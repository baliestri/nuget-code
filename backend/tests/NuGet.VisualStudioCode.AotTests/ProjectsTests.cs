// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class ProjectsTests(PublishedBackend backend) {
  private const string APP = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
      <ItemGroup>
        <PackageReference Include="Alpha" Version="1.0.0" />
      </ItemGroup>
    </Project>
    """;

  private const string FLOATING = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
      <ItemGroup>
        <PackageReference Include="Alpha" Version="1.*" />
      </ItemGroup>
    </Project>
    """;

  private const string MULTI = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFrameworks>net8.0;net10.0</TargetFrameworks>
      </PropertyGroup>
      <ItemGroup>
        <PackageReference Include="Alpha" Version="1.0.0" />
        <PackageReference Include="Beta" Version="2.0.0" Condition="'$(TargetFramework)' == 'net10.0'" />
      </ItemGroup>
    </Project>
    """;

  private const string CENTRAL = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
      <ItemGroup>
        <PackageReference Include="Alpha" />
      </ItemGroup>
    </Project>
    """;

  private const string CENTRAL_VERSIONS = """
    <Project>
      <PropertyGroup>
        <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
      </PropertyGroup>
      <ItemGroup>
        <PackageVersion Include="Alpha" Version="1.0.0" />
      </ItemGroup>
    </Project>
    """;

  private const string BROKEN = "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup>";

  private static Task<SolutionOpenResult> OpenAsync(BackendClient client, string path, CancellationToken ct)
    => client.Connection.RequestAsync(
      MethodNames.SOLUTION_OPEN,
      new SolutionOpenParams(path, null),
      ProtocolJsonContext.Default.SolutionOpenParams,
      ProtocolJsonContext.Default.SolutionOpenResult,
      ct
    );

  private static Task<PackagesInstalledResult> InstalledAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(
      MethodNames.PACKAGES_INSTALLED,
      new Empty(),
      ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.PackagesInstalledResult,
      ct
    );

  private static IReadOnlyList<InstalledPackage> PackagesOf(PackagesInstalledResult installed, string projectFile)
    => installed.Projects
      .Single(project => project.ProjectPath.EndsWith(projectFile, StringComparison.Ordinal))
      .Packages;

  private static InstalledPackage Package(IReadOnlyList<InstalledPackage> packages, string id)
    => packages.Single(package => string.Equals(package.Id, id, StringComparison.Ordinal));

  [Fact]
  public async Task Open_evaluates_frameworks_and_central_package_management() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "App", APP);
    SampleSolution.WriteProject(workspace.Root, "Multi", MULTI);
    SampleSolution.WriteProject(workspace.Root, "Central", CENTRAL);
    workspace.Root.WriteFile(Path.Combine("Central", "Directory.Packages.props"), CENTRAL_VERSIONS);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App", "Central", "Multi");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var result = await OpenAsync(client, solution, ct);

    var projects = result.Projects.ToDictionary(project => project.Name, StringComparer.Ordinal);
    Assert.All(result.Projects, project => Assert.Null(project.Error));
    Assert.Equal(["net10.0"], projects["App"].Frameworks, StringComparer.Ordinal);
    Assert.False(projects["App"].CentralPackageManagement);
    Assert.Equal(["net8.0", "net10.0"], projects["Multi"].Frameworks, StringComparer.Ordinal);
    Assert.True(projects["Central"].CentralPackageManagement);
  }

  [Fact]
  public async Task Installed_lists_requested_versions_per_framework_before_any_restore() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "Multi", MULTI);
    SampleSolution.WriteProject(workspace.Root, "Central", CENTRAL);
    workspace.Root.WriteFile(Path.Combine("Central", "Directory.Packages.props"), CENTRAL_VERSIONS);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "Central", "Multi");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var installed = await InstalledAsync(client, ct);

    var multi = PackagesOf(installed, "Multi.csproj");
    var alpha = Package(multi, "Alpha");
    Assert.Equal("1.0.0", alpha.RequestedVersion);
    Assert.Equal(["net8.0", "net10.0"], alpha.Frameworks, StringComparer.Ordinal);
    Assert.Equal(["net10.0"], Package(multi, "Beta").Frameworks, StringComparer.Ordinal);
    Assert.False(alpha.Restored);
    Assert.Null(alpha.ResolvedVersion);
    Assert.Equal("1.0.0", Package(PackagesOf(installed, "Central.csproj"), "Alpha").RequestedVersion);
  }

  [Fact]
  public async Task Installed_reports_the_resolved_version_after_a_restore() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage("Alpha", "1.0.0");
    workspace.AddPackage("Alpha", "1.2.0");
    var project = SampleSolution.WriteProject(workspace.Root, "App", FLOATING);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await workspace.RestoreAsync(project, ct);
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var installed = await InstalledAsync(client, ct);

    var alpha = Package(PackagesOf(installed, "App.csproj"), "Alpha");
    Assert.Equal("1.*", alpha.RequestedVersion);
    Assert.Equal("1.2.0", alpha.ResolvedVersion);
    Assert.True(alpha.Restored);
  }

  [Fact]
  public async Task A_project_that_does_not_evaluate_is_marked_and_the_others_are_returned() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "App", APP);
    SampleSolution.WriteProject(workspace.Root, "Broken", BROKEN);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App", "Broken");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var result = await OpenAsync(client, solution, ct);

    var projects = result.Projects.ToDictionary(project => project.Name, StringComparer.Ordinal);
    Assert.Null(projects["App"].Error);
    Assert.Equal(["net10.0"], projects["App"].Frameworks, StringComparer.Ordinal);
    Assert.False(string.IsNullOrWhiteSpace(projects["Broken"].Error));
  }

  [Fact]
  public async Task Open_fails_with_evaluation_failed_when_no_project_evaluates() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "Broken", BROKEN);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "Broken");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var exception = await Assert.ThrowsAsync<RpcException>(() => OpenAsync(client, solution, ct));

    Assert.Equal(RpcErrorCodes.EVALUATION_FAILED, exception.Code);
  }

  [Fact]
  public async Task Installed_requires_an_open_solution_and_open_requires_an_sdk() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "App", APP);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct, workspace.Root.Combine("no-dotnet-here"));

    var noSession = await Assert.ThrowsAsync<RpcException>(() => InstalledAsync(client, ct));
    var noSdk = await Assert.ThrowsAsync<RpcException>(() => OpenAsync(client, solution, ct));

    Assert.Equal(RpcErrorCodes.NO_SOLUTION_OPEN, noSession.Code);
    Assert.Equal(RpcErrorCodes.SDK_NOT_FOUND, noSdk.Code);
  }
}
