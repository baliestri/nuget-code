// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using NuGet.Protocol.Core.Types;
using NuGet.Versioning;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Feeds;

internal sealed class PackageUpdatesService(
  FeedRegistry feeds,
  FeedQuery query,
  NuGetLogAdapter logger,
  TimedCache<IReadOnlyList<NuGetVersion>> cache
) {
  private const int MAX_PARALLEL = 8;

  public async Task<PackagesUpdatesResult> GetAsync(IReadOnlyCollection<string> packageIds,
    PackagesUpdatesParams parameters, Func<PackageLatest, Task> report, CancellationToken ct) {
    var failed = new ConcurrentDictionary<string, FeedFailure>(StringComparer.OrdinalIgnoreCase);
    using var gate = new SemaphoreSlim(MAX_PARALLEL);
    var tasks = new List<Task<PackageLatest>>();
    foreach (var id in packageIds)
      tasks.Add(LatestGatedAsync(gate, id, parameters, failed, report, ct));

    var packages = await Task.WhenAll(tasks).ConfigureAwait(false);
    return new PackagesUpdatesResult(packages.OrderBy(package => package.Id, StringComparer.OrdinalIgnoreCase).ToList(),
      failed.Values.OrderBy(failure => failure.Feed, StringComparer.OrdinalIgnoreCase).ToList());
  }

  private async Task<PackageLatest> LatestGatedAsync(SemaphoreSlim gate, string id, PackagesUpdatesParams parameters,
    ConcurrentDictionary<string, FeedFailure> failed, Func<PackageLatest, Task> report, CancellationToken ct) {
    await gate.WaitAsync(ct).ConfigureAwait(false);
    try {
      var latest = await LatestAsync(id, parameters, failed, ct).ConfigureAwait(false);
      await report(latest).ConfigureAwait(false);
      return latest;
    }
    finally {
      gate.Release();
    }
  }

  private async Task<PackageLatest> LatestAsync(string id, PackagesUpdatesParams parameters,
    ConcurrentDictionary<string, FeedFailure> failed, CancellationToken ct) {
    var repositories = feeds.Select(null, id)
      .Where(repository => !failed.ContainsKey(repository.PackageSource.Name))
      .ToList();
    var outcome = await query
      .RunAsync(repositories, (repository, token) => VersionsAsync(repository, id, parameters.NoCache, token), ct)
      .ConfigureAwait(false);

    foreach (var failure in outcome.Failures)
      failed.TryAdd(failure.Feed, failure);

    var versions = new List<FeedVersion>();
    foreach (var result in outcome.Results) {
      var latest = result.Value.Where(version => parameters.Prerelease || !version.IsPrerelease).Max();
      if (latest is not null) {
        versions.Add(new FeedVersion(result.Feed, latest.ToNormalizedString()));
      }
    }

    return new PackageLatest(id, versions);
  }

  private Task<IReadOnlyList<NuGetVersion>> VersionsAsync(SourceRepository repository, string id, bool noCache,
    CancellationToken ct)
    => cache.GetAsync($"{repository.PackageSource.Name}|{id}", noCache,
      () => LoadVersionsAsync(repository, id, noCache, ct));

  private async Task<IReadOnlyList<NuGetVersion>> LoadVersionsAsync(SourceRepository repository, string id,
    bool noCache, CancellationToken ct) {
    var resource = await repository.GetResourceAsync<FindPackageByIdResource>(ct).ConfigureAwait(false) ??
                   throw new InvalidOperationException("The feed does not list package versions.");
    using var context = new SourceCacheContext();
    context.NoCache = noCache;
    context.RefreshMemoryCache = noCache;
    var versions = await resource.GetAllVersionsAsync(id, context, logger, ct).ConfigureAwait(false);
    return versions.ToList();
  }
}
