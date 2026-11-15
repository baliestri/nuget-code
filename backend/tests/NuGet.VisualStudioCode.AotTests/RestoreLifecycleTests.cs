// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class RestoreLifecycleTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";
  private const string V5 = "5.0.0";
  private const string V6 = "6.0.0";

  private const string WITHOUT_PACKAGES = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
    </Project>
    """;

  private readonly static TimeSpan Timeout = TimeSpan.FromSeconds(120);

  private static string Project(string version)
    => $"""
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup>
          <TargetFramework>net10.0</TargetFramework>
        </PropertyGroup>
        <ItemGroup>
          <PackageReference Include="Alpha" Version="{version}" />
        </ItemGroup>
      </Project>
      """;

  private static string AssetsOf(TestWorkspace workspace, string project)
    => workspace.Root.Combine(project, "obj", "project.assets.json");

  private static void UseSource(TestWorkspace workspace, string url)
    => workspace.WriteConfig(
      $"""
        <packageSources>
          <clear />
          <add key="remote" value="{url}" allowInsecureConnections="true" />
        </packageSources>
      """
    );

  // A feed that answers at once except for the package download, which it holds long enough to be cancelled.
  private static TestFeedServer SlowServer()
    => new(new TestFeedPackage(ALPHA, V5, "Alpha."), new TestFeedPackage(ALPHA, V6, "Alpha.")) {
      PackageDelay = TimeSpan.FromSeconds(30)
    };

  private static async Task WaitForDownloadAsync(TestFeedServer server, CancellationToken ct) {
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(Timeout);
    while (!server.RequestedPaths.Any(path => path.EndsWith(".nupkg", StringComparison.OrdinalIgnoreCase)))
      await Task.Delay(50, timeout.Token).ConfigureAwait(false);
  }

  private static TaskCompletionSource<RestoreDidFinishParams> WatchFinished(BackendClient client) {
    var finished = new TaskCompletionSource<RestoreDidFinishParams>(TaskCreationOptions.RunContinuationsAsynchronously);
    client.Connection.OnNotification(MethodNames.RESTORE_DID_FINISH,
      ProtocolJsonContext.Default.RestoreDidFinishParams,
      parameters =>
      {
        finished.TrySetResult(parameters);
        return Task.CompletedTask;
      });
    return finished;
  }

  private static Task<SolutionOpenResult> OpenAsync(BackendClient client, string solution, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(solution, null),
      ProtocolJsonContext.Default.SolutionOpenParams, ProtocolJsonContext.Default.SolutionOpenResult, ct);

  private static Task<OperationResult> RestoreAsync(BackendClient client, string? engine, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.RESTORE_RUN, new RestoreRunParams(null, engine, false),
      ProtocolJsonContext.Default.RestoreRunParams, ProtocolJsonContext.Default.OperationResult, ct);

  private static Task CancelAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.OPERATIONS_CANCEL, new Empty(), ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty, ct);

  private static int ClosedPort() {
    using var probe = new TcpListener(IPAddress.Loopback, 0);
    probe.Start();
    return ((IPEndPoint)probe.LocalEndpoint).Port;
  }

  [Fact]
  public async Task Opening_a_solution_restores_it_in_the_background() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V5);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(V5));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var finished = WatchFinished(client);
    await client.InitializeAsync(ct, restoreOnOpen: true);

    // That the answer is written before the restore starts is covered by RpcConnectionTests, on the raw messages.
    await OpenAsync(client, solution, ct);
    var notification = await finished.Task.WaitAsync(Timeout, ct);

    Assert.Equal("solutionOpen", notification.Reason);
    var project = Assert.Single(notification.Result.Projects);
    Assert.Equal(app, project.Project, true);
    Assert.Equal(RestoreStates.SUCCEEDED, project.Restore);
    Assert.True(File.Exists(AssetsOf(workspace, "App")));
  }

  [Fact]
  public async Task Restore_on_open_can_be_turned_off() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V5);
    SampleSolution.WriteProject(workspace.Root, "App", Project(V5));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var finished = WatchFinished(client);
    await client.InitializeAsync(ct);

    await OpenAsync(client, solution, ct);
    await Task.Delay(TimeSpan.FromSeconds(3), ct);

    Assert.False(finished.Task.IsCompleted);
    Assert.False(File.Exists(AssetsOf(workspace, "App")));
  }

  [Fact]
  public async Task Restore_on_open_of_a_broken_feed_still_finishes() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    UseSource(workspace, string.Create(CultureInfo.InvariantCulture, $"http://localhost:{ClosedPort()}/v3/index.json"));
    SampleSolution.WriteProject(workspace.Root, "App", Project(V5));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var finished = WatchFinished(client);
    await client.InitializeAsync(ct, restoreOnOpen: true);

    await OpenAsync(client, solution, ct);
    var notification = await finished.Task.WaitAsync(Timeout, ct);

    Assert.Equal(RestoreStates.FAILED, Assert.Single(notification.Result.Projects).Restore);
  }

  [Fact]
  public async Task Cancel_stops_a_running_restore() {
    var ct = TestContext.Current.CancellationToken;
    using var server = SlowServer();
    using var workspace = new TestWorkspace();
    UseSource(workspace, server.V3Url);
    SampleSolution.WriteProject(workspace.Root, "App", Project(V5));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var running = RestoreAsync(client, RestoreEngineNames.CONSOLE, ct);
    await WaitForDownloadAsync(server, ct);
    var watch = Stopwatch.StartNew();
    await CancelAsync(client, ct);
    var result = await running.WaitAsync(Timeout, ct);

    Assert.True(watch.Elapsed < TimeSpan.FromSeconds(10));
    Assert.Equal(RestoreStates.CANCELLED, Assert.Single(result.Projects).Restore);
  }

  [Fact]
  public async Task Cancel_keeps_the_edits() {
    var ct = TestContext.Current.CancellationToken;
    using var server = SlowServer();
    using var workspace = new TestWorkspace();
    UseSource(workspace, server.V3Url);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(V5));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var running = client.Connection.RequestAsync(MethodNames.PACKAGES_UPDATE,
      new PackagesUpdateParams([new PackageChangeParams(PackageChangeKinds.UPDATE, ALPHA, V6, [app])]),
      ProtocolJsonContext.Default.PackagesUpdateParams, ProtocolJsonContext.Default.OperationResult, ct);
    await WaitForDownloadAsync(server, ct);
    await CancelAsync(client, ct);
    var result = await running.WaitAsync(Timeout, ct);

    Assert.Equal(Project(V6), await File.ReadAllTextAsync(app, ct));
    var project = Assert.Single(result.Projects);
    Assert.Equal(RestoreStates.CANCELLED, project.Restore);
    Assert.Equal([app], project.ChangedFiles, StringComparer.OrdinalIgnoreCase);
  }

  [Fact]
  public async Task Opening_another_solution_cancels_the_running_operation() {
    var ct = TestContext.Current.CancellationToken;
    using var server = SlowServer();
    using var workspace = new TestWorkspace();
    UseSource(workspace, server.V3Url);
    SampleSolution.WriteProject(workspace.Root, "App", Project(V5));
    var other = SampleSolution.WriteProject(workspace.Root, "Other", WITHOUT_PACKAGES);
    var first = SampleSolution.WriteSlnx(workspace.Root, "First", "App");
    var second = SampleSolution.WriteSlnx(workspace.Root, "Second", "Other");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, first, ct);

    var running = RestoreAsync(client, null, ct);
    await WaitForDownloadAsync(server, ct);
    var opened = await OpenAsync(client, second, ct);
    string outcome;
    try {
      outcome = Assert.Single((await running.WaitAsync(Timeout, ct)).Projects).Restore;
    }
    catch (RpcException exception) when (exception.Code == RpcErrorCodes.REQUEST_CANCELLED) {
      outcome = RestoreStates.CANCELLED;
    }

    Assert.Equal(RestoreStates.CANCELLED, outcome);
    Assert.Equal(other, Assert.Single(opened.Projects).Path, true);
  }
}
