// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Console.Channel;

/// <summary>A request the extension did not answer, with the reason it gave.</summary>
public sealed class ConsoleException(string code, string message, Exception? innerException = null)
  : Exception(message, innerException) {
  /// <summary>The console is not connected to an editor: the variables are missing or nothing listens.</summary>
  internal const string NOT_CONNECTED = "notConnected";

  /// <summary>The cmdlet was given something it cannot work with.</summary>
  internal const string INVALID_ARGUMENT = "invalidArgument";

  /// <summary>A failure of the cmdlet itself: what it was given cannot be worked with.</summary>
  public ConsoleException(string message)
    : this(INVALID_ARGUMENT, message) {
  }

  /// <summary>Why, in one word: one of the codes of the extension, or one of the codes above.</summary>
  public string Code { get; } = code;
}
