// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Sdk;

internal sealed class DotnetRunner(string dotnetPath) {
  private readonly static Dictionary<string, string> CliEnvironment = new(StringComparer.Ordinal) {
    ["DOTNET_CLI_UI_LANGUAGE"] = "en",
    ["DOTNET_NOLOGO"] = "1",
    ["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
  };

  public string DotnetPath => dotnetPath;

  public Task<ProcessResult> RunAsync(IReadOnlyList<string> arguments, string workingDirectory, CancellationToken ct)
    => ProcessRunner.RunAsync(dotnetPath, arguments, workingDirectory, CliEnvironment, ct);
}
