// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics;
using System.Text;

namespace NuGet.VisualStudioCode.Sdk;

internal static class ProcessRunner {
  /// <summary>
  ///   Runs a process to its end. With <paramref name="onLine" />, every line of standard output and of standard
  ///   error is also handed over as it arrives; the two streams are read at the same time, so the callback must
  ///   tolerate concurrent calls.
  /// </summary>
  public static async Task<ProcessResult> RunAsync(string fileName, IReadOnlyList<string> arguments,
    string workingDirectory, IReadOnlyDictionary<string, string>? environment, CancellationToken ct,
    Action<string>? onLine = null) {
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
      var output = ReadAsync(process.StandardOutput, onLine, ct);
      var error = ReadAsync(process.StandardError, onLine, ct);
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

  private static async Task<string> ReadAsync(StreamReader reader, Action<string>? onLine, CancellationToken ct) {
    if (onLine is null) {
      return await reader.ReadToEndAsync(ct).ConfigureAwait(false);
    }

    var text = new StringBuilder();
    while (await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line) {
      text.AppendLine(line);
      onLine(line);
    }

    return text.ToString();
  }
}
