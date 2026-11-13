// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Projects;

internal sealed record ChangeImpact(
  bool Solution,
  IReadOnlyCollection<string> Projects,
  IReadOnlyCollection<string> AssetsProjects
) {
  public bool IsEmpty => !Solution && Projects.Count == 0 && AssetsProjects.Count == 0;
}
