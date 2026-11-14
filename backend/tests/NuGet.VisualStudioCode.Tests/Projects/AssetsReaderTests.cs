// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;
using System.Text;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Projects;

public sealed class AssetsReaderTests {
  /// <summary>
  ///   Writes a <c>project.assets.json</c>. A library is <c>"Name/1.0.0"</c>, or <c>"Name/1.0.0 -> A, B"</c>
  ///   with what it depends on; a name that starts with <c>project:</c> is a referenced project.
  /// </summary>
  private static string Assets(TempDirectory directory, params (string Framework, string[] Libraries)[] targets) {
    var libraries = new SortedDictionary<string, string>(StringComparer.Ordinal);
    var json = new StringBuilder("{\"version\":3,\"targets\":{");
    for (var index = 0; index < targets.Length; index++) {
      var (framework, entries) = targets[index];
      json.Append(index == 0 ? string.Empty : ",").Append(CultureInfo.InvariantCulture, $"\"{framework}\":{{");
      json.AppendJoin(',', entries.Select(entry => Library(entry, libraries))).Append('}');
    }

    json.Append("},\"libraries\":{");
    json.AppendJoin(',', libraries.Select(library
      => $"\"{library.Key}\":{{\"type\":\"{library.Value}\",\"path\":\"{library.Key.ToLowerInvariant()}\",\"files\":[]}}"));
    json.Append("},\"projectFileDependencyGroups\":{}}");
    return directory.WriteFile("obj/project.assets.json", json.ToString());
  }

  private static string Library(string entry, SortedDictionary<string, string> libraries) {
    var parts = entry.Split(" -> ");
    var isProject = parts[0].StartsWith("project:", StringComparison.Ordinal);
    var key = isProject ? parts[0]["project:".Length..] : parts[0];
    var type = isProject ? "project" : "package";
    libraries[key] = type;
    var dependencies = parts.Length == 1
      ? string.Empty
      : ",\"dependencies\":{" + string.Join(',', parts[1].Split(", ").Select(name => $"\"{name}\":\"1.0.0\"")) + "}";
    return $"\"{key}\":{{\"type\":\"{type}\"{dependencies}}}";
  }

  [Fact]
  public void Direct_packages_are_not_transitive() {
    using var directory = new TempDirectory();
    var path = Assets(directory, ("net10.0", ["Direct/1.0.0"]));

    var assets = AssetsReader.Read(path, ["Direct"]);

    Assert.NotNull(assets);
    Assert.Equal("1.0.0", assets.Resolved["Direct"]);
    Assert.Empty(assets.Transitive);
  }

  [Fact]
  public void A_dependency_of_a_direct_package_is_transitive_via_it() {
    using var directory = new TempDirectory();
    var path = Assets(directory, ("net10.0", ["Direct/1.0.0 -> Inner", "Inner/2.5.0"]));

    var transitive = Assert.Single(AssetsReader.Read(path, ["Direct"])!.Transitive);

    Assert.Equal("Inner", transitive.Id);
    Assert.Equal("2.5.0", transitive.ResolvedVersion);
    Assert.Equal(["Direct"], transitive.Via);
    Assert.Equal(["net10.0"], transitive.Frameworks);
  }

  [Fact]
  public void A_deeper_dependency_names_the_direct_package_it_comes_from() {
    using var directory = new TempDirectory();
    var path = Assets(directory, ("net10.0", ["A/1.0.0 -> B", "B/1.0.0 -> C", "C/1.0.0"]));

    var transitive = AssetsReader.Read(path, ["A"])!.Transitive;

    Assert.Equal(["B", "C"], transitive.Select(package => package.Id), StringComparer.Ordinal);
    Assert.All(transitive, package => Assert.Equal(["A"], package.Via));
  }

  [Fact]
  public void A_package_reached_by_two_direct_packages_names_both() {
    using var directory = new TempDirectory();
    var path = Assets(directory, ("net10.0", ["Zeta/1.0.0 -> Shared", "Alpha/1.0.0 -> Shared", "Shared/1.0.0"]));

    var shared = Assert.Single(AssetsReader.Read(path, ["Zeta", "Alpha"])!.Transitive);

    Assert.Equal(["Alpha", "Zeta"], shared.Via);
  }

  [Fact]
  public void A_direct_package_that_another_direct_package_depends_on_stays_direct() {
    using var directory = new TempDirectory();
    var path = Assets(directory, ("net10.0", ["A/1.0.0 -> B", "B/1.0.0"]));

    Assert.Empty(AssetsReader.Read(path, ["A", "B"])!.Transitive);
  }

  [Fact]
  public void A_package_that_comes_only_through_a_project_reference_has_no_via() {
    using var directory = new TempDirectory();
    var path = Assets(directory, ("net10.0", ["project:Lib/1.0.0 -> FromLib", "FromLib/3.0.0", "Direct/1.0.0"]));

    var transitive = Assert.Single(AssetsReader.Read(path, ["Direct"])!.Transitive);

    Assert.Equal("FromLib", transitive.Id);
    Assert.Empty(transitive.Via);
  }

  [Fact]
  public void Frameworks_are_the_ones_where_it_appears() {
    using var directory = new TempDirectory();
    var path = Assets(directory,
      ("net8.0", ["Direct/1.0.0 -> Polyfill", "Polyfill/1.0.0"]),
      ("net10.0", ["Direct/1.0.0"]));

    var polyfill = Assert.Single(AssetsReader.Read(path, ["Direct"])!.Transitive);

    Assert.Equal(["net8.0"], polyfill.Frameworks);
  }

  [Fact]
  public void Ids_are_matched_without_regard_to_case() {
    using var directory = new TempDirectory();
    var path = Assets(directory, ("net10.0", ["Direct/1.0.0 -> inner", "Inner/1.0.0"]));

    var transitive = Assert.Single(AssetsReader.Read(path, ["DIRECT"])!.Transitive);

    Assert.Equal(["Direct"], transitive.Via, StringComparer.OrdinalIgnoreCase);
  }

  [Fact]
  public void A_missing_file_is_a_project_that_was_not_restored() {
    using var directory = new TempDirectory();

    Assert.Null(AssetsReader.Read(null, []));
    Assert.Null(AssetsReader.Read(directory.Combine("obj", "project.assets.json"), []));
  }

  [Fact]
  public void A_file_that_cannot_be_understood_resolves_nothing() {
    using var directory = new TempDirectory();

    var assets = AssetsReader.Read(directory.WriteFile("obj/project.assets.json", "{ not json"), ["Direct"]);

    // NuGet reads such a file as an empty one.
    Assert.NotNull(assets);
    Assert.Empty(assets.Resolved);
    Assert.Empty(assets.Transitive);
  }
}
