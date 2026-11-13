// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Xml;
using System.Xml.Linq;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Projects;

internal sealed class VersionOriginLocator {
  private const string CENTRAL_FILE = "Directory.Packages.props";
  private const string PACKAGE_REFERENCE = "PackageReference";
  private const string VERSION = "Version";

  private readonly static string[] ImportedFiles = ["Directory.Build.props", "Directory.Build.targets"];
  private readonly static VersionOrigin Undetermined = new(VersionOriginKinds.UNDETERMINED, null, null, null);

  private readonly Dictionary<string, XDocument?> _documents = new(StringComparer.Ordinal);

  public VersionOrigin Locate(string projectPath, string packageId, bool centralPackageManagement,
    bool hasVersionOverride) {
    var projectDirectory = Path.GetDirectoryName(projectPath)!;
    if (centralPackageManagement) {
      if (hasVersionOverride) {
        return Decide(Find(projectPath, PACKAGE_REFERENCE, packageId, "VersionOverride"),
          VersionOriginKinds.VERSION_OVERRIDE);
      }

      var central = FindUpward(projectDirectory, CENTRAL_FILE);
      return central is null
        ? Undetermined
        : Decide(Find(central, "PackageVersion", packageId, VERSION), VersionOriginKinds.CENTRAL);
    }

    var inProject = Find(projectPath, PACKAGE_REFERENCE, packageId, VERSION);
    if (inProject.Count > 0) {
      return Decide(inProject, VersionOriginKinds.PROJECT);
    }

    foreach (var name in ImportedFiles) {
      var file = FindUpward(projectDirectory, name);
      var matches = file is null ? [] : Find(file, PACKAGE_REFERENCE, packageId, VERSION);
      if (matches.Count > 0) {
        return Decide(matches, VersionOriginKinds.IMPORTED);
      }
    }

    return Undetermined;
  }

  private static VersionOrigin Decide(List<Declaration> matches, string kind) {
    if (matches.Count != 1) {
      return Undetermined;
    }

    var match = matches[0];
    var resolved = match.Value.Contains("$(", StringComparison.Ordinal) ? VersionOriginKinds.UNDETERMINED : kind;
    return new VersionOrigin(resolved, match.File, match.Line, match.Column);
  }

  private static string? FindUpward(string startDirectory, string fileName) {
    var directory = new DirectoryInfo(startDirectory);
    while (directory is not null) {
      var candidate = Path.Combine(directory.FullName, fileName);
      if (File.Exists(candidate)) {
        return candidate;
      }

      directory = directory.Parent;
    }

    return null;
  }

  private List<Declaration> Find(string file, string elementName, string packageId, string versionName) {
    var document = Load(file);
    if (document is null) {
      return [];
    }

    var matches = new List<Declaration>();
    foreach (var element in document.Descendants()) {
      if (!string.Equals(element.Name.LocalName, elementName, StringComparison.Ordinal)) {
        continue;
      }

      var id = element.Attribute("Include")?.Value ?? element.Attribute("Update")?.Value;
      if (!string.Equals(id, packageId, StringComparison.OrdinalIgnoreCase)) {
        continue;
      }

      var declaration = Declare(file, element, versionName);
      if (declaration is not null) {
        matches.Add(declaration);
      }
    }

    return matches;
  }

  private static Declaration? Declare(string file, XElement element, string versionName) {
    var attribute = element.Attribute(versionName);
    if (attribute is not null) {
      return Position(file, attribute, attribute.Value);
    }

    var child = element.Elements()
      .FirstOrDefault(candidate => string.Equals(candidate.Name.LocalName, versionName, StringComparison.Ordinal));
    return child is null ? null : Position(file, child, child.Value);
  }

  private static Declaration Position(string file, IXmlLineInfo position, string value)
    => new(file, position.LineNumber, position.LinePosition, value);

  private XDocument? Load(string file) {
    if (_documents.TryGetValue(file, out var cached)) {
      return cached;
    }

    XDocument? document;
    try {
      document = XDocument.Load(file, LoadOptions.SetLineInfo);
    }
    catch (XmlException) {
      document = null;
    }
    catch (IOException) {
      document = null;
    }

    _documents[file] = document;
    return document;
  }

  private sealed record Declaration(string File, int Line, int Column, string Value);
}
