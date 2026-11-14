// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Common;
using NuGet.Configuration;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Configuration;

/// <summary>
///   Writes package sources and the two folder properties into NuGet configuration files, through
///   NuGet.Configuration. A machine-wide file is never written: the one change allowed on a feed declared there,
///   enabling or disabling it, goes to the user's file, which is how NuGet itself records it.
/// </summary>
internal sealed class SourcesWriter(
  SettingsProvider settings,
  Func<string, bool> isMachineWide,
  string? userConfigFile = null
) {
  private const string DEFAULT_FILE_NAME = "NuGet.config";
  private const string DISABLED_SECTION = "disabledPackageSources";

  private const string EMPTY_CONFIG = """
    <?xml version="1.0" encoding="utf-8"?>
    <configuration>
    </configuration>

    """;

  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  private readonly string _userConfigFile = userConfigFile ??
                                            Path.Combine(
                                              NuGetEnvironment.GetFolderPath(NuGetFolderPath.UserSettingsDirectory),
                                              "NuGet.Config");

  /// <summary>Returns the file that was written, with the feed as it now reads.</summary>
  public (string File, FeedInfo Feed) Add(SourceWriteParams parameters) {
    if (string.IsNullOrWhiteSpace(parameters.Source)) {
      throw new RpcException(RpcErrorCodes.INVALID_PARAMS, "A source needs a URL or a folder.");
    }

    var file = parameters.File ?? DefaultFile();
    RequireWritable(file);
    EnsureExists(file);
    var provider = new PackageSourceProvider(SourcesReader.LoadFile(file));
    if (provider.GetPackageSourceByName(parameters.Name) is not null) {
      throw Duplicate(parameters.Name, file);
    }

    var source = new PackageSource(parameters.Source, parameters.Name, parameters.Enabled ?? true) {
      AllowInsecureConnections = parameters.AllowInsecureConnections ?? false,
      DisableTLSCertificateValidation = parameters.DisableTlsCertificateValidation ?? false
    };
    provider.AddPackageSource(source);
    return (file, Reread(file, parameters.Name));
  }

  public (string File, FeedInfo Feed) Update(SourceWriteParams parameters) {
    var file = Locate(parameters.File, parameters.Name);
    if (!ConfigFileClassifier.IsWritable(file, isMachineWide)) {
      return UpdateFromOutside(file, parameters);
    }

    var provider = new PackageSourceProvider(SourcesReader.LoadFile(file));
    var existing = provider.GetPackageSourceByName(parameters.Name)!;
    var name = parameters.NewName ?? existing.Name;
    var renamed = !string.Equals(name, existing.Name, StringComparison.OrdinalIgnoreCase);
    if (renamed &&
        provider.GetPackageSourceByName(name) is not null) {
      throw Duplicate(name, file);
    }

    var updated =
      new PackageSource(parameters.Source ?? existing.Source, name, parameters.Enabled ?? existing.IsEnabled) {
        AllowInsecureConnections = parameters.AllowInsecureConnections ?? existing.AllowInsecureConnections,
        DisableTLSCertificateValidation =
          parameters.DisableTlsCertificateValidation ?? existing.DisableTLSCertificateValidation,
        ProtocolVersion = existing.ProtocolVersion,
        Credentials = existing.Credentials
      };
    if (renamed) {
      provider.RemovePackageSource(existing.Name);
      provider.AddPackageSource(updated);
    }
    else {
      provider.UpdatePackageSource(updated, false, true);
    }

    return (file, Reread(file, name));
  }

  /// <summary>Returns the file that was written.</summary>
  public string Remove(SourceRemoveParams parameters) {
    var file = Locate(parameters.File, parameters.Name);
    RequireWritable(file);
    new PackageSourceProvider(SourcesReader.LoadFile(file)).RemovePackageSource(parameters.Name);
    return file;
  }

  public void SetProperty(SourceSetPropertyParams parameters) {
    if (parameters.Property is not (SourcesReader.GLOBAL_PACKAGES_FOLDER or SourcesReader.REPOSITORY_PATH)) {
      throw new RpcException(RpcErrorCodes.INVALID_PARAMS, $"Unknown configuration property '{parameters.Property}'.");
    }

    RequireWritable(parameters.File);
    EnsureExists(parameters.File);
    var single = SourcesReader.LoadFile(parameters.File);
    if (string.IsNullOrEmpty(parameters.Value)) {
      var item = single.GetSection(SourcesReader.CONFIG_SECTION)
        ?.GetFirstItemWithAttribute<AddItem>("key", parameters.Property);
      if (item is not null) {
        single.Remove(SourcesReader.CONFIG_SECTION, item);
      }
    }
    else {
      single.AddOrUpdate(SourcesReader.CONFIG_SECTION, new AddItem(parameters.Property, parameters.Value));
    }

    single.SaveToDisk();
  }

  // A feed in a file that cannot be written can still be turned on and off, in the user's file.
  private (string File, FeedInfo Feed) UpdateFromOutside(string file, SourceWriteParams parameters) {
    var onlyEnabled = parameters is {
      Enabled: not null,
      NewName: null,
      Source: null,
      AllowInsecureConnections: null,
      DisableTlsCertificateValidation: null
    };
    if (!onlyEnabled ||
        !isMachineWide(file)) {
      throw NotWritable(file);
    }

    EnsureExists(_userConfigFile);
    var user = SourcesReader.LoadFile(_userConfigFile);
    var disabled = user.GetSection(DISABLED_SECTION)?.GetFirstItemWithAttribute<AddItem>("key", parameters.Name);
    if (parameters.Enabled == true) {
      if (disabled is not null) {
        user.Remove(DISABLED_SECTION, disabled);
      }
    }
    else {
      user.AddOrUpdate(DISABLED_SECTION, new AddItem(parameters.Name, "true"));
    }

    user.SaveToDisk();
    var feed = Reread(file, parameters.Name);
    return (_userConfigFile, feed with { Enabled = parameters.Enabled.GetValueOrDefault() });
  }

  // The file asked for, or the nearest file of the hierarchy that declares the feed.
  private string Locate(string? requested, string name) {
    var candidates = requested is null ? settings.Load().GetConfigFilePaths() : [requested];
    return candidates.FirstOrDefault(path
             => File.Exists(path) && SourcesReader.ReadFeed(path, name, isMachineWide) is not null) ??
           throw new RpcException(RpcErrorCodes.FEED_UNKNOWN, $"No configuration file declares the source '{name}'.");
  }

  // The configuration file of the solution directory, under the name it already has there.
  private string DefaultFile() {
    var root = settings.Root;
    return settings.Load().GetConfigFilePaths()
             .FirstOrDefault(path => PathComparer.Equals(Path.GetDirectoryName(path), root)) ??
           Path.Combine(root, DEFAULT_FILE_NAME);
  }

  private void RequireWritable(string file) {
    if (!ConfigFileClassifier.IsWritable(file, isMachineWide)) {
      throw NotWritable(file);
    }
  }

  private FeedInfo Reread(string file, string name)
    => SourcesReader.ReadFeed(file, name, isMachineWide) ??
       throw new RpcException(RpcErrorCodes.INTERNAL_ERROR, $"The source '{name}' was not written to '{file}'.");

  private static void EnsureExists(string file) {
    if (File.Exists(file)) {
      return;
    }

    Directory.CreateDirectory(Path.GetDirectoryName(file)!);
    File.WriteAllText(file, EMPTY_CONFIG);
  }

  private static RpcException NotWritable(string file)
    => new(RpcErrorCodes.CONFIG_NOT_WRITABLE, $"The configuration file '{file}' cannot be changed.");

  private static RpcException Duplicate(string name, string file)
    => new(RpcErrorCodes.FEED_DUPLICATE, $"'{file}' already declares a source named '{name}'.");
}
