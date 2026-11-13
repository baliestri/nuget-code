// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Protocol;

internal static class MethodNames {
  public const string INITIALIZE = "initialize";
  public const string SHUTDOWN = "shutdown";

  public const string SOLUTION_OPEN = "solution/open";
  public const string SOLUTION_CLOSE = "solution/close";

  public const string SOLUTION_DID_CHANGE = "solution/didChange";

  public const string PACKAGES_INSTALLED = "packages/installed";
  public const string PACKAGES_SEARCH = "packages/search";
  public const string PACKAGES_DETAILS = "packages/details";

  public const string SOURCES_LIST = "sources/list";
  public const string FOLDERS_LIST = "folders/list";
  public const string FOLDERS_SIZE = "folders/size";

  public const string WORKSPACE_DID_CHANGE_FILES = "workspace/didChangeFiles";

  public const string LOG_ENTRY = "log/entry";
}
