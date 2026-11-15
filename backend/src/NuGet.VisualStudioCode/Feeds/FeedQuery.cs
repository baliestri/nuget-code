// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;
using System.Net;
using NuGet.Protocol.Core.Types;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Feeds;

internal sealed class FeedQuery(FeedOptions options, BackendLog log) {
  public async Task<FeedOutcome<T>> RunAsync<T>(IReadOnlyList<SourceRepository> repositories,
    Func<SourceRepository, CancellationToken, Task<T>> operation, CancellationToken ct) {
    var tasks = new List<Task<(FeedResult<T>? Result, FeedFailure? Failure)>>();
    foreach (var repository in repositories) tasks.Add(RunOneAsync(repository, operation, ct));

    var completed = await Task.WhenAll(tasks).ConfigureAwait(false);
    return new FeedOutcome<T>(
      completed.Where(entry => entry.Result is not null).Select(entry => entry.Result!).ToList(),
      completed.Where(entry => entry.Failure is not null).Select(entry => entry.Failure!).ToList()
    );
  }

  private async Task<(FeedResult<T>? Result, FeedFailure? Failure)> RunOneAsync<T>(SourceRepository repository,
    Func<SourceRepository, CancellationToken, Task<T>> operation, CancellationToken ct) {
    var name = repository.PackageSource.Name;
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(options.Timeout);
    try {
      return (new FeedResult<T>(name, await operation(repository, timeout.Token).ConfigureAwait(false)), null);
    }
    catch (OperationCanceledException) when (!ct.IsCancellationRequested) {
      var seconds = options.Timeout.TotalSeconds.ToString("0", CultureInfo.InvariantCulture);
      return (null, Fail(name, FeedFailureKinds.UNREACHABLE, $"The feed did not answer within {seconds} seconds."));
    }
    catch (Exception exception) when (IsFeedFailure(exception)) {
      var kind = IsAuthentication(exception) ? FeedFailureKinds.AUTHENTICATION : FeedFailureKinds.UNREACHABLE;
      return (null, Fail(name, kind, exception.Message));
    }
  }

  private FeedFailure Fail(string feed, string kind, string message) {
    log.Write(LogLevels.WARNING, LogContexts.BACKEND, $"Feed '{feed}' failed ({kind}): {message}");
    return new FeedFailure(feed, kind, message);
  }

  private static bool IsFeedFailure(Exception exception)
    => exception is NuGetProtocolException or HttpRequestException or IOException or InvalidOperationException;

  private static bool IsAuthentication(Exception exception) {
    for (var current = exception; current is not null; current = current.InnerException) {
      if (current is HttpRequestException { StatusCode: HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden }) {
        return true;
      }

      if (current.Message.Contains("401", StringComparison.Ordinal) ||
          current.Message.Contains("403", StringComparison.Ordinal)) {
        return true;
      }
    }

    return false;
  }
}
