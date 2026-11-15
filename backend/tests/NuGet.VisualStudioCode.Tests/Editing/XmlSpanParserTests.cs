// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;

namespace NuGet.VisualStudioCode.Tests.Editing;

public sealed class XmlSpanParserTests {
  private const string PROJECT =
    "<?xml version=\"1.0\"?>\n<!-- top -->\n<Project Sdk=\"Microsoft.NET.Sdk\">\n  <ItemGroup>\n    <PackageReference Include=\"Alpha\" Version=\"1.0.0\" />\n    <PackageReference Include='Beta'>\n      <Version>2.0.0</Version>\n    </PackageReference>\n  </ItemGroup>\n</Project>\n";

  private const string VERSION = "Version";

  private static XmlElementSpan Root(string text)
    => XmlSpanParser.Parse(text) ?? throw new InvalidOperationException("not parsed");

  private static XmlAttributeSpan Attribute(XmlElementSpan element, string name)
    => element.Attribute(name) ?? throw new InvalidOperationException($"no attribute {name}");

  [Fact]
  public void Root_and_children_are_found_past_the_prolog_and_comments() {
    var root = Root(PROJECT);

    Assert.Equal("Project", root.Name);
    Assert.Equal("Microsoft.NET.Sdk", root.Attribute("Sdk")?.Value);
    var group = Assert.Single(root.Children);
    Assert.Equal("ItemGroup", group.Name);
    Assert.Equal(2, group.Children.Count);
    Assert.Same(root, group.Parent);
  }

  [Fact]
  public void Attribute_value_span_points_at_the_text_between_the_quotes() {
    var group = Root(PROJECT).Children[0];
    var version = Attribute(group.Children[0], VERSION);

    Assert.Equal("1.0.0", PROJECT.Substring(version.ValueStart, version.ValueLength));
    Assert.Equal('"', version.Quote);
    Assert.Equal(VERSION, PROJECT.Substring(version.NameStart, version.Name.Length));
    Assert.Equal('\'', Attribute(group.Children[1], "Include").Quote);
  }

  [Fact]
  public void Element_spans_cover_the_whole_element() {
    var group = Root(PROJECT).Children[0];
    var alpha = group.Children[0];
    var beta = group.Children[1];

    Assert.True(alpha.SelfClosing);
    Assert.Equal("<PackageReference Include=\"Alpha\" Version=\"1.0.0\" />", PROJECT[alpha.Start..alpha.End]);
    Assert.False(beta.SelfClosing);
    Assert.StartsWith("<PackageReference Include='Beta'>", PROJECT[beta.Start..beta.End], StringComparison.Ordinal);
    Assert.Equal("</PackageReference>", PROJECT[beta.EndTagStart..beta.End]);
    var version = Assert.Single(beta.Children);
    Assert.Equal("2.0.0", PROJECT[version.StartTagEnd..version.EndTagStart]);
  }

  [Fact]
  public void Namespace_prefixes_are_dropped_from_names_and_multiline_tags_are_parsed() {
    const string TEXT =
      "<msb:Project xmlns:msb=\"x\">\n  <msb:PackageReference\n      Include=\"Alpha\"\n      Version=\"1.0.0\"\n  />\n</msb:Project>";

    var reference = Assert.Single(Root(TEXT).Children);

    Assert.Equal("PackageReference", reference.Name);
    Assert.Equal("1.0.0", reference.Attribute(VERSION)?.Value);
  }

  [Fact]
  public void Comments_cdata_and_processing_instructions_are_skipped() {
    const string TEXT =
      "<Project>\n  <!-- <PackageReference Include=\"Ghost\" Version=\"9\" /> -->\n  <A><![CDATA[<B/>]]></A>\n  <?pi <C/> ?>\n</Project>";

    var root = Root(TEXT);

    Assert.Equal(["A"], root.Children.Select(child => child.Name), StringComparer.Ordinal);
    Assert.Empty(root.Children[0].Children);
  }

  [Theory]
  [InlineData("")]
  [InlineData("<Project><ItemGroup>")]
  [InlineData("<Project></Other>")]
  [InlineData("<Project><A attr=\"x></A></Project>")]
  [InlineData("not xml")]
  public void Malformed_text_is_not_parsed(string text)
    => Assert.Null(XmlSpanParser.Parse(text));

  [Fact]
  public void Position_is_one_based_line_and_column() {
    var alpha = Root(PROJECT).Children[0].Children[0];
    var version = Attribute(alpha, VERSION);

    Assert.Equal((5, 5), TextPosition.FromOffset(PROJECT, alpha.Start));
    Assert.Equal((5, 39), TextPosition.FromOffset(PROJECT, version.NameStart));
  }
}
