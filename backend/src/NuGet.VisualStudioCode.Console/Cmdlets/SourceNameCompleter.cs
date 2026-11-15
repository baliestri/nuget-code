// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections;
using System.Management.Automation;
using System.Management.Automation.Language;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>Completes the name of a package source with the enabled sources of the solution.</summary>
public sealed class SourceNameCompleter : IArgumentCompleter {
  public IEnumerable<CompletionResult> CompleteArgument(string commandName, string parameterName,
    string wordToComplete, CommandAst commandAst, IDictionary fakeBoundParameters) {
    IReadOnlyList<Wire.SourceInfo> sources;
    try {
      sources = Wire.OrEmpty(
        ConsoleSession.Client.Request(ConsoleRequestNames.SOURCES, WireJsonContext.Default.SourceList).Sources);
    }
    catch (ConsoleException) {
      // Without the editor there is nothing to offer; the cmdlet itself says why when it runs.
      return [];
    }

    var typed = wordToComplete.Trim('\'', '"');
    return sources
      .Where(source => source.Enabled && source.Name.StartsWith(typed, StringComparison.OrdinalIgnoreCase))
      .OrderBy(source => source.Name, StringComparer.OrdinalIgnoreCase)
      .Select(source => new CompletionResult(
        source.Name.Contains(' ', StringComparison.Ordinal) ? $"'{source.Name}'" : source.Name,
        source.Name,
        CompletionResultType.ParameterValue,
        source.Source
      ))
      .ToList();
  }
}
