// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Common;
using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Configuration;

public sealed class SourcesWriterTests {
  private const string CONFIG = """
    <?xml version="1.0" encoding="utf-8"?>
    <configuration>
      <packageSources>
        <clear />
        <add key="local" value="feed" />
      </packageSources>
    </configuration>
    """;

  private const string FILE_NAME = "NuGet.config";
  private const string PRIVATE = "private";
  private const string URL = "https://private.example/v3/index.json";

  private static SourcesWriter Writer(TempDirectory directory, Func<string, bool>? isMachineWide = null,
    string? userConfig = null)
    => new(new SettingsProvider(() => directory.Path), isMachineWide ?? (_ => false), userConfig);

  private static SourceWriteParams Write(string name, string? source = null, string? file = null,
    string? newName = null, bool? enabled = null, bool? insecure = null, bool? noTls = null)
    => new(file, name, newName, source, enabled, insecure, noTls);

  private static IReadOnlyList<FeedInfo> FeedsOf(TempDirectory directory)
    => SourcesReader.Read(new SettingsProvider(() => directory.Path), _ => false).Files[0].Feeds;

  private static int CodeOf(Action action)
    => Assert.Throws<RpcException>(action).Code;

  [Fact]
  public void Add_creates_the_file_in_the_solution_directory() {
    using var directory = new TempDirectory();

    var (file, feed) = Writer(directory).Add(Write(PRIVATE, URL));

    Assert.Equal(directory.Combine(FILE_NAME), file);
    Assert.True(File.Exists(file));
    Assert.Equal(new FeedInfo(PRIVATE, URL, true, false, 2, false, false, false, file), feed);
    Assert.Contains(FeedsOf(directory), item => string.Equals(item.Name, PRIVATE, StringComparison.Ordinal));
  }

  [Fact]
  public void Add_to_an_existing_file_keeps_the_other_feeds() {
    using var directory = new TempDirectory();
    directory.WriteFile(FILE_NAME, CONFIG);

    Writer(directory).Add(Write(PRIVATE, URL));

    Assert.Equal(["local", PRIVATE], FeedsOf(directory).Select(feed => feed.Name), StringComparer.Ordinal);
  }

  [Fact]
  public void Add_requires_a_source_and_refuses_a_duplicate() {
    using var directory = new TempDirectory();
    directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);

    Assert.Equal(RpcErrorCodes.INVALID_PARAMS, CodeOf(() => writer.Add(Write(PRIVATE))));
    Assert.Equal(RpcErrorCodes.FEED_DUPLICATE, CodeOf(() => writer.Add(Write("LOCAL", URL))));
  }

  [Fact]
  public void Update_changes_the_url_and_the_flags() {
    using var directory = new TempDirectory();
    directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);
    writer.Add(Write(PRIVATE, "http://private.example/v3/index.json"));

    var (_, feed) = writer.Update(Write(PRIVATE, URL, insecure: true, noTls: true));

    Assert.Equal(URL, feed.Source);
    Assert.True(feed.AllowInsecureConnections);
    Assert.True(feed.DisableTlsCertificateValidation);
    Assert.Equal(feed, FeedsOf(directory).Single(item => string.Equals(item.Name, PRIVATE, StringComparison.Ordinal)));
  }

  [Fact]
  public void Update_renames() {
    using var directory = new TempDirectory();
    directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);
    writer.Add(Write(PRIVATE, URL));

    var (_, feed) = writer.Update(Write(PRIVATE, newName: "renamed"));
    var duplicate = CodeOf(() => writer.Update(Write("renamed", newName: "local")));

    Assert.Equal("renamed", feed.Name);
    Assert.Equal(URL, feed.Source);
    Assert.Equal(["local", "renamed"], FeedsOf(directory).Select(item => item.Name), StringComparer.Ordinal);
    Assert.Equal(RpcErrorCodes.FEED_DUPLICATE, duplicate);
  }

  [Fact]
  public void Update_disables_and_enables_again() {
    using var directory = new TempDirectory();
    directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);

    var (_, disabled) = writer.Update(Write("local", enabled: false));
    var afterDisable = FeedsOf(directory)[0].Enabled;
    var (_, enabled) = writer.Update(Write("local", enabled: true));

    Assert.False(disabled.Enabled);
    Assert.False(afterDisable);
    Assert.True(enabled.Enabled);
    Assert.True(FeedsOf(directory)[0].Enabled);
  }

  [Fact]
  public void Remove_deletes_the_feed_and_an_unknown_one_is_an_error() {
    using var directory = new TempDirectory();
    directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);
    writer.Add(Write(PRIVATE, URL));

    writer.Remove(new SourceRemoveParams(null, PRIVATE));

    Assert.Equal(["local"], FeedsOf(directory).Select(feed => feed.Name), StringComparer.Ordinal);
    Assert.Equal(RpcErrorCodes.FEED_UNKNOWN, CodeOf(() => writer.Remove(new SourceRemoveParams(null, PRIVATE))));
    Assert.Equal(RpcErrorCodes.FEED_UNKNOWN, CodeOf(() => writer.Update(Write(PRIVATE, URL))));
  }

  [Fact]
  public void SetProperty_writes_changes_and_removes() {
    using var directory = new TempDirectory();
    var file = directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);
    var root = directory.Path;
    var provider = new SettingsProvider(() => root);

    writer.SetProperty(new SourceSetPropertyParams(file, SourcesReader.GLOBAL_PACKAGES_FOLDER, "first"));
    var written = SourcesReader.Read(provider, _ => false);
    writer.SetProperty(new SourceSetPropertyParams(file, SourcesReader.GLOBAL_PACKAGES_FOLDER, "second"));
    writer.SetProperty(new SourceSetPropertyParams(file, SourcesReader.REPOSITORY_PATH, "packages"));
    var changed = SourcesReader.Read(provider, _ => false);
    writer.SetProperty(new SourceSetPropertyParams(file, SourcesReader.GLOBAL_PACKAGES_FOLDER, null));
    var removed = SourcesReader.Read(provider, _ => false);

    Assert.Equal("first", written.Files[0].GlobalPackagesFolder);
    Assert.Equal(directory.Combine("first"), written.GlobalPackagesFolder);
    Assert.Equal("second", changed.Files[0].GlobalPackagesFolder);
    Assert.Equal("packages", changed.Files[0].RepositoryPath);
    Assert.Equal(directory.Combine("packages"), changed.LocalPackagesFolder);
    Assert.Null(removed.Files[0].GlobalPackagesFolder);
    Assert.Equal("local", Assert.Single(removed.Files[0].Feeds).Name);
  }

  [Fact]
  public void SetProperty_refuses_other_properties() {
    using var directory = new TempDirectory();
    var file = directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);

    var code = CodeOf(() => writer.SetProperty(new SourceSetPropertyParams(file, "http_proxy", "x")));

    Assert.Equal(RpcErrorCodes.INVALID_PARAMS, code);
  }

  [Fact]
  public void Read_only_file_is_not_written() {
    using var directory = new TempDirectory();
    var file = directory.WriteFile(FILE_NAME, CONFIG);
    var writer = Writer(directory);
    File.SetAttributes(file, FileAttributes.ReadOnly);
    try {
      Assert.Equal(RpcErrorCodes.CONFIG_NOT_WRITABLE, CodeOf(() => writer.Add(Write(PRIVATE, URL))));
      Assert.Equal(RpcErrorCodes.CONFIG_NOT_WRITABLE, CodeOf(() => writer.Update(Write("local", enabled: false))));
    }
    finally {
      File.SetAttributes(file, FileAttributes.Normal);
    }
  }

  [Fact]
  public void Machine_wide_feed_is_only_enabled_or_disabled_and_in_the_user_file() {
    using var directory = new TempDirectory();
    var machine = directory.WriteFile(FILE_NAME, CONFIG);
    var user = directory.Combine("user", "NuGet.Config");
    var writer = Writer(directory, path => string.Equals(path, machine, StringComparison.OrdinalIgnoreCase), user);

    var (written, disabled) = writer.Update(Write("local", enabled: false));
    var userAfterDisable = File.ReadAllText(user);
    var (_, enabled) = writer.Update(Write("local", enabled: true));

    Assert.Equal(user, written);
    Assert.False(disabled.Enabled);
    Assert.Contains("disabledPackageSources", userAfterDisable, StringComparison.Ordinal);
    Assert.Contains("\"local\"", userAfterDisable, StringComparison.Ordinal);
    Assert.True(enabled.Enabled);
    Assert.DoesNotContain("\"local\"", File.ReadAllText(user), StringComparison.Ordinal);
    Assert.Equal(CONFIG, File.ReadAllText(machine));
    Assert.Equal(RpcErrorCodes.CONFIG_NOT_WRITABLE, CodeOf(() => writer.Update(Write("local", URL))));
    Assert.Equal(RpcErrorCodes.CONFIG_NOT_WRITABLE, CodeOf(() => writer.Remove(new SourceRemoveParams(null, "local"))));
    Assert.Equal(RpcErrorCodes.CONFIG_NOT_WRITABLE, CodeOf(() => writer.Add(Write(PRIVATE, URL, machine))));
  }

  [Fact]
  public void Machine_wide_folders_are_recognized() {
    var machine = NuGetEnvironment.GetFolderPath(NuGetFolderPath.MachineWideConfigDirectory);
    using var directory = new TempDirectory();

    Assert.True(ConfigFileClassifier.IsMachineWide(Path.Combine(machine, "Vendor", "feeds.config")));
    Assert.False(ConfigFileClassifier.IsMachineWide(directory.Combine(FILE_NAME)));
  }
}
