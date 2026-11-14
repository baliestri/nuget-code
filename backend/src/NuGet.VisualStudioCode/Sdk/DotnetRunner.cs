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

  public Task<ProcessResult> RunAsync(IReadOnlyList<string> arguments, string workingDirectory, CancellationToken ct,
    IReadOnlyDictionary<string, string>? environment = null, Action<string>? onLine = null)
    => ProcessRunner.RunAsync(dotnetPath, arguments, workingDirectory, Merge(environment), ct, onLine);

  private static Dictionary<string, string> Merge(IReadOnlyDictionary<string, string>? environment) {
    if (environment is null) {
      return CliEnvironment;
    }

    var merged = new Dictionary<string, string>(CliEnvironment, StringComparer.Ordinal);
    foreach (var (name, value) in environment) merged[name] = value;

    return merged;
  }
}
