// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Restore;

namespace NuGet.VisualStudioCode.Tests.Restore;

public sealed class RestoreDiagnosticParserTests {
  [Theory]
  [InlineData(
    @"D:\work\B\B.csproj : error NU1101: Unable to find package Ghost. No packages exist with this id in source(s): local [D:\work\Sample.slnx]",
    LogLevels.ERROR, "NU1101",
    "Unable to find package Ghost. No packages exist with this id in source(s): local", @"D:\work\B\B.csproj")]
  [InlineData(
    "/home/me/App/App.csproj : warning NU1603: App depends on Alpha (>= 1.0.1) but Alpha 1.0.1 was not found. [/home/me/App/App.csproj]",
    LogLevels.WARNING, "NU1603", "App depends on Alpha (>= 1.0.1) but Alpha 1.0.1 was not found.",
    "/home/me/App/App.csproj")]
  [InlineData(@"D:\work\App\App.csproj : error NU1004: The lock file is out of date.", LogLevels.ERROR, "NU1004",
    "The lock file is out of date.", @"D:\work\App\App.csproj")]
  [InlineData(@"  D:\work\App\App.csproj(12,5): warning NU1701: Restored with a fallback. [D:\work\App\App.csproj]",
    LogLevels.WARNING, "NU1701", "Restored with a fallback.", @"D:\work\App\App.csproj")]
  [InlineData(
    @"C:\Program Files\dotnet\sdk\10.0.403\NuGet.targets(196,5): error NU1301: Unable to load the service index for source http://localhost:5000/v3/index.json. [D:\work\App\App.csproj::TargetFramework=net10.0]",
    LogLevels.ERROR, "NU1301", "Unable to load the service index for source http://localhost:5000/v3/index.json.",
    @"D:\work\App\App.csproj")]
  [InlineData("NuGet.targets : error NU1100: Unable to resolve Alpha.", LogLevels.ERROR, "NU1100",
    "Unable to resolve Alpha.", null)]
  public void Diagnostic_lines_are_recognized(string line, string level, string code, string message,
    string? project) {
    var diagnostic = RestoreDiagnosticParser.Parse(line);

    Assert.Equal(new RestoreDiagnostic(level, code, message, project), diagnostic);
  }

  [Theory]
  [InlineData(@"  Restored D:\work\App\App.csproj (in 212 ms).")]
  [InlineData(@"D:\work\App\Program.cs(3,1): error CS1002: ; expected [D:\work\App\App.csproj]")]
  [InlineData(@"D:\work\App\App.csproj : error MSB4025: The project file could not be loaded.")]
  [InlineData("")]
  public void Other_lines_are_not_diagnostics(string line)
    => Assert.Null(RestoreDiagnosticParser.Parse(line));
}
