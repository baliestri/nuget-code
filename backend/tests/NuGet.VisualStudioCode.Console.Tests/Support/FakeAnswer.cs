// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text;
using System.Text.Json;

namespace NuGet.VisualStudioCode.Console.Tests.Support;

/// <summary>What the fake editor answers to one request: steps, then a result or an error. All of it JSON.</summary>
internal sealed record FakeAnswer(string? Result, string? ErrorCode, string? ErrorMessage) {
  public IReadOnlyList<string> Progress { get; private init; } = [];

  public static FakeAnswer Of(string resultJson)
    => new(OneLine(resultJson), null, null);

  public static FakeAnswer Failed(string code, string message)
    => new(null, code, message);

  /// <summary>The same answer, after these steps, each the JSON of one <c>progress</c>.</summary>
  public FakeAnswer After(params string[] steps)
    => this with { Progress = [.. steps.Select(OneLine)] };

  /// <summary>The same JSON without the line breaks the tests write it with: an answer is one line.</summary>
  private static string OneLine(string json) {
    using var document = JsonDocument.Parse(json);
    using var buffer = new MemoryStream();
    using (var writer = new Utf8JsonWriter(buffer)) {
      document.RootElement.WriteTo(writer);
    }

    return Encoding.UTF8.GetString(buffer.ToArray());
  }
}
