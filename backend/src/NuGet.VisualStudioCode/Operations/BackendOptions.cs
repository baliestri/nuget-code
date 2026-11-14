// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Operations;

internal sealed class BackendOptions {
  public string RestoreEngine { get; set; } = "embedded";

  public bool RestoreOnOpen { get; set; } = true;
}
