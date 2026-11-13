// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace NuGet.VisualStudioCode.Rpc;

internal sealed class RpcConnection(MessageReader reader, MessageWriter writer) {
  private const string CANCEL_METHOD = "$/cancelRequest";

  private readonly static JsonElement EmptyObject = JsonDocument.Parse("{}").RootElement.Clone();

  private readonly ConcurrentDictionary<string, CancellationTokenSource> _inbound = new(StringComparer.Ordinal);

  private readonly ConcurrentDictionary<string, Func<JsonElement, Task>> _notificationHandlers =
    new(StringComparer.Ordinal);

  private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonElement>> _outbound = new();

  private readonly ConcurrentDictionary<string, Func<JsonElement, CancellationToken, Task<Action<Utf8JsonWriter>>>>
    _requestHandlers = new(StringComparer.Ordinal);

  private long _nextId;

  public void OnRequest<TParams, TResult>(
    string method,
    JsonTypeInfo<TParams> paramsInfo,
    JsonTypeInfo<TResult> resultInfo,
    Func<TParams, CancellationToken, Task<TResult>> handler
  )
    => _requestHandlers[method] = async (element, cancellationToken) =>
    {
      var parameters = ReadParams(element, paramsInfo);
      var result = await handler(parameters, cancellationToken).ConfigureAwait(false);
      return json => JsonSerializer.Serialize(json, result, resultInfo);
    };

  public void OnNotification<TParams>(string method, JsonTypeInfo<TParams> paramsInfo, Func<TParams, Task> handler)
    => _notificationHandlers[method] = element => handler(ReadParams(element, paramsInfo));

  public Task NotifyAsync<TParams>(string method, TParams parameters, JsonTypeInfo<TParams> paramsInfo)
    => SendAsync(json =>
    {
      json.WriteString("method", method);
      json.WritePropertyName("params");
      JsonSerializer.Serialize(json, parameters, paramsInfo);
    });

  public async Task<TResult> RequestAsync<TParams, TResult>(
    string method,
    TParams parameters,
    JsonTypeInfo<TParams> paramsInfo,
    JsonTypeInfo<TResult> resultInfo,
    CancellationToken cancellationToken
  ) {
    var id = Interlocked.Increment(ref _nextId);
    var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
    _outbound[id] = completion;
    try {
      await SendAsync(json =>
      {
        json.WriteNumber("id", id);
        json.WriteString("method", method);
        json.WritePropertyName("params");
        JsonSerializer.Serialize(json, parameters, paramsInfo);
      }).ConfigureAwait(false);
      var result = await completion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
      return result.Deserialize(resultInfo)
             ?? throw new RpcException(RpcErrorCodes.INTERNAL_ERROR, $"Peer returned no result for '{method}'.");
    }
    finally {
      _outbound.TryRemove(id, out var _);
    }
  }

  public async Task RunAsync(CancellationToken cancellationToken) {
    while (!cancellationToken.IsCancellationRequested) {
      var payload = await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
      if (payload is null) {
        return;
      }

      Dispatch(payload, cancellationToken);
    }
  }

  private static TParams ReadParams<TParams>(JsonElement element, JsonTypeInfo<TParams> paramsInfo) {
    var source = element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? EmptyObject : element;
    try {
      return source.Deserialize(paramsInfo)
             ?? throw new RpcException(RpcErrorCodes.INVALID_PARAMS, "Params must be an object.");
    }
    catch (JsonException exception) {
      throw new RpcException(RpcErrorCodes.INVALID_PARAMS, exception.Message);
    }
  }

  private void Dispatch(byte[] payload, CancellationToken cancellationToken) {
    JsonElement root;
    try {
      using var document = JsonDocument.Parse(payload);
      root = document.RootElement.Clone();
    }
    catch (JsonException exception) {
      _ = SendErrorAsync(null, RpcErrorCodes.PARSE_ERROR, exception.Message, null);
      return;
    }

    if (root.ValueKind != JsonValueKind.Object) {
      _ = SendErrorAsync(null, RpcErrorCodes.INVALID_REQUEST, "Message must be a JSON object.", null);
      return;
    }

    var hasId = root.TryGetProperty("id", out var id) && id.ValueKind != JsonValueKind.Null;
    if (root.TryGetProperty("method", out var method) &&
        method.ValueKind == JsonValueKind.String) {
      root.TryGetProperty("params", out var parameters);
      _ = hasId
        ? HandleRequestAsync(id, method.GetString()!, parameters, cancellationToken)
        : HandleNotificationAsync(method.GetString()!, parameters);
      return;
    }

    if (hasId) {
      CompleteOutbound(id, root);
      return;
    }

    _ = SendErrorAsync(null, RpcErrorCodes.INVALID_REQUEST, "Message is neither a request nor a response.", null);
  }

  [SuppressMessage(
    "Design",
    "CA1031:Do not catch general exception types",
    Justification = "Protocol boundary: no handler failure may end the process; it becomes an error response."
  )]
  private async Task HandleRequestAsync(
    JsonElement id,
    string method,
    JsonElement parameters,
    CancellationToken cancellationToken
  ) {
    var key = id.GetRawText();
    using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    _inbound[key] = cancellation;
    try {
      if (!_requestHandlers.TryGetValue(method, out var handler)) {
        throw new RpcException(RpcErrorCodes.METHOD_NOT_FOUND, $"Unknown method '{method}'.");
      }

      var writeResult = await handler(parameters, cancellation.Token).ConfigureAwait(false);
      await SendAsync(json =>
      {
        json.WritePropertyName("id");
        id.WriteTo(json);
        json.WritePropertyName("result");
        writeResult(json);
      }).ConfigureAwait(false);
    }
    catch (OperationCanceledException) {
      await SendErrorAsync(id, RpcErrorCodes.REQUEST_CANCELLED, "Request cancelled.", null).ConfigureAwait(false);
    }
    catch (RpcException exception) {
      await SendErrorAsync(id, exception.Code, exception.Message, exception.ErrorData).ConfigureAwait(false);
    }
    catch (Exception exception) {
      await SendErrorAsync(id, RpcErrorCodes.INTERNAL_ERROR, exception.Message, exception.ToString())
        .ConfigureAwait(false);
    }
    finally {
      _inbound.TryRemove(key, out var _);
    }
  }

  private async Task HandleNotificationAsync(string method, JsonElement parameters) {
    try {
      if (string.Equals(method, CANCEL_METHOD, StringComparison.Ordinal)) {
        if (parameters.ValueKind == JsonValueKind.Object &&
            parameters.TryGetProperty("id", out var id) &&
            _inbound.TryGetValue(id.GetRawText(), out var cancellation)) {
          await cancellation.CancelAsync().ConfigureAwait(false);
        }

        return;
      }

      if (_notificationHandlers.TryGetValue(method, out var handler)) {
        await handler(parameters).ConfigureAwait(false);
      }
    }
    catch (ObjectDisposedException) {
      // The request finished between the lookup and the cancellation.
    }
    catch (RpcException) {
      // Notifications have no response; invalid params are dropped.
    }
  }

  private void CompleteOutbound(JsonElement id, JsonElement root) {
    if (!id.TryGetInt64(out var key) ||
        !_outbound.TryGetValue(key, out var completion)) {
      return;
    }

    if (root.TryGetProperty("error", out var error) &&
        error.ValueKind == JsonValueKind.Object) {
      var code = error.TryGetProperty("code", out var codeElement) && codeElement.TryGetInt32(out var parsed)
        ? parsed
        : RpcErrorCodes.INTERNAL_ERROR;
      var message = error.TryGetProperty("message", out var messageElement) ? messageElement.GetString() : null;
      completion.TrySetException(new RpcException(code, message ?? "Peer returned an error."));
      return;
    }

    completion.TrySetResult(root.TryGetProperty("result", out var result) ? result : EmptyObject);
  }

  private Task SendErrorAsync(JsonElement? id, int code, string message, string? data)
    => SendAsync(json =>
    {
      json.WritePropertyName("id");
      if (id is { } value) {
        value.WriteTo(json);
      }
      else {
        json.WriteNullValue();
      }

      json.WriteStartObject("error");
      json.WriteNumber("code", code);
      json.WriteString("message", message);
      if (data is not null) {
        json.WriteString("data", data);
      }

      json.WriteEndObject();
    });

  private async Task SendAsync(Action<Utf8JsonWriter> writeBody) {
    var buffer = new ArrayBufferWriter<byte>();
    var json = new Utf8JsonWriter(buffer);
    await using (json.ConfigureAwait(false)) {
      json.WriteStartObject();
      json.WriteString("jsonrpc", "2.0");
      writeBody(json);
      json.WriteEndObject();
    }

    await writer.WriteAsync(buffer.WrittenMemory, CancellationToken.None).ConfigureAwait(false);
  }
}
