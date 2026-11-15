// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Management.Automation;
using System.Text.Json.Serialization.Metadata;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Versions;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>
///   A cmdlet that changes the packages of a project. The change is planned first: <c>-WhatIf</c> shows the
///   planned edits and stops there; otherwise what the plan warns of is said and the change is applied,
///   with its steps as progress and its failures as errors.
/// </summary>
public abstract class ChangeCmdlet : ProjectCmdlet {
  internal const string INSTALL = "install";
  internal const string UPDATE = "update";
  internal const string REMOVE = "remove";

  private const string RESTORE_FAILED = "failed";
  private const string RESTORE_CANCELLED = "cancelled";

  /// <summary>1 while an operation of this cmdlet runs in the backend.</summary>
  private int _operating;

  /// <summary>Whether the cmdlet was asked only to show what it would do.</summary>
  internal bool IsWhatIf
    => MyInvocation.BoundParameters.TryGetValue("WhatIf", out var value) &&
       value is SwitchParameter { IsPresent: true };

  /// <summary>
  ///   Stopping the cmdlet while its operation runs asks the backend to cancel it. The operation still
  ///   answers, and its answer says what was left undone, so the request is not abandoned.
  /// </summary>
  protected override void StopProcessing() {
    if (Volatile.Read(ref _operating) == 0) {
      base.StopProcessing();
      return;
    }

    try {
      Client.Request(ConsoleRequestNames.CANCEL, WireJsonContext.Default.Nothing);
    }
    catch (ConsoleException) {
      // Without the editor there is nothing left to cancel.
    }
  }

  /// <summary>
  ///   Plans the changes and, unless told not to, applies them with the request given. The action is what
  ///   is done and the target on what, the name of the project or projects, as the confirmation and
  ///   <c>-WhatIf</c> say them.
  /// </summary>
  internal void Apply<TParams>(string action, string target, IReadOnlyList<Wire.Change> changes, string method,
    TParams parameters, JsonTypeInfo<TParams> parametersInfo) {
    var plan = Ask(ConsoleRequestNames.PLAN, new Wire.ChangesParams(changes), WireJsonContext.Default.ChangesParams,
      WireJsonContext.Default.Plan);
    if (!ShouldProcess(target, action)) {
      if (IsWhatIf) {
        ShowPlan(plan);
      }

      return;
    }

    foreach (var warning in Wire.OrEmpty(plan.Warnings)) WriteWarning(PlanWarnings.Describe(warning));
    Operate(action, method, parameters, parametersInfo);
  }

  /// <summary>Runs an operation of the backend, showing its steps, and reports how each project ended.</summary>
  internal void Operate<TParams>(string activity, string method, TParams parameters,
    JsonTypeInfo<TParams> parametersInfo) {
    Wire.Operation result;
    Volatile.Write(ref _operating, 1);
    try {
      result = Ask(method, parameters, parametersInfo, WireJsonContext.Default.Operation,
        step => WriteProgress(new ProgressRecord(1, activity, StepOf(step))));
    }
    finally {
      Volatile.Write(ref _operating, 0);
    }

    WriteProgress(new ProgressRecord(1, activity, "Done") { RecordType = ProgressRecordType.Completed });
    Report(result);
  }

  /// <summary>The packages the project references, without the ones the SDK adds on its own.</summary>
  internal IReadOnlyList<Wire.InstalledPackage> Referenced(Wire.SolutionProject project)
    => [
      .. Wire.OrEmpty(Ask(ConsoleRequestNames.INSTALLED, WireJsonContext.Default.Installed).Projects)
        .Where(packages => PathComparer.Equals(packages.ProjectPath, project.Path))
        .SelectMany(packages => Wire.OrEmpty(packages.Packages))
        .Where(package => !package.Implicit)
    ];

  /// <summary>The version the project has of the package. A range or a floating version is an error.</summary>
  internal static PackageVersion VersionOf(Wire.InstalledPackage package, Wire.SolutionProject project) {
    var text = package.ResolvedVersion ?? package.RequestedVersion;
    return PackageVersion.TryParse(text, out var version)
      ? version
      : throw new ConsoleException(
        $"{project.Name} has {package.Id} as '{text}', which is not one version. Restore the project, or give -Version.");
  }

  /// <summary>The versions the sources have of the package, newest first.</summary>
  internal IReadOnlyList<string> VersionsOf(string id, string? source, bool prerelease) {
    var details = Ask(
      ConsoleRequestNames.DETAILS,
      new Wire.DetailsParams(id, string.IsNullOrEmpty(source) ? null : source, prerelease),
      WireJsonContext.Default.DetailsParams,
      WireJsonContext.Default.Details
    );
    WarnOf(details.Failures);
    return Wire.OrEmpty(details.Versions);
  }

  /// <summary>Says something to the user that is not output: it is not passed down the pipeline.</summary>
  internal void Say(string text)
    => WriteInformation(new HostInformationMessage { Message = text }, ["PSHOST"]);

  private void ShowPlan(Wire.Plan plan) {
    foreach (var edit in Wire.OrEmpty(plan.Edits)) {
      Say($"{edit.File}:{edit.Line}");
      if (edit.OldText.Length > 0) {
        Say($"  - {edit.OldText.Trim()}");
      }

      if (edit.NewText.Length > 0) {
        Say($"  + {edit.NewText.Trim()}");
      }
    }

    foreach (var warning in Wire.OrEmpty(plan.Warnings)) WriteWarning(PlanWarnings.Describe(warning));
  }

  private void Report(Wire.Operation result) {
    foreach (var project in Wire.OrEmpty(result.Projects)) {
      var name = Path.GetFileNameWithoutExtension(project.Project);
      foreach (var error in Wire.OrEmpty(project.EditErrors)) Fail("editFailed", $"{name}: {error}", project.Project);

      var failures = 0;
      foreach (var message in Wire.OrEmpty(project.Messages)) {
        var text = message.Code is null ? $"{name}: {message.Message}" : $"{name}: {message.Code}: {message.Message}";
        switch (message.Level) {
          case "error":
            failures++;
            Fail("restoreFailed", text, project.Project);
            break;
          case "warning":
            WriteWarning(text);
            break;
          default:
            WriteVerbose(text);
            break;
        }
      }

      switch (project.Restore) {
        case RESTORE_FAILED when failures == 0:
          Fail("restoreFailed", $"{name}: the restore failed. See the NuGet log of the editor.", project.Project);
          break;
        case RESTORE_CANCELLED:
          WriteWarning($"{name}: cancelled before the restore finished. Files already edited stay edited.");
          break;
      }

      var files = Wire.OrEmpty(project.ChangedFiles).Count;
      Say($"{name}: {files} {(files == 1 ? "file" : "files")} changed, restore {Described(project.Restore)}.");
    }

    if (result.FellBack) {
      WriteVerbose("The restore fell back to the console engine.");
    }
  }

  private void Fail(string code, string message, string target)
    => WriteError(new ErrorRecord(new ConsoleException(code, message), $"NuGetConsole.{code}",
      ErrorCategory.NotSpecified, target));

  private static string Described(string restore)
    => restore switch {
      "notRun" => "not run",
      "succeededWithWarnings" => "succeeded with warnings",
      var _ => restore
    };

  private static string StepOf(Wire.Progress step)
    => step.Step switch {
      "planning" => "Planning the change",
      "editing" => "Editing the project files",
      "evaluating" => "Evaluating the projects",
      "restoring" => step.Project is null
        ? "Restoring"
        : $"Restoring {Path.GetFileNameWithoutExtension(step.Project)}",
      "done" => "Done",
      var _ => step.Step
    };
}
