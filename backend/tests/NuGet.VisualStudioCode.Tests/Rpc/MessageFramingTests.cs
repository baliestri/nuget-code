// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Tests.Rpc;

public sealed class MessageFramingTests {
  [Fact]
  public async Task ReadAsync_returns_payload_announced_by_content_length() {
    var ct = TestContext.Current.CancellationToken;
    using var input = new MemoryStream("Content-Length: 7\r\n\r\n{\"a\":1}"u8.ToArray());
    var reader = new MessageReader(input);

    var payload = await reader.ReadAsync(ct);

    Assert.Equal("{\"a\":1}", Encoding.UTF8.GetString(payload!));
  }

  [Fact]
  public async Task ReadAsync_reads_consecutive_messages_and_ignores_other_headers() {
    var ct = TestContext.Current.CancellationToken;
    const string TEXT = "Content-Type: application/json\r\ncontent-length: 2\r\n\r\n{}Content-Length: 4\r\n\r\nnull";
    using var input = new MemoryStream(Encoding.ASCII.GetBytes(TEXT));
    var reader = new MessageReader(input);

    var first = await reader.ReadAsync(ct);
    var second = await reader.ReadAsync(ct);

    Assert.Equal("{}", Encoding.UTF8.GetString(first!));
    Assert.Equal("null", Encoding.UTF8.GetString(second!));
  }

  [Fact]
  public async Task ReadAsync_counts_bytes_not_characters() {
    var ct = TestContext.Current.CancellationToken;
    var body = "\"ção\""u8.ToArray();
    var header = Encoding.ASCII.GetBytes($"Content-Length: {body.Length}\r\n\r\n");
    using var input = new MemoryStream([.. header, .. body]);
    var reader = new MessageReader(input);

    var payload = await reader.ReadAsync(ct);

    Assert.Equal(body, payload);
  }

  [Fact]
  public async Task ReadAsync_returns_null_at_end_of_stream() {
    var ct = TestContext.Current.CancellationToken;
    using var input = new MemoryStream();
    var reader = new MessageReader(input);

    Assert.Null(await reader.ReadAsync(ct));
  }

  [Fact]
  public async Task ReadAsync_rejects_headers_without_content_length() {
    var ct = TestContext.Current.CancellationToken;
    using var input = new MemoryStream("Content-Type: x\r\n\r\n{}"u8.ToArray());
    var reader = new MessageReader(input);

    await Assert.ThrowsAsync<InvalidDataException>(() => reader.ReadAsync(ct).AsTask());
  }

  [Fact]
  public async Task ReadAsync_fails_when_stream_ends_inside_the_payload() {
    var ct = TestContext.Current.CancellationToken;
    using var input = new MemoryStream("Content-Length: 10\r\n\r\n{}"u8.ToArray());
    var reader = new MessageReader(input);

    await Assert.ThrowsAsync<EndOfStreamException>(() => reader.ReadAsync(ct).AsTask());
  }

  [Fact]
  public async Task WriteAsync_prefixes_payload_with_its_byte_length() {
    var ct = TestContext.Current.CancellationToken;
    using var output = new MemoryStream();
    using var writer = new MessageWriter(output);

    await writer.WriteAsync("\"ção\""u8.ToArray(), ct);

    Assert.Equal("Content-Length: 7\r\n\r\n\"ção\"", Encoding.UTF8.GetString(output.ToArray()));
  }

  [Fact]
  public async Task WriteAsync_does_not_interleave_concurrent_messages() {
    var ct = TestContext.Current.CancellationToken;
    using var output = new MemoryStream();
    using var writer = new MessageWriter(output);
    var payloads = Enumerable.Range(0, 50).Select(i => Encoding.UTF8.GetBytes($"\"{new string('x', i)}\"")).ToList();

    var writes = new List<Task>();
    foreach (var bytes in payloads) writes.Add(writer.WriteAsync(bytes, ct).AsTask());

    await Task.WhenAll(writes);

    output.Position = 0;
    var reader = new MessageReader(output);
    var received = new List<string>();
    while (await reader.ReadAsync(ct) is { } payload) received.Add(Encoding.UTF8.GetString(payload));

    Assert.Equal(
      payloads.Select(p => Encoding.UTF8.GetString(p)).Order(StringComparer.Ordinal),
      received.Order(StringComparer.Ordinal)
    );
  }
}
