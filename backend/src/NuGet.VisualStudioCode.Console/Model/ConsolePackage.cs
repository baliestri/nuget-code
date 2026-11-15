// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;

namespace NuGet.VisualStudioCode.Console.Model;

/// <summary>A package a project has, as <c>Get-Package</c> returns it.</summary>
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.OUTPUT)]
public sealed class ConsolePackage(string id, string? version, string projectName) {
  public string Id { get; } = id;

  /// <summary>The version the last restore resolved; before a restore, the one the project asks for.</summary>
  public string? Version { get; } = version;

  public string ProjectName { get; } = projectName;

  /// <summary>The newest version on the feeds; only with <c>-Updates</c>.</summary>
  public string? LatestVersion { get; init; }

  /// <summary>Whether the project has it without referencing it.</summary>
  public bool IsTransitive { get; init; }

  /// <summary>The referenced packages through which a transitive one arrives.</summary>
  public IReadOnlyList<string> Via { get; init; } = [];

  /// <summary>The known vulnerabilities of this version; only with <c>-Vulnerable</c>.</summary>
  public IReadOnlyList<ConsoleAdvisory> Advisories { get; init; } = [];

  public override string ToString()
    => Version is null ? Id : $"{Id} {Version}";
}
