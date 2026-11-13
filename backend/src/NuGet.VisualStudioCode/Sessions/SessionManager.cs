// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Sessions;

internal sealed class SessionManager {
  private Session? _current;

  public Session? Current => Volatile.Read(ref _current);

  public void Replace(Session session)
    => Volatile.Write(ref _current, session);

  public void Close()
    => Volatile.Write(ref _current, null);
}
