// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Tests.Feeds;

internal sealed class ManualTimeProvider : TimeProvider {
  private DateTimeOffset _now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

  public override DateTimeOffset GetUtcNow()
    => _now;

  public void Advance(TimeSpan amount)
    => _now += amount;
}
