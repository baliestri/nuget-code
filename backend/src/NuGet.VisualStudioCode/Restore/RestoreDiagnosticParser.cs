// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.RegularExpressions;
using NuGet.VisualStudioCode.Logging;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   Recognizes the NuGet diagnostics MSBuild prints, in the form
///   <c>origin : error|warning NU1234: message [project]</c>.
/// </summary>
internal static partial class RestoreDiagnosticParser {
  private const string ERROR = "error";
  private const string PROJECT_EXTENSION_SUFFIX = "proj";
  private const string PROPERTIES_SEPARATOR = "::";
  private const int TIMEOUT_MILLISECONDS = 1000;

  [GeneratedRegex(
    @"^\s*(?<origin>.*?)\s*:\s*(?<level>error|warning)\s+(?<code>NU\d+)\s*:\s*(?<message>.*?)(?:\s*\[(?<project>[^\[\]]+)\])?\s*$",
    RegexOptions.ExplicitCapture | RegexOptions.CultureInvariant, TIMEOUT_MILLISECONDS)]
  private static partial Regex Diagnostic { get; }

  [GeneratedRegex(@"\(\d+(,\d+)*\)$", RegexOptions.ExplicitCapture | RegexOptions.CultureInvariant,
    TIMEOUT_MILLISECONDS)]
  private static partial Regex Position { get; }

  public static RestoreDiagnostic? Parse(string line) {
    var match = Diagnostic.Match(line);
    if (!match.Success) {
      return null;
    }

    var level = string.Equals(match.Groups["level"].Value, ERROR, StringComparison.Ordinal)
      ? LogLevels.ERROR
      : LogLevels.WARNING;
    var origin = Position.Replace(match.Groups["origin"].Value, string.Empty);
    var built = match.Groups["project"].Success ? WithoutProperties(match.Groups["project"].Value) : null;
    return new RestoreDiagnostic(level, match.Groups["code"].Value, match.Groups["message"].Value,
      IsProject(origin) ? origin : built);
  }

  // In a solution restore the origin is the project the diagnostic is about and the bracket is the solution.
  private static bool IsProject(string path)
    => Path.GetExtension(path).EndsWith(PROJECT_EXTENSION_SUFFIX, StringComparison.OrdinalIgnoreCase);

  private static string WithoutProperties(string project) {
    var separator = project.IndexOf(PROPERTIES_SEPARATOR, StringComparison.Ordinal);
    return separator < 0 ? project : project[..separator];
  }
}
