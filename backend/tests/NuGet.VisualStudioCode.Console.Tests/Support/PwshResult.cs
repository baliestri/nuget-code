// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json;

namespace NuGet.VisualStudioCode.Console.Tests.Support;

/// <summary>How a script ended in PowerShell.</summary>
internal sealed record PwshResult(int ExitCode, string Output, string Error) {
  /// <summary>The output, read as the JSON the script wrote with <c>ConvertTo-Json</c>.</summary>
  public JsonElement Json() {
    Assert.True(ExitCode == 0, $"PowerShell failed ({ExitCode}): {Error}\n{Output}");
    using var document = JsonDocument.Parse(Output);
    return document.RootElement.Clone();
  }

  /// <summary>The lines of the output that are not empty.</summary>
  public IReadOnlyList<string> Lines() {
    Assert.True(ExitCode == 0, $"PowerShell failed ({ExitCode}): {Error}\n{Output}");
    return Output.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
  }
}
