// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Tests.Support;

/// <summary>Runs scripts in a real PowerShell with the module loaded, as the console of the editor does.</summary>
internal static class Pwsh {
  private readonly static Version Minimum = new(7, 6);
  private readonly static Lazy<string?> Unavailable = new(Probe);

  /// <summary>The manifest of the module, beside the assembly the tests were built with.</summary>
  private static string Manifest
    => Path.Combine(Path.GetDirectoryName(typeof(ConsoleSession).Assembly.Location)!, "NuGetCode.psd1");

  /// <summary>
  ///   Runs the script against the fake editor, with the module imported and errors stopping it. The test is
  ///   skipped where there is no PowerShell the module can load in.
  /// </summary>
  public static async Task<PwshResult> RunAsync(FakeConsoleServer server, string script, string? project = null) {
    Assert.SkipWhen(Unavailable.Value is not null, Unavailable.Value ?? string.Empty);

    var full = $"$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n"
               + $"Import-Module '{Manifest.Replace("'", "''", StringComparison.Ordinal)}'\n{script}";
    var start = new ProcessStartInfo("pwsh") {
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      RedirectStandardInput = true,
      UseShellExecute = false,
      StandardOutputEncoding = Encoding.UTF8,
      StandardErrorEncoding = Encoding.UTF8
    };
    foreach (var argument in new[] {
               "-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand",
               Convert.ToBase64String(Encoding.Unicode.GetBytes(full))
             })
      start.ArgumentList.Add(argument);
    start.Environment[ConsoleEnvironment.ADDRESS] = server.Address;
    start.Environment[ConsoleEnvironment.TOKEN] = server.Token;
    start.Environment[ConsoleEnvironment.PROJECT] = project ?? string.Empty;
    // Colours and progress bars would only be noise in what the tests read.
    start.Environment["NO_COLOR"] = "1";

    using var process = Process.Start(start) ?? throw new InvalidOperationException("PowerShell did not start.");
    process.StandardInput.Close();
    var output = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
    var error = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
    await process.WaitForExitAsync(TestContext.Current.CancellationToken).ConfigureAwait(false);
    return new PwshResult(process.ExitCode, (await output.ConfigureAwait(false)).Trim(),
      (await error.ConfigureAwait(false)).Trim());
  }

  /// <summary>Why the tests cannot run PowerShell here; null when they can.</summary>
  private static string? Probe() {
    try {
      var start = new ProcessStartInfo("pwsh") { RedirectStandardOutput = true, UseShellExecute = false };
      start.ArgumentList.Add("--version");
      using var process = Process.Start(start);
      if (process is null) {
        return "PowerShell did not start.";
      }

      var text = process.StandardOutput.ReadToEnd().Trim();
      process.WaitForExit();
      // "PowerShell 7.6.0", possibly with a prerelease label after the numbers.
      var number = text.Split(' ').LastOrDefault()?.Split('-')[0];
      return Version.TryParse(number, out var version) && version >= Minimum
        ? null
        : $"The module needs PowerShell {Minimum} or newer; this machine has '{text}'.";
    }
    catch (Exception exception) when (exception is Win32Exception or InvalidOperationException) {
      return $"There is no pwsh in the PATH: {exception.Message}";
    }
  }
}
