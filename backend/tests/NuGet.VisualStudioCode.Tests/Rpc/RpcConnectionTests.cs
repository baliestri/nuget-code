// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Tests.Rpc;

public sealed class RpcConnectionTests {
  private static void RegisterEcho(RpcConnection connection)
    => connection.OnRequest("echo", TestJsonContext.Default.EchoParams, TestJsonContext.Default.EchoResult,
      (parameters, _) => Task.FromResult(new EchoResult(parameters.Text ?? "<none>")));

  [Fact]
  public async Task Request_returns_the_handler_result_with_the_same_id() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(RegisterEcho);

    await peer.SendAsync("""{"jsonrpc":"2.0","id":7,"method":"echo","params":{"text":"hi"}}""", ct);
    var response = await peer.ReceiveAsync(ct);

    Assert.Equal("2.0", response.GetProperty("jsonrpc").GetString());
    Assert.Equal(7, response.GetProperty("id").GetInt32());
    Assert.Equal("hi", response.GetProperty("result").GetProperty("text").GetString());
  }

  [Fact]
  public async Task Request_accepts_string_ids_and_missing_params() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(RegisterEcho);

    await peer.SendAsync("""{"jsonrpc":"2.0","id":"abc","method":"echo"}""", ct);
    var response = await peer.ReceiveAsync(ct);

    Assert.Equal("abc", response.GetProperty("id").GetString());
    Assert.Equal("<none>", response.GetProperty("result").GetProperty("text").GetString());
  }

  [Fact]
  public async Task Unknown_method_returns_method_not_found() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(_ => { });

    await peer.SendAsync("""{"jsonrpc":"2.0","id":1,"method":"nope"}""", ct);
    var response = await peer.ReceiveAsync(ct);

    Assert.Equal(RpcErrorCodes.METHOD_NOT_FOUND, response.GetProperty("error").GetProperty("code").GetInt32());
  }

  [Fact]
  public async Task Handler_RpcException_becomes_an_error_with_code_message_and_data() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(connection =>
      connection.OnRequest<EchoParams, EchoResult>(
        "boom",
        TestJsonContext.Default.EchoParams,
        TestJsonContext.Default.EchoResult,
        (_, _) => throw new RpcException(RpcErrorCodes.SDK_NOT_FOUND, "no sdk", "details")
      )
    );

    await peer.SendAsync("""{"jsonrpc":"2.0","id":1,"method":"boom"}""", ct);
    var error = (await peer.ReceiveAsync(ct)).GetProperty("error");

    Assert.Equal(RpcErrorCodes.SDK_NOT_FOUND, error.GetProperty("code").GetInt32());
    Assert.Equal("no sdk", error.GetProperty("message").GetString());
    Assert.Equal("details", error.GetProperty("data").GetString());
  }

  [Fact]
  public async Task Handler_unexpected_exception_becomes_internal_error_and_connection_survives() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(connection =>
    {
      RegisterEcho(connection);
      connection.OnRequest<EchoParams, EchoResult>("boom", TestJsonContext.Default.EchoParams,
        TestJsonContext.Default.EchoResult, (_, _) => throw new InvalidOperationException("bad"));
    });

    await peer.SendAsync("""{"jsonrpc":"2.0","id":1,"method":"boom"}""", ct);
    var first = await peer.ReceiveAsync(ct);
    await peer.SendAsync("""{"jsonrpc":"2.0","id":2,"method":"echo","params":{"text":"ok"}}""", ct);
    var second = await peer.ReceiveAsync(ct);

    Assert.Equal(RpcErrorCodes.INTERNAL_ERROR, first.GetProperty("error").GetProperty("code").GetInt32());
    Assert.Equal("ok", second.GetProperty("result").GetProperty("text").GetString());
  }

  [Fact]
  public async Task Malformed_json_returns_parse_error_with_null_id() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(_ => { });

    await peer.SendAsync("{not json", ct);
    var response = await peer.ReceiveAsync(ct);

    Assert.Equal(JsonValueKind.Null, response.GetProperty("id").ValueKind);
    Assert.Equal(RpcErrorCodes.PARSE_ERROR, response.GetProperty("error").GetProperty("code").GetInt32());
  }

  [Fact]
  public async Task Invalid_params_returns_invalid_params() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(RegisterEcho);

    await peer.SendAsync("""{"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":5}}""", ct);
    var response = await peer.ReceiveAsync(ct);

    Assert.Equal(RpcErrorCodes.INVALID_PARAMS, response.GetProperty("error").GetProperty("code").GetInt32());
  }

  [Fact]
  public async Task CancelRequest_cancels_the_running_handler() {
    var ct = TestContext.Current.CancellationToken;
    var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    await using var peer = new RpcTestPeer(connection =>
      connection.OnRequest<EchoParams, EchoResult>("wait", TestJsonContext.Default.EchoParams,
        TestJsonContext.Default.EchoResult, async (_, token) =>
        {
          started.SetResult();
          await Task.Delay(Timeout.Infinite, token).ConfigureAwait(false);
          return new EchoResult("never");
        }));

    await peer.SendAsync("""{"jsonrpc":"2.0","id":9,"method":"wait"}""", ct);
    await started.Task.WaitAsync(ct);
    await peer.SendAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":9}}""", ct);
    var response = await peer.ReceiveAsync(ct);

    Assert.Equal(9, response.GetProperty("id").GetInt32());
    Assert.Equal(RpcErrorCodes.REQUEST_CANCELLED, response.GetProperty("error").GetProperty("code").GetInt32());
  }

  [Fact]
  public async Task Notification_invokes_the_handler_and_sends_no_response() {
    var ct = TestContext.Current.CancellationToken;
    var received = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
    await using var peer = new RpcTestPeer(connection =>
    {
      RegisterEcho(connection);
      connection.OnNotification("note", TestJsonContext.Default.EchoParams, parameters =>
      {
        received.SetResult(parameters.Text);
        return Task.CompletedTask;
      });
    });

    await peer.SendAsync("""{"jsonrpc":"2.0","method":"note","params":{"text":"n"}}""", ct);
    Assert.Equal("n", await received.Task.WaitAsync(ct));

    await peer.SendAsync("""{"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":"after"}}""", ct);
    var next = await peer.ReceiveAsync(ct);
    Assert.Equal(1, next.GetProperty("id").GetInt32());
  }

  [Fact]
  public async Task NotifyAsync_sends_a_notification_without_id() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(_ => { });

    await peer.Server.NotifyAsync("log/entry", new EchoParams("x"), TestJsonContext.Default.EchoParams);
    var message = await peer.ReceiveAsync(ct);

    Assert.Equal("log/entry", message.GetProperty("method").GetString());
    Assert.False(message.TryGetProperty("id", out var _));
    Assert.Equal("x", message.GetProperty("params").GetProperty("text").GetString());
  }

  [Fact]
  public async Task RequestAsync_completes_with_the_peer_result() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(_ => { });

    var pending = peer.Server.RequestAsync("ask", new EchoParams("q"),
      TestJsonContext.Default.EchoParams, TestJsonContext.Default.EchoResult, ct);
    var request = await peer.ReceiveAsync(ct);
    var id = request.GetProperty("id").GetInt64();
    await peer.SendAsync($$$"""{"jsonrpc":"2.0","id":{{{id}}},"result":{"text":"a"}}""", ct);

    Assert.Equal("ask", request.GetProperty("method").GetString());
    Assert.Equal("a", (await pending).Text);
  }

  [Fact]
  public async Task RequestAsync_fails_with_RpcException_when_the_peer_returns_an_error() {
    var ct = TestContext.Current.CancellationToken;
    await using var peer = new RpcTestPeer(_ => { });

    var pending = peer.Server.RequestAsync("ask", new EchoParams("q"),
      TestJsonContext.Default.EchoParams, TestJsonContext.Default.EchoResult, ct);
    var id = (await peer.ReceiveAsync(ct)).GetProperty("id").GetInt64();
    await peer.SendAsync($$$"""{"jsonrpc":"2.0","id":{{{id}}},"error":{"code":-5,"message":"denied"}}""", ct);

    var exception = await Assert.ThrowsAsync<RpcException>(() => pending);
    Assert.Equal(-5, exception.Code);
    Assert.Equal("denied", exception.Message);
  }
}
