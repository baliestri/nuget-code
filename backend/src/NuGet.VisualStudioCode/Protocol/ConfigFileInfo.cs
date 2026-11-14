// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

/// <summary>
///   One configuration file of the hierarchy. The two folder values are the ones declared in this file, as
///   written; the resolved folders are on <see cref="SourcesListResult" />.
/// </summary>
internal sealed record ConfigFileInfo(
  string Path,
  IReadOnlyList<FeedInfo> Feeds,
  bool Writable,
  bool IsMachineWide,
  string? GlobalPackagesFolder,
  string? RepositoryPath
);
