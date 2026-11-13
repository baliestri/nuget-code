// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Threading.Channels;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Logging;

internal sealed class BackendLog : IAsyncDisposable {
  private readonly Channel<LogEntry> _channel =
    Channel.CreateUnbounded<LogEntry>(new UnboundedChannelOptions { SingleReader = true });

  private readonly Task _pump;

  public BackendLog(Func<LogEntry, Task> sink)
    => _pump = PumpAsync(sink);

  public async ValueTask DisposeAsync() {
    _channel.Writer.TryComplete();
    await _pump.ConfigureAwait(false);
  }

  public void Write(string level, string context, string message)
    => _channel.Writer.TryWrite(
      new LogEntry(level, TimeProvider.System.GetUtcNow(), context, SecretMasker.Mask(message))
    );

  private async Task PumpAsync(Func<LogEntry, Task> sink) {
    await foreach (var entry in _channel.Reader.ReadAllAsync().ConfigureAwait(false)) {
      try {
        await sink(entry).ConfigureAwait(false);
      }
      catch (IOException) {
        // The host closed the stream; later entries are still attempted.
      }
      catch (ObjectDisposedException) {
        // Same as above.
      }
    }
  }
}
