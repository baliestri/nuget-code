// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.TestSupport;

public sealed class TestWorkspace : IDisposable {
  private const string CONFIG = """
    <?xml version="1.0" encoding="utf-8"?>
    <configuration>
      <packageSources>
        <clear />
        <add key="local" value="feed" />
      </packageSources>
      <config>
        <add key="globalPackagesFolder" value="global-packages" />
      </config>
    </configuration>
    """;

  public TestWorkspace() {
    Directory.CreateDirectory(FeedPath);
    Root.WriteFile("NuGet.config", CONFIG);
  }

  public TempDirectory Root { get; } = new();

  public string Path => Root.Path;

  private string FeedPath => Root.Combine("feed");

  public void Dispose()
    => Root.Dispose();

  public void AddPackage(string id, string version, params (string Id, string Range)[] dependencies)
    => TestPackages.Create(FeedPath, id, version, dependencies);

  public void AddPackageFor(string framework, string id, string version)
    => TestPackages.Create(FeedPath, id, version, framework);

  public void WriteConfig(string sectionsXml)
    => Root.WriteFile(
      "NuGet.config",
      $"""
      <?xml version="1.0" encoding="utf-8"?>
      <configuration>
      {sectionsXml}
        <config>
          <add key="globalPackagesFolder" value="global-packages" />
        </config>
      </configuration>
      """
    );

  public async Task RestoreAsync(string target, CancellationToken ct) {
    var result = await DotnetCli.RunAsync(["restore", target], Path, ct).ConfigureAwait(false);
    if (result.ExitCode != 0) {
      throw new InvalidOperationException($"dotnet restore failed:{Environment.NewLine}{result.Output}");
    }
  }
}
