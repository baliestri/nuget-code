// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Restore;

internal sealed class RestoreEngineException(string message, Exception inner) : Exception(message, inner);
