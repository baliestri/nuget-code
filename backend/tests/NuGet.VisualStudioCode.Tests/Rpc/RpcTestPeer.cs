// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.IO.Pipelines;
using System.Text;
using System.Text.Json;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Tests.Rpc;

internal sealed class RpcTestPeer : IAsyncDisposable {
  private readonly MessageReader _clientReader;
  private readonly MessageWriter _clientWriter;
  private readonly Task _loop;
  private readonly MessageWriter _serverWriter;
  private readonly Pipe _toClient = new();
  private readonly Pipe _toServer = new();

  public RpcTestPeer(Action<RpcConnection> configure) {
    _serverWriter = new MessageWriter(_toClient.Writer.AsStream());
    Server = new RpcConnection(new MessageReader(_toServer.Reader.AsStream()), _serverWriter);
    configure(Server);
    _clientWriter = new MessageWriter(_toServer.Writer.AsStream());
    _clientReader = new MessageReader(_toClient.Reader.AsStream());
    _loop = Server.RunAsync(CancellationToken.None);
  }

  public RpcConnection Server { get; }

  public async ValueTask DisposeAsync() {
    await _toServer.Writer.CompleteAsync().ConfigureAwait(false);
    await _loop.ConfigureAwait(false);
    _clientWriter.Dispose();
    _serverWriter.Dispose();
  }

  public ValueTask SendAsync(string json, CancellationToken ct)
    => _clientWriter.WriteAsync(Encoding.UTF8.GetBytes(json), ct);

  public async Task<JsonElement> ReceiveAsync(CancellationToken ct) {
    var payload = await _clientReader.ReadAsync(ct).ConfigureAwait(false) ??
                  throw new EndOfStreamException();
    using var document = JsonDocument.Parse(payload);
    return document.RootElement.Clone();
  }
}
