// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

/// <summary>
///   A package a project has without referencing it: it comes with another package, or with a referenced
///   project. <c>Via</c> names the packages the project references through which it arrives.
/// </summary>
internal sealed record TransitivePackage(
  string Id,
  string ResolvedVersion,
  IReadOnlyList<string> Frameworks,
  IReadOnlyList<string> Via
);
