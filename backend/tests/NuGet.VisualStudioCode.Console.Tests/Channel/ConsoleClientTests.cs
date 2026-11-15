// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Reflection;
using System.Text.Json;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Tests.Support;

namespace NuGet.VisualStudioCode.Console.Tests.Channel;

public sealed class ConsoleClientTests {
  private const string PROJECTS =
    """{"projects":[{"name":"App","path":"/work/App.csproj","frameworks":["net10.0"]}]}""";

  [Fact]
  public async Task The_client_sends_the_token_and_reads_the_result() {
    await using var server = new FakeConsoleServer().On(ConsoleRequestNames.PROJECTS, PROJECTS);
    var client = new ConsoleClient(server.Address, server.Token);

    var result = client.Request(ConsoleRequestNames.PROJECTS, WireJsonContext.Default.ProjectList,
      TestContext.Current.CancellationToken);

    var project = Assert.Single(Wire.OrEmpty(result.Projects));
    Assert.Equal("App", project.Name);
    Assert.Equal("/work/App.csproj", project.Path);
    Assert.Equal(["net10.0"], project.Frameworks);
    Assert.Equal([new FakeRequest(ConsoleRequestNames.PROJECTS, "{}")], server.Requests);
  }

  [Fact]
  public async Task The_params_are_sent_in_camel_case_without_what_is_null() {
    await using var server =
      new FakeConsoleServer().On(ConsoleRequestNames.SEARCH, """{"packages":[],"failures":[]}""");
    var client = new ConsoleClient(server.Address, server.Token);

    client.Request(ConsoleRequestNames.SEARCH, new Wire.SearchParams("json", null, true, 0, 20),
      WireJsonContext.Default.SearchParams, WireJsonContext.Default.Search,
      ct: TestContext.Current.CancellationToken);

    Assert.Equal(["""{"query":"json","prerelease":true,"skip":0,"take":20}"""],
      server.ParamsOf(ConsoleRequestNames.SEARCH));
  }

  [Fact]
  public async Task Progress_lines_reach_the_callback_before_the_result() {
    await using var server = new FakeConsoleServer().On(ConsoleRequestNames.RESTORE, _
      => FakeAnswer.Of("""{"fellBack":false,"projects":[]}""")
        .After("""{"step":"planning"}""", """{"step":"restoring","project":"/work/App.csproj"}"""));
    var client = new ConsoleClient(server.Address, server.Token);
    var steps = new List<Wire.Progress>();

    var result = client.Request(ConsoleRequestNames.RESTORE, new Wire.RestoreParams(null, false),
      WireJsonContext.Default.RestoreParams, WireJsonContext.Default.Operation, steps.Add,
      TestContext.Current.CancellationToken);

    Assert.Equal([new Wire.Progress("planning", null), new Wire.Progress("restoring", "/work/App.csproj")], steps);
    Assert.False(result.FellBack);
  }

  [Fact]
  public async Task An_error_answer_becomes_an_exception_with_its_code_and_message() {
    await using var server = new FakeConsoleServer().On(ConsoleRequestNames.INSTALLED, _
      => FakeAnswer.Failed("noSolution", "No solution is open in the editor."));
    var client = new ConsoleClient(server.Address, server.Token);

    var exception = Assert.Throws<ConsoleException>(() => client.Request(ConsoleRequestNames.INSTALLED,
      WireJsonContext.Default.Installed, TestContext.Current.CancellationToken));

    Assert.Equal("noSolution", exception.Code);
    Assert.Equal("No solution is open in the editor.", exception.Message);
  }

  [Fact]
  public async Task A_refused_token_says_to_open_the_console_again() {
    await using var server = new FakeConsoleServer().On(ConsoleRequestNames.PROJECTS, PROJECTS);
    var client = new ConsoleClient(server.Address, "another-token");

    var exception = Assert.Throws<ConsoleException>(() => client.Request(ConsoleRequestNames.PROJECTS,
      WireJsonContext.Default.ProjectList, TestContext.Current.CancellationToken));

    Assert.Equal(ConsoleException.NOT_CONNECTED, exception.Code);
    Assert.Contains("Open the Package Manager Console again", exception.Message, StringComparison.Ordinal);
    Assert.Empty(server.Requests);
  }

  [Fact]
  public async Task A_channel_that_is_gone_says_to_open_the_console_again() {
    string address;
    string token;
    await using (var server = new FakeConsoleServer()) {
      address = server.Address;
      token = server.Token;
    }

    var client = new ConsoleClient(address, token);

    var exception = Assert.Throws<ConsoleException>(() => client.Request(ConsoleRequestNames.PROJECTS,
      WireJsonContext.Default.ProjectList, TestContext.Current.CancellationToken));

    Assert.Equal(ConsoleException.NOT_CONNECTED, exception.Code);
    Assert.Contains("Open the Package Manager Console again", exception.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void A_shell_the_editor_did_not_start_says_how_to_open_the_console() {
    var client = new ConsoleClient(string.Empty, string.Empty);

    var exception = Assert.Throws<ConsoleException>(() => client.Request(ConsoleRequestNames.PROJECTS,
      WireJsonContext.Default.ProjectList, TestContext.Current.CancellationToken));

    Assert.Equal(ConsoleException.NOT_CONNECTED, exception.Code);
    Assert.Contains("NuGet: Open Package Manager Console", exception.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task A_list_the_answer_leaves_out_reads_as_empty() {
    await using var server = new FakeConsoleServer().On(ConsoleRequestNames.INSTALLED,
      """{"projects":[{"projectPath":"/work/App.csproj"}]}""");
    var client = new ConsoleClient(server.Address, server.Token);

    var project = Assert.Single(Wire.OrEmpty(client.Request(ConsoleRequestNames.INSTALLED,
      WireJsonContext.Default.Installed, TestContext.Current.CancellationToken).Projects));

    Assert.Empty(Wire.OrEmpty(project.Packages));
    Assert.Empty(Wire.OrEmpty(project.Transitive));
  }

  [Fact]
  public void The_request_names_and_the_variables_match_the_TypeScript_ones() {
    var source = File.ReadAllText(Path.Combine(RepositoryRoot(), "packages", "console-protocol", "src", "requests.ts"));

    Assert.Equal(ConstantsOf(typeof(ConsoleRequestNames)), ValuesOf(source, "ConsoleRequestNames"));
    Assert.Equal(ConstantsOf(typeof(ConsoleEnvironment)), ValuesOf(source, "ConsoleEnvironment"));
  }

  private static string RepositoryRoot() {
    var folder = new DirectoryInfo(AppContext.BaseDirectory);
    while (folder is not null &&
           !File.Exists(Path.Combine(folder.FullName, "pnpm-workspace.yaml"))) folder = folder.Parent;
    return folder?.FullName ?? throw new InvalidOperationException("The repository root was not found.");
  }

  private static List<string> ConstantsOf(Type type)
    => [
      .. type.GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(field => field.IsLiteral)
        .Select(field => (string)field.GetRawConstantValue()!)
        .Order(StringComparer.Ordinal)
    ];

  /// <summary>The values of the object literal <c>export const name = { ... } as const</c>.</summary>
  private static List<string> ValuesOf(string source, string name) {
    var start = source.IndexOf($"export const {name} = {{", StringComparison.Ordinal);
    Assert.True(start >= 0, $"{name} was not found in requests.ts.");
    var end = source.IndexOf("} as const", start, StringComparison.Ordinal);
    using var document = JsonDocument.Parse("[" + string.Join(',', source[start..end].Split('\n')
      .Select(line => line.Trim().TrimEnd(','))
      .Where(line => line.Contains(": \"", StringComparison.Ordinal))
      .Select(line => line[(line.IndexOf(": \"", StringComparison.Ordinal) + 2)..])) + "]");
    return [.. document.RootElement.EnumerateArray().Select(value => value.GetString()!).Order(StringComparer.Ordinal)];
  }
}
