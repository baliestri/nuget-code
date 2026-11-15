// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Common;

namespace NuGet.VisualStudioCode.Configuration;

internal static class ConfigFileClassifier {
  private readonly static StringComparison PathComparison =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparison.OrdinalIgnoreCase
      : StringComparison.Ordinal;

  // Inside one of the folders NuGet reads machine-wide configuration from.
  public static bool IsMachineWide(string path)
    => IsUnder(path, NuGetEnvironment.GetFolderPath(NuGetFolderPath.MachineWideConfigDirectory)) ||
       IsUnder(path, NuGetEnvironment.GetFolderPath(NuGetFolderPath.MachineWideSettingsBaseDirectory));

  public static bool IsWritable(string path, Func<string, bool> isMachineWide)
    => !isMachineWide(path) && (!File.Exists(path) || !File.GetAttributes(path).HasFlag(FileAttributes.ReadOnly));

  private static bool IsUnder(string path, string? directory) {
    if (string.IsNullOrEmpty(directory)) {
      return false;
    }

    var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory)) + Path.DirectorySeparatorChar;
    return Path.GetFullPath(path).StartsWith(root, PathComparison);
  }
}
