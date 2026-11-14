// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

/// <summary><see cref="Clearable" /> marks the folders that are caches: only those may be emptied.</summary>
internal sealed record FolderInfo(string Title, string Path, bool Clearable = false);
