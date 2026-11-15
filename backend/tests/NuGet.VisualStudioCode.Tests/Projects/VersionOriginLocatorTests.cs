// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Projects;

public sealed class VersionOriginLocatorTests {
  private const string ALPHA = "Alpha";

  private const string ALPHA_IN_PROJECT =
    "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n</Project>\n";

  private const string ALPHA_WITHOUT_VERSION =
    "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\" />\n  </ItemGroup>\n</Project>\n";

  private const string ALPHA_CENTRAL =
    "<Project>\n  <ItemGroup>\n    <PackageVersion Include=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n</Project>\n";

  [Fact]
  public void Version_attribute_in_the_project_is_located_with_line_and_column() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj", ALPHA_IN_PROJECT);

    var origin = new VersionOriginLocator().Locate(project, "alpha", false, false);

    Assert.Equal(VersionOriginKinds.PROJECT, origin.Kind);
    Assert.Equal(project, origin.File);
    Assert.Equal(3, origin.Line);
    Assert.Equal(39, origin.Column);
  }

  [Fact]
  public void Version_child_element_in_the_project_is_located() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\">\n      <Version>1.0.0</Version>\n    </PackageReference>\n  </ItemGroup>\n</Project>\n");

    var origin = new VersionOriginLocator().Locate(project, ALPHA, false, false);

    Assert.Equal(VersionOriginKinds.PROJECT, origin.Kind);
    Assert.Equal(4, origin.Line);
  }

  [Fact]
  public void Version_declared_in_directory_build_props_is_imported() {
    using var directory = new TempDirectory();
    var props = directory.WriteFile("Directory.Build.props", ALPHA_IN_PROJECT);
    var project = directory.WriteFile(Path.Combine("src", "App", "App.csproj"), "<Project />\n");

    var origin = new VersionOriginLocator().Locate(project, ALPHA, false, false);

    Assert.Equal(VersionOriginKinds.IMPORTED, origin.Kind);
    Assert.Equal(props, origin.File);
    Assert.Equal(3, origin.Line);
  }

  [Fact]
  public void Central_version_is_located_in_the_nearest_directory_packages_props() {
    using var directory = new TempDirectory();
    directory.WriteFile("Directory.Packages.props",
      "<Project>\n  <ItemGroup>\n    <PackageVersion Include=\"Alpha\" Version=\"9.9.9\" />\n  </ItemGroup>\n</Project>\n");
    var nearest = directory.WriteFile(Path.Combine("src", "Directory.Packages.props"),
      "<Project>\n  <ItemGroup>\n    <PackageVersion Include=\"Beta\" Version=\"2.0.0\" />\n    <PackageVersion Include=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n</Project>\n");
    var project = directory.WriteFile(Path.Combine("src", "App", "App.csproj"), ALPHA_WITHOUT_VERSION);

    var origin = new VersionOriginLocator().Locate(project, ALPHA, true, false);

    Assert.Equal(VersionOriginKinds.CENTRAL, origin.Kind);
    Assert.Equal(nearest, origin.File);
    Assert.Equal(4, origin.Line);
  }

  [Fact]
  public void Version_override_is_located_in_the_project() {
    using var directory = new TempDirectory();
    directory.WriteFile("Directory.Packages.props", ALPHA_CENTRAL);
    var project = directory.WriteFile("App.csproj",
      "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\" VersionOverride=\"2.0.0\" />\n  </ItemGroup>\n</Project>\n");

    var origin = new VersionOriginLocator().Locate(project, ALPHA, true, true);

    Assert.Equal(VersionOriginKinds.VERSION_OVERRIDE, origin.Kind);
    Assert.Equal(project, origin.File);
    Assert.Equal(3, origin.Line);
  }

  [Fact]
  public void Version_from_a_property_is_undetermined_but_still_points_to_the_declaration() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\" Version=\"$(AlphaVersion)\" />\n  </ItemGroup>\n</Project>\n");

    var origin = new VersionOriginLocator().Locate(project, ALPHA, false, false);

    Assert.Equal(VersionOriginKinds.UNDETERMINED, origin.Kind);
    Assert.Equal(project, origin.File);
    Assert.Equal(3, origin.Line);
  }

  [Fact]
  public void Two_conditional_declarations_are_undetermined_without_position() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project>\n  <ItemGroup Condition=\"'$(TargetFramework)' == 'net8.0'\">\n    <PackageReference Include=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n  <ItemGroup Condition=\"'$(TargetFramework)' == 'net10.0'\">\n    <PackageReference Include=\"Alpha\" Version=\"2.0.0\" />\n  </ItemGroup>\n</Project>\n");

    var origin = new VersionOriginLocator().Locate(project, ALPHA, false, false);

    Assert.Equal(VersionOriginKinds.UNDETERMINED, origin.Kind);
    Assert.Null(origin.File);
    Assert.Null(origin.Line);
  }

  [Theory]
  [InlineData("<Project><ItemGroup>", false)]
  [InlineData("<Project />", false)]
  [InlineData("<Project />", true)]
  public void Unreadable_or_missing_declarations_are_undetermined(string projectXml, bool centralPackageManagement) {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj", projectXml);

    var origin = new VersionOriginLocator().Locate(project, ALPHA, centralPackageManagement, false);

    Assert.Equal(VersionOriginKinds.UNDETERMINED, origin.Kind);
    Assert.Null(origin.File);
  }

  [Fact]
  public void Update_items_and_msbuild_namespaces_are_matched() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\">\n  <ItemGroup>\n    <PackageReference Update=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n</Project>\n");

    var origin = new VersionOriginLocator().Locate(project, ALPHA, false, false);

    Assert.Equal(VersionOriginKinds.PROJECT, origin.Kind);
    Assert.Equal(3, origin.Line);
  }
}
