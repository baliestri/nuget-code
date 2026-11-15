// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class SdkTests(PublishedBackend backend) {
  [Fact]
  public async Task Initialize_reports_the_installed_sdk() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    await using var client = BackendClient.Start(backend, directory.Path);

    var result = await client.InitializeAsync(ct);

    Assert.NotNull(result.Sdk);
    Assert.Matches(@"^\d+\.\d+\.\d+", result.Sdk.Version);
    Assert.True(File.Exists(result.Sdk.DotnetPath));
  }

  [Fact]
  public async Task Initialize_succeeds_without_sdk_when_the_configured_path_is_wrong() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    await using var client = BackendClient.Start(backend, directory.Path);

    var result = await client.InitializeAsync(ct, directory.Combine("no-dotnet-here"));

    Assert.Null(result.Sdk);
    Assert.Equal(1, result.ProtocolVersion);
  }
}
