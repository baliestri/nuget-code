// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Common;

namespace NuGet.VisualStudioCode.Logging;

internal sealed class NuGetLogAdapter(BackendLog log) : LoggerBase(LogLevel.Debug) {
  public override void Log(ILogMessage message)
    => log.Write(Map(message.Level), LogContexts.NUGET, message.Message);

  public override Task LogAsync(ILogMessage message) {
    Log(message);
    return Task.CompletedTask;
  }

  private static string Map(LogLevel level)
    => level switch {
      LogLevel.Debug => LogLevels.DEBUG,
      LogLevel.Verbose => LogLevels.VERBOSE,
      LogLevel.Information or LogLevel.Minimal => LogLevels.INFO,
      LogLevel.Warning => LogLevels.WARNING,
      var _ => LogLevels.ERROR
    };
}
