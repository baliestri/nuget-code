// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;

namespace NuGet.VisualStudioCode.Console.Model;

/// <summary>A project of the open solution, as <c>Get-Project</c> returns it.</summary>
[SuppressMessage("ReSharper", "UnusedMember.Global", Justification = Justifications.OUTPUT)]
[SuppressMessage("ReSharper", "MemberCanBePrivate.Global", Justification = Justifications.OUTPUT)]
public sealed class ConsoleProject(string projectName, string fullName, IReadOnlyList<string> frameworks) {
  public string ProjectName { get; } = projectName;

  /// <summary>The path of the project file.</summary>
  public string FullName { get; } = fullName;

  public IReadOnlyList<string> Frameworks { get; } = frameworks;

  public override string ToString()
    => ProjectName;
}
