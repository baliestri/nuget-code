// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text;
using NuGet.VisualStudioCode.Editing;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Editing;

public sealed class TextDocumentTests {
  private const string DIGITS = "0123456789";

  private static string Write(TempDirectory directory, byte[] bytes) {
    var path = directory.Combine("file.csproj");
    File.WriteAllBytes(path, bytes);
    return path;
  }

  private static byte[] Utf8(string text, bool bom)
    => bom ? [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(text)] : Encoding.UTF8.GetBytes(text);

  [Theory]
  [InlineData(false, "\n")]
  [InlineData(true, "\n")]
  [InlineData(false, "\r\n")]
  [InlineData(true, "\r\n")]
  public void Save_keeps_bom_and_line_endings(bool bom, string newLine) {
    using var directory = new TempDirectory();
    var text = $"<Project>{newLine}  <A>1</A>{newLine}</Project>{newLine}";
    var path = Write(directory, Utf8(text, bom));

    var document = TextDocument.Load(path);
    var start = document.Text.IndexOf('1', StringComparison.Ordinal);
    document.Apply([new TextEdit(start, 1, "22")]).Save();

    Assert.Equal(Utf8(text.Replace("1", "22", StringComparison.Ordinal), bom), File.ReadAllBytes(path));
    Assert.Equal(newLine, document.NewLine);
  }

  [Fact]
  public void Utf16_files_keep_their_encoding() {
    using var directory = new TempDirectory();
    var encoding = new UnicodeEncoding(false, true);
    var path = Write(directory, [.. encoding.GetPreamble(), .. encoding.GetBytes("<P>ção</P>")]);

    var document = TextDocument.Load(path);
    document.Apply([new TextEdit(3, 3, "ok")]).Save();

    Assert.Equal("<P>ção</P>", document.Text);
    Assert.Equal([.. encoding.GetPreamble(), .. encoding.GetBytes("<P>ok</P>")], File.ReadAllBytes(path));
  }

  [Fact]
  public void Apply_handles_several_edits_given_in_any_order() {
    using var directory = new TempDirectory();
    var path = Write(directory, Encoding.UTF8.GetBytes(DIGITS));

    var edited = TextDocument.Load(path)
      .Apply([new TextEdit(1, 2, "A"), new TextEdit(8, 0, "ZZ"), new TextEdit(5, 1, string.Empty)]);

    Assert.Equal("0A3467ZZ89", edited.Text);
  }

  [Fact]
  public void Overlapping_edits_are_rejected() {
    using var directory = new TempDirectory();
    var document = TextDocument.Load(Write(directory, Encoding.UTF8.GetBytes(DIGITS)));

    Assert.Throws<InvalidOperationException>(()
      => document.Apply([new TextEdit(1, 4, "A"), new TextEdit(3, 2, "B")]));
  }

  [Fact]
  public void Save_leaves_no_temporary_file_behind() {
    using var directory = new TempDirectory();
    var path = Write(directory, "abc"u8.ToArray());

    TextDocument.Load(path).Apply([new TextEdit(0, 1, "x")]).Save();

    Assert.Equal(
      ["file.csproj"],
      Directory.GetFiles(directory.Path).Select(Path.GetFileName),
      StringComparer.Ordinal
    );
  }
}
