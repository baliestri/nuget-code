// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Console;

/// <summary>Why the analysis is told that members no C# code touches are in use: PowerShell reaches them.</summary>
internal static class Justifications {
  public const string CMDLET =
    "PowerShell creates the cmdlet and binds its parameters by reflection; no C# code does either.";

  public const string OUTPUT =
    "Written to the pipeline: scripts, the formatting file and other cmdlets read the properties by name.";
}
