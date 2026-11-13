// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics;

namespace NuGet.VisualStudioCode.Sdk;

internal static class ProcessRunner {
  public static async Task<ProcessResult> RunAsync(
    string fileName,
    IReadOnlyList<string> arguments,
    string workingDirectory,
    IReadOnlyDictionary<string, string>? environment,
    CancellationToken ct
  ) {
    var startInfo = new ProcessStartInfo(fileName) {
      WorkingDirectory = workingDirectory,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      RedirectStandardInput = true,
      UseShellExecute = false,
      CreateNoWindow = true
    };
    foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);

    if (environment is not null) {
      foreach (var (name, value) in environment) startInfo.Environment[name] = value;
    }

    using var process = new Process();
    process.StartInfo = startInfo;
    process.Start();
    ChildProcesses.Track(process);
    try {
      process.StandardInput.Close();
      var output = process.StandardOutput.ReadToEndAsync(ct);
      var error = process.StandardError.ReadToEndAsync(ct);
      await process.WaitForExitAsync(ct).ConfigureAwait(false);
      return new ProcessResult(
        process.ExitCode,
        await output.ConfigureAwait(false),
        await error.ConfigureAwait(false)
      );
    }
    catch (OperationCanceledException) {
      ChildProcesses.Kill(process);
      throw;
    }
    finally {
      ChildProcesses.Untrack(process);
    }
  }
}
