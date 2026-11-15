// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Console.Tests.Support;

/// <summary>A request the fake editor received: its method and its params, as the JSON that was sent.</summary>
internal sealed record FakeRequest(string Method, string Params);
