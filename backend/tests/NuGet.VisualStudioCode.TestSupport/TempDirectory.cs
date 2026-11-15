// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.TestSupport;

public sealed class TempDirectory : IDisposable {
  public TempDirectory() {
    var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "nuget-vscode-tests", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(path);
    Path = WithoutLinks(path);
  }

  public string Path { get; }

  public void Dispose() {
    try {
      Directory.Delete(Path, true);
    }
    catch (IOException) {
      // A child process may still hold a file; the OS cleans the temporary directory.
    }
    catch (UnauthorizedAccessException) {
      // Same as above.
    }
  }

  // The path with every symbolic link in it followed. On macOS the temporary directory is reached through
  // one (/var is a link to /private/var), and a process started there reports the path behind the link.
  private static string WithoutLinks(string path) {
    if (OperatingSystem.IsWindows()) {
      return path;
    }

    var resolved = System.IO.Path.GetPathRoot(path) ?? "/";
    foreach (var segment in path.Split(System.IO.Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)) {
      var next = System.IO.Path.Combine(resolved, segment);
      resolved = new DirectoryInfo(next).ResolveLinkTarget(true)?.FullName ?? next;
    }

    return resolved;
  }

  public string Combine(params string[] parts)
    => System.IO.Path.Combine([Path, .. parts]);

  public string WriteFile(string relativePath, string content) {
    var fullPath = Combine(relativePath);
    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(fullPath)!);
    File.WriteAllText(fullPath, content);
    return fullPath;
  }
}
