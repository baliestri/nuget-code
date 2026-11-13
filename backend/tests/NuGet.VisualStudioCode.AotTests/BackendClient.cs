// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.AotTests;

internal sealed class BackendClient : IAsyncDisposable {
  private readonly Task _loop;
  private readonly Process _process;
  private readonly Task<string> _standardError;
  private readonly MessageWriter _writer;

  private BackendClient(Process process) {
    _process = process;
    _writer = new MessageWriter(process.StandardInput.BaseStream);
    Connection = new RpcConnection(
      new MessageReader(new BufferedStream(process.StandardOutput.BaseStream)),
      _writer
    );
    _standardError = process.StandardError.ReadToEndAsync();
    _loop = Connection.RunAsync(CancellationToken.None);
  }

  public RpcConnection Connection { get; }

  public async ValueTask DisposeAsync() {
    if (!_process.HasExited) {
      try {
        await CloseAsync().ConfigureAwait(false);
      }
      catch (TimeoutException) {
        // CloseAsync already killed the process.
      }
    }

    try {
      await _loop.ConfigureAwait(false);
    }
    catch (IOException) {
      // The output stream closes together with the process.
    }

    _writer.Dispose();
    _process.Dispose();
  }

  public static BackendClient Start(PublishedBackend backend, string workingDirectory,
    IReadOnlyDictionary<string, string>? environment = null) {
    var startInfo = new ProcessStartInfo(backend.ExecutablePath) {
      WorkingDirectory = workingDirectory,
      RedirectStandardInput = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false
    };
    foreach (var argument in backend.LaunchArguments) startInfo.ArgumentList.Add(argument);

    if (environment is not null) {
      foreach (var (name, value) in environment) startInfo.Environment[name] = value;
    }

    var process = Process.Start(startInfo)
                  ?? throw new InvalidOperationException("The backend process did not start.");
    return new BackendClient(process);
  }

  public Task<InitializeResult> InitializeAsync(CancellationToken ct, string? dotnetPath = null)
    => Connection.RequestAsync(
      MethodNames.INITIALIZE,
      new InitializeParams(dotnetPath, null),
      ProtocolJsonContext.Default.InitializeParams,
      ProtocolJsonContext.Default.InitializeResult,
      ct
    );

  public async Task<int> CloseAsync() {
    _process.StandardInput.Close();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    try {
      await _process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
    }
    catch (OperationCanceledException exception) {
      _process.Kill(true);
      var error = await _standardError.ConfigureAwait(false);
      throw new TimeoutException($"The backend did not exit after stdin closed. stderr: {error}", exception);
    }

    return _process.ExitCode;
  }
}
