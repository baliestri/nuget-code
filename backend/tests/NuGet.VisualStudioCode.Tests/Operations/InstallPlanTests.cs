// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Rpc;
using static NuGet.VisualStudioCode.Tests.Operations.PlannerFixture;

namespace NuGet.VisualStudioCode.Tests.Operations;

public sealed class InstallPlanTests {
  private const string ALPHA = "Alpha";
  private const string APP = "App.csproj";
  private const string BETA = "Beta";
  private const string GAMMA = "Gamma";
  private const string PACKAGES_PROPS = "Directory.Packages.props";
  private const string V1 = "1.0.0";
  private const string V2 = "2.0.0";

  [Theory]
  [InlineData(ALPHA, GAMMA, BETA, "Alpha,Beta,Gamma")]
  [InlineData(BETA, GAMMA, ALPHA, "Alpha,Beta,Gamma")]
  [InlineData(ALPHA, BETA, GAMMA, "Alpha,Beta,Gamma")]
  [InlineData(GAMMA, ALPHA, BETA, "Gamma,Alpha,Beta")]
  public void New_line_goes_in_order_when_the_group_is_sorted_and_last_otherwise(
    string first, string second, string installed, string expectedOrder) {
    using var fixture = new PlannerFixture();
    var before = Project(Reference(first, V1), Reference(second, V1));
    var app = fixture.AddProject(APP, before, false, (first, V1, false), (second, V1, false));

    var plan = fixture.Plan(Install(installed, V2, app));

    var expected = Project(
      expectedOrder.Split(',')
        .Select(id => Reference(id, string.Equals(id, installed, StringComparison.Ordinal) ? V2 : V1))
        .ToArray()
    );
    Assert.Equal(expected, Applied(app, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Indentation_quotes_and_line_endings_are_copied() {
    using var fixture = new PlannerFixture();
    const string BEFORE =
      "<Project>\r\n\t<ItemGroup>\r\n\t\t<PackageReference Include='Alpha' Version='1.0.0'/>\r\n\t</ItemGroup>\r\n</Project>\r\n";
    var app = fixture.AddProject(APP, BEFORE, false, (ALPHA, V1, false));

    var plan = fixture.Plan(Install(BETA, V2, app));

    Assert.Equal(
      "<Project>\r\n\t<ItemGroup>\r\n\t\t<PackageReference Include='Alpha' Version='1.0.0'/>\r\n\t\t<PackageReference Include='Beta' Version='2.0.0'/>\r\n\t</ItemGroup>\r\n</Project>\r\n",
      Applied(app, plan)
    );
  }

  [Fact]
  public void Conditional_groups_are_skipped() {
    using var fixture = new PlannerFixture();
    var before =
      $"<Project>\n  <ItemGroup Condition=\"a\">\n    {Reference(ALPHA, V1)}\n  </ItemGroup>\n  <ItemGroup>\n    {Reference(GAMMA, V1)}\n  </ItemGroup>\n</Project>\n";
    var app = fixture.AddProject(APP, before, false, (ALPHA, V1, false), (GAMMA, V1, false));

    var plan = fixture.Plan(Install(BETA, V2, app));

    Assert.Equal(
      $"<Project>\n  <ItemGroup Condition=\"a\">\n    {Reference(ALPHA, V1)}\n  </ItemGroup>\n  <ItemGroup>\n    {Reference(BETA, V2)}\n    {Reference(GAMMA, V1)}\n  </ItemGroup>\n</Project>\n",
      Applied(app, plan)
    );
  }

  [Fact]
  public void Group_without_package_references_is_not_used() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project("<Compile Remove=\"x.cs\" />"), false);

    var plan = fixture.Plan(Install(ALPHA, V1, app));

    Assert.Equal(
      $"<Project>\n  <ItemGroup>\n    <Compile Remove=\"x.cs\" />\n  </ItemGroup>\n  <ItemGroup>\n    {Reference(ALPHA, V1)}\n  </ItemGroup>\n</Project>\n",
      Applied(app, plan)
    );
  }

  [Theory]
  [InlineData("  ")]
  [InlineData("    ")]
  [InlineData("\t")]
  public void Project_without_item_groups_gets_one_with_its_own_indentation(string unit) {
    using var fixture = new PlannerFixture();
    var before =
      $"<Project Sdk=\"x\">\n{unit}<PropertyGroup>\n{unit}{unit}<A>1</A>\n{unit}</PropertyGroup>\n</Project>\n";
    var app = fixture.AddProject(APP, before, false);

    var plan = fixture.Plan(Install(ALPHA, V1, app));

    Assert.Equal(
      $"<Project Sdk=\"x\">\n{unit}<PropertyGroup>\n{unit}{unit}<A>1</A>\n{unit}</PropertyGroup>\n{unit}<ItemGroup>\n{unit}{unit}{Reference(ALPHA, V1)}\n{unit}</ItemGroup>\n</Project>\n",
      Applied(app, plan)
    );
  }

  [Fact]
  public void Closing_tag_on_the_same_line_as_content() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, "<Project><PropertyGroup /></Project>", false);

    var plan = fixture.Plan(Install(ALPHA, V1, app));

    Assert.Equal(
      $"<Project><PropertyGroup />\n  <ItemGroup>\n    {Reference(ALPHA, V1)}\n  </ItemGroup>\n</Project>",
      Applied(app, plan)
    );
  }

  [Fact]
  public void Self_closing_root_cannot_be_edited() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, "<Project />", false);

    var exception = Assert.Throws<RpcException>(() => fixture.Plan(Install(ALPHA, V1, app)));

    Assert.Equal(RpcErrorCodes.EDIT_NOT_POSSIBLE, exception.Code);
  }

  [Fact]
  public void Central_install_adds_reference_and_version() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(BETA, V1)));
    var app = fixture.AddProject("A/A.csproj", Project(Reference(BETA)), true, (BETA, V1, false));

    var plan = fixture.Plan(Install(ALPHA, V1, app));

    Assert.Equal(Project(Reference(ALPHA), Reference(BETA)), Applied(app, plan));
    Assert.Equal(Project(Central(ALPHA, V1), Central(BETA, V1)), Applied(props, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Central_install_reuses_an_existing_version() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, V1), Central(BETA, V1)));
    var a = fixture.AddProject("A/A.csproj", Project(Reference(BETA)), true, (BETA, V1, false));
    fixture.AddProject("B/B.csproj", Project(Reference(ALPHA)), true, (ALPHA, V1, false));

    var plan = fixture.Plan(Install(ALPHA, V1, a));

    Assert.Equal(Project(Reference(ALPHA), Reference(BETA)), Applied(a, plan));
    Assert.Equal(Project(Central(ALPHA, V1), Central(BETA, V1)), Applied(props, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Central_install_with_another_version_moves_the_central_one() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, V1), Central(BETA, V1)));
    var a = fixture.AddProject("A/A.csproj", Project(Reference(BETA)), true, (BETA, V1, false));
    var b = fixture.AddProject("B/B.csproj", Project(Reference(ALPHA)), true, (ALPHA, V1, false));

    var plan = fixture.Plan(Install(ALPHA, V2, a));

    Assert.Equal(Project(Central(ALPHA, V2), Central(BETA, V1)), Applied(props, plan));
    Assert.Equal(Project(Reference(ALPHA), Reference(BETA)), Applied(a, plan));
    var warning = Assert.Single(plan.Warnings);
    Assert.Equal(PlanWarningKinds.CENTRAL_SHARED, warning.Kind);
    Assert.Equal([a, b], warning.Projects.Order(StringComparer.Ordinal), StringComparer.Ordinal);
  }

  [Fact]
  public void Central_file_without_versions_gets_a_group() {
    using var fixture = new PlannerFixture();
    const string PROPS =
      "<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n</Project>\n";
    var props = fixture.Write(PACKAGES_PROPS, PROPS);
    var app = fixture.AddProject("A/A.csproj", "<Project>\n</Project>\n", true);

    var plan = fixture.Plan(Install(ALPHA, V1, app));

    Assert.Equal(
      $"<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n  <ItemGroup>\n    {Central(ALPHA, V1)}\n  </ItemGroup>\n</Project>\n",
      Applied(props, plan)
    );
    Assert.Equal($"<Project>\n  <ItemGroup>\n    {Reference(ALPHA)}\n  </ItemGroup>\n</Project>\n", Applied(app, plan));
  }

  [Fact]
  public void Central_install_without_a_central_file_is_an_error() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject("A/A.csproj", Project(Reference(BETA)), true, (BETA, V1, false));

    var exception = Assert.Throws<RpcException>(() => fixture.Plan(Install(ALPHA, V1, app)));

    Assert.Equal(RpcErrorCodes.EDIT_NOT_POSSIBLE, exception.Code);
  }

  [Fact]
  public void Installing_an_installed_package_is_an_update() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(ALPHA, V1)), false, (ALPHA, V1, false));

    var plan = fixture.Plan(Install(ALPHA, V2, app));

    Assert.Equal(Project(Reference(ALPHA, V2)), Applied(app, plan));
  }

  [Fact]
  public void Install_into_several_projects() {
    using var fixture = new PlannerFixture();
    var a = fixture.AddProject("A/A.csproj", Project(Reference(BETA, V1)), false, (BETA, V1, false));
    var b = fixture.AddProject("B/B.csproj", Project(Reference(BETA, V1)), false, (BETA, V1, false));

    var plan = fixture.Plan(Install(ALPHA, V1, a, b));

    Assert.Equal(Project(Reference(ALPHA, V1), Reference(BETA, V1)), Applied(a, plan));
    Assert.Equal(Project(Reference(ALPHA, V1), Reference(BETA, V1)), Applied(b, plan));
  }

  [Fact]
  public void Central_install_into_several_projects_adds_the_version_once() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(BETA, V1)));
    var a = fixture.AddProject("A/A.csproj", Project(Reference(BETA)), true, (BETA, V1, false));
    var b = fixture.AddProject("B/B.csproj", Project(Reference(BETA)), true, (BETA, V1, false));

    var plan = fixture.Plan(Install(ALPHA, V1, a, b));

    Assert.Equal(Project(Central(ALPHA, V1), Central(BETA, V1)), Applied(props, plan));
  }
}
