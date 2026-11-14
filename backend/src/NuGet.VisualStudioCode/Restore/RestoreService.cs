// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   Picks the restore engine (the one asked for, else the configured one) and runs it.
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

    log.Write(LogLevels.INFO, LogContexts.BACKEND,
      $"Restore started: {target.Projects.Count} project(s) with the {engine.Name} engine.");
    var results = await engine.RestoreAsync(target, ct).ConfigureAwait(false);
    var failed = results.Count(result => string.Equals(result.Restore, RestoreStates.FAILED, StringComparison.Ordinal));
    log.Write(failed > 0 ? LogLevels.ERROR : LogLevels.INFO, LogContexts.BACKEND,
      $"Restore finished: {results.Count - failed} succeeded, {failed} failed.");
    return new OperationResult(engine.Name, false, results);
  }
}
