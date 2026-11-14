// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Editing;

/// <summary>
///   Parses XML into elements that remember where they are in the text, so a caller can edit one attribute value
///   or remove one element and leave every other byte of the file alone. Entities are not decoded: MSBuild package
///   ids and versions do not use them.
/// </summary>
internal static class XmlSpanParser {
  public static XmlElementSpan? Parse(string text)
    => new Reader(text).ParseDocument();

  private sealed class Reader(string text) {
    private const string CDATA_END = "]]>";
    private const string CDATA_START = "<![CDATA[";
    private const string COMMENT_END = "-->";
    private const string COMMENT_START = "<!--";
    private const string DOCTYPE_START = "<!DOCTYPE";
    private const string END_TAG_START = "</";
    private const string INSTRUCTION_END = "?>";
    private const string INSTRUCTION_START = "<?";
    private const string SELF_CLOSE = "/>";

    private int _position;

    public XmlElementSpan? ParseDocument() {
      if (text.Length > 0 &&
          text[0] == '﻿') {
        _position = 1;
      }

      if (!SkipMisc()) {
        return null;
      }

      var root = ParseElement(null);
      if (root is null ||
          !SkipMisc()) {
        return null;
      }

      return _position == text.Length ? root : null;
    }

    private bool SkipMisc() {
      while (true) {
        SkipWhitespace();
        if (StartsWith(COMMENT_START)) {
          if (!SkipPast(COMMENT_START, COMMENT_END)) {
            return false;
          }
        }
        else if (StartsWith(INSTRUCTION_START)) {
          if (!SkipPast(INSTRUCTION_START, INSTRUCTION_END)) {
            return false;
          }
        }
        else if (StartsWith(DOCTYPE_START)) {
          if (!SkipPast(DOCTYPE_START, ">")) {
            return false;
          }
        }
        else {
          return true;
        }
      }
    }

    private XmlElementSpan? ParseElement(XmlElementSpan? parent) {
      if (!At('<')) {
        return null;
      }

      var start = _position;
      _position++;
      var qualifiedName = ReadName();
      if (qualifiedName.Length == 0) {
        return null;
      }

      var element = new XmlElementSpan(LocalName(qualifiedName), start, parent);
      if (!ParseStartTag(element)) {
        return null;
      }

      return element.SelfClosing || ParseContent(element, qualifiedName) ? element : null;
    }

    private bool ParseStartTag(XmlElementSpan element) {
      while (true) {
        SkipWhitespace();
        if (StartsWith(SELF_CLOSE)) {
          _position += SELF_CLOSE.Length;
          element.CloseSelf(_position);
          return true;
        }

        if (At('>')) {
          _position++;
          element.CloseStartTag(_position);
          return true;
        }

        if (!ParseAttribute(element)) {
          return false;
        }
      }
    }

    private bool ParseAttribute(XmlElementSpan element) {
      var nameStart = _position;
      var name = ReadName();
      if (name.Length == 0) {
        return false;
      }

      SkipWhitespace();
      if (!At('=')) {
        return false;
      }

      _position++;
      SkipWhitespace();
      if (!At('"') &&
          !At('\'')) {
        return false;
      }

      var quote = text[_position];
      var valueStart = _position + 1;
      var valueEnd = text.IndexOf(quote, valueStart);
      if (valueEnd < 0) {
        return false;
      }

      var value = text[valueStart..valueEnd];
      if (value.Contains('<', StringComparison.Ordinal)) {
        return false;
      }

      element.Add(new XmlAttributeSpan(name, value, nameStart, valueStart, value.Length, quote));
      _position = valueEnd + 1;
      return true;
    }

    private bool ParseContent(XmlElementSpan element, string qualifiedName) {
      while (true) {
        var next = text.IndexOf('<', _position);
        if (next < 0) {
          return false;
        }

        _position = next;
        if (StartsWith(END_TAG_START)) {
          return ParseEndTag(element, qualifiedName);
        }

        if (StartsWith(COMMENT_START)) {
          if (!SkipPast(COMMENT_START, COMMENT_END)) {
            return false;
          }
        }
        else if (StartsWith(CDATA_START)) {
          if (!SkipPast(CDATA_START, CDATA_END)) {
            return false;
          }
        }
        else if (StartsWith(INSTRUCTION_START)) {
          if (!SkipPast(INSTRUCTION_START, INSTRUCTION_END)) {
            return false;
          }
        }
        else {
          var child = ParseElement(element);
          if (child is null) {
            return false;
          }

          element.Add(child);
        }
      }
    }

    private bool ParseEndTag(XmlElementSpan element, string qualifiedName) {
      var endTagStart = _position;
      _position += END_TAG_START.Length;
      if (!string.Equals(ReadName(), qualifiedName, StringComparison.Ordinal)) {
        return false;
      }

      SkipWhitespace();
      if (!At('>')) {
        return false;
      }

      _position++;
      element.Close(endTagStart, _position);
      return true;
    }

    private string ReadName() {
      var start = _position;
      while (_position < text.Length &&
             !IsNameEnd(text[_position])) _position++;

      return text[start.._position];
    }

    private static bool IsNameEnd(char value)
      => char.IsWhiteSpace(value) || value is '=' or '/' or '>' or '<' or '"' or '\'';

    private static string LocalName(string qualifiedName) {
      var separator = qualifiedName.LastIndexOf(':');
      return separator < 0 ? qualifiedName : qualifiedName[(separator + 1)..];
    }

    private void SkipWhitespace() {
      while (_position < text.Length &&
             char.IsWhiteSpace(text[_position])) _position++;
    }

    private bool SkipPast(string opening, string closing) {
      var end = text.IndexOf(closing, _position + opening.Length, StringComparison.Ordinal);
      if (end < 0) {
        return false;
      }

      _position = end + closing.Length;
      return true;
    }

    private bool At(char value)
      => _position < text.Length && text[_position] == value;

    private bool StartsWith(string value)
      => string.CompareOrdinal(text, _position, value, 0, value.Length) == 0;
  }
}
