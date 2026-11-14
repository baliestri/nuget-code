// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Plans the removal of one element. An element alone on its lines takes those lines with it, so no blank line
///   is left behind; an element that shares a line is cut out of it.
/// </summary>
internal static class ItemRemover {
  public static TextEdit Plan(TextDocument document, XmlElementSpan element) {
    var text = document.Text;
    var lineStart = element.Start == 0 ? 0 : text.LastIndexOf('\n', element.Start - 1) + 1;
    var lineEnd = text.IndexOf('\n', element.End);
    var after = lineEnd < 0 ? text.Length : lineEnd + 1;
    var alone = string.IsNullOrWhiteSpace(text[lineStart..element.Start]) &&
                string.IsNullOrWhiteSpace(text[element.End..after]);
    return alone
      ? new TextEdit(lineStart, after - lineStart, string.Empty)
      : new TextEdit(element.Start, element.End - element.Start, string.Empty);
  }
}
