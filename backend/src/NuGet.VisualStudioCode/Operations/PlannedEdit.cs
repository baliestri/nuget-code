// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Operations;

internal sealed record PlannedEdit(string File, int Start, int Length, string OldText, string NewText, int Line);
