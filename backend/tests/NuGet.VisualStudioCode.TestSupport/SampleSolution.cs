// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;
using System.Text;

namespace NuGet.VisualStudioCode.TestSupport;

public static class SampleSolution {
  private const string SDK_PROJECT = """
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
      </PropertyGroup>
    </Project>
    """;

  public static string WriteProject(TempDirectory directory, string name, string? content = null)
    => directory.WriteFile(Path.Combine(name, $"{name}.csproj"), content ?? SDK_PROJECT);

  public static string WriteSlnx(TempDirectory directory, string name, params string[] projectNames) {
    var builder = new StringBuilder("<Solution>\n");
    foreach (var project in projectNames)
      builder.Append(CultureInfo.InvariantCulture, $"  <Project Path=\"{project}/{project}.csproj\" />\n");

    builder.Append("</Solution>\n");
    return directory.WriteFile($"{name}.slnx", builder.ToString());
  }

  public static string WriteSln(TempDirectory directory, string name, params string[] projectNames) {
    var builder = new StringBuilder();
    builder.Append("\nMicrosoft Visual Studio Solution File, Format Version 12.00\n");
    builder.Append("# Visual Studio Version 17\n");
    for (var index = 0; index < projectNames.Length; index++) {
      var project = projectNames[index];
      var id = new Guid(index + 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1).ToString("B").ToUpperInvariant();
      builder.Append(
        CultureInfo.InvariantCulture,
        $"Project(\"{{9A19103F-16F7-4668-BE54-9A1E7A4F7556}}\") = \"{project}\", \"{project}\\{project}.csproj\", \"{id}\"\n"
      );
      builder.Append("EndProject\n");
    }

    builder.Append("Global\nEndGlobal\n");
    return directory.WriteFile($"{name}.sln", builder.ToString());
  }

  public static string WriteSlnf(TempDirectory directory, string name, string solutionFileName,
    params string[] projectNames) {
    var projects = string.Join(", ", projectNames.Select(project => $"\"{project}\\\\{project}.csproj\""));
    var json = $$"""
      {
        "solution": {
          "path": "{{solutionFileName}}",
          "projects": [{{projects}}]
        }
      }
      """;
    return directory.WriteFile($"{name}.slnf", json);
  }
}
