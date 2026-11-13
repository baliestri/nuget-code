// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class LoggingTests(PublishedBackend backend) {
  [Fact]
  public async Task Initialize_emits_a_log_entry_notification() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    await using var client = BackendClient.Start(backend, directory.Path);
    var received = new TaskCompletionSource<LogEntry>(TaskCreationOptions.RunContinuationsAsynchronously);
    client.Connection.OnNotification(
      MethodNames.LOG_ENTRY,
      ProtocolJsonContext.Default.LogEntry,
      entry =>
      {
        received.TrySetResult(entry);
        return Task.CompletedTask;
      }
    );

    await client.InitializeAsync(ct);
    var entry = await received.Task.WaitAsync(TimeSpan.FromSeconds(10), ct);

    Assert.Equal(LogLevels.INFO, entry.Level);
    Assert.Equal("VSCODE", entry.Context);
    Assert.True(entry.Time > DateTimeOffset.UtcNow.AddMinutes(-5));
  }
}
