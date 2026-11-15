// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Solutions;

internal sealed record SolutionDescriptor(
  string Path,
  string Directory,
  SolutionKind Kind,
  IReadOnlyList<string> ProjectPaths
);
