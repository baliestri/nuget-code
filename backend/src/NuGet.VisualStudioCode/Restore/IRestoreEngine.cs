// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   One way of restoring. A project that fails to restore is a result, not an exception; an engine throws
///   <see cref="RestoreEngineException" /> only when it could not run at all.
/// </summary>
internal interface IRestoreEngine {
  string Name { get; }

  Task<IReadOnlyList<ProjectOperationResult>> RestoreAsync(RestoreTarget target, CancellationToken ct);
}
