// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class SourcesWriteTests(PublishedBackend backend) {
  private const string EXTRA = "extra";
  private const string GLOBAL_PACKAGES_FOLDER = "globalPackagesFolder";

  private static Task<SourcesListResult> ListAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.SOURCES_LIST, new Empty(), ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.SourcesListResult, ct);

  private static Task<FeedInfo> WriteAsync(BackendClient client, string method, SourceWriteParams parameters,
    CancellationToken ct)
    => client.Connection.RequestAsync(method, parameters, ProtocolJsonContext.Default.SourceWriteParams,
      ProtocolJsonContext.Default.FeedInfo, ct);

  private static SourceWriteParams Source(string name, string? source = null, string? newName = null,
    bool? enabled = null)
    => new(null, name, newName, source, enabled, null, null);

  [Fact]
  public async Task Sources_list_describes_files_feeds_and_folders() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var config = workspace.Root.Combine("NuGet.config");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var result = await ListAsync(client, ct);

    var file = result.Files[0];
    Assert.Equal(config, file.Path, true);
    Assert.True(file.Writable);
    Assert.False(file.IsMachineWide);
    Assert.Equal("global-packages", file.GlobalPackagesFolder);
    var feed = Assert.Single(result.Effective);
    Assert.Equal(config, feed.DeclaredIn, true);
    Assert.False(feed.IsMachineWide);
    Assert.StartsWith(workspace.Root.Combine("global-packages"), result.GlobalPackagesFolder,
      StringComparison.OrdinalIgnoreCase);
    Assert.NotNull(result.FallbackFolders);
  }

  [Fact]
  public async Task Sources_are_added_updated_and_removed() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var added = await WriteAsync(client, MethodNames.SOURCES_ADD, Source(EXTRA, "extra-feed"), ct);
    var afterAdd = await ListAsync(client, ct);
    var updated = await WriteAsync(client, MethodNames.SOURCES_UPDATE,
      Source(EXTRA, "moved-feed", "renamed", false), ct);
    var afterUpdate = await ListAsync(client, ct);
    await client.Connection.RequestAsync(MethodNames.SOURCES_REMOVE, new SourceRemoveParams(null, "renamed"),
      ProtocolJsonContext.Default.SourceRemoveParams, ProtocolJsonContext.Default.Empty, ct);
    var afterRemove = await ListAsync(client, ct);

    Assert.Equal(EXTRA, added.Name);
    Assert.True(added.Enabled);
    Assert.Equal(["local", EXTRA], afterAdd.Effective.Select(feed => feed.Name), StringComparer.Ordinal);
    Assert.Equal("renamed", updated.Name);
    Assert.False(updated.Enabled);
    Assert.EndsWith("moved-feed", updated.Source, StringComparison.Ordinal);
    Assert.Equal(["local", "renamed"], afterUpdate.Effective.Select(feed => feed.Name), StringComparer.Ordinal);
    Assert.Equal("local", Assert.Single(afterRemove.Effective).Name);
  }

  [Fact]
  public async Task Write_errors_carry_their_codes() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var duplicate = await Assert.ThrowsAsync<RpcException>(()
      => WriteAsync(client, MethodNames.SOURCES_ADD, Source("local", "other"), ct));
    var unknown = await Assert.ThrowsAsync<RpcException>(()
      => WriteAsync(client, MethodNames.SOURCES_UPDATE, Source("ghost", "other"), ct));

    Assert.Equal(RpcErrorCodes.FEED_DUPLICATE, duplicate.Code);
    Assert.Equal(RpcErrorCodes.FEED_UNKNOWN, unknown.Code);
  }

  [Fact]
  public async Task Set_property_changes_the_resolved_folder() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    var config = workspace.Root.Combine("NuGet.config");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    await client.Connection.RequestAsync(MethodNames.SOURCES_SET_PROPERTY,
      new SourceSetPropertyParams(config, GLOBAL_PACKAGES_FOLDER, "elsewhere"),
      ProtocolJsonContext.Default.SourceSetPropertyParams, ProtocolJsonContext.Default.Empty, ct);
    var result = await ListAsync(client, ct);

    Assert.Equal("elsewhere", result.Files[0].GlobalPackagesFolder);
    Assert.StartsWith(workspace.Root.Combine("elsewhere"), result.GlobalPackagesFolder,
      StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public async Task Added_feed_is_searchable_without_a_host_notification() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    TestPackages.Create(workspace.Root.Combine("extra-feed"), "Omega", "1.0.0");
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    var search = new PackagesSearchParams("Omega", EXTRA, false, 0, 10);
    var before = await Assert.ThrowsAsync<RpcException>(() => client.Connection.RequestAsync(
      MethodNames.PACKAGES_SEARCH, search, ProtocolJsonContext.Default.PackagesSearchParams,
      ProtocolJsonContext.Default.PackagesSearchResult, ct));

    await WriteAsync(client, MethodNames.SOURCES_ADD, Source(EXTRA, "extra-feed"), ct);
    var after = await client.Connection.RequestAsync(MethodNames.PACKAGES_SEARCH, search,
      ProtocolJsonContext.Default.PackagesSearchParams, ProtocolJsonContext.Default.PackagesSearchResult, ct);

    Assert.NotEqual(0, before.Code);
    Assert.Equal("Omega", Assert.Single(after.Packages).Id);
  }
}
