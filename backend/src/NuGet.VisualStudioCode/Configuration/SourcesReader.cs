// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Configuration;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Configuration;

internal static class SourcesReader {
  public static SourcesListResult Read(SettingsProvider provider) {
    var settings = provider.Load();
    var files = settings.GetConfigFilePaths().Select(path => new ConfigFileInfo(path, ReadFile(path))).ToList();
    var effective = new PackageSourceProvider(settings).LoadPackageSources().Select(ToFeed).ToList();
    return new SourcesListResult(files, effective);
  }

  private static List<FeedInfo> ReadFile(string path) {
    var single = Settings.LoadSpecificSettings(Path.GetDirectoryName(path)!, Path.GetFileName(path));
    return PackageSourceProvider.LoadPackageSources(single).Select(ToFeed).ToList();
  }

  private static FeedInfo ToFeed(PackageSource source)
    => new(
      source.Name,
      source.Source,
      source.IsEnabled,
      source.AllowInsecureConnections,
      source.ProtocolVersion,
      source.IsLocal
    );
}
