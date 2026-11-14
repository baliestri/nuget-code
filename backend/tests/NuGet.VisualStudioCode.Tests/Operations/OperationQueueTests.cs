// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using NuGet.VisualStudioCode.Operations;

namespace NuGet.VisualStudioCode.Tests.Operations;

public sealed class OperationQueueTests {
  private readonly static TimeSpan Timeout = TimeSpan.FromSeconds(5);

  private static async Task<int> BlockAsync(TaskCompletionSource started, CancellationToken token) {
    started.TrySetResult();
    await Task.Delay(System.Threading.Timeout.Infinite, token).ConfigureAwait(false);
    return 0;
  }

  [Fact]
  public async Task Work_runs_one_at_a_time_in_arrival_order() {
    var ct = TestContext.Current.CancellationToken;
    using var queue = new OperationQueue();
    var running = 0;
    var overlap = false;
    var order = new ConcurrentQueue<int>();
    var tasks = new List<Task<int>>();
    for (var index = 0; index < 20; index++) {
      var number = index;
      tasks.Add(queue.RunAsync(async token =>
      {
        overlap |= Interlocked.Increment(ref running) > 1;
        order.Enqueue(number);
        await Task.Delay(2, token).ConfigureAwait(false);
        Interlocked.Decrement(ref running);
        return number;
      }, ct));
    }

    await Task.WhenAll(tasks);

    Assert.False(overlap);
    Assert.Equal(Enumerable.Range(0, 20), order);
  }

  [Fact]
  public async Task CancelCurrent_cancels_the_running_work_and_the_next_one_runs() {
    var ct = TestContext.Current.CancellationToken;
    using var queue = new OperationQueue();
    var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var first = queue.RunAsync(token => BlockAsync(started, token), ct);
    var second = queue.RunAsync(_ => Task.FromResult(2), ct);

    await started.Task.WaitAsync(Timeout, ct);
    queue.CancelCurrent();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
    Assert.Equal(2, await second.WaitAsync(Timeout, ct));
  }

  [Fact]
  public async Task CancelAll_cancels_running_and_queued_work_and_later_work_still_runs() {
    var ct = TestContext.Current.CancellationToken;
    using var queue = new OperationQueue();
    var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var first = queue.RunAsync(token => BlockAsync(started, token), ct);
    var queued = queue.RunAsync(_ => Task.FromResult(2), ct);

    await started.Task.WaitAsync(Timeout, ct);
    queue.CancelAll();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queued);
    Assert.Equal(3, await queue.RunAsync(_ => Task.FromResult(3), ct).WaitAsync(Timeout, ct));
  }

  [Fact]
  public async Task Failing_work_does_not_block_the_queue() {
    var ct = TestContext.Current.CancellationToken;
    using var queue = new OperationQueue();

    await Assert.ThrowsAsync<InvalidOperationException>(()
      => queue.RunAsync<int>(_ => throw new InvalidOperationException("boom"), ct));

    Assert.Equal(1, await queue.RunAsync(_ => Task.FromResult(1), ct).WaitAsync(Timeout, ct));
  }

  [Fact]
  public async Task Caller_token_cancels_only_its_own_work() {
    var ct = TestContext.Current.CancellationToken;
    using var queue = new OperationQueue();
    using var own = CancellationTokenSource.CreateLinkedTokenSource(ct);
    var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var first = queue.RunAsync(token => BlockAsync(started, token), own.Token);
    var second = queue.RunAsync(_ => Task.FromResult(2), ct);

    await started.Task.WaitAsync(Timeout, ct);
    await own.CancelAsync();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
    Assert.Equal(2, await second.WaitAsync(Timeout, ct));
  }
}
