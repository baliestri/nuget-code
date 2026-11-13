// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.ProjectModel;
using NuGet.VisualStudioCode.Sdk;

namespace NuGet.VisualStudioCode.Projects;

internal sealed class RestoreGraphGenerator(SdkService sdk) {
  public async Task<GraphResult> GenerateAsync(string target, string workingDirectory, CancellationToken ct) {
    var runner = sdk.GetRunner();
    var directory = Path.Combine(Path.GetTempPath(), "nuget-vscode");
    Directory.CreateDirectory(directory);
    var output = Path.Combine(directory, $"{Guid.NewGuid():N}.dgspec.json");
    try {
      var result = await runner.RunAsync(
        [
          "msbuild",
          target,
          "-t:GenerateRestoreGraphFile",
          $"-p:RestoreGraphOutputPath={output}",
          "-nologo",
          "-v:q",
          "-nodeReuse:false"
        ],
        workingDirectory,
        ct
      ).ConfigureAwait(false);
      if (result.ExitCode != 0 ||
          !File.Exists(output)) {
        var text = (result.StandardOutput + result.StandardError).Trim();
        return new GraphResult(null, text.Length > 0 ? text : "MSBuild did not produce the restore graph.");
      }

      return new GraphResult(DependencyGraphSpec.Load(output), null);
    }
    finally {
      if (File.Exists(output)) {
        File.Delete(output);
      }
    }
  }
}
