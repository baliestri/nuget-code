// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Versioning;
using NuGet.VisualStudioCode.Editing;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Turns requested package changes into text edits. It reads the project files and the evaluated model and
///   writes nothing. No rule here refuses a change because it might not restore: that is the restore's call.
/// </summary>
internal sealed class PackageChangePlanner(IReadOnlyList<EvaluatedProject> projects, ProjectFileSet files) {
  private const string PROPERTY_CLOSE = ")";
  private const string PROPERTY_GROUP = "PropertyGroup";
  private const string PROPERTY_OPEN = "$(";

  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  private readonly PackageDeclarationFinder _finder = new(files);

  public ChangePlan Plan(IReadOnlyList<PackageChange> changes) {
    var plan = new PlanBuilder(files);
    foreach (var change in changes) {
      foreach (var path in change.Projects) {
        var project = projects.FirstOrDefault(candidate => PathComparer.Equals(candidate.Info.Path, path)) ??
                      throw new RpcException(RpcErrorCodes.PROJECT_NOT_IN_SESSION,
                        $"The project '{path}' is not part of the open solution.");
        PlanChange(plan, project, change);
      }
    }

    return plan.Build();
  }

  private void PlanChange(PlanBuilder plan, EvaluatedProject project, PackageChange change) {
    switch (change.Kind) {
      case PackageChangeKinds.UPDATE:
        PlanUpdate(plan, project, change.Id, RequireVersion(change));
        break;
      case PackageChangeKinds.INSTALL:
        PlanInstall(plan, project, change.Id, RequireVersion(change));
        break;
      case PackageChangeKinds.REMOVE:
        PlanRemove(plan, project, change.Id);
        break;
      default:
        throw new RpcException(RpcErrorCodes.INVALID_PARAMS, $"Unknown package change '{change.Kind}'.");
    }
  }

  private static string RequireVersion(PackageChange change)
    => string.IsNullOrWhiteSpace(change.Version)
      ? throw new RpcException(RpcErrorCodes.INVALID_PARAMS, $"A version is required to {change.Kind} '{change.Id}'.")
      : change.Version;

  private static DeclaredPackage RequireDeclared(EvaluatedProject project, string id) {
    var declared =
      project.Packages.FirstOrDefault(package => string.Equals(package.Id, id, StringComparison.OrdinalIgnoreCase)) ??
      throw new RpcException(RpcErrorCodes.PACKAGE_NOT_INSTALLED,
        $"The project '{project.Info.Name}' does not reference '{id}'.");
    return declared.Implicit
      ? throw new RpcException(RpcErrorCodes.PACKAGE_IMPLICIT,
        $"'{id}' is added to '{project.Info.Name}' by the SDK and has no declaration to change.")
      : declared;
  }

  private void PlanUpdate(PlanBuilder plan, EvaluatedProject project, string id, string version) {
    var declared = RequireDeclared(project, id);
    var declaration = _finder.Resolve(project.Info.Path, id, project.Info.CentralPackageManagement,
      declared.HasVersionOverride);
    var slots = SelectSlots(declaration.Slots, declared.RequestedVersion);
    if (slots.Count == 0) {
      throw new RpcException(RpcErrorCodes.EDIT_NOT_POSSIBLE,
        $"No version declaration of '{id}' was found for '{project.Info.Name}'.");
    }

    var edited = false;
    foreach (var slot in slots) edited |= PlanSlot(plan, project, slot, id, version);

    if (edited) {
      WarnShared(plan, declaration.Kind, slots[0].File, id);
    }
  }

  // With several declarations (one per framework, say) only those holding the version the project resolves to
  // are moved; a declaration deliberately pinned elsewhere stays.
  private static IReadOnlyList<VersionSlot> SelectSlots(IReadOnlyList<VersionSlot> slots, string? requested) {
    if (slots.Count <= 1) {
      return slots;
    }

    var match = slots.FirstOrDefault(slot => string.Equals(ShortForm(slot.Value), requested, StringComparison.Ordinal));
    return match is null
      ? slots
      : slots.Where(slot => string.Equals(slot.Value, match.Value, StringComparison.Ordinal)).ToList();
  }

  private static string ShortForm(string value)
    => VersionRange.TryParse(value, out var range) ? range.ToShortString() : value;

  private bool PlanSlot(PlanBuilder plan, EvaluatedProject project, VersionSlot slot, string id, string version) {
    var value = slot.Value.Trim();
    if (!value.Contains(PROPERTY_OPEN, StringComparison.Ordinal)) {
      return ReplaceVersion(plan, slot.File, slot.ValueStart, slot.ValueLength, value, id, version);
    }

    var property = PropertyName(value);
    var definitions = property is null ? [] : FindProperty(project.Info.Path, property);
    if (property is null ||
        definitions.Count != 1 ||
        !IsLiteral(definitions[0])) {
      plan.Warn(PlanWarningKinds.LITERAL_WRITE, id, slot.File, detail: slot.Value);
      return plan.Replace(slot.File, slot.ValueStart, slot.ValueLength, version);
    }

    var (file, element) = definitions[0];
    var start = element.StartTagEnd;
    var length = element.EndTagStart - start;
    var current = files.Document(file)!.Text.Substring(start, length).Trim();
    var edited = ReplaceVersion(plan, file, start, length, current, id, version);
    if (edited) {
      var others = PackagesUsing(project.Info.Path, property, id);
      if (others.Count > 0) {
        plan.Warn(PlanWarningKinds.PROPERTY_SHARED, id, file, packages: others, detail: property);
      }
    }

    return edited;
  }

  private static bool ReplaceVersion(PlanBuilder plan, string file, int start, int length, string current, string id,
    string version) {
    if (!plan.Replace(file, start, length, version)) {
      return false;
    }

    if (!NuGetVersion.TryParse(current, out var currentVersion)) {
      plan.Warn(PlanWarningKinds.RANGE_REPLACED, id, file, detail: current);
    }
    else if (NuGetVersion.TryParse(version, out var newVersion) &&
             newVersion < currentVersion) {
      plan.Warn(PlanWarningKinds.DOWNGRADE, id, file, detail: current);
    }

    return true;
  }

  private static string? PropertyName(string value) {
    if (!value.StartsWith(PROPERTY_OPEN, StringComparison.Ordinal) ||
        !value.EndsWith(PROPERTY_CLOSE, StringComparison.Ordinal)) {
      return null;
    }

    var name = value[PROPERTY_OPEN.Length..^PROPERTY_CLOSE.Length];
    return name.Length > 0 && name.All(character => char.IsLetterOrDigit(character) || character is '_' or '.')
      ? name
      : null;
  }

  private static bool IsLiteral((string File, XmlElementSpan Element) definition)
    => definition.Element is { SelfClosing: false, Children.Count: 0 };

  private IReadOnlyList<string> PropertyFiles(string projectPath) {
    var candidates = new List<string> { projectPath };
    candidates.AddRange(PackageDeclarationFinder.ImportedFilesAbove(projectPath));
    var central = PackageDeclarationFinder.CentralFile(projectPath);
    if (central is not null) {
      candidates.Add(central);
    }

    return candidates;
  }

  private List<(string File, XmlElementSpan Element)> FindProperty(string projectPath, string name) {
    var definitions = new List<(string File, XmlElementSpan Element)>();
    foreach (var file in PropertyFiles(projectPath)) {
      var root = files.Root(file);
      var text = files.Document(file)?.Text;
      if (root is null ||
          text is null) {
        continue;
      }

      foreach (var element in root.Descendants())
        if (string.Equals(element.Name, name, StringComparison.Ordinal) &&
            string.Equals(element.Parent?.Name, PROPERTY_GROUP, StringComparison.Ordinal)) {
          definitions.Add((file, element));
        }
    }

    // A definition whose own value is computed cannot be edited as a version.
    return definitions.Count == 1 && ContentOf(definitions[0]).Contains(PROPERTY_OPEN, StringComparison.Ordinal)
      ? []
      : definitions;
  }

  private string ContentOf((string File, XmlElementSpan Element) definition) {
    var text = files.Document(definition.File)?.Text ?? string.Empty;
    return definition.Element.SelfClosing
      ? string.Empty
      : text[definition.Element.StartTagEnd..definition.Element.EndTagStart];
  }

  private List<string> PackagesUsing(string projectPath, string property, string exceptId) {
    var reference = $"{PROPERTY_OPEN}{property}{PROPERTY_CLOSE}";
    var packages = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var file in PropertyFiles(projectPath)) {
      var root = files.Root(file);
      if (root is null) {
        continue;
      }

      foreach (var element in root.Descendants()) {
        var id = element.Attribute("Include")?.Value ?? element.Attribute("Update")?.Value;
        if (id is null ||
            string.Equals(id, exceptId, StringComparison.OrdinalIgnoreCase) ||
            !IsPackageItem(element)) {
          continue;
        }

        if (UsesValue(file, element, reference)) {
          packages.Add(id);
        }
      }
    }

    return [.. packages];
  }

  private static bool IsPackageItem(XmlElementSpan element)
    => element.Name is PackageDeclarationFinder.PACKAGE_REFERENCE or PackageDeclarationFinder.PACKAGE_VERSION;

  private bool UsesValue(string file, XmlElementSpan element, string value) {
    if (element.Attributes.Any(attribute => string.Equals(attribute.Value.Trim(), value, StringComparison.Ordinal))) {
      return true;
    }

    var text = files.Document(file)?.Text ?? string.Empty;
    return element.Children.Any(child
      => !child.SelfClosing &&
         string.Equals(text[child.StartTagEnd..child.EndTagStart].Trim(), value, StringComparison.Ordinal));
  }

  private void WarnShared(PlanBuilder plan, string kind, string file, string id, string? joiningProject = null) {
    if (string.Equals(kind, VersionOriginKinds.CENTRAL, StringComparison.Ordinal)) {
      var users = projects
        .Where(project => project.Info.CentralPackageManagement &&
                          (Declares(project, id) || PathComparer.Equals(project.Info.Path, joiningProject)))
        .Select(project => project.Info.Path)
        .ToList();
      plan.Warn(PlanWarningKinds.CENTRAL_SHARED, id, file, users);
    }
    else if (string.Equals(kind, VersionOriginKinds.IMPORTED, StringComparison.Ordinal)) {
      var directory = Path.GetDirectoryName(file)! + Path.DirectorySeparatorChar;
      var below = projects
        .Where(project => project.Info.Path.StartsWith(directory, PathComparison()))
        .Select(project => project.Info.Path)
        .ToList();
      plan.Warn(PlanWarningKinds.IMPORTED_SHARED, id, file, below);
    }
  }

  private static StringComparison PathComparison()
    => ReferenceEquals(PathComparer, StringComparer.OrdinalIgnoreCase)
      ? StringComparison.OrdinalIgnoreCase
      : StringComparison.Ordinal;

  private static bool Declares(EvaluatedProject project, string id)
    => project.Packages.Any(package
      => !package.Implicit && string.Equals(package.Id, id, StringComparison.OrdinalIgnoreCase));

  private void PlanInstall(PlanBuilder plan, EvaluatedProject project, string id, string version) {
    if (Declares(project, id)) {
      PlanUpdate(plan, project, id, version);
      return;
    }

    var path = project.Info.Path;
    if (!project.Info.CentralPackageManagement) {
      Insert(plan, path, PackageDeclarationFinder.PACKAGE_REFERENCE, [("Include", id), ("Version", version)]);
      return;
    }

    var central = PackageDeclarationFinder.CentralFile(path) ??
                  throw new RpcException(RpcErrorCodes.EDIT_NOT_POSSIBLE,
                    $"'{project.Info.Name}' uses central package versions but no Directory.Packages.props was found.");
    var existing = _finder.FindVersions(central, PackageDeclarationFinder.PACKAGE_VERSION, id,
      PackageDeclarationFinder.VERSION);
    if (existing.Count == 0) {
      Insert(plan, central, PackageDeclarationFinder.PACKAGE_VERSION, [("Include", id), ("Version", version)]);
    }
    else {
      var edited = false;
      foreach (var slot in existing) edited |= PlanSlot(plan, project, slot, id, version);

      if (edited) {
        WarnShared(plan, VersionOriginKinds.CENTRAL, central, id, path);
      }
    }

    Insert(plan, path, PackageDeclarationFinder.PACKAGE_REFERENCE, [("Include", id)]);
  }

  private void Insert(PlanBuilder plan, string file, string elementName,
    IReadOnlyList<(string Name, string Value)> attributes) {
    var document = files.Document(file);
    var root = files.Root(file);
    var edit = document is null || root is null ? null : ItemInserter.Plan(document, root, elementName, attributes);
    if (edit is null) {
      throw new RpcException(RpcErrorCodes.EDIT_NOT_POSSIBLE, $"'{file}' cannot take a new {elementName} item.");
    }

    plan.Replace(file, edit.Start, edit.Length, edit.Replacement);
  }

  private void PlanRemove(PlanBuilder plan, EvaluatedProject project, string id) {
    RequireDeclared(project, id);
    var path = project.Info.Path;
    var items = _finder.FindItems(path, PackageDeclarationFinder.PACKAGE_REFERENCE, id);
    if (items.Count > 0) {
      RemoveItems(plan, path, items);
    }
    else {
      // Declared in an imported file: the declaration stays for the other projects and this one opts out.
      Insert(plan, path, PackageDeclarationFinder.PACKAGE_REFERENCE, [("Remove", id)]);
      plan.Warn(PlanWarningKinds.REMOVE_ITEM, id, path);
    }

    plan.MarkRemoved(id, path);
    if (project.Info.CentralPackageManagement) {
      RemoveUnusedCentralVersion(plan, path, id);
    }
  }

  private void RemoveUnusedCentralVersion(PlanBuilder plan, string projectPath, string id) {
    var stillUsed = projects.Any(project
      => project.Info.CentralPackageManagement && Declares(project, id) && !plan.IsRemoved(id, project.Info.Path));
    var central = PackageDeclarationFinder.CentralFile(projectPath);
    if (stillUsed || central is null) {
      return;
    }

    var versions = _finder.FindItems(central, PackageDeclarationFinder.PACKAGE_VERSION, id);
    if (versions.Count > 0) {
      RemoveItems(plan, central, versions);
      plan.Warn(PlanWarningKinds.CENTRAL_REMOVED, id, central);
    }
  }

  private void RemoveItems(PlanBuilder plan, string file, IReadOnlyList<XmlElementSpan> items) {
    var document = files.Document(file);
    if (document is null) {
      return;
    }

    foreach (var target in items.Select(item => RemovalTarget(item, items)).Distinct()) {
      var edit = ItemRemover.Plan(document, target);
      plan.Replace(file, edit.Start, edit.Length, edit.Replacement);
    }
  }

  // A group that would be left with no items goes instead of its items.
  private static XmlElementSpan RemovalTarget(XmlElementSpan item, IReadOnlyList<XmlElementSpan> removed) {
    var group = item.Parent;
    return group is not null &&
           string.Equals(group.Name, "ItemGroup", StringComparison.Ordinal) &&
           group.Children.All(removed.Contains)
      ? group
      : item;
  }
}
