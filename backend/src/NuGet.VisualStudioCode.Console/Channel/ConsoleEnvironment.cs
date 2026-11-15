// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Console.Channel;

/// <summary>The environment variables through which the extension tells the shell where it listens.</summary>
internal static class ConsoleEnvironment {
  public const string ADDRESS = "NUGET_CODE_CONSOLE_ADDRESS";
  public const string TOKEN = "NUGET_CODE_CONSOLE_TOKEN";
  public const string PROJECT = "NUGET_CODE_CONSOLE_PROJECT";
}
