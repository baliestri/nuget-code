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
  private readonly ConcurrentDictionary<string, NetworkCredential> _known = new(StringComparer.OrdinalIgnoreCase);

  /// <summary>
  ///   What the host answered in this session, by <c>scheme://authority</c>. Held in memory only, so the restore
  ///   engines that start a <c>dotnet</c> process can hand the same credentials over.
  /// </summary>
  public IReadOnlyDictionary<string, NetworkCredential> Known => _known;

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

    var credential = new NetworkCredential(answer.Username, answer.Password);
    _known[host] = credential;
    return new CredentialResponse(credential);
  }

  public void Reset(string? source) {
    if (source is null) {
      _declined.Clear();
      _known.Clear();
      return;
    }

    if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)) {
      return;
    }

    var host = uri.GetLeftPart(UriPartial.Authority);
    _declined.TryRemove(KeyValuePair.Create(host, (byte)0));
    if (_known.TryGetValue(host, out var credential)) {
      _known.TryRemove(KeyValuePair.Create(host, credential));
    }
  }
}
