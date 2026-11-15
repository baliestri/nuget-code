// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Tests.Support;

namespace NuGet.VisualStudioCode.Console.Tests.Cmdlets;

public sealed class PackageReadCmdletTests {
  private const string LINE = """% { "$($_.ProjectName) $($_.Id) $($_.Version) $($_.LatestVersion)".Trim() }""";

  private const string UPDATES = """
    {"packages":[
      {"id":"Alpha","versions":[{"feed":"nuget.org","version":"1.2.0"},{"feed":"private","version":"1.10.0"}]},
      {"id":"Beta","versions":[{"feed":"nuget.org","version":"2.1.0"}]}
    ],"failures":[{"feed":"private","kind":"unreachable","message":"The feed did not answer."}]}
    """;

  [Fact]
  public async Task Get_Package_lists_the_packages_of_the_default_project() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, $"Get-Package | {LINE}", Solution.APP);

    // What the SDK adds on its own is not listed, and neither are the transitive packages.
    Assert.Equal(["App Alpha 1.0.0", "App Beta 2.1.0"], result.Lines());
  }

  [Fact]
  public async Task Get_Package_of_a_named_project_shows_the_requested_version_before_a_restore() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, $"Get-Package -ProjectName Lib | {LINE}", Solution.APP);

    Assert.Equal(["Lib Alpha 0.9.0"], result.Lines());
  }

  [Fact]
  public async Task Get_Package_without_a_default_project_lists_the_solution() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, $"Get-Package | {LINE}");

    Assert.Equal(["App Alpha 1.0.0", "App Beta 2.1.0", "Lib Alpha 0.9.0"], result.Lines());
  }

  [Fact]
  public async Task Get_Package_filters_by_a_part_of_the_id() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, $"Get-Package bet | {LINE}", Solution.APP);

    Assert.Equal(["App Beta 2.1.0"], result.Lines());
  }

  [Fact]
  public async Task Get_Package_Updates_lists_only_the_ones_with_a_newer_version() {
    await using var server = Solution.Open().On(ConsoleRequestNames.UPDATES, UPDATES);

    var result = await Pwsh.RunAsync(server, $"Get-Package -Updates 3>$null | {LINE}", Solution.APP);

    // The newest among the feeds, compared as versions: 1.10.0 is newer than 1.2.0.
    Assert.Equal(["App Alpha 1.0.0 1.10.0"], result.Lines());
    Assert.Equal(["""{"prerelease":false,"transitive":false}"""], server.ParamsOf(ConsoleRequestNames.UPDATES));
  }

  [Fact]
  public async Task A_feed_that_failed_is_a_warning() {
    await using var server = Solution.Open().On(ConsoleRequestNames.UPDATES, UPDATES);

    var result = await Pwsh.RunAsync(server, "Get-Package -Updates -IncludePrerelease 3>&1 | % { \"$_\" }",
      Solution.APP);

    Assert.Contains("private: The feed did not answer.", result.Lines(), StringComparer.Ordinal);
    Assert.Equal(["""{"prerelease":true,"transitive":false}"""], server.ParamsOf(ConsoleRequestNames.UPDATES));
  }

  [Fact]
  public async Task Get_Package_Transitive_adds_the_packages_that_come_with_others() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server,
      """Get-Package -Transitive | % { "$($_.Id) $($_.Version) $($_.IsTransitive) $($_.Via -join ',')".Trim() }""",
      Solution.APP);

    Assert.Equal(["Alpha 1.0.0 False", "Beta 2.1.0 False", "Inner 3.0.0 True Alpha"], result.Lines());
  }

  [Fact]
  public async Task Get_Package_Updates_Transitive_asks_for_the_transitive_ones_apart() {
    await using var server = Solution.Open().On(ConsoleRequestNames.UPDATES, parameters
      => FakeAnswer.Of(parameters.GetProperty("transitive").GetBoolean()
        ? """{"packages":[{"id":"Inner","versions":[{"feed":"nuget.org","version":"3.1.0"}]}],"failures":[]}"""
        : """{"packages":[],"failures":[]}"""));

    var result = await Pwsh.RunAsync(server, $"Get-Package -Updates -Transitive | {LINE}", Solution.APP);

    Assert.Equal(["App Inner 3.0.0 3.1.0"], result.Lines());
    Assert.Equal(2, server.ParamsOf(ConsoleRequestNames.UPDATES).Count);
  }

  [Fact]
  public async Task Get_Package_Vulnerable_lists_the_ones_with_advisories_transitive_included() {
    await using var server = Solution.Open().On(ConsoleRequestNames.VULNERABILITIES, """
    {"packages":[
      {"id":"inner","version":"3.0.0","advisories":[
        {"severity":"high","url":"https://advisories.example/1"},{"severity":"low","url":"https://advisories.example/2"}]},
      {"id":"Alpha","version":"0.5.0","advisories":[{"severity":"critical","url":"https://advisories.example/3"}]}
    ],"failures":[]}
    """);

    var result = await Pwsh.RunAsync(server,
      """Get-Package -Vulnerable | % { "$($_.Id) $($_.Version) $($_.Advisories -join ' | ')" }""", Solution.APP);

    Assert.Equal(["Inner 3.0.0 high: https://advisories.example/1 | low: https://advisories.example/2"],
      result.Lines());
  }

  [Fact]
  public async Task Packages_are_shown_as_a_table_with_notes() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Get-Package -Transitive | Out-String -Width 200", Solution.APP);

    Assert.Contains(result.Lines(), line => line.StartsWith("Id", StringComparison.Ordinal)
                                            && line.Contains("ProjectName", StringComparison.Ordinal));
    Assert.Contains(result.Lines(), line => line.StartsWith("Inner", StringComparison.Ordinal)
                                            && line.EndsWith("via Alpha", StringComparison.Ordinal));
  }

  [Fact]
  public async Task Find_Package_passes_the_keyword_the_source_and_the_page() {
    await using var server = Solution.Open().On(ConsoleRequestNames.SEARCH, """
    {"packages":[
      {"id":"Json.A","version":"1.0.0","description":"First.","feed":"nuget.org"},
      {"id":"Json.B","version":"2.0.0-beta","feed":"nuget.org"}
    ],"failures":[]}
    """);

    var result = await Pwsh.RunAsync(server,
      """Find-Package json -Source nuget.org -IncludePrerelease -First 5 -Skip 10 | % { "$($_.Id) $($_.Version) $($_.Source)" }""");

    Assert.Equal(["Json.A 1.0.0 nuget.org", "Json.B 2.0.0-beta nuget.org"], result.Lines());
    Assert.Equal(["""{"query":"json","feed":"nuget.org","prerelease":true,"skip":10,"take":5}"""],
      server.ParamsOf(ConsoleRequestNames.SEARCH));
  }

  [Fact]
  public async Task Find_Package_without_arguments_asks_for_the_first_twenty() {
    await using var server = Solution.Open().On(ConsoleRequestNames.SEARCH, """{"packages":[],"failures":[]}""");

    var result = await Pwsh.RunAsync(server, "Find-Package");

    Assert.Empty(result.Lines());
    Assert.Equal(["""{"prerelease":false,"skip":0,"take":20}"""], server.ParamsOf(ConsoleRequestNames.SEARCH));
  }

  [Fact]
  public async Task Find_Package_ExactMatch_looks_up_one_package_and_AllVersions_lists_its_versions() {
    await using var server = Solution.Open().On(ConsoleRequestNames.DETAILS, parameters
      => FakeAnswer.Of(string.Equals(parameters.GetProperty("id").GetString(), "Alpha", StringComparison.Ordinal)
        ? """{"id":"Alpha","versions":["1.2.0","1.0.0"],"description":"A.","feed":"nuget.org","dependencyGroups":[],"failures":[],"vulnerableVersions":[]}"""
        : """{"id":"Nope","versions":[],"dependencyGroups":[],"failures":[],"vulnerableVersions":[]}"""));

    var result = await Pwsh.RunAsync(server, """
    Find-Package Alpha -ExactMatch | % { "$($_.Id) $($_.Version) [$($_.Versions -join ',')]" }
    Find-Package Alpha -ExactMatch -AllVersions | % { "$($_.Id) $($_.Version) [$($_.Versions -join ',')]" }
    Find-Package Nope -ExactMatch | % { "found $($_.Id)" }
    """);

    Assert.Equal(["Alpha 1.2.0 []", "Alpha 1.2.0 [1.2.0,1.0.0]"], result.Lines());
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.SEARCH));
    Assert.Equal("""{"id":"Alpha","prerelease":false}""", server.ParamsOf(ConsoleRequestNames.DETAILS)[0]);
  }

  [Fact]
  public async Task Find_Package_refuses_more_than_a_hundred_packages() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Find-Package json -First 101");

    Assert.NotEqual(0, result.ExitCode);
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.SEARCH));
  }
}
