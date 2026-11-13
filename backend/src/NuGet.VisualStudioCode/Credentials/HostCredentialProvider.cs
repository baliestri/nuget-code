// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.Net;
using NuGet.Configuration;
using NuGet.Credentials;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Credentials;

internal sealed class HostCredentialProvider(
  Func<CredentialsRequestParams, CancellationToken, Task<CredentialsRequestResult>> ask
) : ICredentialProvider {
  private readonly ConcurrentDictionary<string, byte> _declined = new(StringComparer.OrdinalIgnoreCase);

  public string Id => "NuGet.VisualStudioCode.Host";

  public async Task<CredentialResponse> GetAsync(Uri uri, IWebProxy? proxy, CredentialRequestType type,
    string? message, bool isRetry, bool nonInteractive, CancellationToken ct) {
    if (type == CredentialRequestType.Proxy) {
      return new CredentialResponse(CredentialStatus.ProviderNotApplicable);
    }

    var host = uri.GetLeftPart(UriPartial.Authority);
    if (_declined.ContainsKey(host)) {
      return new CredentialResponse(CredentialStatus.UserCanceled);
    }

    var answer = await ask(new CredentialsRequestParams(uri.AbsoluteUri, isRetry), ct)
      .ConfigureAwait(false);

    if (answer.Cancelled ||
        answer.Username is null ||
        answer.Password is null) {
      _declined[host] = 0;
      return new CredentialResponse(CredentialStatus.UserCanceled);
    }

    return new CredentialResponse(new NetworkCredential(answer.Username, answer.Password));
  }

  public void Reset(string? source) {
    if (source is null) {
      _declined.Clear();
      return;
    }

    if (Uri.TryCreate(source, UriKind.Absolute, out var uri)) {
      _declined.TryRemove(KeyValuePair.Create(uri.GetLeftPart(UriPartial.Authority), (byte)0));
    }
  }
}
