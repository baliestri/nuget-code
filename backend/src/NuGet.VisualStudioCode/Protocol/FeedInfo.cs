// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

internal sealed record FeedInfo(
  string Name,
  string Source,
  bool Enabled,
  bool AllowInsecureConnections,
  int ProtocolVersion,
  bool IsLocal,
  bool DisableTlsCertificateValidation,
  bool IsMachineWide,
  string? DeclaredIn
);
