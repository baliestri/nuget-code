// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json;

namespace NuGet.VisualStudioCode.Console.Channel;

/// <summary>
///   The answers of the extension, as far as the cmdlets read them. A list the answer leaves out is null
///   here, so every reader goes through <see cref="Wire.OrEmpty{T}" />.
/// </summary>
internal static class Wire {
  public static IReadOnlyList<T> OrEmpty<T>(IReadOnlyList<T>? list)
    => list ?? [];

  internal sealed record SolutionProject(string Name, string Path, IReadOnlyList<string>? Frameworks);

  internal sealed record ProjectList(IReadOnlyList<SolutionProject>? Projects);

  internal sealed record PickedProject(string? Path);

  internal sealed record InstalledPackage(
    string Id,
    string? RequestedVersion,
    string? ResolvedVersion,
    bool Implicit
  );

  internal sealed record TransitivePackage(string Id, string ResolvedVersion, IReadOnlyList<string>? Via);

  internal sealed record ProjectPackages(
    string ProjectPath,
    IReadOnlyList<InstalledPackage>? Packages,
    IReadOnlyList<TransitivePackage>? Transitive
  );

  internal sealed record Installed(IReadOnlyList<ProjectPackages>? Projects);

  internal sealed record FeedFailure(string Feed, string Message);

  internal sealed record FeedVersion(string Feed, string Version);

  internal sealed record PackageLatest(string Id, IReadOnlyList<FeedVersion>? Versions);

  internal sealed record Updates(IReadOnlyList<PackageLatest>? Packages, IReadOnlyList<FeedFailure>? Failures);

  internal sealed record PackageSummary(
    string Id,
    string Version,
    string? Description,
    string? Authors,
    string Feed
  );

  internal sealed record Search(IReadOnlyList<PackageSummary>? Packages, IReadOnlyList<FeedFailure>? Failures);

  internal sealed record VulnerableVersion(string Version, string Severity);

  internal sealed record Details(
    string Id,
    IReadOnlyList<string>? Versions,
    string? Description,
    string? Authors,
    string? Feed,
    IReadOnlyList<FeedFailure>? Failures,
    IReadOnlyList<VulnerableVersion>? VulnerableVersions
  );

  internal sealed record Advisory(string Severity, string Url);

  internal sealed record VulnerablePackage(string Id, string Version, IReadOnlyList<Advisory>? Advisories);

  internal sealed record Vulnerabilities(
    IReadOnlyList<VulnerablePackage>? Packages,
    IReadOnlyList<FeedFailure>? Failures
  );

  internal sealed record SourceInfo(string Name, string Source, bool Enabled);

  internal sealed record SourceList(IReadOnlyList<SourceInfo>? Sources);

  internal sealed record PlannedEdit(string File, int Line, string OldText, string NewText);

  internal sealed record PlanWarning(
    string Kind,
    string PackageId,
    string? File,
    IReadOnlyList<string>? Projects,
    IReadOnlyList<string>? Packages,
    string? Detail
  );

  internal sealed record Plan(IReadOnlyList<PlannedEdit>? Edits, IReadOnlyList<PlanWarning>? Warnings);

  internal sealed record RestoreMessage(string Level, string? Code, string Message);

  internal sealed record ProjectOperation(
    string Project,
    IReadOnlyList<string>? ChangedFiles,
    IReadOnlyList<string>? EditErrors,
    string Restore,
    IReadOnlyList<RestoreMessage>? Messages
  );

  internal sealed record Operation(string? Engine, bool FellBack, IReadOnlyList<ProjectOperation>? Projects);

  internal sealed record Change(string Kind, string Id, string? Version, IReadOnlyList<string> Projects);

  internal sealed record Nothing;

  // What the cmdlets send.

  internal sealed record PickProjectParams(string? Current);

  internal sealed record UpdatesParams(bool Prerelease, bool Transitive);

  internal sealed record SearchParams(string? Query, string? Feed, bool Prerelease, int Skip, int Take);

  internal sealed record DetailsParams(string Id, string? Feed, bool Prerelease);

  internal sealed record ChangesParams(IReadOnlyList<Change> Changes);

  internal sealed record InstallParams(string Id, string Version, IReadOnlyList<string> Projects);

  internal sealed record RemoveParams(string Id, IReadOnlyList<string> Projects);

  internal sealed record RestoreParams(IReadOnlyList<string>? Projects, bool Force);

  // The lines the extension answers with.

  internal sealed record Progress(string Step, string? Project);

  internal sealed record ErrorInfo(string? Code, string? Message);

  internal sealed record Response(Progress? Progress, JsonElement? Result, ErrorInfo? Error);
}
