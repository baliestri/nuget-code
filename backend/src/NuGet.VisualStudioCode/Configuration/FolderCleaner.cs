// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Configuration;

/// <summary>
///   Empties a NuGet cache folder. The folder itself stays; what cannot be deleted (in use, no permission) is
///   skipped and reported; symbolic links and junctions are removed as links, never followed.
/// </summary>
internal static class FolderCleaner {
  private const int MAX_SKIPPED = 50;

  private readonly static StringComparison PathComparison =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparison.OrdinalIgnoreCase
      : StringComparison.Ordinal;

  /// <summary>
  ///   Every path must be one of the listed folders and that folder must be a cache. The check covers the whole
  ///   request before anything is deleted.
  /// </summary>
  public static void RequireClearable(IReadOnlyList<FolderInfo> folders, IReadOnlyList<string> paths) {
    foreach (var path in paths)
      if (!folders.Any(folder => folder.Clearable && SamePath(folder.Path, path))) {
        throw new RpcException(RpcErrorCodes.FOLDER_NOT_CLEARABLE, $"'{path}' is not a NuGet cache folder.");
      }
  }

  public static FolderClearInfo Clear(string path, CancellationToken ct) {
    ct.ThrowIfCancellationRequested();
    var state = new State();
    var root = new DirectoryInfo(path);
    if (root.Exists) {
      ClearDirectory(root, state, ct);
    }

    return new FolderClearInfo(path, state.Bytes, state.Skipped);
  }

  // Returns whether the directory ended up empty.
  private static bool ClearDirectory(DirectoryInfo directory, State state, CancellationToken ct) {
    List<FileSystemInfo> entries;
    try {
      entries = [.. directory.EnumerateFileSystemInfos()];
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
      state.Skip(directory.FullName);
      return false;
    }

    var empty = true;
    foreach (var entry in entries) {
      ct.ThrowIfCancellationRequested();
      empty &= entry switch {
        DirectoryInfo link when link.Attributes.HasFlag(FileAttributes.ReparsePoint) => TryDelete(link, state),
        DirectoryInfo child => ClearDirectory(child, state, ct) && TryDelete(child, state),
        var file => TryDeleteFile((FileInfo)file, state)
      };
    }

    return empty;
  }

  private static bool TryDeleteFile(FileInfo file, State state) {
    try {
      var length = file.Attributes.HasFlag(FileAttributes.ReparsePoint) ? 0 : file.Length;
      if (file.IsReadOnly) {
        file.IsReadOnly = false;
      }

      file.Delete();
      state.Bytes += length;
      return true;
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
      state.Skip(file.FullName);
      return false;
    }
  }

  private static bool TryDelete(DirectoryInfo directory, State state) {
    try {
      directory.Delete(false);
      return true;
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
      state.Skip(directory.FullName);
      return false;
    }
  }

  private static bool SamePath(string left, string right)
    => string.Equals(
      Path.TrimEndingDirectorySeparator(Path.GetFullPath(left)),
      Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)),
      PathComparison
    );

  private sealed class State {
    public long Bytes { get; set; }

    public List<string> Skipped { get; } = [];

    public void Skip(string path) {
      if (Skipped.Count < MAX_SKIPPED) {
        Skipped.Add(path);
      }
    }
  }
}
