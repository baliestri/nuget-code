// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

/// <summary>A version of a package that has known vulnerabilities, with the highest severity among them.</summary>
internal sealed record VulnerableVersion(string Version, string Severity);
