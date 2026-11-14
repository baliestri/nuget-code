// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

/// <summary>
///   These tests only ever ask for folders inside the test's own temporary workspace to be cleared; the refusal
///   of a real, non-cache folder is covered by the unit tests of the check, where nothing can be deleted.
/// </summary>
public sealed class FolderClearTests(PublishedBackend backend) {
  private const string GLOBAL_PACKAGES = "Global Packages";

  private static Task<FoldersListResult> FoldersAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.FOLDERS_LIST, new Empty(), ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.FoldersListResult, ct);

  private static Task<FoldersClearResult> ClearAsync(BackendClient client, CancellationToken ct,
    params string[] paths)
    => client.Connection.RequestAsync(MethodNames.FOLDERS_CLEAR, new FoldersClearParams(paths),
      ProtocolJsonContext.Default.FoldersClearParams, ProtocolJsonContext.Default.FoldersClearResult, ct);

  private static string GlobalOf(FoldersListResult folders)
    => folders.Folders.Single(folder => string.Equals(folder.Title, GLOBAL_PACKAGES, StringComparison.Ordinal)).Path;

  [Fact]
  public async Task Folders_list_marks_the_caches() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var folders = await FoldersAsync(client, ct);

    var clearable = folders.Folders.Where(folder => folder.Clearable).Select(folder => folder.Title);
    Assert.Equal(["Global Packages", "Package Cache", "HTTP Cache", "Temp"], clearable, StringComparer.Ordinal);
  }

  [Fact]
  public async Task Clearing_the_global_packages_folder_empties_it() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.Root.WriteFile(Path.Combine("global-packages", "alpha", "1.0.0", "alpha.nupkg"), new string('z', 128));
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    var global = GlobalOf(await FoldersAsync(client, ct));
    // Checked before anything is cleared: an environment that redirects the folder must not lose real packages.
    Assert.StartsWith(workspace.Path, global, StringComparison.OrdinalIgnoreCase);

    var result = await ClearAsync(client, ct, global);
    var size = await client.Connection.RequestAsync(MethodNames.FOLDERS_SIZE, new FolderSizeParams(global),
      ProtocolJsonContext.Default.FolderSizeParams, ProtocolJsonContext.Default.FolderSizeResult, ct);

    var cleared = Assert.Single(result.Folders);
    Assert.Equal(128, cleared.BytesFreed);
    Assert.Empty(cleared.Skipped);
    Assert.True(size.Exists);
    Assert.Equal(0, size.Bytes);
  }

  [Fact]
  public async Task One_folder_that_is_not_a_cache_refuses_the_whole_request() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var package = workspace.Root.WriteFile(Path.Combine("global-packages", "alpha", "alpha.nupkg"), "kept");
    var other = workspace.Root.WriteFile(Path.Combine("not-a-cache", "file.txt"), "kept");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    var global = GlobalOf(await FoldersAsync(client, ct));
    Assert.StartsWith(workspace.Path, global, StringComparison.OrdinalIgnoreCase);

    var exception = await Assert.ThrowsAsync<RpcException>(()
      => ClearAsync(client, ct, global, workspace.Root.Combine("not-a-cache")));

    Assert.Equal(RpcErrorCodes.FOLDER_NOT_CLEARABLE, exception.Code);
    Assert.True(File.Exists(package));
    Assert.True(File.Exists(other));
  }
}
