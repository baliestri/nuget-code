// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Net;
using NuGet.Configuration;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   Hands the credentials the host supplied to a <c>dotnet</c> process through NuGet's own
///   <c>NuGetPackageSourceCredentials_&lt;name&gt;</c> variables. Nothing is written to disk.
/// </summary>
internal static class RestoreCredentialEnvironment {
  private const string PREFIX = "NuGetPackageSourceCredentials_";

  public static RestoreCredentials Build(ISettings settings, IReadOnlyDictionary<string, NetworkCredential> known) {
    var environment = new Dictionary<string, string>(StringComparer.Ordinal);
    var skipped = new List<string>();
    foreach (var source in PackageSourceProvider.LoadPackageSources(settings)) {
      if (!source.IsEnabled ||
          !source.IsHttp ||
          !known.TryGetValue(source.SourceUri.GetLeftPart(UriPartial.Authority), out var credential)) {
        continue;
      }

      if (!IsVariableName(source.Name)) {
        skipped.Add(source.Name);
        continue;
      }

      environment[PREFIX + source.Name] = $"Username={credential.UserName};Password={credential.Password}";
    }

    return new RestoreCredentials(environment, skipped);
  }

  private static bool IsVariableName(string name)
    => name.Length > 0 && name.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '.' or '-');
}
