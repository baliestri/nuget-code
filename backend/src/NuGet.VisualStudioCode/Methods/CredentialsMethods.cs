// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Credentials;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Methods;

internal static class CredentialsMethods {
  public static void Register(RpcConnection connection, HostCredentialProvider provider, Action resetFeeds)
    => connection.OnNotification(MethodNames.CREDENTIALS_RESET,
      ProtocolJsonContext.Default.CredentialsResetParams, parameters =>
      {
        provider.Reset(parameters.Source);
        resetFeeds();
        return Task.CompletedTask;
      });
}
