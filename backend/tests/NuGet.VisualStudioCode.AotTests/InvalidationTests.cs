// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Threading.Channels;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class InvalidationTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";

  private const string WITHOUT_PACKAGES = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
    </Project>
    """;

  private const string WITH_ALPHA = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
      <ItemGroup>
        <PackageReference Include="Alpha" Version="1.0.0" />
      </ItemGroup>
    </Project>
    """;

  private const string ALPHA_FOR_EVERY_PROJECT =
    "<Project><ItemGroup><PackageReference Include=\"Alpha\" Version=\"1.0.0\" /></ItemGroup></Project>";

  private readonly static TimeSpan Timeout = TimeSpan.FromSeconds(60);

  private static async Task<ChannelReader<SolutionDidChangeParams>> OpenAsync(BackendClient client,
    string solution, CancellationToken ct) {
    var changes = Channel.CreateUnbounded<SolutionDidChangeParams>();
    client.Connection.OnNotification(MethodNames.SOLUTION_DID_CHANGE,
      ProtocolJsonContext.Default.SolutionDidChangeParams,
      change =>
      {
        changes.Writer.TryWrite(change);
        return Task.CompletedTask;
      });
    await client.InitializeAsync(ct).ConfigureAwait(false);
    await client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(solution, null),
      ProtocolJsonContext.Default.SolutionOpenParams,
      ProtocolJsonContext.Default.SolutionOpenResult,
      ct).ConfigureAwait(false);
    return changes.Reader;
  }

  private static async Task<SolutionDidChangeParams> NextAsync(ChannelReader<SolutionDidChangeParams> changes,
    CancellationToken ct) {
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(Timeout);
    return await changes.ReadAsync(timeout.Token).ConfigureAwait(false);
  }

  private static Task NotifyAsync(BackendClient client, params string[] paths)
    => client.Connection.NotifyAsync(MethodNames.WORKSPACE_DID_CHANGE_FILES, new DidChangeFilesParams(paths),
      ProtocolJsonContext.Default.DidChangeFilesParams);

  private static Task<PackagesInstalledResult> InstalledAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_INSTALLED, new Empty(),
      ProtocolJsonContext.Default.Empty, ProtocolJsonContext.Default.PackagesInstalledResult, ct);

  private static bool HasAlpha(ProjectPackages project)
    => project.Packages.Any(package => string.Equals(package.Id, ALPHA, StringComparison.Ordinal));

  [Fact]
  public async Task Editing_a_project_reevaluates_only_that_project() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var app = SampleSolution.WriteProject(workspace.Root, "App", WITHOUT_PACKAGES);
    SampleSolution.WriteProject(workspace.Root, "Lib", WITHOUT_PACKAGES);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App", "Lib");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var changes = await OpenAsync(client, solution, ct);

    await File.WriteAllTextAsync(app, WITH_ALPHA, ct);
    await NotifyAsync(client, app);
    var change = await NextAsync(changes, ct);
    var installed = await InstalledAsync(client, ct);

    Assert.Equal([app], change.Projects, StringComparer.OrdinalIgnoreCase);
    Assert.True(HasAlpha(installed.Projects.Single(project
      => project.ProjectPath.EndsWith("App.csproj", StringComparison.Ordinal))));
    Assert.False(HasAlpha(installed.Projects.Single(project
      => project.ProjectPath.EndsWith("Lib.csproj", StringComparison.Ordinal))));
  }

  [Fact]
  public async Task Editing_a_shared_file_reevaluates_every_project() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var app = SampleSolution.WriteProject(workspace.Root, "App", WITHOUT_PACKAGES);
    var lib = SampleSolution.WriteProject(workspace.Root, "Lib", WITHOUT_PACKAGES);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App", "Lib");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var changes = await OpenAsync(client, solution, ct);

    var props = workspace.Root.WriteFile("Directory.Build.props", ALPHA_FOR_EVERY_PROJECT);
    await NotifyAsync(client, props);
    var change = await NextAsync(changes, ct);
    var installed = await InstalledAsync(client, ct);

    Assert.Equal([app, lib], change.Projects, StringComparer.OrdinalIgnoreCase);
    Assert.All(installed.Projects, project => Assert.True(HasAlpha(project)));
  }

  [Fact]
  public async Task A_new_assets_file_notifies_and_exposes_resolved_versions() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, "1.0.0");
    var app = SampleSolution.WriteProject(workspace.Root, "App", WITH_ALPHA);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var changes = await OpenAsync(client, solution, ct);
    var before = await InstalledAsync(client, ct);

    await workspace.RestoreAsync(app, ct);
    await NotifyAsync(client, workspace.Root.Combine("App", "obj", "project.assets.json"));
    var change = await NextAsync(changes, ct);
    var after = await InstalledAsync(client, ct);

    Assert.False(before.Projects[0].Packages.Single(package => !package.Implicit).Restored);
    Assert.Equal([app], change.Projects, StringComparer.OrdinalIgnoreCase);
    Assert.Equal("1.0.0", after.Projects[0].Packages.Single(package => !package.Implicit).ResolvedVersion);
  }

  [Fact]
  public async Task Answers_come_from_the_previous_model_while_a_reevaluation_runs() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var app = SampleSolution.WriteProject(workspace.Root, "App", WITH_ALPHA);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    var changes = await OpenAsync(client, solution, ct);

    await File.WriteAllTextAsync(app, WITHOUT_PACKAGES, ct);
    await NotifyAsync(client, app);
    var immediately = await InstalledAsync(client, ct);
    await NextAsync(changes, ct);
    var afterwards = await InstalledAsync(client, ct);

    Assert.True(HasAlpha(immediately.Projects[0]));
    Assert.False(HasAlpha(afterwards.Projects[0]));
  }
}
