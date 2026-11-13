// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;
using NuGet.Common;
using NuGet.Configuration;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Configuration;

internal static class FoldersReader {
  public static IReadOnlyList<FolderInfo> Read(SettingsProvider provider, bool hasSolution) {
    var settings = provider.Load();
    var folders = new List<FolderInfo>();
    if (hasSolution) {
      var repository = SettingsUtility.GetRepositoryPath(settings) ?? Path.Combine(provider.Root, "packages");
      folders.Add(new FolderInfo("Local Packages", repository));
    }

    var httpCache = SettingsUtility.GetHttpCacheFolder();
    var cacheRoot = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(httpCache)) ?? httpCache;
    folders.Add(new FolderInfo("Global Packages", SettingsUtility.GetGlobalPackagesFolder(settings)));
    folders.Add(new FolderInfo("Package Cache", Path.Combine(cacheRoot, "Cache")));
    folders.Add(new FolderInfo("HTTP Cache", httpCache));
    folders.Add(new FolderInfo("NuGetHome", NuGetEnvironment.GetFolderPath(NuGetFolderPath.NuGetHome)));
    folders.Add(new FolderInfo("UserSettings", NuGetEnvironment.GetFolderPath(NuGetFolderPath.UserSettingsDirectory)));
    folders.Add(new FolderInfo("MachineSettingsBase",
      NuGetEnvironment.GetFolderPath(NuGetFolderPath.MachineWideSettingsBaseDirectory)));
    folders.Add(new FolderInfo("MachineConfigDir",
      NuGetEnvironment.GetFolderPath(NuGetFolderPath.MachineWideConfigDirectory)));
    folders.Add(new FolderInfo("Temp", NuGetEnvironment.GetFolderPath(NuGetFolderPath.Temp)));
    var fallback = SettingsUtility.GetFallbackPackageFolders(settings);
    for (var index = 0; index < fallback.Count; index++) {
      var title = string.Create(CultureInfo.InvariantCulture, $"Fallback #{index}");
      folders.Add(new FolderInfo(title, fallback[index]));
    }

    return folders;
  }
}
