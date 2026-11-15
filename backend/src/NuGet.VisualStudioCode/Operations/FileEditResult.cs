// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Operations;

internal sealed record FileEditResult(string File, bool Applied, bool Stale, string? Error);
