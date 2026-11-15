// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Configuration;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Configuration;

internal static class SourcesReader {
  public const string CONFIG_SECTION = "config";
  public const string GLOBAL_PACKAGES_FOLDER = "globalPackagesFolder";
  public const string REPOSITORY_PATH = "repositoryPath";

  private const string KEY = "key";

  public static SourcesListResult Read(SettingsProvider provider)
    => Read(provider, ConfigFileClassifier.IsMachineWide);

  public static SourcesListResult Read(SettingsProvider provider, Func<string, bool> isMachineWide) {
    var settings = provider.Load();
    var files = settings.GetConfigFilePaths().Select(path => ReadFile(path, isMachineWide)).ToList();
    var effective = new PackageSourceProvider(settings).LoadPackageSources()
      .Select(source => ToFeed(source, DeclaringFile(files, source.Name), isMachineWide))
      .ToList();
    return new SourcesListResult(files, effective, [.. SettingsUtility.GetFallbackPackageFolders(settings)],
      SettingsUtility.GetGlobalPackagesFolder(settings), SettingsUtility.GetRepositoryPath(settings));
  }

  public static ISettings LoadFile(string path)
    => Settings.LoadSpecificSettings(Path.GetDirectoryName(path)!, Path.GetFileName(path));

  public static FeedInfo? ReadFeed(string path, string name, Func<string, bool> isMachineWide)
    => ReadFile(path, isMachineWide).Feeds
      .FirstOrDefault(feed => string.Equals(feed.Name, name, StringComparison.OrdinalIgnoreCase));

  private static ConfigFileInfo ReadFile(string path, Func<string, bool> isMachineWide) {
    var single = LoadFile(path);
    var feeds = PackageSourceProvider.LoadPackageSources(single)
      .Select(source => ToFeed(source, path, isMachineWide))
      .ToList();
    return new ConfigFileInfo(path, feeds, ConfigFileClassifier.IsWritable(path, isMachineWide), isMachineWide(path),
      Declared(single, GLOBAL_PACKAGES_FOLDER), Declared(single, REPOSITORY_PATH));
  }

  // The nearest file that declares the feed; the list goes from the nearest file to the farthest.
  private static string? DeclaringFile(List<ConfigFileInfo> files, string name)
    => files.FirstOrDefault(file
      => file.Feeds.Any(feed => string.Equals(feed.Name, name, StringComparison.OrdinalIgnoreCase)))?.Path;

  private static string? Declared(ISettings single, string key)
    => single.GetSection(CONFIG_SECTION)?.GetFirstItemWithAttribute<AddItem>(KEY, key)?.Value;

  private static FeedInfo ToFeed(PackageSource source, string? declaredIn, Func<string, bool> isMachineWide)
    => new(source.Name, source.Source, source.IsEnabled, source.AllowInsecureConnections, source.ProtocolVersion,
      source.IsLocal, source.DisableTLSCertificateValidation, declaredIn is not null && isMachineWide(declaredIn),
      declaredIn);
}
