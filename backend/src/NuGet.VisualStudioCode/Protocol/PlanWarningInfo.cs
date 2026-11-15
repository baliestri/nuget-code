// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

internal sealed record PlanWarningInfo(
  string Kind,
  string PackageId,
  string? File,
  IReadOnlyList<string> Projects,
  IReadOnlyList<string> Packages,
  string? Detail
);
