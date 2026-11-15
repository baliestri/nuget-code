// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Console.Channel;

/// <summary>
///   What the console may ask of the extension, by name. The extension has the same names in
///   <c>packages/console-protocol/src/requests.ts</c>; a test fails when the two differ.
/// </summary>
internal static class ConsoleRequestNames {
  public const string PROJECTS = "projects";
  public const string PICK_PROJECT = "pickProject";
  public const string INSTALLED = "installed";
  public const string UPDATES = "updates";
  public const string SEARCH = "search";
  public const string DETAILS = "details";
  public const string VULNERABILITIES = "vulnerabilities";
  public const string PLAN = "plan";
  public const string INSTALL = "install";
  public const string UPDATE = "update";
  public const string REMOVE = "remove";
  public const string RESTORE = "restore";
  public const string SOURCES = "sources";
  public const string CANCEL = "cancel";
}
