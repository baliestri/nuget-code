// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Packaging.Core;
using NuGet.Protocol.Core.Types;
using NuGet.Versioning;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Feeds;

internal sealed class PackageDetailsService(
  FeedRegistry feeds,
  FeedQuery query,
  NuGetLogAdapter logger,
  TimedCache<PackageDetailsResult> cache,
  VulnerabilityService vulnerabilities
) {
  public Task<PackageDetailsResult> GetAsync(PackagesDetailsParams parameters, CancellationToken ct)
    => cache.GetAsync($"{parameters.Feed}|{parameters.Id}|{parameters.Prerelease}", parameters.NoCache,
      () => LoadAsync(parameters, ct));

  // The frameworks one exact version declares dependency groups for, or null when no feed can tell.
  public async Task<IReadOnlyList<string>?> FrameworksAsync(string id, string version, CancellationToken ct) {
    if (!NuGetVersion.TryParse(version, out var parsed)) {
      return null;
    }

    var identity = new PackageIdentity(id, parsed);
    var outcome = await query
      .RunAsync(feeds.Select(null, id), (repository, token) => FrameworksOfAsync(repository, identity, token), ct)
      .ConfigureAwait(false);
    return outcome.Results.Select(result => result.Value).FirstOrDefault(frameworks => frameworks is not null);
  }

  private async Task<IReadOnlyList<string>?> FrameworksOfAsync(SourceRepository repository, PackageIdentity identity,
    CancellationToken ct) {
    var resource = await repository.GetResourceAsync<PackageMetadataResource>(ct).ConfigureAwait(false) ??
                   throw new InvalidOperationException("The feed does not expose package metadata.");
    using var context = new SourceCacheContext();
    var metadata = await resource.GetMetadataAsync(identity, context, logger, ct).ConfigureAwait(false);
    return metadata?.DependencySets.Select(group => group.TargetFramework.GetShortFolderName()).ToList();
  }

  private async Task<PackageDetailsResult> LoadAsync(PackagesDetailsParams parameters, CancellationToken ct) {
    var repositories = feeds.Select(parameters.Feed, parameters.Id);
    var outcome = await query
      .RunAsync(repositories, (repository, token) => LoadOneAsync(repository, parameters, token), ct)
      .ConfigureAwait(false);
    outcome.ThrowIfRequestedFeedFailed(parameters.Feed);

    var hit = outcome.Results.FirstOrDefault(result => result.Value.Count > 0);
    if (hit is null) {
      return new PackageDetailsResult(parameters.Id, [], null, null, null, null, null, null, [], null,
        outcome.Failures, []);
    }

    var latest = hit.Value.MaxBy(metadata => metadata.Identity.Version)!;
    var versions = outcome.Results
      .SelectMany(result => result.Value)
      .Select(metadata => metadata.Identity.Version)
      .Distinct()
      .OrderDescending()
      .ToList();
    var vulnerable = await vulnerabilities.VersionsAsync(latest.Identity.Id, versions, ct).ConfigureAwait(false);

    return new PackageDetailsResult(latest.Identity.Id,
      versions.Select(version => version.ToNormalizedString()).ToList(),
      latest.Description, latest.Authors, latest.LicenseMetadata?.License, latest.LicenseUrl?.ToString(),
      latest.ProjectUrl?.ToString(), latest.IconUrl?.ToString(), Groups(latest), hit.Feed, outcome.Failures,
      vulnerable);
  }

  private async Task<List<IPackageSearchMetadata>> LoadOneAsync(SourceRepository repository,
    PackagesDetailsParams parameters, CancellationToken ct) {
    var resource = await repository.GetResourceAsync<PackageMetadataResource>(ct).ConfigureAwait(false) ??
                   throw new InvalidOperationException("The feed does not expose package metadata.");
    using var context = new SourceCacheContext();
    context.NoCache = parameters.NoCache;
    context.RefreshMemoryCache = parameters.NoCache;
    var found = await resource
      .GetMetadataAsync(parameters.Id, parameters.Prerelease, false, context, logger, ct)
      .ConfigureAwait(false);
    return found.ToList();
  }

  private static List<DependencyGroupInfo> Groups(IPackageSearchMetadata metadata)
    => metadata.DependencySets
      .Select(group => new DependencyGroupInfo(group.TargetFramework.GetShortFolderName(), group.Packages
        .Select(dependency => new DependencyInfo(dependency.Id, dependency.VersionRange.ToNormalizedString()))
        .ToList()))
      .ToList();
}
