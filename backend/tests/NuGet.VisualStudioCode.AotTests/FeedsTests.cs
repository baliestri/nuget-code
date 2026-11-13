// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Feeds;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class FeedsTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";
  private const string BETA = "Beta";
  private const string DEAD = "dead";
  private const string LOCAL = "local";

  private const string WITH_DEAD_FEED = """
      <packageSources>
        <clear />
        <add key="local" value="feed" />
        <add key="dead" value="http://127.0.0.1:1/v3/index.json" allowInsecureConnections="true" />
      </packageSources>
    """;

  private static TestWorkspace CreateWorkspace() {
    var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, "1.0.0");
    workspace.AddPackage(ALPHA, "1.1.0");
    workspace.AddPackage(ALPHA, "2.0.0-beta");
    workspace.AddPackage(BETA, "1.0.0", (ALPHA, "[1.0.0, 2.0.0)"));
    return workspace;
  }

  private static Task<PackagesSearchResult> SearchAsync(
    BackendClient client,
    PackagesSearchParams parameters,
    CancellationToken ct
  )
    => client.Connection.RequestAsync(
      MethodNames.PACKAGES_SEARCH,
      parameters,
      ProtocolJsonContext.Default.PackagesSearchParams,
      ProtocolJsonContext.Default.PackagesSearchResult,
      ct
    );

  private static Task<PackageDetailsResult> DetailsAsync(
    BackendClient client,
    PackagesDetailsParams parameters,
    CancellationToken ct
  )
    => client.Connection.RequestAsync(
      MethodNames.PACKAGES_DETAILS,
      parameters,
      ProtocolJsonContext.Default.PackagesDetailsParams,
      ProtocolJsonContext.Default.PackageDetailsResult,
      ct
    );

  [Fact]
  public async Task Search_returns_the_latest_stable_version_and_honours_prerelease() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = CreateWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var stable = await SearchAsync(client, new PackagesSearchParams(ALPHA, null, false, 0, 10), ct);
    var prerelease = await SearchAsync(client, new PackagesSearchParams(ALPHA, null, true, 0, 10), ct);

    var alpha = Assert.Single(stable.Packages);
    Assert.Equal(ALPHA, alpha.Id);
    Assert.Equal("1.1.0", alpha.Version);
    Assert.Equal(LOCAL, alpha.Feed);
    Assert.Equal("2.0.0-beta", Assert.Single(prerelease.Packages).Version);
    Assert.Empty(stable.Failures);
  }

  [Fact]
  public async Task Search_with_an_empty_query_lists_packages_and_paginates() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = CreateWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var all = await SearchAsync(client, new PackagesSearchParams(null, null, false, 0, 10), ct);
    var firstPage = await SearchAsync(client, new PackagesSearchParams(null, null, false, 0, 1), ct);
    var secondPage = await SearchAsync(client, new PackagesSearchParams(null, null, false, 1, 1), ct);

    Assert.Equal(
      [ALPHA, BETA],
      all.Packages.Select(package => package.Id).Order(StringComparer.Ordinal),
      StringComparer.Ordinal
    );
    var firstPackageSummary = Assert.Single(firstPage.Packages);
    var secondPackageSummary = Assert.Single(secondPage.Packages);
    Assert.NotEqual(firstPackageSummary.Id, secondPackageSummary.Id, StringComparer.Ordinal);
  }

  [Fact]
  public async Task Details_lists_versions_newest_first_with_dependencies() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = CreateWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var alpha = await DetailsAsync(client, new PackagesDetailsParams("alpha", null, true, false), ct);
    var beta = await DetailsAsync(client, new PackagesDetailsParams(BETA, null, false, false), ct);

    Assert.Equal(["2.0.0-beta", "1.1.0", "1.0.0"], alpha.Versions, StringComparer.Ordinal);
    Assert.Equal(LOCAL, alpha.Feed);
    Assert.Equal("Test package Beta.", beta.Description);
    var group = Assert.Single(beta.DependencyGroups);
    Assert.Equal("netstandard2.0", group.Framework);
    var dependency = Assert.Single(group.Dependencies);
    Assert.Equal(ALPHA, dependency.Id);
    Assert.Equal("[1.0.0, 2.0.0)", dependency.Range);
  }

  [Fact]
  public async Task Details_of_an_unknown_package_is_an_empty_result_not_an_error() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = CreateWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var missing = await DetailsAsync(client, new PackagesDetailsParams("Does.Not.Exist", null, false, false), ct);

    Assert.Empty(missing.Versions);
    Assert.Null(missing.Feed);
  }

  [Fact]
  public async Task An_unreachable_feed_is_reported_and_the_other_feeds_still_answer() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = CreateWorkspace();
    workspace.WriteConfig(WITH_DEAD_FEED);
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var result = await SearchAsync(client, new PackagesSearchParams(ALPHA, null, false, 0, 10), ct);

    Assert.Equal(ALPHA, Assert.Single(result.Packages).Id);
    var failure = Assert.Single(result.Failures);
    Assert.Equal(DEAD, failure.Feed);
    Assert.Equal(FeedFailureKinds.UNREACHABLE, failure.Kind);
  }

  [Fact]
  public async Task Asking_for_one_feed_turns_its_failure_into_an_error() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = CreateWorkspace();
    workspace.WriteConfig(WITH_DEAD_FEED);
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var unreachable = await Assert.ThrowsAsync<RpcException>(()
      => SearchAsync(client, new PackagesSearchParams(ALPHA, DEAD, false, 0, 10), ct));
    var unknown = await Assert.ThrowsAsync<RpcException>(()
      => SearchAsync(client, new PackagesSearchParams(ALPHA, "nope", false, 0, 10), ct));
    var local = await SearchAsync(client, new PackagesSearchParams(ALPHA, LOCAL, false, 0, 10), ct);

    Assert.Equal(RpcErrorCodes.FEED_UNREACHABLE, unreachable.Code);
    Assert.Equal(RpcErrorCodes.INVALID_PARAMS, unknown.Code);
    Assert.Single(local.Packages);
  }

  [Fact]
  public async Task A_changed_nuget_config_is_picked_up_after_the_host_reports_it() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = CreateWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);
    await SearchAsync(client, new PackagesSearchParams(ALPHA, null, false, 0, 10), ct);

    workspace.WriteConfig(WITH_DEAD_FEED);
    await client.Connection.NotifyAsync(MethodNames.WORKSPACE_DID_CHANGE_FILES,
      new DidChangeFilesParams([workspace.Root.Combine("NuGet.config")]),
      ProtocolJsonContext.Default.DidChangeFilesParams);
    var result = await SearchAsync(client, new PackagesSearchParams(ALPHA, null, false, 0, 10), ct);

    Assert.Contains(result.Failures, failure => string.Equals(failure.Feed, DEAD, StringComparison.Ordinal));
  }
}
