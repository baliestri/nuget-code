// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class PublishedBackend : IDisposable {
  private const string MODE_VARIABLE = "NUGET_VSCODE_BACKEND_MODE";
  private const string PATH_VARIABLE = "NUGET_VSCODE_BACKEND_PATH";
  private const string PROJECT_NAME = "NuGet.VisualStudioCode";
  private const string VSWHERE_DIRECTORY = @"C:\Program Files (x86)\Microsoft Visual Studio\Installer";

  private readonly string? _publishDirectory;

  public PublishedBackend() {
    var provided = Environment.GetEnvironmentVariable(PATH_VARIABLE);
    if (!string.IsNullOrEmpty(provided)) {
      ExecutablePath = provided;
      LaunchArguments = [];
      return;
    }

    var project = Path.Combine(FindBackendRoot(), "src", PROJECT_NAME, $"{PROJECT_NAME}.csproj");
    _publishDirectory = Path.Combine(Path.GetTempPath(), "nuget-vscode-aot", Guid.NewGuid().ToString("N"));
    var mode = Environment.GetEnvironmentVariable(MODE_VARIABLE);
    if (string.Equals(mode, "jit", StringComparison.OrdinalIgnoreCase)) {
      Publish(project, ["-c", "Release", "-p:PublishAot=false", "-o", _publishDirectory]);
      ExecutablePath = "dotnet";
      LaunchArguments = [Path.Combine(_publishDirectory, $"{PROJECT_NAME}.dll")];
      return;
    }

    Publish(project, ["-c", "Release", "-r", RuntimeInformation.RuntimeIdentifier, "-o", _publishDirectory]);
    var extension = OperatingSystem.IsWindows() ? ".exe" : string.Empty;
    ExecutablePath = Path.Combine(_publishDirectory, PROJECT_NAME + extension);
    LaunchArguments = [];
  }

  public string ExecutablePath { get; }

  public IReadOnlyList<string> LaunchArguments { get; }

  public void Dispose() {
    if (_publishDirectory is null ||
        !Directory.Exists(_publishDirectory)) {
      return;
    }

    try {
      Directory.Delete(_publishDirectory, true);
    }
    catch (IOException) {
      // The binary may still be in use by a test that has not finished; the OS cleans the temporary directory.
    }
    catch (UnauthorizedAccessException) {
      // Same as above.
    }
  }

  private static string FindBackendRoot() {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);
    while (directory is not null) {
      if (File.Exists(Path.Combine(directory.FullName, "NuGet.VisualStudioCode.slnx"))) {
        return directory.FullName;
      }

      directory = directory.Parent;
    }

    throw new InvalidOperationException("NuGet.VisualStudioCode.slnx was not found above the test binaries.");
  }

  private static void Publish(string project, IReadOnlyList<string> arguments) {
    var startInfo = new ProcessStartInfo("dotnet") {
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false
    };
    startInfo.ArgumentList.Add("publish");
    startInfo.ArgumentList.Add(project);
    foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);

    startInfo.ArgumentList.Add("-nologo");
    if (OperatingSystem.IsWindows() &&
        Directory.Exists(VSWHERE_DIRECTORY)) {
      var path = Environment.GetEnvironmentVariable("PATH");
      startInfo.Environment["PATH"] = VSWHERE_DIRECTORY + Path.PathSeparator + path;
    }

    using var process = Process.Start(startInfo)
                        ?? throw new InvalidOperationException("dotnet publish did not start.");
    var output = process.StandardOutput.ReadToEndAsync();
    var error = process.StandardError.ReadToEndAsync();
    if (!process.WaitForExit(TimeSpan.FromMinutes(15))) {
      process.Kill(true);
      throw new TimeoutException("dotnet publish did not finish in 15 minutes.");
    }

    if (process.ExitCode != 0) {
      throw new InvalidOperationException(
        $"dotnet publish failed with exit code {process.ExitCode}.{Environment.NewLine}{output.GetAwaiter().GetResult()}{Environment.NewLine}{error.GetAwaiter().GetResult()}"
      );
    }
  }
}
