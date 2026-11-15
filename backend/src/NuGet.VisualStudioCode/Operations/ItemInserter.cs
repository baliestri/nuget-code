// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text;
using NuGet.VisualStudioCode.Editing;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Plans the insertion of one MSBuild item line, written the way its neighbours are: same indentation, same
///   quotes, same line ending, in alphabetical order when the group already is.
/// </summary>
internal static class ItemInserter {
  private const string DEFAULT_INDENT = "  ";
  private const string ITEM_GROUP = "ItemGroup";

  private readonly static string[] KeyAttributes = ["Include", "Update", "Remove"];

  public static TextEdit? Plan(TextDocument document, XmlElementSpan root, string elementName,
    IReadOnlyList<(string Name, string Value)> attributes) {
    var group = root.Children.FirstOrDefault(child
      => string.Equals(child.Name, ITEM_GROUP, StringComparison.Ordinal) &&
         child.Attribute("Condition") is null &&
         child.Children.Any(item => string.Equals(item.Name, elementName, StringComparison.Ordinal)));
    return group is null
      ? PlanNewGroup(document, root, elementName, attributes)
      : PlanInGroup(document, group, elementName, attributes);
  }

  private static TextEdit PlanInGroup(TextDocument document, XmlElementSpan group, string elementName,
    IReadOnlyList<(string Name, string Value)> attributes) {
    var text = document.Text;
    var siblings = group.Children
      .Where(item => string.Equals(item.Name, elementName, StringComparison.Ordinal))
      .ToList();
    var next = IsSorted(siblings)
      ? siblings.Find(sibling
        => string.Compare(Key(sibling), attributes[0].Value, StringComparison.OrdinalIgnoreCase) > 0)
      : null;
    var model = next ?? siblings[^1];
    var indent = Indent(text, model);
    var item = Item(elementName, attributes, QuoteOf(model), CloserOf(text, model));
    if (indent is null) {
      return new TextEdit(next?.Start ?? model.End, 0, item);
    }

    var line = indent + item + document.NewLine;
    if (next is not null) {
      return new TextEdit(LineStart(text, next.Start), 0, line);
    }

    var lineEnd = text.IndexOf('\n', model.End);
    return lineEnd < 0
      ? new TextEdit(text.Length, 0, document.NewLine + indent + item)
      : new TextEdit(lineEnd + 1, 0, line);
  }

  private static TextEdit? PlanNewGroup(TextDocument document, XmlElementSpan root, string elementName,
    IReadOnlyList<(string Name, string Value)> attributes) {
    if (root.SelfClosing) {
      return null;
    }

    var text = document.Text;
    var newLine = document.NewLine;
    var unit = root.Children.Count > 0 ? Indent(text, root.Children[0]) ?? DEFAULT_INDENT : DEFAULT_INDENT;
    if (unit.Length == 0) {
      unit = DEFAULT_INDENT;
    }

    var builder = new StringBuilder();
    builder.Append(unit).Append('<').Append(ITEM_GROUP).Append('>').Append(newLine);
    builder.Append(unit).Append(unit).Append(Item(elementName, attributes, '"', " />")).Append(newLine);
    builder.Append(unit).Append("</").Append(ITEM_GROUP).Append('>').Append(newLine);

    var closeStart = root.EndTagStart;
    var lineStart = LineStart(text, closeStart);
    return string.IsNullOrWhiteSpace(text[lineStart..closeStart])
      ? new TextEdit(lineStart, 0, builder.ToString())
      : new TextEdit(closeStart, 0, newLine + builder);
  }

  private static bool IsSorted(List<XmlElementSpan> siblings) {
    for (var index = 1; index < siblings.Count; index++)
      if (string.Compare(Key(siblings[index - 1]), Key(siblings[index]), StringComparison.OrdinalIgnoreCase) > 0) {
        return false;
      }

    return true;
  }

  private static string Key(XmlElementSpan item)
    => KeyAttribute(item)?.Value ?? string.Empty;

  private static XmlAttributeSpan? KeyAttribute(XmlElementSpan item) {
    foreach (var name in KeyAttributes) {
      var attribute = item.Attribute(name);
      if (attribute is not null) {
        return attribute;
      }
    }

    return null;
  }

  private static char QuoteOf(XmlElementSpan model)
    => KeyAttribute(model)?.Quote ?? '"';

  private static string CloserOf(string text, XmlElementSpan model)
    => model is { SelfClosing: true, End: >= 3 } && text[model.End - 3] != ' ' ? "/>" : " />";

  private static string Item(string elementName, IReadOnlyList<(string Name, string Value)> attributes, char quote,
    string closer) {
    var builder = new StringBuilder().Append('<').Append(elementName);
    foreach (var (name, value) in attributes)
      builder.Append(' ').Append(name).Append('=').Append(quote).Append(value).Append(quote);

    return builder.Append(closer).ToString();
  }

  // The whitespace before the element on its line, or null when the element shares its line with something else.
  private static string? Indent(string text, XmlElementSpan element) {
    var lineStart = LineStart(text, element.Start);
    var lead = text[lineStart..element.Start];
    return string.IsNullOrWhiteSpace(lead) ? lead : null;
  }

  private static int LineStart(string text, int offset)
    => offset == 0 ? 0 : text.LastIndexOf('\n', offset - 1) + 1;
}
