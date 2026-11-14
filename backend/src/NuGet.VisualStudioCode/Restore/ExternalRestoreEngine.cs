// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.ComponentModel;
using NuGet.Configuration;
using NuGet.Credentials;
using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Credentials;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Sdk;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   Restores by starting <c>dotnet</c>: <c>dotnet msbuild -t:Restore</c> for the MSBuild engine and
///   <c>dotnet restore</c> for the console engine. What the process prints goes to the log line by line, and the
///   NuGet diagnostics in it become the result of each project.
/// </summary>
internal sealed class ExternalRestoreEngine(
  string name,
  SdkService sdk,
  SettingsProvider settings,
  HostCredentialProvider credentials,
  BackendLog log
) : IRestoreEngine {
  private const string FEED_UNAVAILABLE = "NU1301";
  private const string UNAUTHORIZED = "401";

  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  public string Name => name;

  public async Task<IReadOnlyList<ProjectOperationResult>> RestoreAsync(RestoreTarget target, CancellationToken ct) {
    var runner = sdk.GetRunner();
    var solution = target.Solution;
    if (target.WholeSolution &&
        solution.Kind is SolutionKind.Sln or SolutionKind.Slnx) {
      return await RestoreOneAsync(runner, solution.Path, solution.Directory, target.Projects, target.Force, ct)
        .ConfigureAwait(false);
    }

    var results = new List<ProjectOperationResult>();
    foreach (var project in target.Projects)
      results.AddRange(await RestoreOneAsync(runner, project.Info.Path, solution.Directory, [project], target.Force, ct)
        .ConfigureAwait(false));

    return results;
  }

  private async Task<IReadOnlyList<ProjectOperationResult>> RestoreOneAsync(DotnetRunner runner, string file,
    string directory, IReadOnlyList<EvaluatedProject> projects, bool force, CancellationToken ct) {
    var run = await RunAsync(runner, file, directory, force, ct).ConfigureAwait(false);
    if (await AuthenticateAsync(run, ct).ConfigureAwait(false)) {
      run = await RunAsync(runner, file, directory, force, ct).ConfigureAwait(false);
    }

    return Results(run, projects);
  }

  private async Task<Run> RunAsync(DotnetRunner runner, string file, string directory, bool force,
    CancellationToken ct) {
    var carried = RestoreCredentialEnvironment.Build(settings.Load(), credentials.Known);
    foreach (var source in carried.Skipped)
      log.Write(LogLevels.WARNING, LogContexts.BACKEND,
        $"The credentials of the source '{source}' cannot be passed to dotnet: its name is not usable in an environment variable.");

    var diagnostics = new ConcurrentQueue<RestoreDiagnostic>();
    var unauthorized = new StrongFlag();
    try {
      var result = await runner.RunAsync(Arguments(file, force), directory, ct, carried.Environment,
        line => Observe(line, diagnostics, unauthorized)).ConfigureAwait(false);
      return new Run(result.ExitCode, [.. diagnostics.Distinct()], unauthorized.Value);
    }
    catch (Win32Exception exception) {
      throw new RestoreEngineException(exception.Message, exception);
    }
  }

  private List<string> Arguments(string file, bool force) {
    if (string.Equals(name, RestoreEngineNames.MSBUILD, StringComparison.Ordinal)) {
      List<string> msbuild = ["msbuild", file, "-t:Restore", "-nologo", "-v:m", "-nodeReuse:false", "-tl:off"];
      if (force) {
        msbuild.Add("-p:RestoreForce=true");
      }

      return msbuild;
    }

    List<string> console = ["restore", file, "-tl:off"];
    if (force) {
      console.Add("--force");
    }

    return console;
  }

  private void Observe(string line, ConcurrentQueue<RestoreDiagnostic> diagnostics, StrongFlag unauthorized) {
    if (string.IsNullOrWhiteSpace(line)) {
      return;
    }

    if (line.Contains(UNAUTHORIZED, StringComparison.Ordinal)) {
      unauthorized.Value = true;
    }

    var diagnostic = RestoreDiagnosticParser.Parse(line);
    if (diagnostic is not null) {
      diagnostics.Enqueue(diagnostic);
    }

    log.Write(diagnostic?.Level ?? LogLevels.INFO, LogContexts.NUGET, line.TrimEnd());
  }

  // A feed that answered 401 and has no credentials yet: ask the host once, then the restore is run again.
  private async Task<bool> AuthenticateAsync(Run run, CancellationToken ct) {
    if (!run.Unauthorized ||
        !run.Diagnostics.Any(IsFeedUnavailable)) {
      return false;
    }

    var obtained = false;
    foreach (var source in PackageSourceProvider.LoadPackageSources(settings.Load())) {
      if (!source.IsEnabled ||
          !source.IsHttp ||
          credentials.Known.ContainsKey(source.SourceUri.GetLeftPart(UriPartial.Authority)) ||
          !run.Diagnostics.Any(diagnostic
            => IsFeedUnavailable(diagnostic) && diagnostic.Message.Contains(source.Source, StringComparison.Ordinal))) {
        continue;
      }

      var response = await credentials
        .GetAsync(source.SourceUri, null, CredentialRequestType.Unauthorized, null, false, false, ct)
        .ConfigureAwait(false);
      obtained |= response.Status == CredentialStatus.Success;
    }

    return obtained;
  }

  private static bool IsFeedUnavailable(RestoreDiagnostic diagnostic)
    => string.Equals(diagnostic.Code, FEED_UNAVAILABLE, StringComparison.Ordinal);

  private static List<ProjectOperationResult> Results(Run run, IReadOnlyList<EvaluatedProject> projects) {
    var attributed = run.Diagnostics
      .Where(diagnostic => projects.Any(project => PathComparer.Equals(project.Info.Path, diagnostic.Project)))
      .ToList();
    var shared = run.Diagnostics.Except(attributed).ToList();
    var anyError = run.Diagnostics.Any(IsError);
    return projects.Select(project =>
    {
      var own = attributed
        .Where(diagnostic => PathComparer.Equals(project.Info.Path, diagnostic.Project))
        .Concat(shared)
        .ToList();
      var messages = own
        .Select(diagnostic => new RestoreMessageInfo(diagnostic.Level, diagnostic.Code, diagnostic.Message))
        .ToList();
      if (run.ExitCode != 0 &&
          !anyError) {
        messages.Add(new RestoreMessageInfo(LogLevels.ERROR, null, $"restore exited with code {run.ExitCode}"));
      }

      var state = messages.Exists(message => string.Equals(message.Level, LogLevels.ERROR, StringComparison.Ordinal))
        ? RestoreStates.FAILED
        : messages.Count > 0
          ? RestoreStates.SUCCEEDED_WITH_WARNINGS
          : RestoreStates.SUCCEEDED;
      return new ProjectOperationResult(project.Info.Path, [], [], state, messages);
    }).ToList();
  }

  private static bool IsError(RestoreDiagnostic diagnostic)
    => string.Equals(diagnostic.Level, LogLevels.ERROR, StringComparison.Ordinal);

  private sealed record Run(int ExitCode, IReadOnlyList<RestoreDiagnostic> Diagnostics, bool Unauthorized);

  private sealed class StrongFlag {
    private volatile bool _value;

    public bool Value {
      get => _value;
      set => _value = value;
    }
  }
}
