// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Configuration;

namespace NuGet.VisualStudioCode.Configuration;

internal sealed class SettingsProvider(Func<string?> solutionDirectory) {
  public string Root => solutionDirectory() ?? Environment.CurrentDirectory;

  public ISettings Load()
    => Settings.LoadDefaultSettings(Root);
}
