// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Restore;

internal static class RestoreStates {
  public const string NOT_RUN = "notRun";
  public const string SUCCEEDED = "succeeded";
  public const string SUCCEEDED_WITH_WARNINGS = "succeededWithWarnings";
  public const string FAILED = "failed";
  public const string CANCELLED = "cancelled";
}
