// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using NuGet.VisualStudioCode.Feeds;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class UpdatesTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";
  private const string BETA = "Beta";
  private const string UNKNOWN = "Unknown.Package";

  private const string PROJECT = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
      <ItemGroup>
        <PackageReference Include="Alpha" Version="1.0.0" />
        <PackageReference Include="Beta" Version="1.0.0" />
        <PackageReference Include="Unknown.Package" Version="1.0.0" />
      </ItemGroup>
    </Project>
    """;

  private const string WITH_DEAD_FEED = """
      <packageSources>
        <clear />
        <add key="local" value="feed" />
        <add key="dead" value="http://127.0.0.1:1/v3/index.json" allowInsecureConnections="true" />
      </packageSources>
    """;

  private static async Task OpenAsync(BackendClient client, TestWorkspace workspace, CancellationToken ct) {
    workspace.AddPackage(ALPHA, "1.0.0");
    workspace.AddPackage(ALPHA, "1.1.0");
    workspace.AddPackage(ALPHA, "2.0.0-beta");
    workspace.AddPackage(BETA, "1.0.0");
    SampleSolution.WriteProject(workspace.Root, "App", PROJECT);
    var solution = SampleSolution.WriteSlnx(workspace.Root, "Sample", "App");
    await client.InitializeAsync(ct).ConfigureAwait(false);
    await client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(solution, null),
        ProtocolJsonContext.Default.SolutionOpenParams, ProtocolJsonContext.Default.SolutionOpenResult, ct)
      .ConfigureAwait(false);
  }

  private static Task<PackagesUpdatesResult> UpdatesAsync(BackendClient client, PackagesUpdatesParams parameters,
    CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_UPDATES, parameters,
      ProtocolJsonContext.Default.PackagesUpdatesParams, ProtocolJsonContext.Default.PackagesUpdatesResult, ct);

  private static IReadOnlyList<FeedVersion> VersionsOf(PackagesUpdatesResult result, string id)
    => result.Packages.Single(package => string.Equals(package.Id, id, StringComparison.Ordinal)).Versions;

  [Fact]
  public async Task Updates_returns_the_newest_version_of_each_installed_package() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, workspace, ct);

    var stable = await UpdatesAsync(client, new PackagesUpdatesParams(false, false, null), ct);
    var prerelease = await UpdatesAsync(client, new PackagesUpdatesParams(true, true, null), ct);

    Assert.Equal(
      [ALPHA, BETA, UNKNOWN],
      stable.Packages.Select(package => package.Id).Order(StringComparer.Ordinal),
      StringComparer.Ordinal
    );
    var alpha = Assert.Single(VersionsOf(stable, ALPHA));
    Assert.Equal("local", alpha.Feed);
    Assert.Equal("1.1.0", alpha.Version);
    Assert.Equal("1.0.0", Assert.Single(VersionsOf(stable, BETA)).Version);
    Assert.Empty(VersionsOf(stable, UNKNOWN));
    Assert.Equal("2.0.0-beta", VersionsOf(prerelease, ALPHA)[0].Version);
  }

  [Fact]
  public async Task Updates_streams_partial_results_between_begin_and_end() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    await using var client = BackendClient.Start(backend, workspace.Path);
    var progress = new ConcurrentQueue<ProgressParams>();
    var ended = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    client.Connection.OnNotification(MethodNames.PROGRESS, ProtocolJsonContext.Default.ProgressParams,
      entry =>
      {
        progress.Enqueue(entry);
        if (string.Equals(entry.Kind, ProgressKinds.END, StringComparison.Ordinal)) {
          ended.TrySetResult();
        }

        return Task.CompletedTask;
      });
    await OpenAsync(client, workspace, ct);

    var result = await UpdatesAsync(client, new PackagesUpdatesParams(false, false, "t-1"), ct);
    await ended.Task.WaitAsync(TimeSpan.FromSeconds(10), ct);

    var entries = progress.ToList();
    Assert.All(entries, entry => Assert.Equal("t-1", entry.Token));
    Assert.Equal(ProgressKinds.BEGIN, entries[0].Kind);
    Assert.Equal(ProgressKinds.END, entries[^1].Kind);
    var reported = entries
      .Where(entry => string.Equals(entry.Kind, ProgressKinds.REPORT, StringComparison.Ordinal))
      .Select(entry => entry.Package?.Id)
      .Order(StringComparer.Ordinal);
    Assert.Equal(
      result.Packages.Select(package => package.Id).Order(StringComparer.Ordinal),
      reported,
      StringComparer.Ordinal
    );
  }

  [Fact]
  public async Task A_failing_feed_is_listed_once_and_does_not_hide_the_other_feeds() {
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.WriteConfig(WITH_DEAD_FEED);
    await using var client = BackendClient.Start(backend, workspace.Path);
    await OpenAsync(client, workspace, ct);

    var result = await UpdatesAsync(client, new PackagesUpdatesParams(false, false, null), ct);

    var failure = Assert.Single(result.Failures);
    Assert.Equal("dead", failure.Feed);
    Assert.Equal(FeedFailureKinds.UNREACHABLE, failure.Kind);
    Assert.Equal("1.1.0", VersionsOf(result, ALPHA)[0].Version);
  }
}
