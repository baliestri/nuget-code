// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;

namespace NuGet.VisualStudioCode.Projects;

internal sealed class PackageDeclarationFinder(ProjectFileSet files) {
  public const string PACKAGE_REFERENCE = "PackageReference";
  public const string PACKAGE_VERSION = "PackageVersion";
  public const string VERSION = "Version";
  public const string VERSION_OVERRIDE = "VersionOverride";

  private const string CENTRAL_FILE = "Directory.Packages.props";

  private readonly static string[] ImportedFiles = ["Directory.Build.props", "Directory.Build.targets"];

  public ProjectFileSet Files => files;

  public ResolvedDeclaration Resolve(string projectPath, string packageId, bool centralPackageManagement,
    bool hasVersionOverride) {
    if (centralPackageManagement) {
      if (hasVersionOverride) {
        return new ResolvedDeclaration(VersionOriginKinds.VERSION_OVERRIDE,
          FindVersions(projectPath, PACKAGE_REFERENCE, packageId, VERSION_OVERRIDE));
      }

      var central = CentralFile(projectPath);
      return new ResolvedDeclaration(VersionOriginKinds.CENTRAL,
        central is null ? [] : FindVersions(central, PACKAGE_VERSION, packageId, VERSION));
    }

    var inProject = FindVersions(projectPath, PACKAGE_REFERENCE, packageId, VERSION);
    if (inProject.Count > 0) {
      return new ResolvedDeclaration(VersionOriginKinds.PROJECT, inProject);
    }

    foreach (var file in ImportedFilesAbove(projectPath)) {
      var matches = FindVersions(file, PACKAGE_REFERENCE, packageId, VERSION);
      if (matches.Count > 0) {
        return new ResolvedDeclaration(VersionOriginKinds.IMPORTED, matches);
      }
    }

    return new ResolvedDeclaration(VersionOriginKinds.PROJECT, []);
  }

  public static string? CentralFile(string projectPath)
    => ProjectFileSet.FindUpward(Path.GetDirectoryName(projectPath)!, CENTRAL_FILE);

  public static IReadOnlyList<string> ImportedFilesAbove(string projectPath) {
    var directory = Path.GetDirectoryName(projectPath)!;
    var found = new List<string>();
    foreach (var name in ImportedFiles) {
      var file = ProjectFileSet.FindUpward(directory, name);
      if (file is not null) {
        found.Add(file);
      }
    }

    return found;
  }

  public IReadOnlyList<XmlElementSpan> FindItems(string file, string elementName, string packageId) {
    var root = files.Root(file);
    if (root is null) {
      return [];
    }

    var items = new List<XmlElementSpan>();
    foreach (var element in root.Descendants()) {
      if (!string.Equals(element.Name, elementName, StringComparison.Ordinal)) {
        continue;
      }

      var id = element.Attribute("Include")?.Value ?? element.Attribute("Update")?.Value;
      if (string.Equals(id, packageId, StringComparison.OrdinalIgnoreCase)) {
        items.Add(element);
      }
    }

    return items;
  }

  public IReadOnlyList<VersionSlot> FindVersions(string file, string elementName, string packageId,
    string versionName) {
    var text = files.Document(file)?.Text;
    if (text is null) {
      return [];
    }

    var slots = new List<VersionSlot>();
    foreach (var element in FindItems(file, elementName, packageId)) {
      var slot = Slot(file, text, element, versionName);
      if (slot is not null) {
        slots.Add(slot);
      }
    }

    return slots;
  }

  private static VersionSlot? Slot(string file, string text, XmlElementSpan element, string versionName) {
    var attribute = element.Attribute(versionName);
    if (attribute is not null) {
      return new VersionSlot(file, element, attribute.ValueStart, attribute.ValueLength, attribute.Value,
        attribute.NameStart);
    }

    foreach (var child in element.Children) {
      if (!string.Equals(child.Name, versionName, StringComparison.Ordinal) ||
          child.SelfClosing) {
        continue;
      }

      var length = child.EndTagStart - child.StartTagEnd;
      return new VersionSlot(file, element, child.StartTagEnd, length, text.Substring(child.StartTagEnd, length),
        child.Start + 1);
    }

    return null;
  }
}
