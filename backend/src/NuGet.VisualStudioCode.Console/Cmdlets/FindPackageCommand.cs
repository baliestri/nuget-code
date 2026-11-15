// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Model;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>Searches the package sources for a keyword, or looks up one package by its exact id.</summary>
[Cmdlet(VerbsCommon.Find, "Package")]
[OutputType(typeof(ConsoleFoundPackage))]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "MemberCanBePrivate.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "AutoPropertyCanBeMadeGetOnly.Global", Justification = Justifications.CMDLET)]
public sealed class FindPackageCommand : NuGetCmdlet {
  /// <summary>The keyword to search for; with <c>-ExactMatch</c>, the id of the package.</summary>
  [Parameter(Position = 0, ValueFromPipelineByPropertyName = true)]
  public string? Id { get; set; }

  /// <summary>The name of one package source, in place of all the enabled ones.</summary>
  [Parameter]
  [ArgumentCompleter(typeof(SourceNameCompleter))]
  public string? Source { get; set; }

  [Parameter]
  public SwitchParameter IncludePrerelease { get; set; }

  /// <summary>How many packages to return, at most a hundred.</summary>
  [Parameter]
  [ValidateRange(1, 100)]
  public int First { get; set; } = 20;

  [Parameter]
  [ValidateRange(0, int.MaxValue)]
  public int Skip { get; set; }

  /// <summary>Returns only the package whose id is exactly the one given.</summary>
  [Parameter]
  public SwitchParameter ExactMatch { get; set; }

  /// <summary>Returns every version of each package, not only the newest.</summary>
  [Parameter]
  public SwitchParameter AllVersions { get; set; }

  private string? Feed => string.IsNullOrEmpty(Source) ? null : Source;

  protected override void Run() {
    if (ExactMatch.IsPresent) {
      if (string.IsNullOrEmpty(Id)) {
        throw new ConsoleException("-ExactMatch needs the id of the package.");
      }

      var exact = Details(Id);
      if (exact is not null) {
        WriteObject(exact);
      }

      return;
    }

    var found = Ask(
      ConsoleRequestNames.SEARCH,
      new Wire.SearchParams(string.IsNullOrEmpty(Id) ? null : Id, Feed, IncludePrerelease.IsPresent, Skip, First),
      WireJsonContext.Default.SearchParams,
      WireJsonContext.Default.Search
    );
    WarnOf(found.Failures);
    foreach (var package in Wire.OrEmpty(found.Packages))
      WriteObject(AllVersions.IsPresent ? Details(package.Id) ?? Summary(package) : Summary(package));
  }

  private static ConsoleFoundPackage Summary(Wire.PackageSummary package)
    => new(package.Id, package.Version) {
      Description = package.Description, Authors = package.Authors, Source = package.Feed
    };

  /// <summary>The package with that id, with its versions; null when no source has it.</summary>
  private ConsoleFoundPackage? Details(string id) {
    var details = Ask(
      ConsoleRequestNames.DETAILS,
      new Wire.DetailsParams(id, Feed, IncludePrerelease.IsPresent),
      WireJsonContext.Default.DetailsParams,
      WireJsonContext.Default.Details
    );
    WarnOf(details.Failures);
    var versions = Wire.OrEmpty(details.Versions);
    return versions.Count == 0
      ? null
      : new ConsoleFoundPackage(details.Id, versions[0]) {
        Versions = AllVersions.IsPresent ? versions : [],
        Description = details.Description,
        Authors = details.Authors,
        Source = details.Feed
      };
  }
}
