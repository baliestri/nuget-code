// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

/// <summary>
///   With <c>Transitive</c>, the answer is about the transitive packages of the solution and not about the
///   ones the projects reference: the two are asked for apart, because the transitive ones are many.
/// </summary>
internal sealed record PackagesUpdatesParams(
  bool Prerelease,
  bool NoCache,
  string? ProgressToken,
  bool Transitive = false
);
