// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Sessions;

internal sealed class SessionManager {
  private Session? _current;

  public Session? Current => Volatile.Read(ref _current);

  public Session Require()
    => Current ??
       throw new RpcException(RpcErrorCodes.NO_SOLUTION_OPEN, "No solution is open. Select a solution first.");

  public void Replace(Session session)
    => Volatile.Write(ref _current, session);

  public void Close()
    => Volatile.Write(ref _current, null);
}
