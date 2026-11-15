// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Management.Automation;
using System.Text.Json.Serialization.Metadata;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Model;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>What every cmdlet of the console shares: the way to the editor, the projects and the failures.</summary>
public abstract class NuGetCmdlet : PSCmdlet, IDisposable {
  private readonly CancellationTokenSource _stop = new();

  internal static ConsoleClient Client => ConsoleSession.Client;

  internal static StringComparer PathComparer
    => OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

  /// <summary>Cancelled when the user stops the cmdlet.</summary>
  private CancellationToken StopToken => _stop.Token;

  public void Dispose() {
    _stop.Dispose();
    GC.SuppressFinalize(this);
  }

  /// <summary>What the cmdlet does, once for each object of the pipeline.</summary>
  protected abstract void Run();

  protected override sealed void ProcessRecord() {
    try {
      Run();
    }
    catch (ConsoleException exception) {
      ThrowTerminatingError(new ErrorRecord(exception, $"NuGetConsole.{exception.Code}", CategoryOf(exception.Code),
        null));
    }
    catch (OperationCanceledException) {
      throw new PipelineStoppedException();
    }
  }

  protected override void StopProcessing()
    => _stop.Cancel();

  internal TResult Ask<TResult>(string method, JsonTypeInfo<TResult> result)
    => Client.Request(method, result, StopToken);

  internal TResult Ask<TParams, TResult>(string method, TParams parameters, JsonTypeInfo<TParams> parametersInfo,
    JsonTypeInfo<TResult> result, Action<Wire.Progress>? progress = null)
    => Client.Request(method, parameters, parametersInfo, result, progress, StopToken);

  internal IReadOnlyList<Wire.SolutionProject> Projects()
    => Wire.OrEmpty(Ask(ConsoleRequestNames.PROJECTS, WireJsonContext.Default.ProjectList).Projects);

  /// <summary>The project with that name, or with that path. An unknown or ambiguous name is an error.</summary>
  internal static Wire.SolutionProject Find(IReadOnlyList<Wire.SolutionProject> projects, string name) {
    var byPath = projects.FirstOrDefault(project => PathComparer.Equals(project.Path, name));
    if (byPath is not null) {
      return byPath;
    }

    var named = projects.Where(project => string.Equals(project.Name, name, StringComparison.OrdinalIgnoreCase))
      .ToList();
    return named.Count switch {
      1 => named[0],
      0 => throw new ConsoleException(
        $"There is no project named '{name}'. The projects are: {string.Join(", ", projects.Select(project => project.Name))}."),
      var _ => throw new ConsoleException(
        $"More than one project is named '{name}'. Give its path: {string.Join(", ", named.Select(project => project.Path))}.")
    };
  }

  /// <summary>The default project; null when the console has none or it is no longer in the solution.</summary>
  internal static Wire.SolutionProject? Default(IReadOnlyList<Wire.SolutionProject> projects) {
    var path = ConsoleSession.DefaultProjectPath;
    return path is null ? null : projects.FirstOrDefault(project => PathComparer.Equals(project.Path, path));
  }

  /// <summary>The default project, for a cmdlet that cannot go without one.</summary>
  internal static Wire.SolutionProject RequiredDefault(IReadOnlyList<Wire.SolutionProject> projects) {
    var path = ConsoleSession.DefaultProjectPath ??
               throw new ConsoleException("There is no default project. Choose one with Set-Project.");
    return Default(projects) ??
           throw new ConsoleException(
             $"The default project is no longer in the solution: {path}. Choose another with Set-Project.");
  }

  internal static ConsoleProject Shown(Wire.SolutionProject project)
    => new(project.Name, project.Path, Wire.OrEmpty(project.Frameworks));

  internal void WarnOf(IReadOnlyList<Wire.FeedFailure>? failures) {
    foreach (var failure in Wire.OrEmpty(failures))
      WriteWarning($"{failure.Feed}: {failure.Message}");
  }

  private static ErrorCategory CategoryOf(string code)
    => code switch {
      ConsoleException.NOT_CONNECTED or "stopped" => ErrorCategory.ConnectionError,
      ConsoleException.INVALID_ARGUMENT or "invalidParams" => ErrorCategory.InvalidArgument,
      "noSolution" => ErrorCategory.ObjectNotFound,
      var _ => ErrorCategory.NotSpecified
    };
}
