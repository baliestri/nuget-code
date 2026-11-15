// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Projects;

public sealed class PackageDeclarationFinderTests {
  private const string ALPHA = "Alpha";

  private const string CENTRAL =
    "<Project>\n  <ItemGroup>\n    <PackageVersion Include=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n</Project>\n";

  private static PackageDeclarationFinder Finder()
    => new(new ProjectFileSet());

  private static string TextOf(VersionSlot slot)
    => File.ReadAllText(slot.File).Substring(slot.ValueStart, slot.ValueLength);

  [Fact]
  public void Attribute_slot_covers_the_value_between_the_quotes() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n</Project>\n");

    var declaration = Finder().Resolve(project, "alpha", false, false);

    var slot = Assert.Single(declaration.Slots);
    Assert.Equal(VersionOriginKinds.PROJECT, declaration.Kind);
    Assert.Equal("1.0.0", TextOf(slot));
    Assert.Equal("1.0.0", slot.Value);
  }

  [Fact]
  public void Child_element_slot_covers_the_element_content() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project>\n  <ItemGroup>\n    <PackageReference Include='Alpha'>\n      <Version>1.0.0</Version>\n    </PackageReference>\n  </ItemGroup>\n</Project>\n");

    var slot = Assert.Single(Finder().Resolve(project, ALPHA, false, false).Slots);

    Assert.Equal("1.0.0", TextOf(slot));
  }

  [Fact]
  public void Single_quoted_values_exclude_the_quotes() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project><ItemGroup><PackageReference Include='Alpha' Version='1.0.0'/></ItemGroup></Project>");

    var slot = Assert.Single(Finder().Resolve(project, ALPHA, false, false).Slots);

    Assert.Equal("1.0.0", TextOf(slot));
  }

  [Fact]
  public void Conditional_declarations_are_returned_in_file_order() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project>\n  <ItemGroup Condition=\"a\">\n    <PackageReference Include=\"Alpha\" Version=\"1.0.0\" />\n  </ItemGroup>\n  <ItemGroup Condition=\"b\">\n    <PackageReference Include=\"Alpha\" Version=\"2.0.0\" />\n  </ItemGroup>\n</Project>\n");

    var slots = Finder().Resolve(project, ALPHA, false, false).Slots;

    Assert.Equal(["1.0.0", "2.0.0"], slots.Select(slot => slot.Value), StringComparer.Ordinal);
  }

  [Fact]
  public void Central_declarations_resolve_to_the_override_or_to_the_nearest_central_file() {
    using var directory = new TempDirectory();
    var central = directory.WriteFile("Directory.Packages.props", CENTRAL);
    var plain = directory.WriteFile(Path.Combine("A", "A.csproj"),
      "<Project><ItemGroup><PackageReference Include=\"Alpha\" /></ItemGroup></Project>");
    var overriding = directory.WriteFile(Path.Combine("B", "B.csproj"),
      "<Project><ItemGroup><PackageReference Include=\"Alpha\" VersionOverride=\"2.0.0\" /></ItemGroup></Project>");
    var finder = Finder();

    var fromCentral = finder.Resolve(plain, ALPHA, true, false);
    var fromOverride = finder.Resolve(overriding, ALPHA, true, true);

    Assert.Equal(VersionOriginKinds.CENTRAL, fromCentral.Kind);
    Assert.Equal(central, Assert.Single(fromCentral.Slots).File);
    Assert.Equal(VersionOriginKinds.VERSION_OVERRIDE, fromOverride.Kind);
    Assert.Equal("2.0.0", Assert.Single(fromOverride.Slots).Value);
  }

  [Fact]
  public void Items_without_a_version_are_found_as_items_and_not_as_versions() {
    using var directory = new TempDirectory();
    var project = directory.WriteFile("App.csproj",
      "<Project><ItemGroup><PackageReference Include=\"Alpha\" /></ItemGroup></Project>");
    var finder = Finder();

    Assert.Single(finder.FindItems(project, PackageDeclarationFinder.PACKAGE_REFERENCE, ALPHA));
    Assert.Empty(finder.Resolve(project, ALPHA, false, false).Slots);
  }

  [Theory]
  [InlineData("<Project><ItemGroup>")]
  [InlineData(null)]
  public void Malformed_and_missing_files_yield_nothing(string? content) {
    using var directory = new TempDirectory();
    var project = content is null ? directory.Combine("Missing.csproj") : directory.WriteFile("App.csproj", content);

    var finder = Finder();

    Assert.Empty(finder.Resolve(project, ALPHA, false, false).Slots);
    Assert.Empty(finder.FindItems(project, PackageDeclarationFinder.PACKAGE_REFERENCE, ALPHA));
  }
}
