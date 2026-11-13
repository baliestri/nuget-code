// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Methods;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sdk;
using NuGet.VisualStudioCode.Sessions;

var input = new BufferedStream(Console.OpenStandardInput());
var output = Console.OpenStandardOutput();
using var writer = new MessageWriter(output);
var connection = new RpcConnection(new MessageReader(input), writer);
var log = new BackendLog(entry
  => connection.NotifyAsync(MethodNames.LOG_ENTRY, entry, ProtocolJsonContext.Default.LogEntry)
);
var sdk = new SdkService();
var sessions = new SessionManager();
var settings = new SettingsProvider(() => sessions.Current?.Solution.Directory);
var evaluator = new ProjectEvaluator(new RestoreGraphGenerator(sdk), log);

LifecycleMethods.Register(connection, sdk, log);
ConfigurationMethods.Register(connection, settings, () => sessions.Current is not null);
SolutionMethods.Register(connection, sessions, evaluator);
PackagesMethods.Register(connection, sessions);

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
