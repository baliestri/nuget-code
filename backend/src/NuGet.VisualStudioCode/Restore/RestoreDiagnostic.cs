// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Restore;

internal sealed record RestoreDiagnostic(string Level, string Code, string Message, string? Project);
