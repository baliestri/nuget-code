// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics;

namespace NuGet.VisualStudioCode.TestSupport;

public static class DotnetCli {
  public static async Task<DotnetResult> RunAsync(IReadOnlyList<string> arguments, string workingDirectory,
    CancellationToken ct) {
    var startInfo = new ProcessStartInfo("dotnet") {
      WorkingDirectory = workingDirectory,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false
    };
    foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);

    startInfo.Environment["DOTNET_CLI_UI_LANGUAGE"] = "en";
    using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("dotnet did not start.");
    var output = process.StandardOutput.ReadToEndAsync(ct);
    var error = process.StandardError.ReadToEndAsync(ct);
    await process.WaitForExitAsync(ct).ConfigureAwait(false);
    return new DotnetResult(
      process.ExitCode,
      await output.ConfigureAwait(false) + await error.ConfigureAwait(false)
    );
  }
}
