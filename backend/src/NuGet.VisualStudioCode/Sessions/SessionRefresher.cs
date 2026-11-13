// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Sessions;

internal sealed class SessionRefresher : IDisposable {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  private readonly HashSet<string> _assets = new(PathComparer);
  private readonly Debouncer _debouncer;
  private readonly ProjectEvaluator _evaluator;
  private readonly Lock _lock = new();
  private readonly BackendLog _log;
  private readonly Func<SolutionDidChangeParams, Task> _notify;
  private readonly HashSet<string> _projects = new(PathComparer);
  private readonly SessionManager _sessions;

  private bool _solution;
  private long _version;

  public SessionRefresher(SessionManager sessions, ProjectEvaluator evaluator, BackendLog log,
    Func<SolutionDidChangeParams, Task> notify, TimeSpan delay) {
    _sessions = sessions;
    _evaluator = evaluator;
    _log = log;
    _notify = notify;
    _debouncer = new Debouncer(delay, RefreshAsync);
  }

  public void Dispose()
    => _debouncer.Dispose();

  public void Report(IReadOnlyList<string> changedPaths) {
    var session = _sessions.Current;
    if (session is null) {
      return;
    }

    var impact = ChangeClassifier.Classify(session, changedPaths);
    if (impact.IsEmpty) {
      return;
    }

    lock (_lock) {
      _solution |= impact.Solution;
      _projects.UnionWith(impact.Projects);
      _assets.UnionWith(impact.AssetsProjects);
      _version++;
    }

    _debouncer.Trigger();
  }

  private async Task RefreshAsync(CancellationToken ct) {
    var session = _sessions.Current;
    if (session is null) {
      return;
    }

    bool solution;
    List<string> projects;
    List<string> assets;
    long version;
    lock (_lock) {
      solution = _solution;
      projects = [.. _projects];
      assets = [.. _assets];
      version = _version;
    }

    IReadOnlyList<string> changed;
    try {
      changed = solution
        ? await RefreshSolutionAsync(session, ct).ConfigureAwait(false)
        : await RefreshProjectsAsync(session, projects, assets, ct).ConfigureAwait(false);
    }
    catch (RpcException exception) {
      _log.Write(LogLevels.ERROR, LogContexts.BACKEND,
        $"Re-evaluation failed: {exception.Message} {exception.ErrorData}");
      return;
    }

    lock (_lock) {
      if (_version == version) {
        _solution = false;
        _projects.Clear();
        _assets.Clear();
      }
    }

    if (changed.Count > 0) {
      await _notify(new SolutionDidChangeParams(changed)).ConfigureAwait(false);
    }
  }

  private async Task<IReadOnlyList<string>> RefreshSolutionAsync(Session session, CancellationToken ct) {
    var previous = session.Solution;
    var isImplicit = previous.Kind == SolutionKind.Implicit;
    var solution = await SolutionReader.ReadAsync(isImplicit ? previous.Directory : previous.Path,
      isImplicit ? previous.ProjectPaths : null, ct).ConfigureAwait(false);
    var models = await _evaluator.EvaluateAsync(solution, ct).ConfigureAwait(false);
    ct.ThrowIfCancellationRequested();
    return _sessions.TryReplace(session, new Session(solution, models))
      ? models.Select(model => model.Info.Path).ToList()
      : [];
  }

  private async Task<IReadOnlyList<string>> RefreshProjectsAsync(Session session, List<string> projects,
    List<string> assets, CancellationToken ct) {
    var models = session.Projects.ToList();
    foreach (var path in projects) {
      var index = models.FindIndex(model => PathComparer.Equals(model.Info.Path, path));
      if (index >= 0) {
        models[index] = await _evaluator.EvaluateProjectAsync(path, session.Solution.Directory, ct)
          .ConfigureAwait(false);
      }
    }

    ct.ThrowIfCancellationRequested();
    if (projects.Count > 0 &&
        !_sessions.TryReplace(session, session with { Projects = models })) {
      return [];
    }

    return projects.Union(assets, PathComparer).Order(PathComparer).ToList();
  }
}
