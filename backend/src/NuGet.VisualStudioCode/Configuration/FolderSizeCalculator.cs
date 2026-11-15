// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Configuration;

internal static class FolderSizeCalculator {
  private readonly static EnumerationOptions Options = new() {
    RecurseSubdirectories = true,
    IgnoreInaccessible = true,
    AttributesToSkip = FileAttributes.ReparsePoint
  };

  public static FolderSizeResult Calculate(string path, CancellationToken ct) {
    ct.ThrowIfCancellationRequested();
    var directory = new DirectoryInfo(path);
    if (!directory.Exists) {
      return new FolderSizeResult(false, 0);
    }

    long total = 0;
    foreach (var file in directory.EnumerateFiles("*", Options)) {
      ct.ThrowIfCancellationRequested();
      total += file.Length;
    }

    return new FolderSizeResult(true, total);
  }
}
