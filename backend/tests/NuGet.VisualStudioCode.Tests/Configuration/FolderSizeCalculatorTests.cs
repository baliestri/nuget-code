// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Configuration;

public sealed class FolderSizeCalculatorTests {
  [Fact]
  public void Calculate_sums_files_in_nested_directories() {
    using var directory = new TempDirectory();
    directory.WriteFile("a.bin", new string('x', 10));
    directory.WriteFile(Path.Combine("nested", "deep", "b.bin"), new string('y', 32));

    var result = FolderSizeCalculator.Calculate(directory.Path, TestContext.Current.CancellationToken);

    Assert.True(result.Exists);
    Assert.Equal(42, result.Bytes);
  }

  [Fact]
  public void Calculate_reports_a_missing_directory_instead_of_failing() {
    using var directory = new TempDirectory();

    var result = FolderSizeCalculator.Calculate(directory.Combine("missing"), TestContext.Current.CancellationToken);

    Assert.False(result.Exists);
    Assert.Equal(0, result.Bytes);
  }

  [Fact]
  public async Task Calculate_stops_when_cancelled() {
    using var directory = new TempDirectory();
    directory.WriteFile("a.bin", "x");
    using var cancellation = new CancellationTokenSource();
    await cancellation.CancelAsync();
    var path = directory.Path;
    var token = cancellation.Token;

    Assert.Throws<OperationCanceledException>(() => FolderSizeCalculator.Calculate(path, token));
  }
}
