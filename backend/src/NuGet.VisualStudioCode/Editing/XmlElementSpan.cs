// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Editing;

internal sealed class XmlElementSpan(string name, int start, XmlElementSpan? parent) {
  private readonly List<XmlAttributeSpan> _attributes = [];
  private readonly List<XmlElementSpan> _children = [];

  public string Name { get; } = name;

  public int Start { get; } = start;

  public XmlElementSpan? Parent { get; } = parent;

  public int StartTagEnd { get; private set; }

  public int EndTagStart { get; private set; }

  public int End { get; private set; }

  public bool SelfClosing { get; private set; }

  public IReadOnlyList<XmlAttributeSpan> Attributes => _attributes;

  public IReadOnlyList<XmlElementSpan> Children => _children;

  public XmlAttributeSpan? Attribute(string attributeName)
    => _attributes.Find(attribute => string.Equals(attribute.Name, attributeName, StringComparison.Ordinal));

  public IEnumerable<XmlElementSpan> Descendants() {
    foreach (var child in _children) {
      yield return child;

      foreach (var descendant in child.Descendants()) yield return descendant;
    }
  }

  internal void Add(XmlAttributeSpan attribute)
    => _attributes.Add(attribute);

  internal void Add(XmlElementSpan child)
    => _children.Add(child);

  internal void CloseStartTag(int startTagEnd)
    => StartTagEnd = startTagEnd;

  internal void CloseSelf(int end) {
    SelfClosing = true;
    StartTagEnd = end;
    EndTagStart = end;
    End = end;
  }

  internal void Close(int endTagStart, int end) {
    EndTagStart = endTagStart;
    End = end;
  }
}
