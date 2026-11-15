// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Sessions;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Tests.Projects;

public sealed class ChangeClassifierTests {
  private readonly static string Root = Path.Combine(Path.GetTempPath(), "repo");
  private readonly static string App = Path.Combine(Root, "App", "App.csproj");
  private readonly static string Lib = Path.Combine(Root, "Lib", "Lib.csproj");
  private readonly static string AppAssets = Path.Combine(Root, "App", "obj", "project.assets.json");
  private readonly static string SolutionPath = Path.Combine(Root, "Sample.slnx");

  private static Session CreateSession() {
    var solution = new SolutionDescriptor(SolutionPath, Root, SolutionKind.Slnx, [App, Lib]);
    var app = new EvaluatedProject(new ProjectInfo("App", App, ["net10.0"], false, null), [], AppAssets);
    var lib = new EvaluatedProject(new ProjectInfo("Lib", Lib, ["net10.0"], false, null), [], null);
    return new Session(solution, [app, lib]);
  }

  [Theory]
  [InlineData("Directory.Build.props")]
  [InlineData("Directory.Build.targets")]
  [InlineData("Directory.Packages.props")]
  [InlineData("global.json")]
  [InlineData("NuGet.Config")]
  [InlineData("nuget.config")]
  public void Shared_files_reevaluate_the_solution(string fileName) {
    var impact = ChangeClassifier.Classify(CreateSession(), [Path.Combine(Root, "src", fileName)]);

    Assert.True(impact.Solution);
  }

  [Fact]
  public void The_solution_file_reevaluates_the_solution()
    => Assert.True(ChangeClassifier.Classify(CreateSession(), [SolutionPath]).Solution);

  [Fact]
  public void A_project_file_reevaluates_only_that_project() {
    var impact = ChangeClassifier.Classify(CreateSession(), [App, App]);

    Assert.False(impact.Solution);
    Assert.Equal([App], impact.Projects, StringComparer.Ordinal);
    Assert.Empty(impact.AssetsProjects);
  }

  [Fact]
  public void An_assets_file_only_marks_its_project() {
    var impact = ChangeClassifier.Classify(CreateSession(), [AppAssets]);

    Assert.False(impact.Solution);
    Assert.Empty(impact.Projects);
    Assert.Equal([App], impact.AssetsProjects, StringComparer.Ordinal);
  }

  [Fact]
  public void Unrelated_files_have_no_impact() {
    var impact = ChangeClassifier.Classify(CreateSession(),
    [
      Path.Combine(Root, "App", "Program.cs"),
      Path.Combine(Root, "Other", "Other.csproj"),
      Path.Combine(Root, "Other", "obj", "project.assets.json")
    ]);

    Assert.True(impact.IsEmpty);
  }
}
