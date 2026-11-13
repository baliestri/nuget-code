// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Globalization;
using NuGet.Common;
using NuGet.Configuration;
using NuGet.Credentials;
using NuGet.Protocol;
using NuGet.Protocol.Plugins;
using NuGet.VisualStudioCode.Logging;
using PluginException = NuGet.Protocol.Plugins.PluginException;

namespace NuGet.VisualStudioCode.Credentials;

internal static class CredentialSetup {
  public static void Install(HostCredentialProvider provider, NuGetLogAdapter logger, BackendLog log)
    => HttpHandlerResourceV3.CredentialService = new Lazy<ICredentialService>(()
      => new CredentialService(new AsyncLazy<IEnumerable<ICredentialProvider>>(() => LoadAsync(provider, logger, log)),
        false, false));

  private static async Task<IEnumerable<ICredentialProvider>> LoadAsync(HostCredentialProvider provider,
    NuGetLogAdapter logger, BackendLog log) {
    var providers = new List<ICredentialProvider>();
    try {
      var builder = new SecurePluginCredentialProviderBuilder(PluginManager.Instance, false, logger);
      providers.AddRange(await builder.BuildAllAsync().ConfigureAwait(false));
    }
    catch (PluginException exception) {
      log.Write(LogLevels.WARNING, LogContexts.BACKEND,
        $"Credential plugins could not be loaded: {exception.Message}");
    }

    var count = providers.Count.ToString(CultureInfo.InvariantCulture);
    log.Write(LogLevels.DEBUG, LogContexts.BACKEND,
      $"Registered {count} plugin credential provider(s) and the host provider.");
    providers.Add(provider);
    return providers;
  }
}
