// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Projects;

internal sealed class VersionOriginLocator(PackageDeclarationFinder finder) {
  private readonly static VersionOrigin Undetermined = new(VersionOriginKinds.UNDETERMINED, null, null, null);

  public VersionOriginLocator() : this(new PackageDeclarationFinder(new ProjectFileSet())) { }

  public VersionOrigin Locate(string projectPath, string packageId, bool centralPackageManagement,
    bool hasVersionOverride) {
    var declaration = finder.Resolve(projectPath, packageId, centralPackageManagement, hasVersionOverride);
    if (declaration.Slots.Count != 1) {
      return Undetermined;
    }

    var slot = declaration.Slots[0];
    var text = finder.Files.Document(slot.File)?.Text;
    if (text is null) {
      return Undetermined;
    }

    var kind = slot.Value.Contains("$(", StringComparison.Ordinal)
      ? VersionOriginKinds.UNDETERMINED
      : declaration.Kind;
    var (line, column) = TextPosition.FromOffset(text, slot.PositionStart);
    return new VersionOrigin(kind, slot.File, line, column);
  }
}
