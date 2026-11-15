// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Editing;

internal static class TextPosition {
  public static (int Line, int Column) FromOffset(string text, int offset) {
    var line = 1;
    var lineStart = 0;
    for (var index = 0; index < offset; index++)
      if (text[index] == '\n') {
        line++;
        lineStart = index + 1;
      }

    return (line, offset - lineStart + 1);
  }
}
