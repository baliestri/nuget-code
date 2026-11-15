// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace NuGet.VisualStudioCode.Console.Tests.Support;

/// <summary>
///   The extension's side of the channel, for the tests: a named pipe on Windows and a Unix socket elsewhere,
///   as the extension does, answering each method with what the test set up and recording what was asked.
/// </summary>
internal sealed class FakeConsoleServer : IAsyncDisposable {
  private const string PIPE_PREFIX = @"\\.\pipe\";
  private readonly string? _folder;

  private readonly ConcurrentDictionary<string, Func<JsonElement, Task<FakeAnswer>>> _handlers =
    new(StringComparer.Ordinal);

  private readonly Task _listening;
  private readonly ConcurrentQueue<FakeRequest> _requests = new();
  private readonly Socket? _socket;
  private readonly CancellationTokenSource _stop = new();

  public FakeConsoleServer() {
    Token = Guid.NewGuid().ToString("N");
    if (OperatingSystem.IsWindows()) {
      Address = PIPE_PREFIX + "nuget-code-test-" + Guid.NewGuid().ToString("N");
      _listening = ListenOnPipeAsync(_stop.Token);
      return;
    }

    _folder = Directory.CreateTempSubdirectory("nuget-code-test-").FullName;
    Address = Path.Combine(_folder, "console.sock");
    _socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
    _socket.Bind(new UnixDomainSocketEndPoint(Address));
    _socket.Listen();
    _listening = ListenOnSocketAsync(_socket, _stop.Token);
  }

  public string Address { get; }
  public string Token { get; }

  /// <summary>What was asked so far, in the order it arrived.</summary>
  public IReadOnlyList<FakeRequest> Requests => [.. _requests];

  public async ValueTask DisposeAsync() {
    await _stop.CancelAsync().ConfigureAwait(false);
    _socket?.Dispose();
    try {
      await _listening.ConfigureAwait(false);
    }
    catch (OperationCanceledException) {
      // The way the listening ends.
    }

    _stop.Dispose();
    if (_folder is not null) {
      Directory.Delete(_folder, true);
    }
  }

  /// <summary>Answers the method with this result, whatever its params.</summary>
  public FakeConsoleServer On(string method, string resultJson)
    => On(method, _ => FakeAnswer.Of(resultJson));

  public FakeConsoleServer On(string method, Func<JsonElement, FakeAnswer> handler)
    => On(method, parameters => Task.FromResult(handler(parameters)));

  public FakeConsoleServer On(string method, Func<JsonElement, Task<FakeAnswer>> handler) {
    _handlers[method] = handler;
    return this;
  }

  /// <summary>The params of every request of that method, as JSON.</summary>
  public IReadOnlyList<string> ParamsOf(string method)
    => [
      .. _requests.Where(request => string.Equals(request.Method, method, StringComparison.Ordinal))
        .Select(request => request.Params)
    ];

  private async Task ListenOnPipeAsync(CancellationToken ct) {
    var connections = new List<Task>();
    while (!ct.IsCancellationRequested) {
      var pipe = new NamedPipeServerStream(Address[PIPE_PREFIX.Length..], PipeDirection.InOut,
        NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
      try {
        await pipe.WaitForConnectionAsync(ct).ConfigureAwait(false);
      }
      catch (OperationCanceledException) {
        await pipe.DisposeAsync().ConfigureAwait(false);
        break;
      }

      connections.Add(ServeAsync(pipe, ct));
    }

    await Task.WhenAll(connections).ConfigureAwait(false);
  }

  private async Task ListenOnSocketAsync(Socket listener, CancellationToken ct) {
    var connections = new List<Task>();
    while (!ct.IsCancellationRequested) {
      Socket accepted;
      try {
        accepted = await listener.AcceptAsync(ct).ConfigureAwait(false);
      }
      catch (Exception exception) when (exception is OperationCanceledException or SocketException
                                          or ObjectDisposedException) {
        break;
      }

      connections.Add(ServeAsync(new NetworkStream(accepted, true), ct));
    }

    await Task.WhenAll(connections).ConfigureAwait(false);
  }

  private async Task ServeAsync(Stream stream, CancellationToken ct) {
    await using (stream.ConfigureAwait(false)) {
      try {
        using var reader = new StreamReader(stream, Encoding.UTF8, false, leaveOpen: true);
        var line = await reader.ReadLineAsync(ct).ConfigureAwait(false);
        if (line is null) {
          return;
        }

        using var request = JsonDocument.Parse(line);
        var root = request.RootElement;
        if (!root.TryGetProperty("token", out var token) ||
            !string.Equals(token.GetString(), Token, StringComparison.Ordinal)) {
          return;
        }

        var id = root.GetProperty("id").GetInt32();
        var method = root.GetProperty("method").GetString() ?? string.Empty;
        var parameters = root.TryGetProperty("params", out var given) ? given.Clone() : default;
        _requests.Enqueue(new FakeRequest(method,
          parameters.ValueKind == JsonValueKind.Undefined ? "{}" : parameters.GetRawText()));

        var answer = _handlers.TryGetValue(method, out var handler)
          ? await handler(parameters).ConfigureAwait(false)
          : FakeAnswer.Failed("methodNotAllowed", $"The test did not expect '{method}'.");
        foreach (var step in answer.Progress)
          await WriteAsync(stream, $$"""{"id":{{id}},"progress":{{step}}}""", ct).ConfigureAwait(false);
        await WriteAsync(stream, answer.Result is null
          ? $$"""{"id":{{id}},"error":{{ErrorJson(answer)}}}"""
          : $$"""{"id":{{id}},"result":{{answer.Result}}}""", ct).ConfigureAwait(false);
      }
      catch (Exception exception) when (exception is IOException or OperationCanceledException or JsonException) {
        // A client that went away, or the end of the test.
      }
    }
  }

  private static string ErrorJson(FakeAnswer answer)
    => "{\"code\":" + Quoted(answer.ErrorCode) + ",\"message\":" + Quoted(answer.ErrorMessage) + "}";

  private static string Quoted(string? text)
    => $"\"{JsonEncodedText.Encode(text ?? string.Empty)}\"";

  private static async Task WriteAsync(Stream stream, string line, CancellationToken ct) {
    await stream.WriteAsync(Encoding.UTF8.GetBytes(line + "\n"), ct).ConfigureAwait(false);
    await stream.FlushAsync(ct).ConfigureAwait(false);
  }
}
