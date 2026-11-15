// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using NuGet.Configuration;
using NuGet.Protocol;
using NuGet.Protocol.Core.Types;
using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Feeds;

internal sealed class FeedRegistry(SettingsProvider settings) {
  private readonly ConcurrentDictionary<string, SourceRepository> _repositories =
    new(StringComparer.OrdinalIgnoreCase);

  public IReadOnlyList<SourceRepository> Select(string? feedName, string? packageId) {
    var loaded = settings.Load();
    var sources = new PackageSourceProvider(loaded).LoadPackageSources().Where(source => source.IsEnabled).ToList();
    if (feedName is not null) {
      sources = sources.Where(source => string.Equals(source.Name, feedName, StringComparison.OrdinalIgnoreCase))
        .ToList();
      if (sources.Count == 0) {
        throw new RpcException(RpcErrorCodes.INVALID_PARAMS, $"The feed '{feedName}' does not exist or is disabled.");
      }
    }

    if (packageId is not null) {
      var mapping = PackageSourceMapping.GetPackageSourceMapping(loaded);
      if (mapping.IsEnabled) {
        var allowed = mapping.GetConfiguredPackageSources(packageId);
        sources = sources.Where(source => allowed.Contains(source.Name, StringComparer.OrdinalIgnoreCase)).ToList();
      }
    }

    return sources.Select(RepositoryOf).ToList();
  }

  /// <summary>
  ///   The feeds asked about vulnerabilities: the audit sources of the configuration when it has any, as a
  ///   restore does, else the enabled package sources.
  /// </summary>
  public IReadOnlyList<SourceRepository> Audit() {
    var provider = new PackageSourceProvider(settings.Load());
    var audit = provider.LoadAuditSources().Where(source => source.IsEnabled).ToList();
    var sources = audit.Count > 0 ? audit : provider.LoadPackageSources().Where(source => source.IsEnabled).ToList();
    return sources.Select(RepositoryOf).ToList();
  }

  private SourceRepository RepositoryOf(PackageSource source)
    => _repositories.GetOrAdd($"{source.Name}|{source.Source}", _ => Repository.Factory.GetCoreV3(source));

  public void Reset()
    => _repositories.Clear();
}
