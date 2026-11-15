// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;

namespace NuGet.VisualStudioCode.Console.Versions;

/// <summary>
///   A package version, read only as far as the console compares versions: up to four numbers and the
///   prerelease labels. The module carries no NuGet library, so that nothing of it can clash with what
///   PowerShell has loaded.
/// </summary>
internal sealed class PackageVersion {
  private readonly string[] _labels;
  private readonly int[] _numbers;

  private PackageVersion(string text, int[] numbers, string[] labels) {
    Text = text;
    _numbers = numbers;
    _labels = labels;
  }

  /// <summary>The version as it was written.</summary>
  public string Text { get; }

  public int Major => _numbers[0];
  public int Minor => _numbers[1];
  public bool IsPrerelease => _labels.Length > 0;

  /// <summary>Whether this version comes after the other in the order of NuGet.</summary>
  public bool IsNewerThan(PackageVersion other)
    => Compare(this, other) > 0;

  /// <summary>Reads a version; false for a range, a floating version or anything else that is not one.</summary>
  public static bool TryParse(string? text, out PackageVersion version) {
    version = null!;
    if (string.IsNullOrWhiteSpace(text)) {
      return false;
    }

    var trimmed = text.Trim();
    var metadata = trimmed.IndexOf('+', StringComparison.Ordinal);
    var core = metadata < 0 ? trimmed : trimmed[..metadata];
    var dash = core.IndexOf('-', StringComparison.Ordinal);
    var release = (dash < 0 ? core : core[..dash]).Split('.');
    var labels = dash < 0 ? [] : core[(dash + 1)..].Split('.');
    if (release.Length is < 1 or > 4 ||
        labels.Any(label => label.Length == 0)) {
      return false;
    }

    var numbers = new int[4];
    for (var index = 0; index < release.Length; index++)
      if (!int.TryParse(release[index], NumberStyles.None, CultureInfo.InvariantCulture, out numbers[index])) {
        return false;
      }

    version = new PackageVersion(trimmed, numbers, labels);
    return true;
  }

  public override string ToString()
    => Text;

  private static int Compare(PackageVersion left, PackageVersion right) {
    for (var index = 0; index < left._numbers.Length; index++) {
      var byNumber = left._numbers[index].CompareTo(right._numbers[index]);
      if (byNumber != 0) {
        return byNumber;
      }
    }

    // A release is newer than any of its prereleases.
    if (!left.IsPrerelease ||
        !right.IsPrerelease) {
      return right.IsPrerelease.CompareTo(left.IsPrerelease);
    }

    for (var index = 0; index < Math.Min(left._labels.Length, right._labels.Length); index++) {
      var byLabel = CompareLabels(left._labels[index], right._labels[index]);
      if (byLabel != 0) {
        return byLabel;
      }
    }

    return left._labels.Length.CompareTo(right._labels.Length);
  }

  private static int CompareLabels(string left, string right) {
    var leftIsNumber = int.TryParse(left, NumberStyles.None, CultureInfo.InvariantCulture, out var leftNumber);
    var rightIsNumber = int.TryParse(right, NumberStyles.None, CultureInfo.InvariantCulture, out var rightNumber);
    if (leftIsNumber && rightIsNumber) {
      return leftNumber.CompareTo(rightNumber);
    }

    // A numeric label is older than a textual one; textual ones compare as NuGet does, ignoring case.
    return leftIsNumber != rightIsNumber
      ? rightIsNumber.CompareTo(leftIsNumber)
      : string.Compare(left, right, StringComparison.OrdinalIgnoreCase);
  }
}
