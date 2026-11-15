// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Feeds;

namespace NuGet.VisualStudioCode.Tests.Feeds;

public sealed class TimedCacheTests {
  private const string KEY = "k";

  [Fact]
  public async Task Value_is_reused_until_it_expires() {
    var time = new ManualTimeProvider();
    var cache = new TimedCache<int>(TimeSpan.FromMinutes(1), time);
    var calls = 0;

    var first = await cache.GetAsync(KEY, false, () => Task.FromResult(++calls));
    time.Advance(TimeSpan.FromSeconds(59));
    var second = await cache.GetAsync("K", false, () => Task.FromResult(++calls));
    time.Advance(TimeSpan.FromSeconds(2));
    var third = await cache.GetAsync(KEY, false, () => Task.FromResult(++calls));

    Assert.Equal([1, 1, 2], [first, second, third]);
  }

  [Fact]
  public async Task Bypass_refreshes_the_entry_for_later_readers() {
    var cache = new TimedCache<int>(TimeSpan.FromMinutes(1), new ManualTimeProvider());
    var calls = 0;

    await cache.GetAsync(KEY, false, () => Task.FromResult(++calls));
    var bypassed = await cache.GetAsync(KEY, true, () => Task.FromResult(++calls));
    var after = await cache.GetAsync(KEY, false, () => Task.FromResult(++calls));

    Assert.Equal(2, bypassed);
    Assert.Equal(2, after);
  }

  [Fact]
  public async Task A_failing_factory_caches_nothing() {
    var cache = new TimedCache<int>(TimeSpan.FromMinutes(1), new ManualTimeProvider());

    await Assert.ThrowsAsync<InvalidOperationException>(()
      => cache.GetAsync(KEY, false, () => throw new InvalidOperationException("down")));
    var value = await cache.GetAsync(KEY, false, () => Task.FromResult(7));

    Assert.Equal(7, value);
  }
}
