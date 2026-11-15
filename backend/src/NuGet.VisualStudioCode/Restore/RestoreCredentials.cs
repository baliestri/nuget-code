// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   The environment variables that carry feed credentials into a <c>dotnet</c> process, and the sources whose
///   credentials could not be carried because their name is not usable in a variable name.
/// </summary>
internal sealed record RestoreCredentials(
  IReadOnlyDictionary<string, string> Environment,
  IReadOnlyList<string> Skipped);
