// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Operations;

internal sealed record PlanWarning(
  string Kind,
  string PackageId,
  string? File,
  IReadOnlyList<string> Projects,
  IReadOnlyList<string> Packages,
  string? Detail
);
