// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;

namespace NuGet.VisualStudioCode.Feeds;

internal sealed class TimedCache<TValue>(TimeSpan lifetime, TimeProvider time) {
  private readonly ConcurrentDictionary<string, (DateTimeOffset Expires, TValue Value)> _entries =
    new(StringComparer.OrdinalIgnoreCase);

  public async Task<TValue> GetAsync(string key, bool bypass, Func<Task<TValue>> factory) {
    if (!bypass &&
        _entries.TryGetValue(key, out var entry) &&
        entry.Expires > time.GetUtcNow()) {
      return entry.Value;
    }

    var value = await factory().ConfigureAwait(false);
    _entries[key] = (time.GetUtcNow() + lifetime, value);
    return value;
  }

  public void Clear()
    => _entries.Clear();
}
