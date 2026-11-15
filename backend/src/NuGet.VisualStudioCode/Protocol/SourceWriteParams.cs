// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

internal sealed record SourceWriteParams(
  string? File,
  string Name,
  string? NewName,
  string? Source,
  bool? Enabled,
  bool? AllowInsecureConnections,
  bool? DisableTlsCertificateValidation
);
