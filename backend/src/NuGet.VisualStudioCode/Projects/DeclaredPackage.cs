// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Projects;

internal sealed record DeclaredPackage(
  string Id,
  string? RequestedVersion,
  IReadOnlyList<string> Frameworks,
  bool Implicit
);
