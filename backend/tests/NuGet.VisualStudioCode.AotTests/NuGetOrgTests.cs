// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class NuGetOrgTests(PublishedBackend backend) {
  private const string NEWTONSOFT = "Newtonsoft.Json";

  private const string SOURCES = """
      <packageSources>
        <clear />
        <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
      </packageSources>
    """;

  [Fact]
  public async Task Search_and_details_work_against_nuget_org() {
    Assert.SkipUnless(
      string.Equals(Environment.GetEnvironmentVariable("NUGET_VSCODE_ONLINE_TESTS"), "1", StringComparison.Ordinal),
      "Set NUGET_VSCODE_ONLINE_TESTS=1 to run the tests that reach nuget.org.");
    var ct = TestContext.Current.CancellationToken;
    using var workspace = new TestWorkspace();
    workspace.WriteConfig(SOURCES);
    await using var client = BackendClient.Start(backend, workspace.Path);
    await client.InitializeAsync(ct);

    var search = await client.Connection.RequestAsync(MethodNames.PACKAGES_SEARCH,
      new PackagesSearchParams(NEWTONSOFT, null, false, 0, 5),
      ProtocolJsonContext.Default.PackagesSearchParams, ProtocolJsonContext.Default.PackagesSearchResult, ct);
    var details = await client.Connection.RequestAsync(MethodNames.PACKAGES_DETAILS,
      new PackagesDetailsParams(NEWTONSOFT, null, false, true),
      ProtocolJsonContext.Default.PackagesDetailsParams, ProtocolJsonContext.Default.PackageDetailsResult, ct);

    Assert.Empty(search.Failures);
    Assert.Contains(search.Packages, package => string.Equals(package.Id, NEWTONSOFT, StringComparison.Ordinal));
    Assert.Contains("13.0.3", details.Versions, StringComparer.Ordinal);
    Assert.Equal("MIT", details.License);
    Assert.NotEmpty(details.DependencyGroups);
  }
}
