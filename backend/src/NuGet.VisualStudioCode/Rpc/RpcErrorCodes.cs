// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Rpc;

internal static class RpcErrorCodes {
  public const int PARSE_ERROR = -32700;
  public const int INVALID_REQUEST = -32600;
  public const int METHOD_NOT_FOUND = -32601;
  public const int INVALID_PARAMS = -32602;
  public const int INTERNAL_ERROR = -32603;
  public const int REQUEST_CANCELLED = -32800;

  public const int SDK_NOT_FOUND = 1001;
  public const int SOLUTION_UNREADABLE = 1002;
  public const int NO_SOLUTION_OPEN = 1003;
  public const int EVALUATION_FAILED = 1004;
  public const int FEED_UNREACHABLE = 1005;
  public const int AUTHENTICATION_REFUSED = 1006;

  public const int PROJECT_NOT_IN_SESSION = 1101;
  public const int PACKAGE_NOT_INSTALLED = 1102;
  public const int PACKAGE_IMPLICIT = 1103;
  public const int EDIT_NOT_POSSIBLE = 1104;
  public const int UNKNOWN_RESTORE_ENGINE = 1105;
  public const int CONFIG_NOT_WRITABLE = 1106;
  public const int FEED_UNKNOWN = 1107;
  public const int FEED_DUPLICATE = 1108;
}
