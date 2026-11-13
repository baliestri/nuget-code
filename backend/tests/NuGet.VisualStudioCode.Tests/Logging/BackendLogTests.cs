// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.Globalization;
using NuGet.Common;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Tests.Logging;

public sealed class BackendLogTests {
  private static (BackendLog Log, ConcurrentQueue<LogEntry> Received) Create() {
    var received = new ConcurrentQueue<LogEntry>();
    var log = new BackendLog(entry =>
    {
      received.Enqueue(entry);
      return Task.CompletedTask;
    });
    return (log, received);
  }

  [Fact]
  public async Task Entries_reach_the_sink_in_write_order() {
    var (log, received) = Create();

    for (var index = 0; index < 200; index++)
      log.Write(LogLevels.DEBUG, "Test", string.Create(CultureInfo.InvariantCulture, $"message {index}"));

    await log.DisposeAsync();

    Assert.Equal(
      Enumerable.Range(0, 200).Select(index => string.Create(CultureInfo.InvariantCulture, $"message {index}")),
      received.Select(entry => entry.Message),
      StringComparer.Ordinal
    );
  }

  [Fact]
  public async Task Messages_are_masked_before_leaving() {
    var (log, received) = Create();

    log.Write(LogLevels.INFO, "Test", "GET https://user:secret@feed.example/index.json");
    await log.DisposeAsync();

    var entry = Assert.Single(received);
    Assert.Equal("GET https://***@feed.example/index.json", entry.Message);
    Assert.Equal(LogLevels.INFO, entry.Level);
    Assert.Equal("Test", entry.Context);
  }

  [Fact]
  public async Task A_failing_sink_does_not_stop_later_entries() {
    var received = new ConcurrentQueue<string>();
    var log = new BackendLog(entry =>
    {
      if (string.Equals(entry.Message, "first", StringComparison.Ordinal)) {
        throw new IOException("pipe closed");
      }

      received.Enqueue(entry.Message);
      return Task.CompletedTask;
    });

    log.Write(LogLevels.INFO, "Test", "first");
    log.Write(LogLevels.INFO, "Test", "second");
    await log.DisposeAsync();

    Assert.Equal(["second"], received, StringComparer.Ordinal);
  }

  [Theory]
  [InlineData(LogLevel.Debug, LogLevels.DEBUG)]
  [InlineData(LogLevel.Verbose, LogLevels.VERBOSE)]
  [InlineData(LogLevel.Information, LogLevels.INFO)]
  [InlineData(LogLevel.Minimal, LogLevels.INFO)]
  [InlineData(LogLevel.Warning, LogLevels.WARNING)]
  [InlineData(LogLevel.Error, LogLevels.ERROR)]
  public async Task NuGet_log_levels_are_mapped(LogLevel level, string expected) {
    var (log, received) = Create();
    var adapter = new NuGetLogAdapter(log);

    await adapter.LogAsync(level, "from nuget");
    await log.DisposeAsync();

    var entry = Assert.Single(received);
    Assert.Equal(expected, entry.Level);
    Assert.Equal("NUGET", entry.Context);
  }
}
