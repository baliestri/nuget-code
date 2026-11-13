// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

internal sealed record PackageDetailsResult(
  string Id,
  IReadOnlyList<string> Versions,
  string? Description,
  string? Authors,
  string? License,
  string? LicenseUrl,
  string? ProjectUrl,
  string? IconUrl,
  IReadOnlyList<DependencyGroupInfo> DependencyGroups,
  string? Feed,
  IReadOnlyList<FeedFailure> Failures
);
