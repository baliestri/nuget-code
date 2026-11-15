// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Protocol.Core.Types;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Feeds;

internal sealed class PackageSearchService(FeedRegistry feeds, FeedQuery query, NuGetLogAdapter logger) {
  public async Task<PackagesSearchResult> SearchAsync(PackagesSearchParams parameters, CancellationToken ct) {
    var repositories = feeds.Select(parameters.Feed, null);
    var outcome = await query
      .RunAsync(repositories, (repository, token) => SearchOneAsync(repository, parameters, token), ct)
      .ConfigureAwait(false);
    outcome.ThrowIfRequestedFeedFailed(parameters.Feed);
    return new PackagesSearchResult(Interleave(outcome.Results), outcome.Failures);
  }

  private async Task<List<IPackageSearchMetadata>> SearchOneAsync(SourceRepository repository,
    PackagesSearchParams parameters, CancellationToken ct) {
    var resource = await repository.GetResourceAsync<PackageSearchResource>(ct).ConfigureAwait(false) ??
                   throw new InvalidOperationException("The feed does not support search.");
    var found = await resource
      .SearchAsync(parameters.Query ?? string.Empty, new SearchFilter(parameters.Prerelease),
        parameters.Skip, parameters.Take, logger, ct)
      .ConfigureAwait(false);
    return found.ToList();
  }

  private static List<PackageSummary> Interleave(IReadOnlyList<FeedResult<List<IPackageSearchMetadata>>> results) {
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var packages = new List<PackageSummary>();
    var longest = results.Count == 0 ? 0 : results.Max(result => result.Value.Count);
    for (var index = 0; index < longest; index++)
      foreach (var result in results)
        if (index < result.Value.Count &&
            seen.Add(result.Value[index].Identity.Id)) {
          packages.Add(Summarize(result.Value[index], result.Feed));
        }

    return packages;
  }

  private static PackageSummary Summarize(IPackageSearchMetadata metadata, string feed)
    => new(metadata.Identity.Id, metadata.Identity.Version.ToNormalizedString(), metadata.Description,
      metadata.Authors, metadata.IconUrl?.ToString(), metadata.DownloadCount, feed);
}
