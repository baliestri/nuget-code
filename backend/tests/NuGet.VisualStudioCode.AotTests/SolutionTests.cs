// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class SolutionTests(PublishedBackend backend) {
  private static Task<SolutionOpenResult> OpenAsync(BackendClient client, string path, IReadOnlyList<string>? projects,
    CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.SOLUTION_OPEN, new SolutionOpenParams(path, projects),
      ProtocolJsonContext.Default.SolutionOpenParams, ProtocolJsonContext.Default.SolutionOpenResult, ct);

  [Theory]
  [InlineData("slnx")]
  [InlineData("sln")]
  public async Task Open_reads_solution_files_under_aot(string kind) {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var app = SampleSolution.WriteProject(directory, "App");
    var lib = SampleSolution.WriteProject(directory, "Lib");
    var solution = string.Equals(kind, "slnx", StringComparison.Ordinal)
      ? SampleSolution.WriteSlnx(directory, "Sample", "App", "Lib")
      : SampleSolution.WriteSln(directory, "Sample", "App", "Lib");
    await using var client = BackendClient.Start(backend, directory.Path);
    await client.InitializeAsync(ct);

    var result = await OpenAsync(client, solution, null, ct);

    Assert.Equal(kind, result.Kind);
    Assert.Equal([app, lib], result.Projects.Select(project => project.Path), StringComparer.Ordinal);
    Assert.Equal(["App", "Lib"], result.Projects.Select(project => project.Name), StringComparer.Ordinal);
  }

  [Fact]
  public async Task Open_reads_a_solution_filter_and_an_implicit_solution() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var app = SampleSolution.WriteProject(directory, "App");
    var lib = SampleSolution.WriteProject(directory, "Lib");
    SampleSolution.WriteSlnx(directory, "Sample", "App", "Lib");
    var filter = SampleSolution.WriteSlnf(directory, "OnlyApp", "Sample.slnx", "App");
    await using var client = BackendClient.Start(backend, directory.Path);
    await client.InitializeAsync(ct);

    var filtered = await OpenAsync(client, filter, null, ct);
    var implicitSolution = await OpenAsync(client, directory.Path, [app, lib], ct);

    Assert.Equal("slnf", filtered.Kind);
    Assert.Equal([app], filtered.Projects.Select(project => project.Path), StringComparer.Ordinal);
    Assert.Equal("implicit", implicitSolution.Kind);
    Assert.Equal([app, lib], implicitSolution.Projects.Select(project => project.Path), StringComparer.Ordinal);
  }

  [Fact]
  public async Task Close_ends_the_session_and_open_of_a_missing_file_fails() {
    var ct = TestContext.Current.CancellationToken;
    using var directory = new TempDirectory();
    var missing = directory.Combine("Missing.slnx");
    await using var client = BackendClient.Start(backend, directory.Path);
    await client.InitializeAsync(ct);

    var exception = await Assert.ThrowsAsync<RpcException>(() => OpenAsync(client, missing, null, ct));
    await client.Connection.RequestAsync(MethodNames.SOLUTION_CLOSE, new Empty(), ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty, ct);

    Assert.Equal(RpcErrorCodes.SOLUTION_UNREADABLE, exception.Code);
  }
}
