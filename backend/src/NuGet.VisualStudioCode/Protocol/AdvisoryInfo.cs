// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

/// <summary>One known vulnerability of a package version: how severe it is and where it is described.</summary>
internal sealed record AdvisoryInfo(string Severity, string Url);
