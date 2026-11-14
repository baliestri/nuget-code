// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Operations;

internal sealed class PlannerFixture : IDisposable {
  private const string CLOSE = "  </ItemGroup>\n</Project>\n";
  private const string OPEN = "<Project>\n  <ItemGroup>\n";

  private readonly TempDirectory _directory = new();
  private readonly List<EvaluatedProject> _projects = [];

  public void Dispose()
    => _directory.Dispose();

  public static string Project(params string[] itemLines)
    => OPEN + string.Concat(itemLines.Select(line => $"    {line}\n")) + CLOSE;

  public static string Reference(string id, string version)
    => $"<PackageReference Include=\"{id}\" Version=\"{version}\" />";

  public static string Reference(string id)
    => $"<PackageReference Include=\"{id}\" />";

  public static string Central(string id, string version)
    => $"<PackageVersion Include=\"{id}\" Version=\"{version}\" />";

  public static PackageChange Update(string id, string version, params string[] projects)
    => new(PackageChangeKinds.UPDATE, id, version, projects);

  public static PackageChange Install(string id, string version, params string[] projects)
    => new(PackageChangeKinds.INSTALL, id, version, projects);

  public static PackageChange Remove(string id, params string[] projects)
    => new(PackageChangeKinds.REMOVE, id, null, projects);

  public string Write(string relativePath, string content)
    => _directory.WriteFile(relativePath, content);

  public string Missing(string relativePath)
    => _directory.Combine(relativePath);

  public string AddProject(string relativePath, string content, bool central,
    params (string Id, string Requested, bool Override)[] packages)
    => AddProject(relativePath, content, central, packages
      .Select(package => new DeclaredPackage(package.Id, package.Requested, ["net10.0"], false, package.Override))
      .ToList());

  public string AddProject(string relativePath, string content, bool central, IReadOnlyList<DeclaredPackage> packages) {
    var path = Write(relativePath, content);
    var info = new ProjectInfo(Path.GetFileNameWithoutExtension(path), path, ["net10.0"], central, null);
    _projects.Add(new EvaluatedProject(info, packages, null));
    return path;
  }

  public ChangePlan Plan(params PackageChange[] changes)
    => new PackageChangePlanner(_projects, new ProjectFileSet()).Plan(changes);

  public static string Applied(string path, ChangePlan plan)
    => TextDocument.Load(path)
      .Apply(plan.Edits
        .Where(edit => string.Equals(edit.File, path, StringComparison.OrdinalIgnoreCase))
        .Select(edit => new TextEdit(edit.Start, edit.Length, edit.NewText)))
      .Text;
}
