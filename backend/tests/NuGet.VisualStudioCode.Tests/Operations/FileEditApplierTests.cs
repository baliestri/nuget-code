// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Operations;

public sealed class FileEditApplierTests {
  private const string CONTENT = "<Project>\r\n  <A>1</A>\r\n</Project>\r\n";
  private const string EDITED = "<Project>\r\n  <A>22</A>\r\n</Project>\r\n";

  private static PlannedEdit EditOf(string file)
    => new(file, CONTENT.IndexOf('1', StringComparison.Ordinal), 1, "1", "22", 2);

  [Fact]
  public void Edits_are_written_to_every_file() {
    using var directory = new TempDirectory();
    var first = directory.WriteFile("a.props", CONTENT);
    var second = directory.WriteFile("b.props", CONTENT);

    var results = FileEditApplier.Apply([EditOf(first), EditOf(second)]);

    Assert.All(results, result => Assert.True(result.Applied));
    Assert.Equal(EDITED, File.ReadAllText(first));
    Assert.Equal(EDITED, File.ReadAllText(second));
  }

  [Fact]
  public void File_that_changed_after_planning_is_reported_stale_and_left_alone() {
    using var directory = new TempDirectory();
    var file = directory.WriteFile("a.props", CONTENT);
    var edit = EditOf(file);
    File.WriteAllText(file, "<Project>\r\n  <A>9</A>\r\n</Project>\r\n");

    var result = Assert.Single(FileEditApplier.Apply([edit]));

    Assert.False(result.Applied);
    Assert.True(result.Stale);
    Assert.Contains("<A>9</A>", File.ReadAllText(file), StringComparison.Ordinal);
  }

  [Fact]
  public void Read_only_file_fails_and_the_other_file_is_written() {
    using var directory = new TempDirectory();
    var locked = directory.WriteFile("a.props", CONTENT);
    var free = directory.WriteFile("b.props", CONTENT);
    File.SetAttributes(locked, FileAttributes.ReadOnly);
    try {
      var results = FileEditApplier.Apply([EditOf(locked), EditOf(free)]);

      var failed = results.Single(result => string.Equals(result.File, locked, StringComparison.Ordinal));
      Assert.False(failed.Applied);
      Assert.False(failed.Stale);
      Assert.False(string.IsNullOrWhiteSpace(failed.Error));
      Assert.Equal(CONTENT, File.ReadAllText(locked));
      Assert.Equal(EDITED, File.ReadAllText(free));
    }
    finally {
      File.SetAttributes(locked, FileAttributes.Normal);
    }
  }

  [Fact]
  public void Missing_file_fails_without_throwing() {
    using var directory = new TempDirectory();

    var result = Assert.Single(FileEditApplier.Apply([EditOf(directory.Combine("missing.props"))]));

    Assert.False(result.Applied);
  }
}
