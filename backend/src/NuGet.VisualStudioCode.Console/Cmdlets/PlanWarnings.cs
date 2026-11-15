// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>
///   Says, in one sentence, what a change does beyond what was asked. The sentences are the ones the NuGet
///   view shows for the same warnings.
/// </summary>
internal static class PlanWarnings {
  public static string Describe(Wire.PlanWarning warning) {
    var id = warning.PackageId;
    var file = warning.File is null ? "a shared file" : Path.GetFileName(warning.File);
    var projects = Listed(Wire.OrEmpty(warning.Projects).Select(Path.GetFileNameWithoutExtension).OfType<string>());
    var detail = warning.Detail ?? string.Empty;
    return warning.Kind switch {
      "centralShared" => $"{id}: the version in {file} is shared, so it changes for {projects}.",
      "importedShared" => $"{id}: the version is declared in {file}, so it changes for {projects}.",
      "propertyShared" =>
        $"{id}: its version comes from the property {detail} in {file}, which {Listed(Wire.OrEmpty(warning.Packages))} also use.",
      "literalWrite" =>
        $"{id}: the version is the expression {detail} in {file}; it is replaced by the version itself.",
      "rangeReplaced" =>
        $"{id}: the version is {warning.Detail ?? "a range"} in {file}; it is replaced by one version.",
      "downgrade" => $"{id}: this is a downgrade from {warning.Detail ?? "a newer version"}.",
      "centralRemoved" => $"{id}: no other project uses it, so its version is removed from {file} too.",
      "removeItem" => $"{id}: it is declared in an imported file, so {file} opts out of it instead.",
      "frameworkMismatch" =>
        $"{id}: this version lists no framework compatible with {warning.Detail ?? "the target framework"} of {projects}.",
      var _ => warning.Detail is null ? $"{id}: {warning.Kind}." : $"{id}: {warning.Kind} ({warning.Detail})."
    };
  }

  /// <summary>The first three names, and how many more there are.</summary>
  private static string Listed(IEnumerable<string> names) {
    var all = names.ToList();
    return all.Count <= 3
      ? string.Join(", ", all)
      : $"{string.Join(", ", all.Take(3))} and {all.Count - 3} more";
  }
}
