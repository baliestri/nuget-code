// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>A cmdlet that acts on a project: the one named, or the default one.</summary>
public abstract class ProjectCmdlet : NuGetCmdlet {
  /// <summary>The project to act on, in place of the default project.</summary>
  [SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
  [Parameter(ValueFromPipelineByPropertyName = true)]
  [ArgumentCompleter(typeof(ProjectNameCompleter))]
  public string? ProjectName { get; set; }

  /// <summary>The project named, else the default one; null when there is neither.</summary>
  internal Wire.SolutionProject? Target(IReadOnlyList<Wire.SolutionProject> projects)
    => string.IsNullOrEmpty(ProjectName) ? Default(projects) : Find(projects, ProjectName);

  /// <summary>The project named, else the default one, for a cmdlet that cannot go without one.</summary>
  internal Wire.SolutionProject RequiredTarget(IReadOnlyList<Wire.SolutionProject> projects)
    => string.IsNullOrEmpty(ProjectName) ? RequiredDefault(projects) : Find(projects, ProjectName);
}
