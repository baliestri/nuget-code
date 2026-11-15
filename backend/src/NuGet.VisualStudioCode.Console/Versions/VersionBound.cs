// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Console.Versions;

/// <summary>How far from the installed version an update may go.</summary>
internal enum VersionBound {
  /// <summary>To the newest version.</summary>
  None,

  /// <summary>To the newest version with the same major: <c>-ToHighestMinor</c>.</summary>
  Minor,

  /// <summary>To the newest version with the same major and minor: <c>-ToHighestPatch</c>, <c>-Safe</c>.</summary>
  Patch
}
