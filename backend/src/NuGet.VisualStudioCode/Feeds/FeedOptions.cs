// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Feeds;

internal sealed class FeedOptions {
  public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);
}
