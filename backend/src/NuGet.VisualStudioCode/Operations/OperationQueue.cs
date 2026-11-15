// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Runs state-changing work one piece at a time, in arrival order. Reads do not go through it.
/// </summary>
internal sealed class OperationQueue : IDisposable {
  private readonly SemaphoreSlim _gate = new(1, 1);
  private readonly Lock _lock = new();

  private CancellationTokenSource? _current;
  private CancellationTokenSource _generation = new();

  public void Dispose() {
    _gate.Dispose();
    _generation.Dispose();
  }

  public async Task<T> RunAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct) {
    CancellationToken generation;
    lock (_lock) {
      generation = _generation.Token;
    }

    using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, generation);
    await _gate.WaitAsync(linked.Token).ConfigureAwait(false);
    try {
      // The turn can be granted in the same instant the work is cancelled; cancelled work must not start.
      linked.Token.ThrowIfCancellationRequested();
      lock (_lock) {
        _current = linked;
      }

      return await work(linked.Token).ConfigureAwait(false);
    }
    finally {
      lock (_lock) {
        _current = null;
      }

      _gate.Release();
    }
  }

  public void CancelCurrent() {
    lock (_lock) {
      _current?.Cancel();
    }
  }

  [SuppressMessage(
    "Reliability",
    "CA2000:Dispose objects before losing scope",
    Justification = "The replaced source is not disposed: queued and running work still observe its token."
  )]
  public void CancelAll() {
    CancellationTokenSource previous;
    lock (_lock) {
      previous = _generation;
      _generation = new CancellationTokenSource();
    }

    previous.Cancel();
  }
}
