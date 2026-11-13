// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json.Serialization;

namespace NuGet.VisualStudioCode.Tests.Rpc;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(EchoParams))]
[JsonSerializable(typeof(EchoResult))]
internal sealed partial class TestJsonContext : JsonSerializerContext;
