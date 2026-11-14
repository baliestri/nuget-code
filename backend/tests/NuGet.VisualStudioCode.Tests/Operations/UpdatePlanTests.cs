// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Rpc;
using static NuGet.VisualStudioCode.Tests.Operations.PlannerFixture;

namespace NuGet.VisualStudioCode.Tests.Operations;

public sealed class UpdatePlanTests {
  private const string ALPHA = "Alpha";
  private const string APP = "App.csproj";
  private const string BETA = "Beta";
  private const string BUILD_PROPS = "Directory.Build.props";
  private const string NEW = "1.2.0";
  private const string OLD = "1.0.0";
  private const string PACKAGES_PROPS = "Directory.Packages.props";
  private const string PROPERTY_REFERENCE = "$(AlphaVersion)";

  private static string WithProperty(string definition, params string[] itemLines)
    => $"<Project>\n  <PropertyGroup>\n    {definition}\n  </PropertyGroup>\n  <ItemGroup>\n"
       + string.Concat(itemLines.Select(line => $"    {line}\n"))
       + "  </ItemGroup>\n</Project>\n";

  private static PlanWarning OnlyWarning(ChangePlan plan, string kind) {
    var warning = Assert.Single(plan.Warnings);
    Assert.Equal(kind, warning.Kind);
    return warning;
  }

  [Fact]
  public void Version_attribute_in_the_project() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(ALPHA, OLD)), false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(Project(Reference(ALPHA, NEW)), Applied(app, plan));
    Assert.Empty(plan.Warnings);
    var edit = Assert.Single(plan.Edits);
    Assert.Equal(OLD, edit.OldText);
    Assert.Equal(NEW, edit.NewText);
    Assert.Equal(3, edit.Line);
  }

  [Fact]
  public void Version_child_element() {
    using var fixture = new PlannerFixture();
    const string BEFORE =
      "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\">\n      <Version>1.0.0</Version>\n    </PackageReference>\n  </ItemGroup>\n</Project>\n";
    var app = fixture.AddProject(APP, BEFORE, false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(BEFORE.Replace("<Version>1.0.0<", "<Version>1.2.0<", StringComparison.Ordinal), Applied(app, plan));
  }

  [Fact]
  public void Single_quotes_and_crlf_are_kept() {
    using var fixture = new PlannerFixture();
    const string BEFORE =
      "<Project>\r\n\t<ItemGroup>\r\n\t\t<PackageReference Include='Alpha' Version='1.0.0'/>\r\n\t</ItemGroup>\r\n</Project>\r\n";
    var app = fixture.AddProject(APP, BEFORE, false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(BEFORE.Replace("Version='1.0.0'", "Version='1.2.0'", StringComparison.Ordinal), Applied(app, plan));
  }

  [Fact]
  public void Central_version_moves_for_every_project() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, OLD)));
    var a = fixture.AddProject("A/A.csproj", Project(Reference(ALPHA)), true, (ALPHA, OLD, false));
    var b = fixture.AddProject("B/B.csproj", Project(Reference(ALPHA)), true, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, a));

    Assert.Equal(Project(Central(ALPHA, NEW)), Applied(props, plan));
    Assert.All(plan.Edits, edit => Assert.Equal(props, edit.File, true));
    var warning = OnlyWarning(plan, PlanWarningKinds.CENTRAL_SHARED);
    Assert.Equal([a, b], warning.Projects.Order(StringComparer.Ordinal), StringComparer.Ordinal);
  }

  [Fact]
  public void Version_override_is_edited_and_central_is_not() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, OLD)));
    const string OVERRIDE = "<PackageReference Include=\"Alpha\" VersionOverride=\"1.1.0\" />";
    var a = fixture.AddProject("A/A.csproj", Project(OVERRIDE), true, (ALPHA, "1.1.0", true));

    var plan = fixture.Plan(Update(ALPHA, NEW, a));

    Assert.Equal(Project(OVERRIDE.Replace("1.1.0", NEW, StringComparison.Ordinal)), Applied(a, plan));
    Assert.Equal(Project(Central(ALPHA, OLD)), Applied(props, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Imported_declaration() {
    using var fixture = new PlannerFixture();
    var props = fixture.Write(BUILD_PROPS, Project(Reference(ALPHA, OLD)));
    var a = fixture.AddProject("src/A/A.csproj", "<Project />\n", false, (ALPHA, OLD, false));
    var b = fixture.AddProject("src/B/B.csproj", "<Project />\n", false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, a));

    Assert.Equal(Project(Reference(ALPHA, NEW)), Applied(props, plan));
    var warning = OnlyWarning(plan, PlanWarningKinds.IMPORTED_SHARED);
    Assert.Equal([a, b], warning.Projects.Order(StringComparer.Ordinal), StringComparer.Ordinal);
  }

  [Fact]
  public void Property_definition_is_edited() {
    using var fixture = new PlannerFixture();
    var before = WithProperty("<AlphaVersion>1.0.0</AlphaVersion>", Reference(ALPHA, PROPERTY_REFERENCE));
    var app = fixture.AddProject(APP, before, false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(WithProperty("<AlphaVersion>1.2.0</AlphaVersion>", Reference(ALPHA, PROPERTY_REFERENCE)),
      Applied(app, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Property_shared_with_another_package_warns() {
    using var fixture = new PlannerFixture();
    var before = WithProperty(
      "<AlphaVersion>1.0.0</AlphaVersion>",
      Reference(ALPHA, PROPERTY_REFERENCE),
      Reference(BETA, PROPERTY_REFERENCE)
    );
    var app = fixture.AddProject(APP, before, false, (ALPHA, OLD, false), (BETA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Contains("<AlphaVersion>1.2.0</AlphaVersion>", Applied(app, plan), StringComparison.Ordinal);
    var warning = OnlyWarning(plan, PlanWarningKinds.PROPERTY_SHARED);
    Assert.Equal([BETA], warning.Packages, StringComparer.Ordinal);
    Assert.Equal("AlphaVersion", warning.Detail);
  }

  [Fact]
  public void Property_in_directory_build_props() {
    using var fixture = new PlannerFixture();
    const string DEFINITION =
      "<Project>\n  <PropertyGroup>\n    <AlphaVersion>1.0.0</AlphaVersion>\n  </PropertyGroup>\n</Project>\n";
    var props = fixture.Write(BUILD_PROPS, DEFINITION);
    var before = Project(Reference(ALPHA, PROPERTY_REFERENCE));
    var app = fixture.AddProject("src/App/App.csproj", before, false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(DEFINITION.Replace(OLD, NEW, StringComparison.Ordinal), Applied(props, plan));
    Assert.Equal(before, Applied(app, plan));
  }

  [Theory]
  [InlineData("<AlphaVersion>$(Base).0</AlphaVersion>")]
  [InlineData("<AlphaVersion>1.0.0</AlphaVersion>\n    <AlphaVersion>1.0.1</AlphaVersion>")]
  [InlineData("<Other>1.0.0</Other>")]
  public void Property_that_cannot_be_edited_falls_back_to_a_literal(string definition) {
    using var fixture = new PlannerFixture();
    var before = WithProperty(definition, Reference(ALPHA, PROPERTY_REFERENCE));
    var app = fixture.AddProject(APP, before, false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(WithProperty(definition, Reference(ALPHA, NEW)), Applied(app, plan));
    OnlyWarning(plan, PlanWarningKinds.LITERAL_WRITE);
  }

  [Fact]
  public void Partial_property_expression_falls_back_to_a_literal() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(ALPHA, "1.$(Minor).0")), false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(Project(Reference(ALPHA, NEW)), Applied(app, plan));
    OnlyWarning(plan, PlanWarningKinds.LITERAL_WRITE);
  }

  private static string Conditional(string first, string second)
    => $"<Project>\n  <ItemGroup Condition=\"a\">\n    {Reference(ALPHA, first)}\n  </ItemGroup>\n  <ItemGroup Condition=\"b\">\n    {Reference(ALPHA, second)}\n  </ItemGroup>\n</Project>\n";

  [Theory]
  [InlineData("1.0.0", "1.2.0")]
  [InlineData("0.9.0", "0.9.0")]
  public void Conditional_declarations_move_when_they_hold_the_requested_version(string second, string secondAfter) {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Conditional(OLD, second), false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(Conditional(NEW, secondAfter), Applied(app, plan));
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Downgrade_warns_and_is_still_planned() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(ALPHA, "2.0.0")), false, (ALPHA, "2.0.0", false));

    var plan = fixture.Plan(Update(ALPHA, OLD, app));

    Assert.Equal(Project(Reference(ALPHA, OLD)), Applied(app, plan));
    OnlyWarning(plan, PlanWarningKinds.DOWNGRADE);
  }

  [Theory]
  [InlineData("[1.0.0, 2.0.0)")]
  [InlineData("1.*")]
  public void Range_or_floating_version_is_replaced_and_warned(string current) {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(ALPHA, current)), false, (ALPHA, current, false));

    var plan = fixture.Plan(Update(ALPHA, "1.5.0", app));

    Assert.Equal(Project(Reference(ALPHA, "1.5.0")), Applied(app, plan));
    Assert.Equal(current, OnlyWarning(plan, PlanWarningKinds.RANGE_REPLACED).Detail);
  }

  [Fact]
  public void Same_version_plans_nothing() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(ALPHA, OLD)), false, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, OLD, app));

    Assert.Empty(plan.Edits);
    Assert.Empty(plan.Warnings);
  }

  [Fact]
  public void Several_packages_in_one_plan() {
    using var fixture = new PlannerFixture();
    var before = Project(Reference(ALPHA, OLD), Reference(BETA, OLD));
    var app = fixture.AddProject(APP, before, false, (ALPHA, OLD, false), (BETA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app), Update(BETA, "3.0.0", app));

    Assert.Equal(Project(Reference(ALPHA, NEW), Reference(BETA, "3.0.0")), Applied(app, plan));
  }

  [Fact]
  public void Same_central_edit_from_two_projects_is_planned_once() {
    using var fixture = new PlannerFixture();
    fixture.Write(PACKAGES_PROPS, Project(Central(ALPHA, OLD)));
    var a = fixture.AddProject("A/A.csproj", Project(Reference(ALPHA)), true, (ALPHA, OLD, false));
    var b = fixture.AddProject("B/B.csproj", Project(Reference(ALPHA)), true, (ALPHA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, a, b));

    Assert.Single(plan.Edits);
    OnlyWarning(plan, PlanWarningKinds.CENTRAL_SHARED);
  }

  [Fact]
  public void Comments_and_unrelated_lines_are_untouched() {
    using var fixture = new PlannerFixture();
    var before = Project(
      "<!-- <PackageReference Include=\"Alpha\" Version=\"0.0.1\" /> -->",
      Reference(BETA, OLD),
      Reference(ALPHA, OLD),
      "<Compile Remove=\"x.cs\" />"
    );
    var app = fixture.AddProject(APP, before, false, (ALPHA, OLD, false), (BETA, OLD, false));

    var plan = fixture.Plan(Update(ALPHA, NEW, app));

    Assert.Equal(
      Project(
        "<!-- <PackageReference Include=\"Alpha\" Version=\"0.0.1\" /> -->",
        Reference(BETA, OLD),
        Reference(ALPHA, NEW),
        "<Compile Remove=\"x.cs\" />"
      ),
      Applied(app, plan)
    );
  }

  [Fact]
  public void Project_outside_the_session_is_an_error() {
    using var fixture = new PlannerFixture();
    var outside = fixture.Missing("Other.csproj");

    var exception = Assert.Throws<RpcException>(() => fixture.Plan(Update(ALPHA, NEW, outside)));

    Assert.Equal(RpcErrorCodes.PROJECT_NOT_IN_SESSION, exception.Code);
  }

  [Fact]
  public void Package_the_project_does_not_declare_is_an_error() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, Project(Reference(BETA, OLD)), false, (BETA, OLD, false));

    var exception = Assert.Throws<RpcException>(() => fixture.Plan(Update(ALPHA, NEW, app)));

    Assert.Equal(RpcErrorCodes.PACKAGE_NOT_INSTALLED, exception.Code);
  }

  [Fact]
  public void Implicit_package_is_an_error() {
    using var fixture = new PlannerFixture();
    var app = fixture.AddProject(APP, "<Project />\n", false,
      [new DeclaredPackage(ALPHA, OLD, ["net10.0"], true, false)]);

    var exception = Assert.Throws<RpcException>(() => fixture.Plan(Update(ALPHA, NEW, app)));

    Assert.Equal(RpcErrorCodes.PACKAGE_IMPLICIT, exception.Code);
  }
}
