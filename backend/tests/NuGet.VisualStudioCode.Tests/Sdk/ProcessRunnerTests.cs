// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics;
using NuGet.VisualStudioCode.Sdk;

namespace NuGet.VisualStudioCode.Tests.Sdk;

public sealed class ProcessRunnerTests {
  [Fact]
  public async Task RunAsync_captures_exit_code_and_output() {
    var ct = TestContext.Current.CancellationToken;

    var result = await ProcessRunner.RunAsync("dotnet", ["--version"], Environment.CurrentDirectory, null, ct);

    Assert.Equal(0, result.ExitCode);
    Assert.Matches(@"^\d+\.\d+\.\d+", result.StandardOutput.Trim());
  }

  [Fact]
  public async Task RunAsync_reports_a_non_zero_exit_code_without_throwing() {
    var ct = TestContext.Current.CancellationToken;

    var result = await ProcessRunner.RunAsync("dotnet", ["this-command-does-not-exist"],
      Environment.CurrentDirectory, null, ct);

    Assert.NotEqual(0, result.ExitCode);
  }

  [Fact]
  public async Task RunAsync_kills_the_process_when_cancelled() {
    using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
    var fileName = OperatingSystem.IsWindows() ? "ping" : "sleep";
    string[] arguments = OperatingSystem.IsWindows() ? ["-n", "60", "127.0.0.1"] : ["60"];
    var stopwatch = Stopwatch.StartNew();

    var running = ProcessRunner.RunAsync(fileName, arguments, Environment.CurrentDirectory, null, cancellation.Token);
    cancellation.CancelAfter(TimeSpan.FromMilliseconds(300));

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running);
    Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(20), "The process was not killed on cancellation.");
  }
}
