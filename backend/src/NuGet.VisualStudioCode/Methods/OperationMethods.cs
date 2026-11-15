// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Methods;

internal static class OperationMethods {
  public static void Register(RpcConnection connection, SessionManager sessions, PlanAdvisor advisor,
    OperationQueue queue, PackageOperationService operations) {
    connection.OnRequest(MethodNames.PACKAGES_PLAN, ProtocolJsonContext.Default.PackagesPlanParams,
      ProtocolJsonContext.Default.PackagesPlanResult,
      (parameters, ct) => PlanAsync(sessions, advisor, parameters.Changes, ct));
    connection.OnRequest(MethodNames.PACKAGES_INSTALL, ProtocolJsonContext.Default.PackagesInstallParams,
      ProtocolJsonContext.Default.OperationResult, (parameters, ct) => RunAsync(queue, operations,
        [new PackageChange(PackageChangeKinds.INSTALL, parameters.Id, parameters.Version, parameters.Projects)], ct));
    connection.OnRequest(MethodNames.PACKAGES_UPDATE, ProtocolJsonContext.Default.PackagesUpdateParams,
      ProtocolJsonContext.Default.OperationResult, (parameters, ct) => RunAsync(queue, operations,
        parameters.Changes
          .Select(change => new PackageChange(PackageChangeKinds.UPDATE, change.Id, change.Version, change.Projects))
          .ToList(), ct));
    connection.OnRequest(MethodNames.PACKAGES_REMOVE, ProtocolJsonContext.Default.PackagesRemoveParams,
      ProtocolJsonContext.Default.OperationResult, (parameters, ct) => RunAsync(queue, operations,
        [new PackageChange(PackageChangeKinds.REMOVE, parameters.Id, null, parameters.Projects)], ct));
  }

  private static Task<OperationResult> RunAsync(OperationQueue queue, PackageOperationService operations,
    IReadOnlyList<PackageChange> changes, CancellationToken ct)
    => queue.RunAsync(token => operations.RunAsync(changes, token), ct);

  private static List<PackageChange> ToChanges(IReadOnlyList<PackageChangeParams> changes)
    => changes.Select(change => new PackageChange(change.Kind, change.Id, change.Version, change.Projects)).ToList();

  private static async Task<PackagesPlanResult> PlanAsync(SessionManager sessions, PlanAdvisor advisor,
    IReadOnlyList<PackageChangeParams> requested, CancellationToken ct) {
    var projects = sessions.Require().Projects;
    var changes = ToChanges(requested);
    var plan = new PackageChangePlanner(projects, new ProjectFileSet()).Plan(changes);
    var advice = await advisor.FrameworkWarningsAsync(changes, projects, ct).ConfigureAwait(false);
    return new PackagesPlanResult(
      plan.Edits.Select(edit => new PlannedEditInfo(edit.File, edit.Line, edit.OldText, edit.NewText)).ToList(),
      plan.Warnings.Concat(advice).Select(ToInfo).ToList()
    );
  }

  private static PlanWarningInfo ToInfo(PlanWarning warning)
    => new(warning.Kind, warning.PackageId, warning.File, warning.Projects, warning.Packages, warning.Detail);
}
