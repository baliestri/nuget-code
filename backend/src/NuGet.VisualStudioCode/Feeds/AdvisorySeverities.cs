// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Protocol;

namespace NuGet.VisualStudioCode.Feeds;

internal static class AdvisorySeverities {
  public const string LOW = "low";
  public const string MODERATE = "moderate";
  public const string HIGH = "high";
  public const string CRITICAL = "critical";
  public const string UNKNOWN = "unknown";

  public static string From(PackageVulnerabilitySeverity severity)
    => severity switch {
      PackageVulnerabilitySeverity.Low => LOW,
      PackageVulnerabilitySeverity.Moderate => MODERATE,
      PackageVulnerabilitySeverity.High => HIGH,
      PackageVulnerabilitySeverity.Critical => CRITICAL,
      var _ => UNKNOWN
    };

  /// <summary>How severities compare: the higher the worse. One that is not known is below every known one.</summary>
  public static int Rank(string severity)
    => severity switch {
      CRITICAL => 4,
      HIGH => 3,
      MODERATE => 2,
      LOW => 1,
      var _ => 0
    };
}
