// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Editing;

internal sealed record XmlAttributeSpan(
  string Name,
  string Value,
  int NameStart,
  int ValueStart,
  int ValueLength,
  char Quote
);
