// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class PackagePlanTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";

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

  private static Task OpenAsync(BackendClient client, string solution, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(solution, null),
      ProtocolJsonContext.Default.SolutionOpenParams, ProtocolJsonContext.Default.SolutionOpenResult, ct);

  private static Task<PackagesPlanResult> PlanAsync(BackendClient client, string kind, string id, string version,
    IReadOnlyList<string> projects, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_PLAN,
      new PackagesPlanParams([new PackageChangeParams(kind, id, version, projects)]),
      ProtocolJsonContext.Default.PackagesPlanParams, ProtocolJsonContext.Default.PackagesPlanResult, ct);

  [Fact]
  public async Task Plan_describes_an_update_without_touching_files() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var app = SampleSolution.WriteProject(workspace.Root, "App", APP);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    var before = await File.ReadAllBytesAsync(app, ct);
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var plan = await PlanAsync(client, PackageChangeKinds.UPDATE, ALPHA, "1.2.0", [app], ct);

    var edit = Assert.Single(plan.Edits);
    Assert.Equal(app, edit.File, true);
    Assert.Equal(6, edit.Line);
    Assert.Equal("1.0.0", edit.OldText);
    Assert.Equal("1.2.0", edit.NewText);
    Assert.Equal(before, await File.ReadAllBytesAsync(app, ct));
  }

  [Fact]
  public async Task Plan_warns_about_a_shared_central_version() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.Root.WriteFile("Directory.Packages.props", CENTRAL_VERSIONS);
    var a = SampleSolution.WriteProject(workspace.Root, "A", CENTRAL);
    var b = SampleSolution.WriteProject(workspace.Root, "B", CENTRAL);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "A", "B");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var plan = await PlanAsync(client, PackageChangeKinds.UPDATE, ALPHA, "1.2.0", [a], ct);

    var warning = Assert.Single(plan.Warnings, item
      => string.Equals(item.Kind, PlanWarningKinds.CENTRAL_SHARED, StringComparison.Ordinal));
    Assert.Equal([a, b], warning.Projects.Order(StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase);
    Assert.EndsWith("Directory.Packages.props", Assert.Single(plan.Edits).File, StringComparison.Ordinal);
  }

  [Fact]
  public async Task Plan_warns_about_an_incompatible_framework_and_still_plans_the_edit() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, "1.0.0");
    workspace.AddPackageFor("net472", ALPHA, "3.0.0");
    var app = SampleSolution.WriteProject(workspace.Root, "App", APP);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var incompatible = await PlanAsync(client, PackageChangeKinds.UPDATE, ALPHA, "3.0.0", [app], ct);
    var compatible = await PlanAsync(client, PackageChangeKinds.UPDATE, ALPHA, "1.0.1", [app], ct);

    var warning = Assert.Single(incompatible.Warnings);
    Assert.Equal(PlanWarningKinds.FRAMEWORK_MISMATCH, warning.Kind);
    Assert.Equal("net10.0", warning.Detail);
    Assert.Single(incompatible.Edits);
    Assert.Empty(compatible.Warnings);
  }

  [Fact]
  public async Task Plan_of_an_unknown_project_is_an_error() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    SampleSolution.WriteProject(workspace.Root, "App", APP);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    var outside = workspace.Root.Combine("Other", "Other.csproj");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await OpenAsync(client, solution, ct);

    var exception = await Assert.ThrowsAsync<RpcException>(()
      => PlanAsync(client, PackageChangeKinds.UPDATE, ALPHA, "1.2.0", [outside], ct));

    Assert.Equal(RpcErrorCodes.PROJECT_NOT_IN_SESSION, exception.Code);
  }

  [Fact]
  public async Task Plan_requires_an_open_solution() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var missing = workspace.Root.Combine("App.csproj");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var exception = await Assert.ThrowsAsync<RpcException>(()
      => PlanAsync(client, PackageChangeKinds.UPDATE, ALPHA, "1.2.0", [missing], ct));

    Assert.Equal(RpcErrorCodes.NO_SOLUTION_OPEN, exception.Code);
  }
}
