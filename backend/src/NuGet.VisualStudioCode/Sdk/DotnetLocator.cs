// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Sdk;

internal static class DotnetLocator {
  private readonly static string Executable = OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet";

  public static string? Find(string? configuredPath, Func<string, string?> getEnvironmentVariable,
    Func<string, bool> fileExists) {
    if (!string.IsNullOrWhiteSpace(configuredPath)) {
      return fileExists(configuredPath) ? configuredPath : null;
    }

    var root = getEnvironmentVariable("DOTNET_ROOT");
    if (!string.IsNullOrWhiteSpace(root)) {
      var candidate = Path.Combine(root, Executable);
      if (fileExists(candidate)) {
        return candidate;
      }
    }

    var path = getEnvironmentVariable("PATH") ?? string.Empty;
    return path
      .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Select(directory => Path.Combine(directory, Executable))
      .FirstOrDefault(fileExists);
  }
}
