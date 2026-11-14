// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Versioning;
using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Credentials;
using NuGet.VisualStudioCode.Feeds;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Methods;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sdk;
using NuGet.VisualStudioCode.Sessions;

var input = new BufferedStream(Console.OpenStandardInput());
var output = Console.OpenStandardOutput();
using var writer = new MessageWriter(output);
var connection = new RpcConnection(new MessageReader(input), writer);
var log = new BackendLog(entry
  => connection.NotifyAsync(MethodNames.LOG_ENTRY, entry, ProtocolJsonContext.Default.LogEntry));
var sdk = new SdkService();
var sessions = new SessionManager();
var settings = new SettingsProvider(() => sessions.Current?.Solution.Directory);
var evaluator = new ProjectEvaluator(new RestoreGraphGenerator(sdk), log);
using var refresher = new SessionRefresher(sessions, evaluator, log,
  change => connection.NotifyAsync(MethodNames.SOLUTION_DID_CHANGE, change,
    ProtocolJsonContext.Default.SolutionDidChangeParams), TimeSpan.FromMilliseconds(250));

var feedOptions = new FeedOptions();
var nugetLogger = new NuGetLogAdapter(log);
var feeds = new FeedRegistry(settings);
var feedQuery = new FeedQuery(feedOptions, log);
var detailsCache = new TimedCache<PackageDetailsResult>(TimeSpan.FromMinutes(2), TimeProvider.System);
var search = new PackageSearchService(feeds, feedQuery, nugetLogger);
var details = new PackageDetailsService(feeds, feedQuery, nugetLogger, detailsCache);
var versionsCache = new TimedCache<IReadOnlyList<NuGetVersion>>(TimeSpan.FromMinutes(2), TimeProvider.System);
var updates = new PackageUpdatesService(feeds, feedQuery, nugetLogger, versionsCache);

var options = new BackendOptions();
var advisor = new PlanAdvisor(details);

LifecycleMethods.Register(connection, sdk, log, feedOptions, options);
ConfigurationMethods.Register(connection, settings, () => sessions.Current is not null);
PackagesMethods.Register(connection, sessions, search, details, updates);
WorkspaceMethods.Register(connection, refresher, ResetFeeds);

var credentials = new HostCredentialProvider((request, ct) => connection.RequestAsync(MethodNames.CREDENTIALS_REQUEST,
  request, ProtocolJsonContext.Default.CredentialsRequestParams, ProtocolJsonContext.Default.CredentialsRequestResult,
  ct));
CredentialSetup.Install(credentials, nugetLogger, log);
CredentialsMethods.Register(connection, credentials, ResetFeeds);

using var queue = new OperationQueue();
var engines = new Dictionary<string, IRestoreEngine>(StringComparer.Ordinal) {
  [RestoreEngineNames.EMBEDDED] = new EmbeddedRestoreEngine(nugetLogger),
  [RestoreEngineNames.MSBUILD] =
    new ExternalRestoreEngine(RestoreEngineNames.MSBUILD, sdk, settings, credentials, log),
  [RestoreEngineNames.CONSOLE] =
    new ExternalRestoreEngine(RestoreEngineNames.CONSOLE, sdk, settings, credentials, log)
};
var restore = new RestoreService(engines, options, log);
RestoreMethods.Register(connection, sessions, queue, restore, refresher, options);

var openRestore = new SolutionOpenRestore(sessions, queue, restore, refresher, options, log,
  finished => connection.NotifyAsync(MethodNames.RESTORE_DID_FINISH, finished,
    ProtocolJsonContext.Default.RestoreDidFinishParams));
SolutionMethods.Register(connection, sessions, evaluator, queue, openRestore);

ConfigurationMethods.RegisterWrites(connection, queue,
  new SourcesWriter(settings, ConfigFileClassifier.IsMachineWide), refresher, ResetFeeds);

var operations = new PackageOperationService(sessions, refresher, restore, log,
  step => connection.NotifyAsync(MethodNames.OPERATION_PROGRESS, step,
    ProtocolJsonContext.Default.OperationProgressParams));
OperationMethods.Register(connection, sessions, advisor, queue, operations);

try {
  await connection.RunAsync(CancellationToken.None).ConfigureAwait(false);
  return 0;
}
catch (Exception exception) when (exception is IOException or InvalidDataException) {
  await Console.Error.WriteLineAsync(exception.ToString()).ConfigureAwait(false);
  return 1;
}
finally {
  ChildProcesses.KillAll();
  await log.DisposeAsync().ConfigureAwait(false);
  await input.DisposeAsync().ConfigureAwait(false);
  await output.DisposeAsync().ConfigureAwait(false);
}

void ResetFeeds() {
  feeds.Reset();
  detailsCache.Clear();
  versionsCache.Clear();
}
