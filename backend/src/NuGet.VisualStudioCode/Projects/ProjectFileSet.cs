// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;

namespace NuGet.VisualStudioCode.Projects;

/// <summary>
///   The MSBuild files read while answering one request or planning one operation. Each file is loaded and parsed
///   once, so every decision in that request sees the same content.
/// </summary>
internal sealed class ProjectFileSet {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  private readonly Dictionary<string, Entry> _entries = new(PathComparer);

  public TextDocument? Document(string path)
    => Load(path).Document;

  public XmlElementSpan? Root(string path)
    => Load(path).Root;

  public static string? FindUpward(string startDirectory, string fileName) {
    var directory = new DirectoryInfo(startDirectory);
    while (directory is not null) {
      var candidate = Path.Combine(directory.FullName, fileName);
      if (File.Exists(candidate)) {
        return candidate;
      }

      directory = directory.Parent;
    }

    return null;
  }

  private Entry Load(string path) {
    if (_entries.TryGetValue(path, out var cached)) {
      return cached;
    }

    var entry = Read(path);
    _entries[path] = entry;
    return entry;
  }

  private static Entry Read(string path) {
    try {
      var document = TextDocument.Load(path);
      return new Entry(document, XmlSpanParser.Parse(document.Text));
    }
    catch (IOException) {
      return new Entry(null, null);
    }
    catch (UnauthorizedAccessException) {
      return new Entry(null, null);
    }
  }

  private sealed record Entry(TextDocument? Document, XmlElementSpan? Root);
}
