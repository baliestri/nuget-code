// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Solutions;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.Tests.Solutions;

public sealed class SolutionReaderTests {
  [Fact]
  public async Task Slnx_lists_its_projects_as_absolute_paths() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var app = SampleSolution.WriteProject(directory, "App");
    var lib = SampleSolution.WriteProject(directory, "Lib");
    var solution = SampleSolution.WriteSlnx(directory, "Sample", "Lib", "App");

    var descriptor = await SolutionReader.ReadAsync(solution, null, ct);

    Assert.Equal(SolutionKind.Slnx, descriptor.Kind);
    Assert.Equal(directory.Path, descriptor.Directory, true);
    Assert.Equal([app, lib], descriptor.ProjectPaths, StringComparer.Ordinal);
  }

  [Fact]
  public async Task Sln_lists_its_projects() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var app = SampleSolution.WriteProject(directory, "App");
    var solution = SampleSolution.WriteSln(directory, "Sample", "App");

    var descriptor = await SolutionReader.ReadAsync(solution, null, ct);

    Assert.Equal(SolutionKind.Sln, descriptor.Kind);
    Assert.Equal([app], descriptor.ProjectPaths, StringComparer.Ordinal);
  }

  [Fact]
  public async Task Slnf_keeps_only_the_filtered_projects_relative_to_the_solution_directory() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var app = SampleSolution.WriteProject(directory, "App");
    SampleSolution.WriteProject(directory, "Lib");
    SampleSolution.WriteSlnx(directory, "Sample", "App", "Lib");
    var filter = SampleSolution.WriteSlnf(directory, "OnlyApp", "Sample.slnx", "App");

    var descriptor = await SolutionReader.ReadAsync(filter, null, ct);

    Assert.Equal(SolutionKind.Slnf, descriptor.Kind);
    Assert.Equal(filter, descriptor.Path);
    Assert.Equal([app], descriptor.ProjectPaths, StringComparer.Ordinal);
  }

  [Fact]
  public async Task Implicit_solution_uses_the_projects_given_by_the_host() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var app = SampleSolution.WriteProject(directory, "App");
    var lib = SampleSolution.WriteProject(directory, "Lib");

    var descriptor = await SolutionReader.ReadAsync(directory.Path, [lib, app, app], ct);

    Assert.Equal(SolutionKind.Implicit, descriptor.Kind);
    Assert.Equal(directory.Path, descriptor.Directory, true);
    Assert.Equal([app, lib], descriptor.ProjectPaths, StringComparer.Ordinal);
  }

  [Theory]
  [InlineData("missing.slnx")]
  [InlineData("notes.txt")]
  public async Task Unreadable_input_is_reported_as_solution_unreadable(string fileName) {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    directory.WriteFile("notes.txt", "not a solution");
    var path = directory.Combine(fileName);

    var exception = await Assert.ThrowsAsync<RpcException>(() => SolutionReader.ReadAsync(path, null, ct));

    Assert.Equal(RpcErrorCodes.SOLUTION_UNREADABLE, exception.Code);
  }

  [Fact]
  public async Task Malformed_slnx_is_reported_as_solution_unreadable() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var solution = directory.WriteFile("Broken.slnx", "<Solution><Project");

    var exception = await Assert.ThrowsAsync<RpcException>(() => SolutionReader.ReadAsync(solution, null, ct));

    Assert.Equal(RpcErrorCodes.SOLUTION_UNREADABLE, exception.Code);
  }
}
