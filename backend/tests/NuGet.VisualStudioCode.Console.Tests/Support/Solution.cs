// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Tests.Support;

/// <summary>The solution the fake editor has open in the cmdlet tests: two projects and their packages.</summary>
internal static class Solution {
  public const string APP = "/work/App/App.csproj";
  public const string LIB = "/work/Lib/Lib.csproj";

  public const string PROJECTS = $$"""
    {"projects":[
      {"name":"App","path":"{{APP}}","frameworks":["net10.0"]},
      {"name":"Lib","path":"{{LIB}}","frameworks":["net8.0","net10.0"]}
    ]}
    """;

  public const string INSTALLED = $$"""
    {"projects":[
      {"projectPath":"{{APP}}",
       "packages":[
         {"id":"Alpha","requestedVersion":"1.0.0","resolvedVersion":"1.0.0","frameworks":["net10.0"],"implicit":false,"restored":true},
         {"id":"Beta","requestedVersion":"2.*","resolvedVersion":"2.1.0","frameworks":["net10.0"],"implicit":false,"restored":true},
         {"id":"Microsoft.NET.ILLink.Tasks","resolvedVersion":"10.0.0","frameworks":["net10.0"],"implicit":true,"restored":true}
       ],
       "transitive":[{"id":"Inner","resolvedVersion":"3.0.0","frameworks":["net10.0"],"via":["Alpha"]}]},
      {"projectPath":"{{LIB}}",
       "packages":[
         {"id":"Alpha","requestedVersion":"0.9.0","frameworks":["net8.0"],"implicit":false,"restored":false}
       ],
       "transitive":[]}
    ]}
    """;

  /// <summary>A fake editor that has the solution open.</summary>
  public static FakeConsoleServer Open()
    => new FakeConsoleServer()
      .On(ConsoleRequestNames.PROJECTS, PROJECTS)
      .On(ConsoleRequestNames.INSTALLED, INSTALLED);
}
