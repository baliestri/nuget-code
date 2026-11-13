// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Methods;

internal static class ConfigurationMethods {
  private readonly static StringComparison PathComparison =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparison.OrdinalIgnoreCase
      : StringComparison.Ordinal;

  public static void Register(RpcConnection connection, SettingsProvider settings, Func<bool> hasSolution) {
    connection.OnRequest(MethodNames.SOURCES_LIST, ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.SourcesListResult, (_, _) => Task.FromResult(SourcesReader.Read(settings)));
    connection.OnRequest(MethodNames.FOLDERS_LIST, ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.FoldersListResult,
      (_, _) => Task.FromResult(new FoldersListResult(FoldersReader.Read(settings, hasSolution()))));
    connection.OnRequest(MethodNames.FOLDERS_SIZE, ProtocolJsonContext.Default.FolderSizeParams,
      ProtocolJsonContext.Default.FolderSizeResult, (parameters, ct) =>
      {
        var known = FoldersReader.Read(settings, hasSolution()).Any(folder => SamePath(folder.Path, parameters.Path));
        return known
          ? Task.Run(() => FolderSizeCalculator.Calculate(parameters.Path, ct), ct)
          : throw new RpcException(RpcErrorCodes.INVALID_PARAMS, "The path is not one of the NuGet folders.");
      });
  }

  private static bool SamePath(string left, string right)
    => string.Equals(
      Path.TrimEndingDirectorySeparator(left),
      Path.TrimEndingDirectorySeparator(right),
      PathComparison
    );
}
