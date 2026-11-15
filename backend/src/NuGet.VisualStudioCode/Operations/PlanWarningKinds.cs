// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Operations;

internal static class PlanWarningKinds {
  public const string CENTRAL_SHARED = "centralShared";
  public const string PROPERTY_SHARED = "propertyShared";
  public const string IMPORTED_SHARED = "importedShared";
  public const string LITERAL_WRITE = "literalWrite";
  public const string DOWNGRADE = "downgrade";
  public const string RANGE_REPLACED = "rangeReplaced";
  public const string CENTRAL_REMOVED = "centralRemoved";
  public const string REMOVE_ITEM = "removeItem";
  public const string FRAMEWORK_MISMATCH = "frameworkMismatch";
}
