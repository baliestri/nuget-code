// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.ProjectModel;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Projects;

/// <summary>
///   One project as last evaluated. <see cref="Graph" /> is the restore graph the project came from, kept so the
///   embedded engine can restore without evaluating again; it is null when the evaluation failed.
/// </summary>
internal sealed record EvaluatedProject(
  ProjectInfo Info,
  IReadOnlyList<DeclaredPackage> Packages,
  string? AssetsPath,
  DependencyGraphSpec? Graph = null
);
