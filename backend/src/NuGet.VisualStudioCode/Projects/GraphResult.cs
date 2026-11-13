// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.ProjectModel;

namespace NuGet.VisualStudioCode.Projects;

internal sealed record GraphResult(DependencyGraphSpec? Graph, string? Error);
