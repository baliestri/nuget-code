// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;

namespace NuGet.VisualStudioCode.Tests.Restore;

internal sealed class FakeRestoreEngine(string name, string state = RestoreStates.SUCCEEDED, Exception? failure = null)
  : IRestoreEngine {
  public int Calls { get; private set; }

  public string Name => name;

  public Task<IReadOnlyList<ProjectOperationResult>> RestoreAsync(RestoreTarget target, CancellationToken ct) {
    Calls++;
    return failure is null
      ? Task.FromResult<IReadOnlyList<ProjectOperationResult>>([
        new ProjectOperationResult("App.csproj", [], [], state, [])
      ])
      : Task.FromException<IReadOnlyList<ProjectOperationResult>>(failure);
  }
}
