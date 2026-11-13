// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Sdk;

namespace NuGet.VisualStudioCode.Tests.Sdk;

public sealed class DotnetLocatorTests {
  private readonly static string Executable = OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet";

  private static Func<string, string?> Variables(string? dotnetRoot, string? path)
    => name => name switch {
      "DOTNET_ROOT" => dotnetRoot,
      "PATH" => path,
      var _ => null
    };

  [Fact]
  public void Configured_path_wins_when_it_exists() {
    var configured = Path.Combine("custom", Executable);

    var found = DotnetLocator.Find(configured, Variables("root", "bin"), _ => true);

    Assert.Equal(configured, found);
  }

  [Fact]
  public void Configured_path_that_does_not_exist_is_not_replaced_by_a_fallback() {
    var found = DotnetLocator.Find(
      Path.Combine("missing", Executable),
      Variables("root", "bin"),
      path => path.StartsWith("root", StringComparison.Ordinal)
    );

    Assert.Null(found);
  }

  [Fact]
  public void DOTNET_ROOT_is_used_before_PATH() {
    var expected = Path.Combine("root", Executable);

    var found = DotnetLocator.Find(null, Variables("root", "bin"), _ => true);

    Assert.Equal(expected, found);
  }

  [Fact]
  public void PATH_entries_are_searched_in_order() {
    var path = string.Join(Path.PathSeparator, "first", "second");
    var expected = Path.Combine("second", Executable);

    var found = DotnetLocator.Find(
      null,
      Variables(null, path),
      candidate => string.Equals(candidate, expected, StringComparison.Ordinal)
    );

    Assert.Equal(expected, found);
  }

  [Fact]
  public void Returns_null_when_nothing_is_found()
    => Assert.Null(DotnetLocator.Find(null, Variables(null, "first"), _ => false));
}
