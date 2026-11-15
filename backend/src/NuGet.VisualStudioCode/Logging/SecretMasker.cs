// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.RegularExpressions;

namespace NuGet.VisualStudioCode.Logging;

internal static partial class SecretMasker {
  private const int TIMEOUT_MILLISECONDS = 1000;

  [GeneratedRegex(@"(?<scheme>[a-z][a-z0-9+.\-]*://)[^/\s:@]+:[^/\s@]+@",
    RegexOptions.IgnoreCase | RegexOptions.ExplicitCapture, TIMEOUT_MILLISECONDS)]
  private static partial Regex UserInfo { get; }

  [GeneratedRegex(@"(?<key>[?&](sig|signature|token|access_token|api[-_]?key|password|pwd|secret)=)[^&\s]+",
    RegexOptions.IgnoreCase | RegexOptions.ExplicitCapture, TIMEOUT_MILLISECONDS)]
  private static partial Regex QuerySecret { get; }

  public static string Mask(string text)
    => QuerySecret.Replace(UserInfo.Replace(text, "${scheme}***@"), "${key}***");
}
