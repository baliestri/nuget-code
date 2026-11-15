// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   Picks the restore engine (the one asked for, else the configured one) and runs it. Only the embedded engine
///   falls back, to the console engine, and only when it could not run at all: a project that failed to restore
///   is a result, not a reason to try again.
/// </summary>
internal sealed class RestoreService(
  IReadOnlyDictionary<string, IRestoreEngine> engines,
  BackendOptions options,
  BackendLog log
) {
  public async Task<OperationResult> RestoreAsync(RestoreTarget target, string? requestedEngine,
    CancellationToken ct) {
    var name = requestedEngine ?? options.RestoreEngine;
    if (!engines.TryGetValue(name, out var engine)) {
      throw new RpcException(RpcErrorCodes.UNKNOWN_RESTORE_ENGINE, $"Unknown restore engine '{name}'.");
    }

    Started(target, engine);
    var fellBack = false;
    IReadOnlyList<ProjectOperationResult> results;
    try {
      try {
        results = await engine.RestoreAsync(target, ct).ConfigureAwait(false);
      }
      catch (RestoreEngineException exception) when (FallbackFor(engine) is { } fallback) {
        log.Write(LogLevels.WARNING, LogContexts.BACKEND,
          $"The embedded restore could not run: {exception.Message} Falling back to the console engine.");
        engine = fallback;
        fellBack = true;
        Started(target, engine);
        results = await engine.RestoreAsync(target, ct).ConfigureAwait(false);
      }
    }
    catch (OperationCanceledException) {
      // A cancelled restore is an outcome the caller reports, with whatever it had already done kept.
      log.Write(LogLevels.WARNING, LogContexts.BACKEND, "Restore cancelled.");
      return new OperationResult(engine.Name, fellBack, target.Projects
        .Select(project => new ProjectOperationResult(project.Info.Path, [], [], RestoreStates.CANCELLED, []))
        .ToList());
    }

    var failed = results.Count(result => string.Equals(result.Restore, RestoreStates.FAILED, StringComparison.Ordinal));
    log.Write(failed > 0 ? LogLevels.ERROR : LogLevels.INFO, LogContexts.BACKEND,
      $"Restore finished: {results.Count - failed} succeeded, {failed} failed.");
    return new OperationResult(engine.Name, fellBack, results);
  }

  private IRestoreEngine? FallbackFor(IRestoreEngine engine)
    => string.Equals(engine.Name, RestoreEngineNames.EMBEDDED, StringComparison.Ordinal)
      ? engines.GetValueOrDefault(RestoreEngineNames.CONSOLE)
      : null;

  private void Started(RestoreTarget target, IRestoreEngine engine)
    => log.Write(LogLevels.INFO, LogContexts.BACKEND,
      $"Restore started: {target.Projects.Count} project(s) with the {engine.Name} engine.");
}
