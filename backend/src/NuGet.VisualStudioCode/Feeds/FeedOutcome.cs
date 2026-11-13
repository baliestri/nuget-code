// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Feeds;

internal sealed record FeedOutcome<T>(IReadOnlyList<FeedResult<T>> Results, IReadOnlyList<FeedFailure> Failures) {
  public void ThrowIfRequestedFeedFailed(string? requestedFeed) {
    if (requestedFeed is null ||
        Failures.Count == 0) {
      return;
    }

    var failure = Failures[0];
    var code = string.Equals(failure.Kind, FeedFailureKinds.AUTHENTICATION, StringComparison.Ordinal)
      ? RpcErrorCodes.AUTHENTICATION_REFUSED
      : RpcErrorCodes.FEED_UNREACHABLE;
    throw new RpcException(code, $"The feed '{failure.Feed}' did not answer.", failure.Message);
  }
}
