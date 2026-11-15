// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;

namespace NuGet.VisualStudioCode.Console.Model;

/// <summary>One known vulnerability of a package version.</summary>
[SuppressMessage("ReSharper", "MemberCanBePrivate.Global", Justification = Justifications.OUTPUT)]
public sealed class ConsoleAdvisory(string severity, string url) {
  public string Severity { get; } = severity;

  /// <summary>The page that describes it.</summary>
  public string Url { get; } = url;

  public override string ToString()
    => $"{Severity}: {Url}";
}
