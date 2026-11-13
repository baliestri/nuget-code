// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

internal sealed record PackageSummary(
  string Id,
  string Version,
  string? Description,
  string? Authors,
  string? IconUrl,
  long? DownloadCount,
  string Feed
);
