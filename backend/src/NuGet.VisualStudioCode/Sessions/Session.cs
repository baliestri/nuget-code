// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Sessions;

internal sealed record Session(SolutionDescriptor Solution, IReadOnlyList<EvaluatedProject> Projects);
