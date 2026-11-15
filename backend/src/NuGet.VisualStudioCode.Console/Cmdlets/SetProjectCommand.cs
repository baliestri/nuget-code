// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Model;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>
///   Changes the default project of the console: to the one named, or to the one chosen in the list the
///   editor shows when no name is given.
/// </summary>
[Cmdlet(VerbsCommon.Set, "Project")]
[OutputType(typeof(ConsoleProject))]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
public sealed class SetProjectCommand : NuGetCmdlet {
  [Parameter(Position = 0)]
  [ArgumentCompleter(typeof(ProjectNameCompleter))]
  public string? Name { get; set; }

  /// <summary>Returns the project that became the default.</summary>
  [Parameter]
  public SwitchParameter PassThru { get; set; }

  protected override void Run() {
    var projects = Projects();
    Wire.SolutionProject chosen;
    if (string.IsNullOrEmpty(Name)) {
      var picked = Ask(
        ConsoleRequestNames.PICK_PROJECT,
        new Wire.PickProjectParams(ConsoleSession.DefaultProjectPath),
        WireJsonContext.Default.PickProjectParams,
        WireJsonContext.Default.PickedProject
      );
      if (picked.Path is null) {
        // Dismissing the list is not an error: the default stays what it was.
        WriteVerbose("No project was chosen; the default project is unchanged.");
        return;
      }

      chosen = Find(projects, picked.Path);
    }
    else {
      chosen = Find(projects, Name);
    }

    ConsoleSession.SetDefaultProject(chosen);
    if (PassThru.IsPresent) {
      WriteObject(Shown(chosen));
    }
  }
}
