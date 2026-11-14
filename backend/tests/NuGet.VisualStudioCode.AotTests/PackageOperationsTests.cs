// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.Threading.Channels;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class PackageOperationsTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";
  private const string BETA = "Beta";
  private const string GAMMA = "Gamma";
  private const string V1 = "1.0.0";
  private const string V2 = "2.0.0";

  private const string WITHOUT_PACKAGES = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
    </Project>
    """;

  private static string Project(string items, string properties = "")
    => $"""
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup>
          <TargetFramework>net10.0</TargetFramework>{properties}
        </PropertyGroup>
        <ItemGroup>
          {items}
        </ItemGroup>
      </Project>
      """;

  private static string Reference(string id, string version)
    => $"<PackageReference Include=\"{id}\" Version=\"{version}\" />";

  private static string CentralVersions(string id, string version)
    => $"""
      <Project>
        <PropertyGroup>
          <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
        </PropertyGroup>
        <ItemGroup>
          <PackageVersion Include="{id}" Version="{version}" />
        </ItemGroup>
      </Project>
      """;

  private static async Task OpenAsync(BackendClient client, string solution, CancellationToken ct) {
    await client.InitializeAsync(ct).ConfigureAwait(false);
    await client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(solution, null),
        ProtocolJsonContext.Default.SolutionOpenParams, ProtocolJsonContext.Default.SolutionOpenResult, ct)
      .ConfigureAwait(false);
  }

  private static Task<OperationResult> UpdateAsync(BackendClient client, CancellationToken ct,
    params (string Id, string Version, string Project)[] changes)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_UPDATE,
      new PackagesUpdateParams(changes
        .Select(change
          => new PackageChangeParams(PackageChangeKinds.UPDATE, change.Id, change.Version, [change.Project]))
        .ToList()),
      ProtocolJsonContext.Default.PackagesUpdateParams, ProtocolJsonContext.Default.OperationResult, ct);

  private static Task<OperationResult> InstallAsync(BackendClient client, string id, string version, string project,
    CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_INSTALL, new PackagesInstallParams(id, version, [project]),
      ProtocolJsonContext.Default.PackagesInstallParams, ProtocolJsonContext.Default.OperationResult, ct);

  private static async Task<IReadOnlyList<InstalledPackage>> InstalledAsync(BackendClient client, string project,
    CancellationToken ct) {
    var result = await client.Connection.RequestAsync(MethodNames.PACKAGES_INSTALLED, new Empty(),
      ProtocolJsonContext.Default.Empty, ProtocolJsonContext.Default.PackagesInstalledResult, ct).ConfigureAwait(false);
    return result.Projects
      .Single(item => string.Equals(item.ProjectPath, project, StringComparison.OrdinalIgnoreCase))
      .Packages.Where(package => !package.Implicit)
      .ToList();
  }

  private static ProjectOperationResult ResultOf(OperationResult result, string project)
    => result.Projects.Single(item => string.Equals(item.Project, project, StringComparison.OrdinalIgnoreCase));

  [Fact]
  public async Task Update_edits_the_project_and_restores() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    workspace.AddPackage(ALPHA, "1.2.0");
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(Reference(ALPHA, V1)));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await UpdateAsync(client, ct, (ALPHA, "1.2.0", app));
    var package = Assert.Single(await InstalledAsync(client, app, ct));

    Assert.Equal(Project(Reference(ALPHA, "1.2.0")), await File.ReadAllTextAsync(app, ct));
    var outcome = ResultOf(result, app);
    Assert.Equal(RestoreStates.SUCCEEDED, outcome.Restore);
    Assert.Equal([app], outcome.ChangedFiles, StringComparer.OrdinalIgnoreCase);
    Assert.Empty(outcome.EditErrors);
    Assert.Equal(RestoreEngineNames.EMBEDDED, result.Engine);
    Assert.Equal("1.2.0", package.RequestedVersion);
    Assert.Equal("1.2.0", package.ResolvedVersion);
  }

  [Fact]
  public async Task Update_to_a_version_that_does_not_exist_keeps_the_edit() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(Reference(ALPHA, V1)));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await UpdateAsync(client, ct, (ALPHA, "9.9.9", app));
    var package = Assert.Single(await InstalledAsync(client, app, ct));

    Assert.Contains("Version=\"9.9.9\"", await File.ReadAllTextAsync(app, ct), StringComparison.Ordinal);
    var outcome = ResultOf(result, app);
    Assert.Equal(RestoreStates.FAILED, outcome.Restore);
    Assert.Contains(outcome.Messages, message => string.Equals(message.Code, "NU1102", StringComparison.Ordinal));
    Assert.Equal("9.9.9", package.RequestedVersion);
    Assert.False(package.Restored);
  }

  [Fact]
  public async Task Update_all_covers_central_property_and_imported_versions() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    foreach (var id in (string[])[ALPHA, BETA, GAMMA]) {
      workspace.AddPackage(id, V1);
      workspace.AddPackage(id, V2);
    }

    var centralVersions = workspace.Root.WriteFile("Central/Directory.Packages.props", CentralVersions(ALPHA, V1));
    var central = SampleSolution.WriteProject(workspace.Root, "Central",
      Project("<PackageReference Include=\"Alpha\" />"));
    var imported = workspace.Root.WriteFile("Plain/Directory.Build.props",
      $"<Project>\n  <ItemGroup>\n    {Reference(GAMMA, V1)}\n  </ItemGroup>\n</Project>\n");
    var plain = SampleSolution.WriteProject(workspace.Root, "Plain",
      Project(Reference(BETA, "$(BetaVersion)"), "\n    <BetaVersion>1.0.0</BetaVersion>"));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "Central", "Plain");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var log = new ConcurrentQueue<string>();
    client.Connection.OnNotification(MethodNames.LOG_ENTRY, ProtocolJsonContext.Default.LogEntry,
      entry =>
      {
        log.Enqueue(entry.Message);
        return Task.CompletedTask;
      });
    await OpenAsync(client, solution, ct);

    var result = await UpdateAsync(client, ct, (ALPHA, V2, central), (BETA, V2, plain), (GAMMA, V2, plain));
    var inCentral = await InstalledAsync(client, central, ct);
    var inPlain = await InstalledAsync(client, plain, ct);
    await Task.Delay(500, ct);

    Assert.Contains("Version=\"2.0.0\"", await File.ReadAllTextAsync(centralVersions, ct), StringComparison.Ordinal);
    Assert.Contains("<BetaVersion>2.0.0</BetaVersion>", await File.ReadAllTextAsync(plain, ct),
      StringComparison.Ordinal);
    Assert.Contains("Version=\"2.0.0\"", await File.ReadAllTextAsync(imported, ct), StringComparison.Ordinal);
    Assert.All(result.Projects, project => Assert.Equal(RestoreStates.SUCCEEDED, project.Restore));
    Assert.All(inCentral.Concat(inPlain), package => Assert.Equal(V2, package.ResolvedVersion));
    Assert.Equal(3, inCentral.Count + inPlain.Count);
    Assert.Single(log, message => message.StartsWith("Restore started", StringComparison.Ordinal));
  }

  [Fact]
  public async Task Install_adds_the_reference_and_restores() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var app = SampleSolution.WriteProject(workspace.Root, "App", WITHOUT_PACKAGES);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await InstallAsync(client, ALPHA, V1, app, ct);
    var package = Assert.Single(await InstalledAsync(client, app, ct));

    Assert.Contains(Reference(ALPHA, V1), await File.ReadAllTextAsync(app, ct), StringComparison.Ordinal);
    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, app).Restore);
    Assert.Equal(ALPHA, package.Id);
    Assert.Equal(V1, package.ResolvedVersion);
  }

  [Fact]
  public async Task Install_with_central_versions_edits_both_files() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    workspace.AddPackage(BETA, V1);
    var versions = workspace.Root.WriteFile("Directory.Packages.props", CentralVersions(ALPHA, V1));
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project("<PackageReference Include=\"Alpha\" />"));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await InstallAsync(client, BETA, V1, app, ct);
    var installed = await InstalledAsync(client, app, ct);

    Assert.Contains("<PackageReference Include=\"Beta\" />", await File.ReadAllTextAsync(app, ct),
      StringComparison.Ordinal);
    Assert.Contains("<PackageVersion Include=\"Beta\" Version=\"1.0.0\" />", await File.ReadAllTextAsync(versions, ct),
      StringComparison.Ordinal);
    var outcome = ResultOf(result, app);
    Assert.Equal(RestoreStates.SUCCEEDED, outcome.Restore);
    Assert.Equal(2, outcome.ChangedFiles.Count);
    Assert.Contains(installed, package => string.Equals(package.Id, BETA, StringComparison.Ordinal));
  }

  [Fact]
  public async Task Remove_deletes_the_reference_and_restores() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(Reference(ALPHA, V1)));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var result = await client.Connection.RequestAsync(MethodNames.PACKAGES_REMOVE,
      new PackagesRemoveParams(ALPHA, [app]), ProtocolJsonContext.Default.PackagesRemoveParams,
      ProtocolJsonContext.Default.OperationResult, ct);
    var installed = await InstalledAsync(client, app, ct);

    Assert.DoesNotContain(ALPHA, await File.ReadAllTextAsync(app, ct), StringComparison.Ordinal);
    Assert.Equal(RestoreStates.SUCCEEDED, ResultOf(result, app).Restore);
    Assert.Empty(installed);
  }

  [Fact]
  public async Task Operation_reports_progress_in_order() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    workspace.AddPackage(ALPHA, V2);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(Reference(ALPHA, V1)));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var steps = new ConcurrentQueue<string>();
    client.Connection.OnNotification(MethodNames.OPERATION_PROGRESS,
      ProtocolJsonContext.Default.OperationProgressParams,
      step =>
      {
        steps.Enqueue(step.Step);
        return Task.CompletedTask;
      });
    await OpenAsync(client, solution, ct);

    await UpdateAsync(client, ct, (ALPHA, V2, app));
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(TimeSpan.FromSeconds(10));
    while (steps.Count < 5) await Task.Delay(20, timeout.Token);

    Assert.Equal(
      [
        OperationSteps.PLANNING, OperationSteps.EDITING, OperationSteps.EVALUATING, OperationSteps.RESTORING,
        OperationSteps.DONE
      ],
      steps,
      StringComparer.Ordinal
    );
  }

  [Fact]
  public async Task Read_only_file_fails_that_project_and_not_the_other() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    workspace.AddPackage(ALPHA, V2);
    var a = SampleSolution.WriteProject(workspace.Root, "A", Project(Reference(ALPHA, V1)));
    var b = SampleSolution.WriteProject(workspace.Root, "B", Project(Reference(ALPHA, V1)));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "A", "B");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);
    File.SetAttributes(a, FileAttributes.ReadOnly);
    try {
      var result = await UpdateAsync(client, ct, (ALPHA, V2, a), (ALPHA, V2, b));

      var failed = ResultOf(result, a);
      Assert.NotEmpty(failed.EditErrors);
      Assert.Equal(RestoreStates.NOT_RUN, failed.Restore);
      Assert.Contains(Reference(ALPHA, V1), await File.ReadAllTextAsync(a, ct), StringComparison.Ordinal);
      var written = ResultOf(result, b);
      Assert.Empty(written.EditErrors);
      Assert.Equal(RestoreStates.SUCCEEDED, written.Restore);
      Assert.Contains(Reference(ALPHA, V2), await File.ReadAllTextAsync(b, ct), StringComparison.Ordinal);
    }
    finally {
      File.SetAttributes(a, FileAttributes.Normal);
    }
  }

  [Fact]
  public async Task Request_errors_happen_before_any_write() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var content = Project(Reference(ALPHA, V1));
    var app = SampleSolution.WriteProject(workspace.Root, "App", content);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    var outside = workspace.Root.Combine("Other", "Other.csproj");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, solution, ct);

    var exception = await Assert.ThrowsAsync<RpcException>(()
      => UpdateAsync(client, ct, (ALPHA, V2, app), (ALPHA, V2, outside)));

    Assert.Equal(RpcErrorCodes.PROJECT_NOT_IN_SESSION, exception.Code);
    Assert.Equal(content, await File.ReadAllTextAsync(app, ct));
  }

  [Fact]
  public async Task Host_notification_for_our_own_edit_does_not_reevaluate_twice() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, V1);
    workspace.AddPackage(ALPHA, V2);
    var app = SampleSolution.WriteProject(workspace.Root, "App", Project(Reference(ALPHA, V1)));
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var changes = Channel.CreateUnbounded<SolutionDidChangeParams>();
    client.Connection.OnNotification(MethodNames.SOLUTION_DID_CHANGE,
      ProtocolJsonContext.Default.SolutionDidChangeParams,
      change =>
      {
        changes.Writer.TryWrite(change);
        return Task.CompletedTask;
      });
    await OpenAsync(client, solution, ct);

    await UpdateAsync(client, ct, (ALPHA, V2, app));
    await Task.Delay(TimeSpan.FromSeconds(2), ct);
    var before = changes.Reader.Count;
    await client.Connection.NotifyAsync(MethodNames.WORKSPACE_DID_CHANGE_FILES, new DidChangeFilesParams([app]),
      ProtocolJsonContext.Default.DidChangeFilesParams);
    await Task.Delay(TimeSpan.FromSeconds(2), ct);

    Assert.True(before >= 1);
    Assert.Equal(before, changes.Reader.Count);
  }
}
