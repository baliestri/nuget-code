// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text;

namespace NuGet.VisualStudioCode.Editing;

/// <summary>
///   A text file that can be edited and written back with the encoding, byte order mark and line endings it had.
/// </summary>
internal sealed class TextDocument {
  private const string CARRIAGE_RETURN_LINE_FEED = "\r\n";

  private readonly Encoding _encoding;
  private readonly string _path;
  private readonly byte[] _preamble;

  private TextDocument(string path, string text, Encoding encoding, byte[] preamble) {
    _path = path;
    Text = text;
    _encoding = encoding;
    _preamble = preamble;
  }

  public string Text { get; }

  public string NewLine
    => Text.Contains(CARRIAGE_RETURN_LINE_FEED, StringComparison.Ordinal)
      ? CARRIAGE_RETURN_LINE_FEED
      : "\n";

  public static TextDocument Load(string path) {
    var bytes = File.ReadAllBytes(path);
    var (encoding, preamble) = Detect(bytes);
    var text = encoding.GetString(bytes, preamble.Length, bytes.Length - preamble.Length);
    return new TextDocument(path, text, encoding, preamble);
  }

  public TextDocument Apply(IEnumerable<TextEdit> edits) {
    var ordered = edits.OrderBy(edit => edit.Start).ThenBy(edit => edit.Length).ToList();
    var builder = new StringBuilder(Text.Length);
    var position = 0;
    foreach (var edit in ordered) {
      if (edit.Start < position ||
          edit.Start + edit.Length > Text.Length) {
        throw new InvalidOperationException("Text edits overlap or fall outside the document.");
      }

      builder.Append(Text, position, edit.Start - position);
      builder.Append(edit.Replacement);
      position = edit.Start + edit.Length;
    }

    builder.Append(Text, position, Text.Length - position);
    return new TextDocument(_path, builder.ToString(), _encoding, _preamble);
  }

  public void Save() {
    // Replacing a file by renaming another over it only needs write access to the directory, so on Unix it
    // would go through for a read-only file. A file marked read-only is not to be changed, on any system.
    if (File.Exists(_path) &&
        File.GetAttributes(_path).HasFlag(FileAttributes.ReadOnly)) {
      throw new UnauthorizedAccessException($"The file '{_path}' is read-only.");
    }

    var temporary = $"{_path}.{Guid.NewGuid():N}.tmp";
    try {
      File.WriteAllBytes(temporary, [.. _preamble, .. _encoding.GetBytes(Text)]);
      if (!OperatingSystem.IsWindows() &&
          File.Exists(_path)) {
        // The new file takes the place of the old one: it keeps the old one's permissions.
        File.SetUnixFileMode(temporary, File.GetUnixFileMode(_path));
      }

      File.Move(temporary, _path, true);
    }
    catch {
      if (File.Exists(temporary)) {
        File.Delete(temporary);
      }

      throw;
    }
  }

  private static (Encoding Encoding, byte[] Preamble) Detect(byte[] bytes) {
    if (StartsWith(bytes, [0xFF, 0xFE, 0x00, 0x00])) {
      return (new UTF32Encoding(false, false), [0xFF, 0xFE, 0x00, 0x00]);
    }

    if (StartsWith(bytes, [0xEF, 0xBB, 0xBF])) {
      return (new UTF8Encoding(false), [0xEF, 0xBB, 0xBF]);
    }

    if (StartsWith(bytes, [0xFF, 0xFE])) {
      return (new UnicodeEncoding(false, false), [0xFF, 0xFE]);
    }

    if (StartsWith(bytes, [0xFE, 0xFF])) {
      return (new UnicodeEncoding(true, false), [0xFE, 0xFF]);
    }

    return (new UTF8Encoding(false), []);
  }

  private static bool StartsWith(byte[] bytes, ReadOnlySpan<byte> prefix)
    => bytes.AsSpan().StartsWith(prefix);
}
