// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class LifecycleTests(PublishedBackend backend) {
  [Fact]
  public async Task Initialize_reports_protocol_and_backend_version() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    await using var client = BackendClient.Start(backend, directory.Path);

    var result = await client.InitializeAsync(ct);

    Assert.Equal(1, result.ProtocolVersion);
    Assert.False(string.IsNullOrWhiteSpace(result.BackendVersion));
  }

  [Fact]
  public async Task Shutdown_replies_and_process_exits_with_zero_when_stdin_closes() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    await using var client = BackendClient.Start(backend, directory.Path);
    await client.InitializeAsync(ct);

    await client.Connection.RequestAsync(
      MethodNames.SHUTDOWN,
      new Empty(),
      ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty,
      ct
    );
    var exitCode = await client.CloseAsync();

    Assert.Equal(0, exitCode);
  }

  [Fact]
  public async Task Unknown_method_is_rejected_without_ending_the_process() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    await using var client = BackendClient.Start(backend, directory.Path);

    var exception = await Assert.ThrowsAsync<RpcException>(() => client.Connection.RequestAsync(
      "does/notExist",
      new Empty(),
      ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty,
      ct
    ));
    var result = await client.InitializeAsync(ct);

    Assert.Equal(RpcErrorCodes.METHOD_NOT_FOUND, exception.Code);
    Assert.Equal(1, result.ProtocolVersion);
  }
}
