// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.ProjectModel;

namespace NuGet.VisualStudioCode.Projects;

internal static class AssetsReader {
  public static IReadOnlyDictionary<string, string>? ReadResolved(string? assetsPath) {
    if (assetsPath is null ||
        !File.Exists(assetsPath)) {
      return null;
    }

    LockFile lockFile;
    try {
      lockFile = new LockFileFormat().Read(assetsPath);
    }
    catch (IOException) {
      return null;
    }
    catch (FileFormatException) {
      return null;
    }

    return lockFile.Libraries
      .Where(library => string.Equals(library.Type, "package", StringComparison.OrdinalIgnoreCase))
      .GroupBy(library => library.Name, StringComparer.OrdinalIgnoreCase)
      .ToDictionary(
        group => group.Key,
        group => group.Max(library => library.Version)!.ToNormalizedString(),
        StringComparer.OrdinalIgnoreCase
      );
  }
}
