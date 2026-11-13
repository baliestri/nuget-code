// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;

namespace NuGet.VisualStudioCode.Projects;

internal sealed class Debouncer(TimeSpan delay, Func<CancellationToken, Task> action) : IDisposable {
  private readonly Lock _lock = new();

  private CancellationTokenSource? _pending;

  public void Dispose() {
    lock (_lock) {
      _pending?.Cancel();
      _pending = null;
    }
  }

  [SuppressMessage("Reliability", "CA2000:Dispose objects before losing scope",
    Justification = "A replaced source is not disposed: the run it belongs to may still observe its token.")]
  public void Trigger() {
    CancellationTokenSource current;
    lock (_lock) {
      _pending?.Cancel();
      _pending = current = new CancellationTokenSource();
    }

    _ = RunAsync(current.Token);
  }

  private async Task RunAsync(CancellationToken ct) {
    try {
      await Task.Delay(delay, ct).ConfigureAwait(false);
      await action(ct).ConfigureAwait(false);
    }
    catch (OperationCanceledException) {
      // Another trigger took over, or the debouncer was disposed.
    }
  }
}
