// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;
using System.Text;

namespace NuGet.VisualStudioCode.Rpc;

internal sealed class MessageWriter(Stream output) : IDisposable {
  private readonly SemaphoreSlim _gate = new(1, 1);

  public void Dispose()
    => _gate.Dispose();

  public async ValueTask WriteAsync(ReadOnlyMemory<byte> payload, CancellationToken cancellationToken) {
    var header =
      Encoding.ASCII.GetBytes(string.Create(CultureInfo.InvariantCulture, $"Content-Length: {payload.Length}\r\n\r\n"));
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try {
      await output.WriteAsync(header, cancellationToken).ConfigureAwait(false);
      await output.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
      await output.FlushAsync(cancellationToken).ConfigureAwait(false);
    }
    finally {
      _gate.Release();
    }
  }
}
