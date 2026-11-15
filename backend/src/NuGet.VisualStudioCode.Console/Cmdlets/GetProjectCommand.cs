// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Model;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>Returns the default project, the projects with the given names, or every project.</summary>
[Cmdlet(VerbsCommon.Get, "Project", DefaultParameterSetName = BY_NAME)]
[OutputType(typeof(ConsoleProject))]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
public sealed class GetProjectCommand : NuGetCmdlet {
  private const string BY_NAME = "ByName";
  private const string EVERY = "All";

  [Parameter(Position = 0, ParameterSetName = BY_NAME)]
  [ArgumentCompleter(typeof(ProjectNameCompleter))]
  public string[]? Name { get; set; }

  [Parameter(Mandatory = true, ParameterSetName = EVERY)]
  public SwitchParameter All { get; set; }

  protected override void Run() {
    var projects = Projects();
    if (All.IsPresent) {
      foreach (var project in projects) WriteObject(Shown(project));
      return;
    }

    if (Name is null or []) {
      WriteObject(Shown(RequiredDefault(projects)));
      return;
    }

    foreach (var name in Name) WriteObject(Shown(Find(projects, name)));
  }
}
