// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;
using System.Text;

namespace NuGet.VisualStudioCode.Rpc;

internal sealed class MessageReader(Stream input) {
  private const string CONTENT_LENGTH = "Content-Length:";
  private const int MAX_HEADER_LENGTH = 8 * 1024;

  private readonly byte[] _single = new byte[1];

  public async ValueTask<byte[]?> ReadAsync(CancellationToken cancellationToken) {
    var length = await ReadContentLengthAsync(cancellationToken).ConfigureAwait(false);
    if (length is null) {
      return null;
    }

    var payload = new byte[length.Value];
    await input.ReadExactlyAsync(payload, cancellationToken).ConfigureAwait(false);
    return payload;
  }

  private async ValueTask<int?> ReadContentLengthAsync(CancellationToken cancellationToken) {
    int? length = null;
    var sawHeader = false;
    while (true) {
      var line = await ReadLineAsync(cancellationToken).ConfigureAwait(false);
      if (line is null) {
        return sawHeader ? throw new EndOfStreamException("Stream ended inside the message headers.") : null;
      }

      if (line.Length == 0) {
        return length ?? throw new InvalidDataException("Message headers have no Content-Length.");
      }

      sawHeader = true;
      if (line.StartsWith(CONTENT_LENGTH, StringComparison.OrdinalIgnoreCase)) {
        length = int.Parse(line.AsSpan(CONTENT_LENGTH.Length).Trim(), NumberStyles.None, CultureInfo.InvariantCulture);
      }
    }
  }

  private async ValueTask<string?> ReadLineAsync(CancellationToken cancellationToken) {
    var builder = new StringBuilder();
    while (true) {
      var read = await input.ReadAsync(_single, cancellationToken).ConfigureAwait(false);
      if (read == 0) {
        return builder.Length == 0 ? null : throw new EndOfStreamException("Stream ended inside a header line.");
      }

      var current = (char)_single[0];
      if (current == '\n') {
        return builder.ToString().TrimEnd('\r');
      }

      if (builder.Length >= MAX_HEADER_LENGTH) {
        throw new InvalidDataException("Header line is too long.");
      }

      builder.Append(current);
    }
  }
}
