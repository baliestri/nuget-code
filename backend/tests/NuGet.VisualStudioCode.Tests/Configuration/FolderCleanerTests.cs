// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Runtime.Versioning;
using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Configuration;

public sealed class FolderCleanerTests {
  private const string CACHE = "cache";

  [Fact]
  public void Files_and_subfolders_are_deleted_and_the_folder_stays() {
    using var directory = new TempDirectory();
    directory.WriteFile(Path.Combine(CACHE, "a.bin"), new string('a', 10));
    directory.WriteFile(Path.Combine(CACHE, "pkg", "1.0.0", "b.bin"), new string('b', 30));
    var keep = directory.WriteFile("outside.txt", "keep");
    var cache = directory.Combine(CACHE);

    var result = FolderCleaner.Clear(cache, TestContext.Current.CancellationToken);

    Assert.Equal(40, result.BytesFreed);
    Assert.Empty(result.Skipped);
    Assert.True(Directory.Exists(cache));
    Assert.Empty(Directory.EnumerateFileSystemEntries(cache));
    Assert.True(File.Exists(keep));
  }

  [Fact]
  public void Read_only_files_are_deleted() {
    using var directory = new TempDirectory();
    var file = directory.WriteFile(Path.Combine(CACHE, "a.bin"), "12345");
    File.SetAttributes(file, FileAttributes.ReadOnly);

    var result = FolderCleaner.Clear(directory.Combine(CACHE), TestContext.Current.CancellationToken);

    Assert.Equal(5, result.BytesFreed);
    Assert.False(File.Exists(file));
  }

  [Fact]
  public void File_in_use_is_skipped_and_the_rest_is_deleted() {
    // Only Windows refuses to delete a file that is open; elsewhere the test below covers a file that
    // cannot be deleted.
    Assert.SkipUnless(OperatingSystem.IsWindows(), "Only Windows keeps an open file from being deleted.");
    using var directory = new TempDirectory();
    var locked = directory.WriteFile(Path.Combine(CACHE, "pkg", "locked.bin"), "locked");
    var free = directory.WriteFile(Path.Combine(CACHE, "pkg", "free.bin"), "free");
    FolderClearInfo result;
    using (new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.None)) {
      result = FolderCleaner.Clear(directory.Combine(CACHE), TestContext.Current.CancellationToken);
    }

    Assert.Equal(4, result.BytesFreed);
    Assert.Contains(locked, result.Skipped, StringComparer.OrdinalIgnoreCase);
    Assert.True(File.Exists(locked));
    Assert.False(File.Exists(free));
  }

  [Fact]
  [UnsupportedOSPlatform("windows")]
  public void File_that_cannot_be_deleted_is_skipped_and_the_rest_is_deleted() {
    Assert.SkipWhen(OperatingSystem.IsWindows(), "Directory permissions of this kind do not exist on Windows.");
    Assert.SkipWhen(Environment.IsPrivilegedProcess, "A privileged process is not held back by permissions.");
    using var directory = new TempDirectory();
    var kept = directory.WriteFile(Path.Combine(CACHE, "sealed", "kept.bin"), "kept");
    var free = directory.WriteFile(Path.Combine(CACHE, "open", "free.bin"), "free");
    var sealedDirectory = Path.GetDirectoryName(kept)!;
    // Deleting a file needs write access to its directory.
    File.SetUnixFileMode(sealedDirectory, UnixFileMode.UserRead | UnixFileMode.UserExecute);
    FolderClearInfo result;
    try {
      result = FolderCleaner.Clear(directory.Combine(CACHE), TestContext.Current.CancellationToken);
    }
    finally {
      File.SetUnixFileMode(sealedDirectory,
        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }

    Assert.Equal(4, result.BytesFreed);
    Assert.Contains(kept, result.Skipped, StringComparer.Ordinal);
    Assert.True(File.Exists(kept));
    Assert.False(File.Exists(free));
  }

  [Fact]
  public void Missing_folder_frees_nothing() {
    using var directory = new TempDirectory();

    var result = FolderCleaner.Clear(directory.Combine("missing"), TestContext.Current.CancellationToken);

    Assert.Equal(0, result.BytesFreed);
    Assert.Empty(result.Skipped);
  }

  [Fact]
  public void Cancellation_stops_before_deleting() {
    using var directory = new TempDirectory();
    var file = directory.WriteFile(Path.Combine(CACHE, "a.bin"), "a");
    var cache = directory.Combine(CACHE);
    using var cancelled = new CancellationTokenSource();
    cancelled.Cancel();
    var token = cancelled.Token;

    Assert.Throws<OperationCanceledException>(() => FolderCleaner.Clear(cache, token));

    Assert.True(File.Exists(file));
  }

  [Fact]
  public void Only_listed_cache_folders_pass_the_check() {
    var caches = Path.Combine(Path.GetTempPath(), "nuget-check", "caches");
    var settings = Path.Combine(Path.GetTempPath(), "nuget-check", "settings");
    IReadOnlyList<FolderInfo> folders = [new("Global Packages", caches, true), new("UserSettings", settings)];

    FolderCleaner.RequireClearable(folders, [caches + Path.DirectorySeparatorChar]);
    var notCache = Assert.Throws<RpcException>(() => FolderCleaner.RequireClearable(folders, [caches, settings]));
    var unlisted = Assert.Throws<RpcException>(()
      => FolderCleaner.RequireClearable(folders, [Path.Combine(caches, "inner")]));

    Assert.Equal(RpcErrorCodes.FOLDER_NOT_CLEARABLE, notCache.Code);
    Assert.Equal(RpcErrorCodes.FOLDER_NOT_CLEARABLE, unlisted.Code);
  }
}
