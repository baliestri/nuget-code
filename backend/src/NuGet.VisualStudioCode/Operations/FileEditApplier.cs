// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Writes planned edits, one file at a time. A file is written only if the text each edit replaces is still
///   there; a file that fails does not stop the others.
/// </summary>
internal static class FileEditApplier {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  public static IReadOnlyList<FileEditResult> Apply(IReadOnlyList<PlannedEdit> edits)
    => edits
      .GroupBy(edit => edit.File, PathComparer)
      .Select(group => ApplyToFile(group.Key, [.. group]))
      .ToList();

  private static FileEditResult ApplyToFile(string file, IReadOnlyList<PlannedEdit> edits) {
    try {
      var document = TextDocument.Load(file);
      if (edits.Any(edit => !Matches(document.Text, edit))) {
        return new FileEditResult(file, false, true, "The file changed after the edit was planned.");
      }

      document.Apply(edits.Select(edit => new TextEdit(edit.Start, edit.Length, edit.NewText))).Save();
      return new FileEditResult(file, true, false, null);
    }
    catch (IOException exception) {
      return new FileEditResult(file, false, false, exception.Message);
    }
    catch (UnauthorizedAccessException exception) {
      return new FileEditResult(file, false, false, exception.Message);
    }
  }

  private static bool Matches(string text, PlannedEdit edit)
    => edit.Start + edit.Length <= text.Length &&
       string.CompareOrdinal(text, edit.Start, edit.OldText, 0, edit.Length) == 0 &&
       edit.OldText.Length == edit.Length;
}
