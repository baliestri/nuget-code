// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class HttpFeedsTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";
  private const string BETA = "Beta";
  private const string LOCAL = "local";
  private const string REMOTE = "remote";
  private const string REMOTE_ALPHA = "Alpha from remote.";

  private const string PROJECT = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
      <ItemGroup>
        <PackageReference Include="Alpha" Version="1.0.0" />
        <PackageReference Include="Beta" Version="1.0.0" />
      </ItemGroup>
    </Project>
    """;

  private const string MAPPING = """
      <packageSourceMapping>
        <packageSource key="local">
          <package pattern="Alpha" />
        </packageSource>
        <packageSource key="remote">
          <package pattern="Beta" />
        </packageSource>
      </packageSourceMapping>
    """;

  private static TestFeedServer CreateServer()
    => new(new TestFeedPackage(ALPHA, "5.0.0", REMOTE_ALPHA),
      new TestFeedPackage(ALPHA, "5.1.0", REMOTE_ALPHA),
      new TestFeedPackage(ALPHA, "6.0.0-rc.1", REMOTE_ALPHA),
      new TestFeedPackage(BETA, "5.0.0", "Beta from remote."));

  private static string Sources(string name, string url, string? extra = null)
    => $"""
        <packageSources>
          <clear />
          <add key="local" value="feed" />
          <add key="{name}" value="{url}" allowInsecureConnections="true" />
        </packageSources>
      {extra}
      """;

  private static Task<PackageDetailsResult> DetailsAsync(BackendClient client, string id, string? feed,
    bool prerelease, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_DETAILS,
      new PackagesDetailsParams(id, feed, prerelease, true),
      ProtocolJsonContext.Default.PackagesDetailsParams, ProtocolJsonContext.Default.PackageDetailsResult, ct);

  private static async Task<PackagesUpdatesResult> OpenAndUpdateAsync(BackendClient client, TestWorkspace workspace,
    CancellationToken ct) {
    SampleSolution.WriteProject(workspace.Root, "App", PROJECT);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await client.InitializeAsync(ct).ConfigureAwait(false);
    await client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(solution, null),
        ProtocolJsonContext.Default.SolutionOpenParams, ProtocolJsonContext.Default.SolutionOpenResult, ct)
      .ConfigureAwait(false);
    return await client.Connection.RequestAsync(MethodNames.PACKAGES_UPDATES,
        new PackagesUpdatesParams(false, true, null),
        ProtocolJsonContext.Default.PackagesUpdatesParams, ProtocolJsonContext.Default.PackagesUpdatesResult, ct)
      .ConfigureAwait(false);
  }

  private static IReadOnlyList<FeedVersion> VersionsOf(PackagesUpdatesResult result, string id)
    => result.Packages.Single(package => string.Equals(package.Id, id, StringComparison.Ordinal)).Versions;

  [Fact]
  public async Task V3_feed_search_and_details_work_under_aot() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = new TestWorkspace();
    workspace.WriteConfig(Sources(REMOTE, server.V3Url));
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var search = await client.Connection.RequestAsync(MethodNames.PACKAGES_SEARCH,
      new PackagesSearchParams("alp", REMOTE, false, 0, 10),
      ProtocolJsonContext.Default.PackagesSearchParams, ProtocolJsonContext.Default.PackagesSearchResult, ct);
    var details = await DetailsAsync(client, ALPHA, REMOTE, true, ct);

    var alpha = Assert.Single(search.Packages);
    Assert.Equal("5.1.0", alpha.Version);
    Assert.Equal(REMOTE_ALPHA, alpha.Description);
    Assert.Equal(42, alpha.DownloadCount);
    Assert.Equal(["6.0.0-rc.1", "5.1.0", "5.0.0"], details.Versions, StringComparer.Ordinal);
    Assert.Equal("MIT", details.License);
    Assert.Equal(REMOTE, details.Feed);
  }

  [Fact]
  public async Task V2_feed_details_work_under_aot() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = new TestWorkspace();
    workspace.WriteConfig(Sources("legacy", server.V2Url));
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var details = await DetailsAsync(client, ALPHA, "legacy", false, ct);

    Assert.Equal(["5.1.0", "5.0.0"], details.Versions, StringComparer.Ordinal);
    Assert.Equal(REMOTE_ALPHA, details.Description);
    Assert.Equal("legacy", details.Feed);
  }

  [Fact]
  public async Task Updates_combine_local_and_http_feeds() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, "1.0.0");
    workspace.WriteConfig(Sources(REMOTE, server.V3Url));
    await using var client = BackendClient.Start(backend, workspace.Path);

    var updates = await OpenAndUpdateAsync(client, workspace, ct);

    var alpha = VersionsOf(updates, ALPHA)
      .ToDictionary(version => version.Feed, version => version.Version, StringComparer.Ordinal);
    Assert.Equal("1.0.0", alpha[LOCAL]);
    Assert.Equal("5.1.0", alpha[REMOTE]);
    Assert.Empty(updates.Failures);
  }

  [Fact]
  public async Task Package_source_mapping_restricts_which_feed_is_asked() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = new TestWorkspace();
    workspace.AddPackage(ALPHA, "1.0.0");
    workspace.AddPackage(BETA, "1.0.0");
    workspace.WriteConfig(Sources(REMOTE, server.V3Url, MAPPING));
    await using var client = BackendClient.Start(backend, workspace.Path);

    var updates = await OpenAndUpdateAsync(client, workspace, ct);
    var alphaDetails = await DetailsAsync(client, ALPHA, null, false, ct);

    Assert.Equal(LOCAL, Assert.Single(VersionsOf(updates, ALPHA)).Feed);
    Assert.Equal(REMOTE, Assert.Single(VersionsOf(updates, BETA)).Feed);
    Assert.Equal(["1.0.0"], alphaDetails.Versions, StringComparer.Ordinal);
    Assert.DoesNotContain(server.RequestedPaths, path => path.Contains("alpha", StringComparison.OrdinalIgnoreCase));
  }
}
