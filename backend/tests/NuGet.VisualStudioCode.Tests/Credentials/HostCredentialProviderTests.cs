// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Configuration;
using NuGet.Credentials;
using NuGet.VisualStudioCode.Credentials;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Tests.Credentials;

public sealed class HostCredentialProviderTests {
  private readonly static Uri Feed = new("https://feed.example/v3/index.json");
  private readonly static CredentialsRequestResult Cancelled = new(null, null, true);

  private static Task<CredentialResponse> GetAsync(HostCredentialProvider provider, Uri uri, bool isRetry,
    CredentialRequestType type = CredentialRequestType.Unauthorized)
    => provider.GetAsync(uri, null, type, "message", isRetry, false, TestContext.Current.CancellationToken);

  [Fact]
  public async Task Host_answer_becomes_network_credentials() {
    var asked = new List<CredentialsRequestParams>();
    var provider = new HostCredentialProvider((request, _) =>
    {
      asked.Add(request);
      return Task.FromResult(new CredentialsRequestResult("user", "secret", false));
    });

    var response = await GetAsync(provider, Feed, true);

    Assert.Equal(CredentialStatus.Success, response.Status);
    var credential = response.Credentials?.GetCredential(Feed, "Basic");
    Assert.NotNull(credential);
    Assert.Equal("user", credential.UserName);
    Assert.Equal("secret", credential.Password);
    var request = Assert.Single(asked);
    Assert.Equal(Feed.AbsoluteUri, request.Source);
    Assert.True(request.IsRetry);
  }

  [Fact]
  public async Task Cancellation_is_remembered_per_host_until_reset() {
    var calls = 0;
    var provider = new HostCredentialProvider((_, _) =>
    {
      calls++;
      return Task.FromResult(Cancelled);
    });

    var first = await GetAsync(provider, Feed, false);
    var second = await GetAsync(provider, new Uri("https://feed.example/other/path"), false);
    var otherHost = await GetAsync(provider, new Uri("https://another.example/v3/index.json"), false);
    provider.Reset(Feed.AbsoluteUri);
    await GetAsync(provider, Feed, false);

    Assert.Equal(CredentialStatus.UserCanceled, first.Status);
    Assert.Equal(CredentialStatus.UserCanceled, second.Status);
    Assert.Equal(CredentialStatus.UserCanceled, otherHost.Status);
    Assert.Equal(3, calls);
  }

  [Fact]
  public async Task Reset_without_source_releases_every_host() {
    var calls = 0;
    var provider = new HostCredentialProvider((_, _) =>
    {
      calls++;
      return Task.FromResult(Cancelled);
    });

    await GetAsync(provider, Feed, false);
    provider.Reset(null);
    await GetAsync(provider, Feed, false);

    Assert.Equal(2, calls);
  }

  [Fact]
  public async Task Proxy_requests_are_not_handled() {
    var provider = new HostCredentialProvider((_, _) => throw new InvalidOperationException("must not ask"));

    var response = await GetAsync(provider, Feed, false, CredentialRequestType.Proxy);

    Assert.Equal(CredentialStatus.ProviderNotApplicable, response.Status);
  }
}
