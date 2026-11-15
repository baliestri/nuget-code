// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace NuGet.VisualStudioCode.Console.Channel;

/// <summary>The JSON of the channel, generated at build time: camelCase names, nulls left out.</summary>
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(Wire.Response))]
[JsonSerializable(typeof(Wire.Nothing))]
[JsonSerializable(typeof(Wire.ProjectList))]
[JsonSerializable(typeof(Wire.PickedProject))]
[JsonSerializable(typeof(Wire.Installed))]
[JsonSerializable(typeof(Wire.Updates))]
[JsonSerializable(typeof(Wire.Search))]
[JsonSerializable(typeof(Wire.Details))]
[JsonSerializable(typeof(Wire.Vulnerabilities))]
[JsonSerializable(typeof(Wire.SourceList))]
[JsonSerializable(typeof(Wire.Plan))]
[JsonSerializable(typeof(Wire.Operation))]
[JsonSerializable(typeof(Wire.PickProjectParams))]
[JsonSerializable(typeof(Wire.UpdatesParams))]
[JsonSerializable(typeof(Wire.SearchParams))]
[JsonSerializable(typeof(Wire.DetailsParams))]
[JsonSerializable(typeof(Wire.ChangesParams))]
[JsonSerializable(typeof(Wire.InstallParams))]
[JsonSerializable(typeof(Wire.RemoveParams))]
[JsonSerializable(typeof(Wire.RestoreParams))]
internal sealed partial class WireJsonContext : JsonSerializerContext;
