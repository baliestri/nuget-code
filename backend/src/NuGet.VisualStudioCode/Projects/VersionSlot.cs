// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Editing;

namespace NuGet.VisualStudioCode.Projects;

/// <summary>
///   Where the text of one declared version is: the value of a <c>Version</c> attribute or the content of a
///   <c>Version</c> child element. <see cref="PositionStart" /> is what is reported to the user as the declaration.
/// </summary>
internal sealed record VersionSlot(
  string File,
  XmlElementSpan Element,
  int ValueStart,
  int ValueLength,
  string Value,
  int PositionStart
);
