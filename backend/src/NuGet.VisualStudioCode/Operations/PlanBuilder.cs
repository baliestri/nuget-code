// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;
using NuGet.VisualStudioCode.Projects;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Collects the edits and warnings of one plan. The same edit or warning reached through two projects is kept
///   once.
/// </summary>
internal sealed class PlanBuilder(ProjectFileSet files) {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  private readonly List<PlannedEdit> _edits = [];
  private readonly List<PlanWarning> _warnings = [];

  public bool Replace(string file, int start, int length, string newText) {
    var text = files.Document(file)?.Text ?? string.Empty;
    var oldText = text.Substring(start, length);
    if (string.Equals(oldText, newText, StringComparison.Ordinal)) {
      return false;
    }

    if (_edits.Exists(edit => edit.Start == start && edit.Length == length && PathComparer.Equals(edit.File, file))) {
      return true;
    }

    _edits.Add(new PlannedEdit(file, start, length, oldText, newText, TextPosition.FromOffset(text, start).Line));
    return true;
  }

  public void Warn(string kind, string packageId, string? file, IReadOnlyList<string>? projects = null,
    IReadOnlyList<string>? packages = null, string? detail = null) {
    var known = _warnings.Exists(warning
      => string.Equals(warning.Kind, kind, StringComparison.Ordinal) &&
         string.Equals(warning.PackageId, packageId, StringComparison.OrdinalIgnoreCase) &&
         PathComparer.Equals(warning.File, file));
    if (!known) {
      _warnings.Add(new PlanWarning(kind, packageId, file, projects ?? [], packages ?? [], detail));
    }
  }

  public ChangePlan Build()
    => new(_edits.OrderBy(edit => edit.File, PathComparer).ThenBy(edit => edit.Start).ToList(), _warnings);
}
