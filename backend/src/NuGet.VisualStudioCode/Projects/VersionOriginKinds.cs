// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Projects;

internal static class VersionOriginKinds {
  public const string PROJECT = "project";
  public const string CENTRAL = "central";
  public const string VERSION_OVERRIDE = "versionOverride";
  public const string IMPORTED = "imported";
  public const string UNDETERMINED = "undetermined";
}
