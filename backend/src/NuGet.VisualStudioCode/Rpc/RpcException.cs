// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Rpc;

internal sealed class RpcException(int code, string message, string? errorData = null) : Exception(message) {
  public int Code { get; } = code;

  public string? ErrorData { get; } = errorData;
}
