// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections;
using System.Management.Automation;
using System.Management.Automation.Language;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>Completes the name of a project with the projects of the open solution.</summary>
public sealed class ProjectNameCompleter : IArgumentCompleter {
  public IEnumerable<CompletionResult> CompleteArgument(string commandName, string parameterName,
    string wordToComplete, CommandAst commandAst, IDictionary fakeBoundParameters) {
    IReadOnlyList<Wire.SolutionProject> projects;
    try {
      projects = Wire.OrEmpty(
        ConsoleSession.Client.Request(ConsoleRequestNames.PROJECTS, WireJsonContext.Default.ProjectList).Projects);
    }
    catch (ConsoleException) {
      // Without the editor there is nothing to offer; the cmdlet itself says why when it runs.
      return [];
    }

    var typed = wordToComplete.Trim('\'', '"');
    return projects
      .Where(project => project.Name.StartsWith(typed, StringComparison.OrdinalIgnoreCase))
      .OrderBy(project => project.Name, StringComparer.OrdinalIgnoreCase)
      .Select(project => new CompletionResult(
        project.Name.Contains(' ', StringComparison.Ordinal) ? $"'{project.Name}'" : project.Name,
        project.Name,
        CompletionResultType.ParameterValue,
        project.Path
      ))
      .ToList();
  }
}
