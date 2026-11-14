// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Rpc;
using static NuGet.VisualStudioCode.Tests.Operations.PlannerFixture;

namespace NuGet.VisualStudioCode.Tests.Operations;

public sealed class RemovePlanTests {
  private const string ALPHA = "Alpha";
  private const string APP = "App.csproj";
  private const string BETA = "Beta";
  private const string PACKAGES_PROPS = "Directory.Packages.props";
  private const string V1 = "1.0.0";

  [Fact]
  public void Line_is_removed_without_leaving_a_blank_one() {
    using var fixture = new PlannerFixture();
    var before = Project(Reference(ALPHA, V1), Reference(BETA, V1));
    var app = fixture.AddProject(APP, before, false, (ALPHA, V1, false), (BETA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, app));

    Assert.Equal(Project(Reference(BETA, V1)), Applied(app, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Multi_line_element_is_removed_whole() {
    using var fixture = new PlannerFixture();
    var before = Project(
      "<PackageReference Include=\"Alpha\">\n      <Version>1.0.0</Version>\n    </PackageReference>",
      Reference(BETA, V1)
    );
    var app = fixture.AddProject(APP, before, false, (ALPHA, V1, false), (BETA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, app));

    Assert.Equal(Project(Reference(BETA, V1)), Applied(app, plan));
  }

  [Fact]
  public void Last_item_takes_the_group_with_it() {
    using var fixture = new PlannerFixture();
    var before =
      $"<Project>\n  <PropertyGroup>\n    <A>1</A>\n  </PropertyGroup>\n  <ItemGroup>\n    {Reference(ALPHA, V1)}\n  </ItemGroup>\n</Project>\n";
    var app = fixture.AddProject(APP, before, false, (ALPHA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, app));

    Assert.Equal("<Project>\n  <PropertyGroup>\n    <A>1</A>\n  </PropertyGroup>\n</Project>\n", Applied(app, plan));
  }

  [Fact]
  public void Group_with_other_items_is_kept() {
    using var fixture = new PlannerFixture();
    var before = Project(Reference(ALPHA, V1), "<Compile Remove=\"x.cs\" />");
    var app = fixture.AddProject(APP, before, false, (ALPHA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, app));

    Assert.Equal(Project("<Compile Remove=\"x.cs\" />"), Applied(app, plan));
  }

  [Fact]
  public void Element_sharing_a_line_is_cut_out_of_it() {
    using var fixture = new PlannerFixture();
    var before = $"<Project><ItemGroup>{Reference(ALPHA, V1)}{Reference(BETA, V1)}</ItemGroup></Project>";
    var app = fixture.AddProject(APP, before, false, (ALPHA, V1, false), (BETA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, app));

    Assert.Equal($"<Project><ItemGroup>{Reference(BETA, V1)}</ItemGroup></Project>", Applied(app, plan));
  }

  [Fact]
  public void Crlf_is_kept() {
    using var fixture = new PlannerFixture();
    var before = Project(Reference(ALPHA, V1), Reference(BETA, V1)).Replace("\n", "\r\n", StringComparison.Ordinal);
    var app = fixture.AddProject(APP, before, false, (ALPHA, V1, false), (BETA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, app));

    Assert.Equal(Project(Reference(BETA, V1)).Replace("\n", "\r\n", StringComparison.Ordinal), Applied(app, plan));
  }

  [Fact]
  public void Central_version_goes_with_the_last_reference() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, V1), Central(BETA, V1)));
    var before = Project(Reference(ALPHA), Reference(BETA));
    var a = fixture.AddProject("A/A.csproj", before, true, (ALPHA, V1, false), (BETA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, a));

    Assert.Equal(Project(Reference(BETA)), Applied(a, plan));
    Assert.Equal(Project(Central(BETA, V1)), Applied(props, plan));
    Assert.Equal(PlanWarningKinds.CENTRAL_REMOVED, Assert.Single(plan.Warnings).Kind);
  }

  [Fact]
  public void Central_version_stays_while_another_project_uses_it() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, V1), Central(BETA, V1)));
    var a = fixture.AddProject("A/A.csproj", Project(Reference(ALPHA), Reference(BETA)), true,
      (ALPHA, V1, false), (BETA, V1, false));
    fixture.AddProject("B/B.csproj", Project(Reference(ALPHA)), true, (ALPHA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, a));

    Assert.Equal(Project(Central(ALPHA, V1), Central(BETA, V1)), Applied(props, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Central_version_goes_when_all_users_are_in_the_change() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, V1), Central(BETA, V1)));
    var a = fixture.AddProject("A/A.csproj", Project(Reference(ALPHA), Reference(BETA)), true,
      (ALPHA, V1, false), (BETA, V1, false));
    var b = fixture.AddProject("B/B.csproj", Project(Reference(ALPHA), Reference(BETA)), true,
      (ALPHA, V1, false), (BETA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, a, b));

    Assert.Equal(Project(Central(BETA, V1)), Applied(props, plan));
    Assert.Equal(Project(Reference(BETA)), Applied(b, plan));
    Assert.Equal(PlanWarningKinds.CENTRAL_REMOVED, Assert.Single(plan.Warnings).Kind);
  }

  [Fact]
  public void Imported_package_gets_a_remove_item() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write("Directory.Build.props", Project(Reference(ALPHA, V1)));
    var before = Project(Reference(BETA, V1));
    var app = fixture.AddProject("src/App/App.csproj", before, false, (ALPHA, V1, false), (BETA, V1, false));

    var plan = fixture.Plan(Remove(ALPHA, app));

    Assert.Equal(Project("<PackageReference Remove=\"Alpha\" />", Reference(BETA, V1)), Applied(app, plan));
    Assert.Equal(Project(Reference(ALPHA, V1)), Applied(props, plan));
    Assert.Equal(PlanWarningKinds.REMOVE_ITEM, Assert.Single(plan.Warnings).Kind);
  }

  [Fact]
  public void Implicit_and_missing_packages_are_errors() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(BETA, V1)), false,
    [
      new DeclaredPackage(ALPHA, V1, ["net10.0"], true, false), new DeclaredPackage(BETA, V1, ["net10.0"], false, false)
    ]);

    var implicitPackage = Assert.Throws<RpcException>(() => fixture.Plan(Remove(ALPHA, app)));
    var missing = Assert.Throws<RpcException>(() => fixture.Plan(Remove("Gamma", app)));

    Assert.Equal(RpcErrorCodes.PACKAGE_IMPLICIT, implicitPackage.Code);
    Assert.Equal(RpcErrorCodes.PACKAGE_NOT_INSTALLED, missing.Code);
  }
}
