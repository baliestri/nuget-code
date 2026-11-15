// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.IO.Pipes;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace NuGet.VisualStudioCode.Console.Channel;

/// <summary>
///   Asks the extension. Each request is a connection of its own: one line of JSON out, then lines in until
///   the one that carries the result or the error. That lets a cancellation be sent while an operation runs.
/// </summary>
internal sealed class ConsoleClient(string address, string token) {
  private const string LOST = "The editor is not answering this console. Open the Package Manager Console again.";
  private const string PIPE_PREFIX = @"\\.\pipe\";
  private const string INTERNAL = "internal";
  private readonly static TimeSpan ConnectTimeout = TimeSpan.FromSeconds(5);

  /// <summary>The client the shell was started for, or one that fails every request when there is none.</summary>
  public static ConsoleClient FromEnvironment()
    => new(
      Environment.GetEnvironmentVariable(ConsoleEnvironment.ADDRESS) ?? string.Empty,
      Environment.GetEnvironmentVariable(ConsoleEnvironment.TOKEN) ?? string.Empty
    );

  /// <summary>Sends a request that has no parameters and waits for its answer.</summary>
  /// <exception cref="ConsoleException">The extension refused, failed, or is not there.</exception>
  public TResult Request<TResult>(string method, JsonTypeInfo<TResult> result, CancellationToken ct = default)
    => Request(method, new Wire.Nothing(), WireJsonContext.Default.Nothing, result, null, ct);

  /// <summary>
  ///   Sends the request and waits for its answer. <paramref name="progress" /> is called, on the calling
  ///   thread, for each step the extension reports before it.
  /// </summary>
  /// <exception cref="ConsoleException">The extension refused, failed, or is not there.</exception>
  public TResult Request<TParams, TResult>(string method, TParams parameters, JsonTypeInfo<TParams> parametersInfo,
    JsonTypeInfo<TResult> result, Action<Wire.Progress>? progress = null, CancellationToken ct = default) {
    if (address.Length == 0 ||
        token.Length == 0) {
      throw new ConsoleException(ConsoleException.NOT_CONNECTED,
        "This shell was not started by the editor. Open it with 'NuGet: Open Package Manager Console'.");
    }

    try {
      using var stream = Connect(ct);
      Send(stream, method, parameters, parametersInfo);

      using var reader = new StreamReader(stream, Encoding.UTF8, false, leaveOpen: true);
      while (true) {
        // Read on this thread, one line at a time: the progress must be reported from the cmdlet's thread.
        var line = reader.ReadLineAsync(ct).AsTask().GetAwaiter().GetResult() ??
                   throw new ConsoleException(ConsoleException.NOT_CONNECTED, LOST);
        if (line.Length == 0) {
          continue;
        }

        var response = JsonSerializer.Deserialize(line, WireJsonContext.Default.Response)
                       ?? throw new ConsoleException(ConsoleException.NOT_CONNECTED, LOST);
        if (response.Progress is not null) {
          progress?.Invoke(response.Progress);
          continue;
        }

        if (response.Error is not null) {
          throw new ConsoleException(response.Error.Code ?? INTERNAL, response.Error.Message ?? string.Empty);
        }

        if (response.Result is { } answer) {
          return answer.Deserialize(result) ??
                 throw new ConsoleException(INTERNAL, $"The editor answered '{method}' with nothing.");
        }
      }
    }
    catch (Exception exception) when (exception is IOException or SocketException or TimeoutException
                                        or JsonException or UnauthorizedAccessException) {
      throw new ConsoleException(ConsoleException.NOT_CONNECTED, LOST, exception);
    }
  }

  private void Send<TParams>(Stream stream, string method, TParams parameters, JsonTypeInfo<TParams> info) {
    using var buffer = new MemoryStream();
    using (var writer = new Utf8JsonWriter(buffer)) {
      writer.WriteStartObject();
      writer.WriteNumber("id", 1);
      writer.WriteString("token", token);
      writer.WriteString("method", method);
      writer.WritePropertyName("params");
      JsonSerializer.Serialize(writer, parameters, info);
      writer.WriteEndObject();
    }

    buffer.WriteByte((byte)'\n');
    stream.Write(buffer.GetBuffer(), 0, (int)buffer.Length);
    stream.Flush();
  }

  private Stream Connect(CancellationToken ct) {
    if (address.StartsWith(PIPE_PREFIX, StringComparison.Ordinal)) {
      var pipe = new NamedPipeClientStream(".", address[PIPE_PREFIX.Length..], PipeDirection.InOut,
        PipeOptions.Asynchronous);
      try {
        pipe.ConnectAsync(ConnectTimeout, ct).GetAwaiter().GetResult();
        return pipe;
      }
      catch {
        pipe.Dispose();
        throw;
      }
    }

    var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
    try {
      socket.Connect(new UnixDomainSocketEndPoint(address));
      return new NetworkStream(socket, true);
    }
    catch {
      socket.Dispose();
      throw;
    }
  }
}
