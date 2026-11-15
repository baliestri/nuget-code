// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class ConfigurationTests(PublishedBackend backend) {
  private const string CONFIG = """
    <?xml version="1.0" encoding="utf-8"?>
    <configuration>
      <packageSources>
        <clear />
        <add key="local" value="feed" />
      </packageSources>
      <config>
        <add key="globalPackagesFolder" value="global-packages" />
      </config>
    </configuration>
    """;

  private const string GLOBAL_PACKAGES = "Global Packages";

  private static Task<FoldersListResult> FoldersAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.FOLDERS_LIST, new Empty(), ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.FoldersListResult, ct);

  private static Task<FolderSizeResult> SizeAsync(BackendClient client, string path, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.FOLDERS_SIZE, new FolderSizeParams(path),
      ProtocolJsonContext.Default.FolderSizeParams, ProtocolJsonContext.Default.FolderSizeResult, ct);

  [Fact]
  public async Task Sources_list_reads_the_config_hierarchy_from_the_working_directory() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var configPath = directory.WriteFile("NuGet.config", CONFIG);
    await using var client = BackendClient.Start(backend, directory.Path);
    await client.InitializeAsync(ct);

    var result = await client.Connection.RequestAsync(MethodNames.SOURCES_LIST, new Empty(),
      ProtocolJsonContext.Default.Empty, ProtocolJsonContext.Default.SourcesListResult, ct);

    Assert.Equal(configPath, result.Files[0].Path, true);
    var feed = Assert.Single(result.Effective);
    Assert.Equal("local", feed.Name);
    Assert.True(feed.IsLocal);
  }

  [Fact]
  public async Task Folders_list_honours_the_configured_global_packages_folder() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    directory.WriteFile("NuGet.config", CONFIG);
    await using var client = BackendClient.Start(backend, directory.Path);
    await client.InitializeAsync(ct);

    var result = await FoldersAsync(client, ct);

    var global = Assert.Single(result.Folders,
      folder => string.Equals(folder.Title, GLOBAL_PACKAGES, StringComparison.Ordinal));
    Assert.StartsWith(directory.Combine("global-packages"), global.Path, StringComparison.OrdinalIgnoreCase);
    Assert.Contains(result.Folders, folder => string.Equals(folder.Title, "HTTP Cache", StringComparison.Ordinal));
  }

  [Fact]
  public async Task Folders_size_measures_a_listed_folder_and_rejects_any_other_path() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    directory.WriteFile("NuGet.config", CONFIG);
    directory.WriteFile(Path.Combine("global-packages", "pkg", "file.bin"), new string('z', 64));
    await using var client = BackendClient.Start(backend, directory.Path);
    await client.InitializeAsync(ct);
    var folders = await FoldersAsync(client, ct);
    var global =
      folders.Folders.Single(folder => string.Equals(folder.Title, GLOBAL_PACKAGES, StringComparison.Ordinal));

    var size = await SizeAsync(client, global.Path, ct);
    var rejected = await Assert.ThrowsAsync<RpcException>(() => SizeAsync(client, directory.Path, ct));

    Assert.True(size.Exists);
    Assert.Equal(64, size.Bytes);
    Assert.Equal(RpcErrorCodes.INVALID_PARAMS, rejected.Code);
  }
}
