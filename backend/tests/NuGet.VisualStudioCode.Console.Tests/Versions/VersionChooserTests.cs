// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Console.Versions;

namespace NuGet.VisualStudioCode.Console.Tests.Versions;

public sealed class VersionChooserTests {
  private readonly static string[] Available =
    ["2.1.0-beta", "2.0.0", "1.3.0", "1.2.9", "1.2.4-rc.1", "1.2.3", "1.0.0"];

  private static string? Choose(string installed, VersionBound bound, bool prerelease = false,
    IEnumerable<string>? available = null) {
    Assert.True(PackageVersion.TryParse(installed, out var version));
    return VersionChooser.Choose(available ?? Available, version, bound, prerelease)?.Text;
  }

  [Fact]
  public void Without_a_bound_it_is_the_newest_stable_version()
    => Assert.Equal("2.0.0", Choose("1.2.3", VersionBound.None));

  [Fact]
  public void Minor_keeps_the_major()
    => Assert.Equal("1.3.0", Choose("1.2.3", VersionBound.Minor));

  [Fact]
  public void Patch_keeps_the_major_and_the_minor()
    => Assert.Equal("1.2.9", Choose("1.2.3", VersionBound.Patch));

  [Fact]
  public void Prereleases_count_only_when_asked() {
    Assert.Equal("2.1.0-beta", Choose("1.2.3", VersionBound.None, true));
    Assert.Equal("1.2.4-rc.1", Choose("1.2.3", VersionBound.Patch, true, ["1.2.4-rc.1", "1.2.3"]));
    Assert.Null(Choose("1.2.3", VersionBound.Patch, false, ["1.2.4-rc.1", "1.2.3"]));
  }

  [Theory]
  [InlineData("2.0.0", nameof(VersionBound.None))]
  [InlineData("1.3.0", nameof(VersionBound.Minor))]
  [InlineData("1.2.9", nameof(VersionBound.Patch))]
  public void Nothing_newer_within_the_bound_is_no_choice(string installed, string bound)
    => Assert.Null(Choose(installed, Enum.Parse<VersionBound>(bound)));

  [Fact]
  public void An_installed_version_the_sources_do_not_list_is_still_compared()
    => Assert.Equal("1.2.9", Choose("1.2.5", VersionBound.Patch));

  [Fact]
  public void The_order_of_the_list_does_not_matter_and_what_is_not_a_version_is_skipped()
    => Assert.Equal("1.10.0", Choose("1.2.0", VersionBound.Minor, false, ["1.9.0", "latest", "1.10.0", "1.2.0"]));

  [Theory]
  [InlineData("1.0.0", "1.0.0-rc.1")]
  [InlineData("1.0.0-rc.2", "1.0.0-rc.1")]
  [InlineData("1.0.0-rc.10", "1.0.0-rc.9")]
  [InlineData("1.0.0-rc.1", "1.0.0-beta")]
  [InlineData("1.0.0-beta.1", "1.0.0-beta")]
  [InlineData("1.0.0-beta", "1.0.0-1")]
  [InlineData("1.0.0.1", "1.0.0")]
  [InlineData("1.10", "1.9.5")]
  public void Versions_are_ordered_as_NuGet_orders_them(string newer, string older) {
    Assert.True(PackageVersion.TryParse(newer, out var left));
    Assert.True(PackageVersion.TryParse(older, out var right));

    Assert.True(left.IsNewerThan(right));
    Assert.False(right.IsNewerThan(left));
  }

  [Fact]
  public void Build_metadata_and_letter_case_do_not_make_a_version_newer() {
    Assert.True(PackageVersion.TryParse("1.0.0-RC+build.5", out var left));
    Assert.True(PackageVersion.TryParse("1.0.0-rc", out var right));

    Assert.False(left.IsNewerThan(right));
    Assert.False(right.IsNewerThan(left));
  }

  [Theory]
  [InlineData("2.*")]
  [InlineData("[1.0.0, 2.0.0)")]
  [InlineData("1.0.0.0.0")]
  [InlineData("1.x")]
  [InlineData("1.0.0-")]
  [InlineData("")]
  [InlineData(null)]
  public void What_is_not_one_version_is_not_read(string? text)
    => Assert.False(PackageVersion.TryParse(text, out var _));
}
