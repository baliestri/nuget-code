// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Sdk;

internal sealed class SdkService {
  private string? _configuredPath;

  public void Configure(string? dotnetPath)
    => _configuredPath = dotnetPath;

  public async Task<SdkInfo?> DescribeAsync(string workingDirectory, CancellationToken ct) {
    var runner = TryGetRunner();
    if (runner is null) {
      return null;
    }

    var result = await runner.RunAsync(["--version"], workingDirectory, ct).ConfigureAwait(false);
    return result.ExitCode == 0 ? new SdkInfo(runner.DotnetPath, result.StandardOutput.Trim()) : null;
  }

  private DotnetRunner? TryGetRunner() {
    var path = DotnetLocator.Find(_configuredPath, Environment.GetEnvironmentVariable, File.Exists);
    return path is null ? null : new DotnetRunner(path);
  }
}
