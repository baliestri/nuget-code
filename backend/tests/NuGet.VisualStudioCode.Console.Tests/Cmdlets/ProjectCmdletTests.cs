// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Tests.Support;

namespace NuGet.VisualStudioCode.Console.Tests.Cmdlets;

public sealed class ProjectCmdletTests {
  [Fact]
  public async Task Get_Project_returns_the_default_project() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Get-Project | ConvertTo-Json -Compress", Solution.APP);

    var project = result.Json();
    Assert.Equal("App", project.GetProperty("ProjectName").GetString());
    Assert.Equal(Solution.APP, project.GetProperty("FullName").GetString());
    Assert.Equal("net10.0", Assert.Single(project.GetProperty("Frameworks").EnumerateArray()).GetString());
  }

  [Fact]
  public async Task Get_Project_All_returns_every_project() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "(Get-Project -All).ProjectName", Solution.APP);

    Assert.Equal(["App", "Lib"], result.Lines());
  }

  [Fact]
  public async Task Get_Project_with_names_returns_those_projects() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, $"(Get-Project lib, '{Solution.APP}').ProjectName", Solution.APP);

    Assert.Equal(["Lib", "App"], result.Lines());
  }

  [Fact]
  public async Task Get_Project_without_a_default_project_says_to_choose_one() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Get-Project");

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("There is no default project. Choose one with Set-Project.", result.Error,
      StringComparison.Ordinal);
  }

  [Fact]
  public async Task A_default_project_that_left_the_solution_is_said() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Get-Project", "/work/Gone/Gone.csproj");

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("The default project is no longer in the solution: /work/Gone/Gone.csproj", result.Error,
      StringComparison.Ordinal);
  }

  [Fact]
  public async Task Set_Project_with_a_name_changes_the_default() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Set-Project Lib; (Get-Project).ProjectName; prompt", Solution.APP);

    Assert.Equal(["Lib", "PM [Lib]>"], result.Lines());
    Assert.Empty(server.ParamsOf(ConsoleRequestNames.PICK_PROJECT));
  }

  [Fact]
  public async Task Set_Project_without_a_name_asks_the_editor() {
    await using var server = Solution.Open().On(ConsoleRequestNames.PICK_PROJECT, $$"""{"path":"{{Solution.LIB}}"}""");

    var result = await Pwsh.RunAsync(server, "(Set-Project -PassThru).ProjectName; (Get-Project).ProjectName",
      Solution.APP);

    Assert.Equal(["Lib", "Lib"], result.Lines());
    Assert.Equal([$$"""{"current":"{{Solution.APP}}"}"""], server.ParamsOf(ConsoleRequestNames.PICK_PROJECT));
  }

  [Fact]
  public async Task Set_Project_keeps_the_default_when_the_list_is_dismissed() {
    await using var server = Solution.Open().On(ConsoleRequestNames.PICK_PROJECT, "{}");

    var result = await Pwsh.RunAsync(server, "Set-Project; (Get-Project).ProjectName", Solution.APP);

    Assert.Equal(["App"], result.Lines());
  }

  [Fact]
  public async Task An_unknown_project_name_is_an_error_that_lists_the_names() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Set-Project Nope", Solution.APP);

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("There is no project named 'Nope'. The projects are: App, Lib.", result.Error,
      StringComparison.Ordinal);
  }

  [Fact]
  public async Task Project_names_complete_with_the_projects_of_the_solution() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, """
    (TabExpansion2 'Set-Project ' 12).CompletionMatches.CompletionText
    (TabExpansion2 'Get-Package -ProjectName l' 26).CompletionMatches.CompletionText
    """, Solution.APP);

    Assert.Equal(["App", "Lib", "Lib"], result.Lines());
  }

  [Fact]
  public async Task The_prompt_names_the_default_project() {
    await using var server = Solution.Open();

    Assert.Equal(["PM [App]>"], (await Pwsh.RunAsync(server, "prompt", Solution.APP)).Lines());
    Assert.Equal(["PM>"], (await Pwsh.RunAsync(server, "prompt")).Lines());
    // The prompt is drawn without asking the editor.
    Assert.Empty(server.Requests);
  }

  [Fact]
  public async Task Without_an_open_solution_the_cmdlet_says_so() {
    await using var server = new FakeConsoleServer().On(ConsoleRequestNames.PROJECTS, _
      => FakeAnswer.Failed("noSolution", "No solution is open in the editor."));

    var result = await Pwsh.RunAsync(server, "Get-Project -All");

    Assert.NotEqual(0, result.ExitCode);
    Assert.Contains("No solution is open in the editor.", result.Error, StringComparison.Ordinal);
  }

  [Fact]
  public async Task The_help_topic_says_what_is_not_there() {
    await using var server = Solution.Open();

    var result = await Pwsh.RunAsync(server, "Get-Help about_NuGetCode | Out-String");

    Assert.Contains("Add-Migration", result.Output, StringComparison.Ordinal);
    Assert.Contains("Add-BindingRedirect does not exist", result.Output, StringComparison.Ordinal);
  }
}
