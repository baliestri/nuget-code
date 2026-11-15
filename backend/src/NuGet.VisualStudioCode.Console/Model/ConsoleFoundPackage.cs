// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;

namespace NuGet.VisualStudioCode.Console.Model;

/// <summary>A package the feeds have, as <c>Find-Package</c> returns it.</summary>
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.OUTPUT)]
[SuppressMessage("ReSharper", "MemberCanBePrivate.Global", Justification = Justifications.OUTPUT)]
public sealed class ConsoleFoundPackage(string id, string version) {
  public string Id { get; } = id;

  /// <summary>The newest version.</summary>
  public string Version { get; } = version;

  /// <summary>Every version, newest first; only with <c>-AllVersions</c>.</summary>
  public IReadOnlyList<string> Versions { get; init; } = [];

  public string? Description { get; init; }
  public string? Authors { get; init; }

  /// <summary>The package source the answer came from.</summary>
  public string? Source { get; init; }

  public override string ToString()
    => $"{Id} {Version}";
}
