// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Net;
using NuGet.Configuration;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Restore;

public sealed class RestoreCredentialEnvironmentTests {
  private const string CONFIG = """
    <?xml version="1.0" encoding="utf-8"?>
    <configuration>
      <packageSources>
        <clear />
        <add key="private" value="https://private.example/v3/index.json" />
        <add key="off" value="https://off.example/v3/index.json" />
        <add key="anonymous" value="https://anonymous.example/v3/index.json" />
        <add key="my feed" value="https://spaced.example/v3/index.json" />
        <add key="local" value="feed" />
      </packageSources>
      <disabledPackageSources>
        <add key="off" value="true" />
      </disabledPackageSources>
    </configuration>
    """;

  private readonly static Dictionary<string, NetworkCredential> Known = new(StringComparer.OrdinalIgnoreCase) {
    ["https://private.example"] = new NetworkCredential("user", "s3cr3t"),
    ["https://off.example"] = new NetworkCredential("user", "s3cr3t"),
    ["https://spaced.example"] = new NetworkCredential("user", "s3cr3t")
  };

  private static RestoreCredentials Build() {
    using var directory = new TempDirectory();
    directory.WriteFile("NuGet.Config", CONFIG);
    return RestoreCredentialEnvironment.Build(new Settings(directory.Path), Known);
  }

  [Fact]
  public void Source_with_a_known_credential_gets_its_variable() {
    var variable = Assert.Single(Build().Environment);

    Assert.Equal("NuGetPackageSourceCredentials_private", variable.Key);
    Assert.Equal("Username=user;Password=s3cr3t", variable.Value);
  }

  [Fact]
  public void Source_whose_name_cannot_be_a_variable_is_reported()
    => Assert.Equal(["my feed"], Build().Skipped);
}
