// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Configuration;

public sealed class SourcesReaderTests {
  private const string CONFIG = """
    <?xml version="1.0" encoding="utf-8"?>
    <configuration>
      <packageSources>
        <clear />
        <add key="local" value="feed" />
        <add key="insecure" value="http://feed.example/v3/index.json" allowInsecureConnections="true" />
        <add key="off" value="https://off.example/v3/index.json" />
      </packageSources>
      <disabledPackageSources>
        <add key="off" value="true" />
      </disabledPackageSources>
    </configuration>
    """;

  [Fact]
  public void Read_lists_the_workspace_config_file_first_with_its_feeds() {
    using var directory = new TempDirectory();
    var configPath = directory.WriteFile("NuGet.config", CONFIG);
    var root = directory.Path;
    var provider = new SettingsProvider(() => root);

    var result = SourcesReader.Read(provider);

    var first = result.Files[0];
    Assert.Equal(configPath, first.Path, true);
    Assert.Equal(["local", "insecure", "off"], first.Feeds.Select(feed => feed.Name), StringComparer.Ordinal);
  }

  [Fact]
  public void Read_reports_enabled_insecure_and_local_flags_in_the_effective_view() {
    using var directory = new TempDirectory();
    directory.WriteFile("NuGet.config", CONFIG);
    var root = directory.Path;
    var provider = new SettingsProvider(() => root);

    var effective = SourcesReader.Read(provider).Effective.ToDictionary(feed => feed.Name, StringComparer.Ordinal);

    Assert.Equal(["insecure", "local", "off"], effective.Keys.Order(StringComparer.Ordinal), StringComparer.Ordinal);
    Assert.True(effective["local"].Enabled);
    Assert.True(effective["local"].IsLocal);
    Assert.Equal(directory.Combine("feed"), effective["local"].Source, true);
    Assert.True(effective["insecure"].AllowInsecureConnections);
    Assert.False(effective["insecure"].IsLocal);
    Assert.False(effective["off"].Enabled);
  }

  [Fact]
  public void Root_without_solution_is_the_process_working_directory() {
    var provider = new SettingsProvider(() => null);

    Assert.Equal(Environment.CurrentDirectory, provider.Root);
  }
}
