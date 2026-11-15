// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Tests.Support;

namespace NuGet.VisualStudioCode.Console.Tests.Cmdlets;

public sealed class PackageChangeCmdletTests {
  /// <summary>Turns everything the cmdlet says, on any stream, into lines of text.</summary>
  private const string TEXT = """*>&1 | % { "$_" }""";

  private const string PLAN = $$"""
    {"edits":[{"file":"{{Solution.APP}}","line":7,"oldText":"","newText":"    <PackageReference Include=\"Gamma\" Version=\"1.0.0\" />"}],
     "warnings":[]}
    """;

  private const string DONE = $$"""
    {"engine":"embedded","fellBack":false,"projects":[
      {"project":"{{Solution.APP}}","changedFiles":["{{Solution.APP}}"],"editErrors":[],"restore":"succeeded","messages":[]}]}
    """;

  /// <summary>A fake editor with the solution open, where every change is planned and succeeds.</summary>
  private static FakeConsoleServer Open()
    => Solution.Open()
      .On(ConsoleRequestNames.PLAN, PLAN)
      .On(ConsoleRequestNames.INSTALL, DONE)
      .On(ConsoleRequestNames.UPDATE, DONE)
      .On(ConsoleRequestNames.REMOVE, DONE)
      .On(ConsoleRequestNames.RESTORE, DONE)
      .On(ConsoleRequestNames.DETAILS, Details);

  /// <summary>What the sources have: Alpha and Gamma in several versions, Beta only in the installed one.</summary>
  private static FakeAnswer Details(JsonElement parameters) {
    var id = parameters.GetProperty("id").GetString();
    var prerelease = parameters.TryGetProperty("prerelease", out var asked) && asked.GetBoolean();
    var versions = id switch {
      "Alpha" or "Gamma" => """["2.0.0","1.2.5","1.2.0","1.0.3","1.0.0","0.9.0"]""",
      "Beta" => """["2.1.0"]""",
      var _ => "[]"
    };
    if (prerelease && id is "Alpha" or "Gamma") {
      versions = versions.Replace("[", """["2.1.0-beta",""", StringComparison.Ordinal);
    }

    return FakeAnswer.Of(
      $$"""{"id":"{{id}}","versions":{{versions}},"dependencyGroups":[],"failures":[],"vulnerableVersions":[]}""");
  }

  private static string Update(string id, string version, string project = Solution.APP)
    => $$"""{"changes":[{"kind":"update","id":"{{id}}","version":"{{version}}","projects":["{{project}}"]}]}""";

  [Fact]
  public async Task Install_Package_without_a_version_installs_the_newest() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"Install-Package Gamma {TEXT}", Solution.APP);

    Assert.Equal(["App: 1 file changed, restore succeeded."], result.Lines());
    Assert.Equal(["""{"id":"Gamma","prerelease":false}"""], server.ParamsOf(ConsoleRequestNames.DETAILS));
    Assert.Equal(
      [$$"""{"changes":[{"kind":"install","id":"Gamma","version":"2.0.0","projects":["{{Solution.APP}}"]}]}"""],
      server.ParamsOf(ConsoleRequestNames.PLAN));
    Assert.Equal([$$"""{"id":"Gamma","version":"2.0.0","projects":["{{Solution.APP}}"]}"""],
      server.ParamsOf(ConsoleRequestNames.INSTALL));
  }

  [Fact]
  public async Task Install_Package_IncludePrerelease_lets_the_newest_be_a_prerelease() {
    await using var server = Open();

    await Pwsh.RunAsync(server, $"Install-Package Gamma -IncludePrerelease -Source nuget.org {TEXT}", Solution.APP);

    Assert.Equal(["""{"id":"Gamma","feed":"nuget.org","prerelease":true}"""],
      server.ParamsOf(ConsoleRequestNames.DETAILS));
    Assert.Equal([$$"""{"id":"Gamma","version":"2.1.0-beta","projects":["{{Solution.APP}}"]}"""],
      server.ParamsOf(ConsoleRequestNames.INSTALL));
  }

  [Fact]
  public async Task Install_Package_with_a_version_and_a_project_installs_that_one_there() {
    await using var server = Open();

    await Pwsh.RunAsync(server, $"Install-Package Gamma 1.0.0 -ProjectName Lib {TEXT}", Solution.APP);

    Assert.Empty(server.ParamsOf(ConsoleRequestNames.DETAILS));
    Assert.Equal([$$"""{"id":"Gamma","version":"1.0.0","projects":["{{Solution.LIB}}"]}"""],
      server.ParamsOf(ConsoleRequestNames.INSTALL));
  }

  [Fact]
  public async Task Install_Package_of_what_no_source_has_is_an_error() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, "Install-Package Nope", Solution.APP);

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("No package source has Nope in a stable version; try -IncludePrerelease.", result.Error,
      StringComparison.Ordinal);
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.INSTALL));
  }

  [Fact]
  public async Task A_change_without_a_default_project_says_to_choose_one() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, "Install-Package Gamma 1.0.0");

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("There is no default project. Choose one with Set-Project.", result.Error,
      StringComparison.Ordinal);
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.INSTALL));
  }

  [Fact]
  public async Task Uninstall_Package_removes_the_package_from_the_project() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"Uninstall-Package Alpha {TEXT}", Solution.APP);

    Assert.Equal(["App: 1 file changed, restore succeeded."], result.Lines());
    Assert.Equal([$$"""{"changes":[{"kind":"remove","id":"Alpha","projects":["{{Solution.APP}}"]}]}"""],
      server.ParamsOf(ConsoleRequestNames.PLAN));
    Assert.Equal([$$"""{"id":"Alpha","projects":["{{Solution.APP}}"]}"""], server.ParamsOf(ConsoleRequestNames.REMOVE));
  }

  [Fact]
  public async Task Uninstall_Package_Force_warns_that_it_does_not_apply_and_removes() {
    await using var server = Open();

    var result =
      await Pwsh.RunAsync(server, $"Uninstall-Package Alpha -Force -RemoveDependencies {TEXT}", Solution.APP);

    Assert.Contains(result.Lines(),
      line => line.StartsWith("-Force and -RemoveDependencies do not apply", StringComparison.Ordinal));
    Assert.Single(server.ParamsOf(ConsoleRequestNames.REMOVE));
  }

  [Fact]
  public async Task Update_Package_with_an_id_goes_to_the_newest() {
    await using var server = Open();

    await Pwsh.RunAsync(server, $"Update-Package alpha {TEXT}", Solution.APP);

    // The id is written as the project has it, whatever the case it was typed in.
    Assert.Equal([Update("Alpha", "2.0.0")], server.ParamsOf(ConsoleRequestNames.UPDATE));
    Assert.Equal([Update("Alpha", "2.0.0")], server.ParamsOf(ConsoleRequestNames.PLAN));
  }

  [Theory]
  [InlineData("-ToHighestMinor", "1.2.5")]
  [InlineData("-ToHighestPatch", "1.0.3")]
  [InlineData("-Safe", "1.0.3")]
  [InlineData("-Safe -ToHighestPatch", "1.0.3")]
  [InlineData("-IncludePrerelease", "2.1.0-beta")]
  [InlineData("-Version 0.9.0", "0.9.0")]
  public async Task Update_Package_goes_as_far_as_it_is_told(string arguments, string version) {
    await using var server = Open();

    await Pwsh.RunAsync(server, $"Update-Package Alpha {arguments} {TEXT}", Solution.APP);

    Assert.Equal([Update("Alpha", version)], server.ParamsOf(ConsoleRequestNames.UPDATE));
  }

  [Theory]
  [InlineData("Alpha -Safe -ToHighestMinor")]
  [InlineData("Alpha -Version 1.2.0 -ToHighestPatch")]
  [InlineData("Alpha -Reinstall -ToHighestMinor")]
  public async Task The_ways_to_choose_a_version_exclude_each_other(string arguments) {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"Update-Package {arguments}", Solution.APP);

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("exclude each other", result.Error, StringComparison.Ordinal);
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.UPDATE));
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.RESTORE));
  }

  [Fact]
  public async Task A_package_already_at_the_newest_of_its_range_is_left_alone() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"""
      Update-Package Beta {TEXT}
      Update-Package Alpha -Version 1.0.0 {TEXT}
      """, Solution.APP);

    Assert.Equal(["Beta is already at the newest version in App.", "Alpha is already at 1.0.0 in App."],
      result.Lines());
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.UPDATE));
  }

  [Fact]
  public async Task Update_Package_of_what_is_not_installed_says_to_install_it() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, "Update-Package Gamma", Solution.APP);

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("Gamma is not installed in App. Use Install-Package.", result.Error, StringComparison.Ordinal);
  }

  [Fact]
  public async Task Update_Package_without_an_id_updates_every_package_of_the_named_project_in_one_change() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"Update-Package -ProjectName App -ToHighestMinor {TEXT}", Solution.APP);

    // Beta is already where it can be; what the SDK adds on its own is not touched.
    Assert.Equal([Update("Alpha", "1.2.5")], server.ParamsOf(ConsoleRequestNames.UPDATE));
    Assert.Equal(["App: 1 file changed, restore succeeded."], result.Lines());
  }

  [Fact]
  public async Task Update_Package_without_an_id_and_a_project_asks_first() {
    await using var server = Open();

    // The tests run PowerShell without a user to answer, so the question cannot be asked: nothing is updated.
    var refused = await Pwsh.RunAsync(server, "Update-Package", Solution.APP);
    Assert.NotEqual(0, refused.ExitCode);
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.UPDATE));

    await Pwsh.RunAsync(server, $"Update-Package -Confirm:$false {TEXT}", Solution.APP);
    await Pwsh.RunAsync(server, $"Update-Package -Force {TEXT}", Solution.APP);

    Assert.Equal([Update("Alpha", "2.0.0"), Update("Alpha", "2.0.0")], server.ParamsOf(ConsoleRequestNames.UPDATE));
  }

  [Fact]
  public async Task Updating_every_package_skips_the_one_whose_version_is_not_one_version() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"Update-Package -ProjectName Lib {TEXT}", Solution.APP);

    // Lib has Alpha 0.9.0, not restored: the requested version is what is compared.
    Assert.Equal([Update("Alpha", "2.0.0", Solution.LIB)], server.ParamsOf(ConsoleRequestNames.UPDATE));
    Assert.DoesNotContain(result.Lines(), line => line.Contains("not one version", StringComparison.Ordinal));
  }

  [Fact]
  public async Task Update_Package_Reinstall_forces_a_restore_and_plans_nothing() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"Update-Package -Reinstall {TEXT}", Solution.APP);

    Assert.Equal(["App: 1 file changed, restore succeeded."], result.Lines());
    Assert.Equal([$$"""{"projects":["{{Solution.APP}}"],"force":true}"""],
      server.ParamsOf(ConsoleRequestNames.RESTORE));
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.PLAN));
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.UPDATE));
  }

  [Fact]
  public async Task Sync_Package_takes_the_version_of_the_default_project_to_the_others_that_have_it() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"""
      Sync-Package Alpha {TEXT}
      Sync-Package Beta {TEXT}
      """, Solution.APP);

    Assert.Equal([Update("Alpha", "1.0.0", Solution.LIB)], server.ParamsOf(ConsoleRequestNames.UPDATE));
    Assert.Contains("No other project has Beta in a version other than 2.1.0.", result.Lines(), StringComparer.Ordinal);
  }

  [Fact]
  public async Task WhatIf_shows_the_planned_edits_and_changes_nothing() {
    await using var server = Open();

    var result = await Pwsh.RunAsync(server, $"Install-Package Gamma 1.0.0 -WhatIf {TEXT}", Solution.APP);

    Assert.Contains(result.Lines(), line => line.StartsWith("What if:", StringComparison.Ordinal)
                                            && line.Contains("Install Gamma 1.0.0", StringComparison.Ordinal));
    Assert.Contains($"{Solution.APP}:7", result.Lines(), StringComparer.Ordinal);
    Assert.Contains("""+ <PackageReference Include="Gamma" Version="1.0.0" />""", result.Lines(),
      StringComparer.Ordinal);
    Assert.Single(server.ParamsOf(ConsoleRequestNames.PLAN));
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.INSTALL));
  }

  [Fact]
  public async Task What_the_plan_warns_of_is_written_as_warnings() {
    await using var server = Open().On(ConsoleRequestNames.PLAN, $$"""
      {"edits":[],"warnings":[
        {"kind":"centralShared","packageId":"Alpha","file":"/work/Directory.Packages.props",
         "projects":["{{Solution.APP}}","{{Solution.LIB}}"],"packages":[]},
        {"kind":"downgrade","packageId":"Alpha","projects":[],"packages":[],"detail":"1.0.0"}
      ]}
      """);

    var result = await Pwsh.RunAsync(server, "Update-Package Alpha -Version 0.9.0 3>&1 6>$null | % { \"$_\" }",
      Solution.APP);

    Assert.Equal([
      "Alpha: the version in Directory.Packages.props is shared, so it changes for App, Lib.",
      "Alpha: this is a downgrade from 1.0.0."
    ], result.Lines());
    Assert.Single(server.ParamsOf(ConsoleRequestNames.UPDATE));
  }

  [Fact]
  public async Task Edit_and_restore_failures_are_errors() {
    await using var server = Open().On(ConsoleRequestNames.INSTALL, $$"""
      {"fellBack":true,"projects":[
        {"project":"{{Solution.APP}}","changedFiles":[],"editErrors":["The file is read-only."],"restore":"notRun","messages":[]},
        {"project":"{{Solution.LIB}}","changedFiles":["{{Solution.LIB}}"],"editErrors":[],"restore":"failed","messages":[
          {"level":"error","code":"NU1101","message":"Unable to find package Gamma."},
          {"level":"warning","code":"NU1603","message":"Gamma 1.0.1 was resolved instead."}]}]}
      """);

    // The errors are not terminating: the cmdlet goes on to the next project. PowerShell still ends with a
    // failure code after them, which is not what is tested here.
    var result = await Pwsh.RunAsync(server, """
    Install-Package Gamma 1.0.0 -ErrorAction Continue 2>&1 3>$null 6>$null | % { "$($_.GetType().Name): $_" }
    exit 0
    """, Solution.APP);

    Assert.Equal([
      "ErrorRecord: App: The file is read-only.",
      "ErrorRecord: Lib: NU1101: Unable to find package Gamma."
    ], result.Lines());
  }

  [Fact]
  public async Task A_restore_that_failed_without_saying_why_and_one_that_was_cancelled_are_said() {
    await using var server = Open().On(ConsoleRequestNames.INSTALL, $$"""
      {"fellBack":false,"projects":[
        {"project":"{{Solution.APP}}","changedFiles":["{{Solution.APP}}"],"editErrors":[],"restore":"failed","messages":[]},
        {"project":"{{Solution.LIB}}","changedFiles":["{{Solution.LIB}}"],"editErrors":[],"restore":"cancelled","messages":[]}]}
      """);

    var result = await Pwsh.RunAsync(server, $"Install-Package Gamma 1.0.0 -ErrorAction Continue {TEXT}\nexit 0",
      Solution.APP);

    Assert.Equal([
      "App: the restore failed. See the NuGet log of the editor.",
      "App: 1 file changed, restore failed.",
      "Lib: cancelled before the restore finished. Files already edited stay edited.",
      "Lib: 1 file changed, restore cancelled."
    ], result.Lines());
  }

  [Fact]
  public async Task The_steps_of_the_operation_are_shown_as_progress() {
    await using var server = Open().On(ConsoleRequestNames.INSTALL, _ => FakeAnswer.Of(DONE)
      .After("""{"step":"planning"}""", $$"""{"step":"restoring","project":"{{Solution.APP}}"}""",
        """{"step":"done"}"""));

    // Progress is not a stream a script can redirect: it is read from a PowerShell of its own.
    var result = await Pwsh.RunAsync(server, $$"""
      $inner = [powershell]::Create()
      [void]$inner.AddScript("Import-Module '{{Pwsh.Manifest}}'; Install-Package Gamma 1.0.0")
      [void]$inner.Invoke()
      $inner.Streams.Progress | % { "$($_.Activity): $($_.StatusDescription) [$($_.RecordType)]" }
      """, Solution.APP);

    Assert.Equal([
      "Install Gamma 1.0.0: Planning the change [Processing]",
      "Install Gamma 1.0.0: Restoring App [Processing]",
      "Install Gamma 1.0.0: Done [Processing]",
      "Install Gamma 1.0.0: Done [Completed]"
    ], result.Lines());
  }

  [Fact]
  public async Task Stopping_the_cmdlet_asks_the_backend_to_cancel_and_waits_for_the_operation_to_answer() {
    var signal = Path.Combine(Path.GetTempPath(), $"nuget-code-test-{Guid.NewGuid():N}.signal");
    var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var ct = TestContext.Current.CancellationToken;
    await using var server = Open()
      .On(ConsoleRequestNames.INSTALL, async _ =>
      {
        // The operation runs until it is cancelled, and then answers, as the backend does.
        await File.WriteAllTextAsync(signal, string.Empty, ct).ConfigureAwait(false);
        await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(30), ct).ConfigureAwait(false);
        return FakeAnswer.Of(DONE.Replace("succeeded", "cancelled", StringComparison.Ordinal));
      })
      .On(ConsoleRequestNames.CANCEL, _ =>
      {
        cancelled.TrySetResult();
        return FakeAnswer.Of("{}");
      });

    try {
      var result = await Pwsh.RunAsync(server, $$"""
        $inner = [powershell]::Create()
        [void]$inner.AddScript("Import-Module '{{Pwsh.Manifest}}'; Install-Package Gamma 1.0.0")
        $running = $inner.BeginInvoke()
        while (-not (Test-Path '{{signal}}')) { Start-Sleep -Milliseconds 20 }
        $inner.Stop()
        "state: $($inner.InvocationStateInfo.State)"
        """, Solution.APP);

      Assert.Equal(["state: Stopped"], result.Lines());
      Assert.Equal(["{}"], server.ParamsOf(ConsoleRequestNames.CANCEL));
    }
    finally {
      File.Delete(signal);
    }
  }

  [Fact]
  public async Task Get_Package_Updates_pipes_into_Update_Package() {
    await using var server = Open().On(ConsoleRequestNames.UPDATES,
      """{"packages":[{"id":"Alpha","versions":[{"feed":"nuget.org","version":"2.0.0"}]}],"failures":[]}""");

    await Pwsh.RunAsync(server, $"Get-Package -Updates | Update-Package -ToHighestMinor {TEXT}");

    // No default project: each package is updated in the project it was listed for, from the version it
    // has there. Lib has 0.9.0, and no other version of that major exists.
    Assert.Equal([Update("Alpha", "1.2.5")],
      server.ParamsOf(ConsoleRequestNames.UPDATE));
  }
}
