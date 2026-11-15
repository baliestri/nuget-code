// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Configuration;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Methods;

internal static class ConfigurationMethods {
  private readonly static StringComparison PathComparison =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparison.OrdinalIgnoreCase
      : StringComparison.Ordinal;

  private readonly static Empty Done = new();

  /// <summary>
  ///   The methods that write configuration files. They take their turn in the operation queue. A written file
  ///   is treated as the host reporting the change: feeds are read again and the projects evaluated again.
  /// </summary>
  public static void RegisterWrites(RpcConnection connection, OperationQueue queue, SourcesWriter writer,
    SessionRefresher refresher, Action resetFeeds) {
    void Written(string file) {
      resetFeeds();
      refresher.Report([file]);
    }

    connection.OnRequest(MethodNames.SOURCES_ADD, ProtocolJsonContext.Default.SourceWriteParams,
      ProtocolJsonContext.Default.FeedInfo, (parameters, ct) => queue.RunAsync(_ =>
      {
        var (file, feed) = writer.Add(parameters);
        Written(file);
        return Task.FromResult(feed);
      }, ct));
    connection.OnRequest(MethodNames.SOURCES_UPDATE, ProtocolJsonContext.Default.SourceWriteParams,
      ProtocolJsonContext.Default.FeedInfo, (parameters, ct) => queue.RunAsync(_ =>
      {
        var (file, feed) = writer.Update(parameters);
        Written(file);
        return Task.FromResult(feed);
      }, ct));
    connection.OnRequest(MethodNames.SOURCES_REMOVE, ProtocolJsonContext.Default.SourceRemoveParams,
      ProtocolJsonContext.Default.Empty, (parameters, ct) => queue.RunAsync(_ =>
      {
        Written(writer.Remove(parameters));
        return Task.FromResult(Done);
      }, ct));
    connection.OnRequest(MethodNames.SOURCES_SET_PROPERTY, ProtocolJsonContext.Default.SourceSetPropertyParams,
      ProtocolJsonContext.Default.Empty, (parameters, ct) => queue.RunAsync(_ =>
      {
        writer.SetProperty(parameters);
        Written(parameters.File);
        return Task.FromResult(Done);
      }, ct));
  }

  /// <summary>
  ///   <c>folders/clear</c>: every path is checked against the cache folders of <c>folders/list</c> before the
  ///   first file is deleted.
  /// </summary>
  public static void RegisterClear(RpcConnection connection, OperationQueue queue, SettingsProvider settings,
    Func<bool> hasSolution)
    => connection.OnRequest(MethodNames.FOLDERS_CLEAR, ProtocolJsonContext.Default.FoldersClearParams,
      ProtocolJsonContext.Default.FoldersClearResult, (parameters, ct) => queue.RunAsync(token =>
      {
        FolderCleaner.RequireClearable(FoldersReader.Read(settings, hasSolution()), parameters.Paths);
        return Task.Run(() => new FoldersClearResult(
          parameters.Paths.Select(path => FolderCleaner.Clear(path, token)).ToList()), token);
      }, ct));

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
