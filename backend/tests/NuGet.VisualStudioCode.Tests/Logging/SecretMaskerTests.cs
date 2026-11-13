// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;

namespace NuGet.VisualStudioCode.Tests.Logging;

public sealed class SecretMaskerTests {
  [Theory]
  [InlineData("GET https://user:p4ss@feed.example/v3/index.json", "GET https://***@feed.example/v3/index.json")]
  [InlineData("https://feed.example/pkg?sig=abc123&x=1", "https://feed.example/pkg?sig=***&x=1")]
  [InlineData("https://feed.example/pkg?x=1&api_key=SECRET", "https://feed.example/pkg?x=1&api_key=***")]
  [InlineData("https://feed.example/pkg?access_token=tok", "https://feed.example/pkg?access_token=***")]
  [InlineData(@"Restored D:\repo\App.csproj (in 1 ms).", @"Restored D:\repo\App.csproj (in 1 ms).")]
  [InlineData("https://api.nuget.org/v3/index.json", "https://api.nuget.org/v3/index.json")]
  public void Mask_hides_credentials_and_keeps_everything_else(string input, string expected)
    => Assert.Equal(expected, SecretMasker.Mask(input));
}
