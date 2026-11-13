// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.TestSupport;

public sealed class TempDirectory : IDisposable {
  public TempDirectory() {
    Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "nuget-vscode-tests", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(Path);
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

  public string Combine(params string[] parts)
    => System.IO.Path.Combine([Path, .. parts]);

  public string WriteFile(string relativePath, string content) {
    var fullPath = Combine(relativePath);
    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(fullPath)!);
    File.WriteAllText(fullPath, content);
    return fullPath;
  }
}
