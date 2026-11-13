// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Projects;

namespace NuGet.VisualStudioCode.Tests.Projects;

public sealed class DebouncerTests {
  private readonly static TimeSpan Timeout = TimeSpan.FromSeconds(5);

  [Fact]
  public async Task A_burst_of_triggers_runs_the_action_once() {
    var ct = TestContext.Current.CancellationToken;
    var runs = 0;
    var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    using var debouncer = new Debouncer(TimeSpan.FromMilliseconds(100), _ =>
    {
      Interlocked.Increment(ref runs);
      done.TrySetResult();
      return Task.CompletedTask;
    });

    for (var index = 0; index < 10; index++) debouncer.Trigger();

    await done.Task.WaitAsync(Timeout, ct);
    await Task.Delay(300, ct);

    Assert.Equal(1, runs);
  }

  [Fact]
  public async Task A_trigger_during_the_action_cancels_it_and_runs_again() {
    var ct = TestContext.Current.CancellationToken;
    var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var completed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var calls = 0;
    using var debouncer = new Debouncer(TimeSpan.FromMilliseconds(20), async token =>
    {
      if (Interlocked.Increment(ref calls) == 1) {
        started.TrySetResult();
        try {
          await Task.Delay(System.Threading.Timeout.Infinite, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) {
          cancelled.TrySetResult();
          throw;
        }
      }

      completed.TrySetResult();
    });

    debouncer.Trigger();
    await started.Task.WaitAsync(Timeout, ct);
    debouncer.Trigger();

    await cancelled.Task.WaitAsync(Timeout, ct);
    await completed.Task.WaitAsync(Timeout, ct);
    Assert.Equal(2, calls);
  }
}
