// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Projects;

/// <summary>
///   What the last restore of a project resolved: the version of every package, and the packages the project
///   does not reference itself.
/// </summary>
internal sealed record ResolvedAssets(
  IReadOnlyDictionary<string, string> Resolved,
  IReadOnlyList<TransitivePackage> Transitive
);
