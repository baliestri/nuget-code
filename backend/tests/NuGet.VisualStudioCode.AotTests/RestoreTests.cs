// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.Threading.Channels;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class RestoreTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";
  private const string FINISHED = "Restore finished";
  private const string NO_OP = "No further actions are required";
  private const string V1 = "1.0.0";

  private readonly static TimeSpan Timeout = TimeSpan.FromSeconds(60);

  private static string Project(string id, string version, string properties = "")
    => $"""
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup>
          <TargetFramework>net10.0</TargetFramework>{properties}
        </PropertyGroup>
        <ItemGroup>
          <PackageReference Include="{id}" Version="{version}" />
        </ItemGroup>
      </Project>
      """;

  private static string AssetsOf(TestWorkspace workspace, string project)
    => workspace.Root.Combine(project, "obj", "project.assets.json");

  private static ChannelReader<SolutionDidChangeParams> WatchChanges(BackendClient client) {
    var changes = Channel.CreateUnbounded<SolutionDidChangeParams>();
    client.Connection.OnNotification(MethodNames.SOLUTION_DID_CHANGE,
      ProtocolJsonContext.Default.SolutionDidChangeParams,
      change =>
      {
        changes.Writer.TryWrite(change);
        return Task.CompletedTask;
      });
    return changes.Reader;
  }

  private static ConcurrentQueue<string> WatchLog(BackendClient client) {
    var messages = new ConcurrentQueue<string>();
    client.Connection.OnNotification(MethodNames.LOG_ENTRY, ProtocolJsonContext.Default.LogEntry,
      entry =>
      {
        messages.Enqueue(entry.Message);
        return Task.CompletedTask;
      });
    return messages;
  }

  private static async Task OpenAsync(BackendClient client, string solution, CancellationToken ct) {
    await client.InitializeAsync(ct).ConfigureAwait(false);
    await client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(solution, null),
        ProtocolJsonContext.Default.SolutionOpenParams, ProtocolJsonContext.Default.SolutionOpenResult, ct)
      .ConfigureAwait(false);
  }

  private static Task<OperationResult> RestoreAsync(BackendClient client, CancellationToken ct,
    IReadOnlyList<string>? projects = null, string? engine = null, bool force = false)
    => client.Connection.RequestAsync(MethodNames.RESTORE_RUN, new RestoreRunParams(projects, engine, force),
      ProtocolJsonContext.Default.RestoreRunParams, ProtocolJsonContext.Default.OperationResult, ct);

  private static Task<PackagesInstalledResult> InstalledAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_INSTALLED, new Empty(),
      ProtocolJsonContext.Default.Empty, ProtocolJsonContext.Default.PackagesInstalledResult, ct);

  private static async Task<SolutionDidChangeParams> NextAsync(ChannelReader<SolutionDidChangeParams> changes,
    CancellationToken ct) {
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(Timeout);
    return await changes.ReadAsync(timeout.Token).ConfigureAwait(false);
  }

  // The log is delivered on its own; this waits until the closing line of the given restore has arrived.
  private static async Task<IReadOnlyList<string>> LogUntilFinishedAsync(ConcurrentQueue<string> log, int restores,
    CancellationToken ct) {
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(Timeout);
    while (log.Count(message => message.StartsWith(FINISHED, StringComparison.Ordinal)) < restores)
      await Task.Delay(50, timeout.Token).ConfigureAwait(false);

    return [.. log];
  }

  private static ProjectOperationResult ResultOf(OperationResult result, string project)
    => result.Projects.Single(item => string.Equals(item.Project, project, StringComparison.OrdinalIgnoreCase));

  [Fact]
  public async Task Embedded_restore_resolves_packages_from_a_local_feed() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await RestoreAsync(client, ct);
    var installed = await InstalledAsync(client, ct);

    Assert.Equal(RestoreEngineNames.EMBEDDED, result.Engine);
    Assert.False(result.FellBack);
    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, app).Restore);
    Assert.True(File.Exists(AssetsOf(workspace, "App")));
    Assert.Equal(V1, installed.Projects[0].Packages.Single(package => !package.Implicit).ResolvedVersion);
  }

  [Fact]
  public async Task Restore_emits_solution_did_change() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var changes = WatchChanges(client);
    await OpenAsync(client, solution, ct);

    await RestoreAsync(client, ct);
    var change = await NextAsync(changes, ct);

    Assert.Equal([app], change.Projects, StringComparer.OrdinalIgnoreCase);
  }

  [Fact]
  public async Task Second_restore_is_a_no_op_and_force_is_not() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var log = WatchLog(client);
    await OpenAsync(client, solution, ct);

    var first = await RestoreAsync(client, ct);
    var afterFirst = await LogUntilFinishedAsync(log, 1, ct);
    var second = await RestoreAsync(client, ct);
    var afterSecond = await LogUntilFinishedAsync(log, 2, ct);
    var third = await RestoreAsync(client, ct, force: true);
    var afterThird = await LogUntilFinishedAsync(log, 3, ct);

    Assert.All([first, second, third], result => Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, app).Restore));
    Assert.DoesNotContain(afterFirst, message => message.Contains(NO_OP, StringComparison.Ordinal));
    Assert.Contains(afterSecond.Skip(afterFirst.Count), message => message.Contains(NO_OP, StringComparison.Ordinal));
    Assert.DoesNotContain(afterThird.Skip(afterSecond.Count),
      message => message.Contains(NO_OP, StringComparison.Ordinal));
  }

  [Fact]
  public async Task Missing_package_fails_that_project_only() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var a = SampleSolution.WriteProject(workspace.Root, "A", Project(ALPHA, V1));
    var b = SampleSolution.WriteProject(workspace.Root, "B", Project("Ghost", V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "A", "B");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await RestoreAsync(client, ct);

    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, a).Restore);
    var failed = ResultOf(result, b);
    Assert.Equal(RestoreStates.FAILED, failed.Restore);
    Assert.Contains(failed.Messages, message => string.Equals(message.Code, "NU1101", StringComparison.Ordinal));
  }

  [Fact]
  public async Task Restore_of_selected_projects() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var a = SampleSolution.WriteProject(workspace.Root, "A", Project(ALPHA, V1));
    SampleSolution.WriteProject(workspace.Root, "B", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "A", "B");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await RestoreAsync(client, ct, [a]);

    Assert.Equal(a, Assert.Single(result.Projects).Project, true);
    Assert.True(File.Exists(AssetsOf(workspace, "A")));
    Assert.False(File.Exists(AssetsOf(workspace, "B")));
  }

  [Fact]
  public async Task Restore_honours_a_lock_file_in_locked_mode() {
    const string LOCK_FILE = "\n    <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>";
    const string LOCKED = LOCK_FILE + "\n    <RestoreLockedMode>true</RestoreLockedMode>";
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    workspace.AddPackage(ALPHA, "1.1.0");
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1, LOCK_FILE));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var changes = WatchChanges(client);
    await OpenAsync(client, solution, ct);

    var unlocked = await RestoreAsync(client, ct);
    await NextAsync(changes, ct);
    await File.WriteAllTextAsync(app, Project(ALPHA, "1.1.0", LOCKED), ct);
    await client.Connection.NotifyAsync(MethodNames.WORKSPACE_DID_CHANGE_FILES, new DidChangeFilesParams([app]),
      ProtocolJsonContext.Default.DidChangeFilesParams);
    await NextAsync(changes, ct);
    var locked = await RestoreAsync(client, ct);

    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(unlocked, app).Restore);
    Assert.True(File.Exists(workspace.Root.Combine("App", "packages.lock.json")));
    var failed = ResultOf(locked, app);
    Assert.Equal(RestoreStates.FAILED, failed.Restore);
    Assert.Contains(failed.Messages, message => string.Equals(message.Code, "NU1004", StringComparison.Ordinal));
  }

  [Fact]
  public async Task Unknown_engine_is_an_error() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var exception = await Assert.ThrowsAsync<RpcException>(() => RestoreAsync(client, ct, engine: "nope"));

    Assert.Equal(RpcErrorCodes.UNKNOWN_RESTORE_ENGINE, exception.Code);
  }

  [Fact]
  public async Task Restore_requires_an_open_solution() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var exception = await Assert.ThrowsAsync<RpcException>(() => RestoreAsync(client, ct));

    Assert.Equal(RpcErrorCodes.NO_SOLUTION_OPEN, exception.Code);
  }

  [Fact]
  public async Task Configuration_change_selects_the_engine() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    await client.Connection.NotifyAsync(MethodNames.CONFIGURATION_DID_CHANGE, new ConfigurationParams("nope", null),
      ProtocolJsonContext.Default.ConfigurationParams);
    var exception = await Assert.ThrowsAsync<RpcException>(() => RestoreAsync(client, ct));

    Assert.Equal(RpcErrorCodes.UNKNOWN_RESTORE_ENGINE, exception.Code);
  }

  [Theory]
  [InlineData(RestoreEngineNames.MSBUILD)]
  [InlineData(RestoreEngineNames.CONSOLE)]
  public async Task External_engine_restores(string engine) {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await RestoreAsync(client, ct, engine: engine);

    Assert.Equal(engine, result.Engine);
    Assert.False(result.FellBack);
    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, app).Restore);
    Assert.True(File.Exists(AssetsOf(workspace, "App")));
  }

  [Theory]
  [InlineData(RestoreEngineNames.MSBUILD)]
  [InlineData(RestoreEngineNames.CONSOLE)]
  public async Task External_engine_reports_a_missing_package_per_project(string engine) {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var a = SampleSolution.WriteProject(workspace.Root, "A", Project(ALPHA, V1));
    var b = SampleSolution.WriteProject(workspace.Root, "B", Project("Ghost", V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "A", "B");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await RestoreAsync(client, ct, engine: engine);

    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, a).Restore);
    var failed = ResultOf(result, b);
    Assert.Equal(RestoreStates.FAILED, failed.Restore);
    Assert.Contains(failed.Messages, message => string.Equals(message.Code, "NU1101", StringComparison.Ordinal));
  }

  [Fact]
  public async Task External_engine_output_reaches_the_log() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, V1));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var entries = new ConcurrentQueue<LogEntry>();
    client.Connection.OnNotification(MethodNames.LOG_ENTRY, ProtocolJsonContext.Default.LogEntry,
      entry =>
      {
        entries.Enqueue(entry);
        return Task.CompletedTask;
      });
    var log = WatchFinished(entries);
    await OpenAsync(client, solution, ct);

    await RestoreAsync(client, ct, engine: RestoreEngineNames.CONSOLE);
    await log(1, ct);

    Assert.Contains(entries, entry
      => string.Equals(entry.Context, "NUGET", StringComparison.Ordinal) &&
         entry.Message.Contains("App.csproj", StringComparison.Ordinal));
  }

  [Fact]
  public async Task External_engine_authenticates_with_host_credentials() {
    const string USER = "user";
    const string PASSWORD = "s3cr3t-pass";
    var ct = TestContext.Current.CancellationToken;
    using var server = new TestFeedServer(new TestFeedPackage(ALPHA, "5.0.0", "Alpha from private feed."));
    server.RequireBasicAuthentication(USER, PASSWORD);
    using var workspace = new TestWorkspace();
    workspace.WriteConfig(
      $"""
        <packageSources>
          <clear />
          <add key="private" value="{server.V3Url}" allowInsecureConnections="true" />
        </packageSources>
      """
    );
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(ALPHA, "5.0.0"));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var asked = new ConcurrentQueue<string>();
    client.Connection.OnRequest(MethodNames.CREDENTIALS_REQUEST, ProtocolJsonContext.Default.CredentialsRequestParams,
      ProtocolJsonContext.Default.CredentialsRequestResult, (request, _) =>
      {
        asked.Enqueue(request.Source);
        return Task.FromResult(new CredentialsRequestResult(USER, PASSWORD, false));
      });
    await OpenAsync(client, solution, ct);

    var result = await RestoreAsync(client, ct, engine: RestoreEngineNames.CONSOLE);

    Assert.NotEmpty(asked);
    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, app).Restore);
    Assert.True(File.Exists(AssetsOf(workspace, "App")));
  }

  private static Func<int, CancellationToken, Task> WatchFinished(ConcurrentQueue<LogEntry> entries)
    => async (restores, ct) =>
    {
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
      timeout.CancelAfter(Timeout);
      while (entries.Count(entry => entry.Message.StartsWith(FINISHED, StringComparison.Ordinal)) < restores)
        await Task.Delay(50, timeout.Token).ConfigureAwait(false);
    };
}
