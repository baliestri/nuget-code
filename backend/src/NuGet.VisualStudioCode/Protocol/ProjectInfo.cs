// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

internal sealed record ProjectInfo(
  string Name,
  string Path,
  IReadOnlyList<string> Frameworks,
  bool CentralPackageManagement,
  string? Error
);
