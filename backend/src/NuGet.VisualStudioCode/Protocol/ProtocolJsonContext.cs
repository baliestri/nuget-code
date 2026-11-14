// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json.Serialization;

namespace NuGet.VisualStudioCode.Protocol;

[JsonSourceGenerationOptions(
  PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
  DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
)]
[JsonSerializable(typeof(Empty))]
[JsonSerializable(typeof(InitializeParams))]
[JsonSerializable(typeof(InitializeResult))]
[JsonSerializable(typeof(LogEntry))]
[JsonSerializable(typeof(SolutionOpenParams))]
[JsonSerializable(typeof(SolutionOpenResult))]
[JsonSerializable(typeof(DidChangeFilesParams))]
[JsonSerializable(typeof(SolutionDidChangeParams))]
[JsonSerializable(typeof(PackagesInstalledResult))]
[JsonSerializable(typeof(CredentialsRequestParams))]
[JsonSerializable(typeof(CredentialsRequestResult))]
[JsonSerializable(typeof(CredentialsResetParams))]
[JsonSerializable(typeof(PackagesPlanParams))]
[JsonSerializable(typeof(PackagesPlanResult))]
[JsonSerializable(typeof(RestoreRunParams))]
[JsonSerializable(typeof(OperationResult))]
[JsonSerializable(typeof(ConfigurationParams))]
[JsonSerializable(typeof(PackagesUpdatesParams))]
[JsonSerializable(typeof(PackagesUpdatesResult))]
[JsonSerializable(typeof(ProgressParams))]
[JsonSerializable(typeof(PackagesSearchParams))]
[JsonSerializable(typeof(PackagesSearchResult))]
[JsonSerializable(typeof(PackagesDetailsParams))]
[JsonSerializable(typeof(PackageDetailsResult))]
[JsonSerializable(typeof(SourcesListResult))]
[JsonSerializable(typeof(FoldersListResult))]
[JsonSerializable(typeof(FolderSizeParams))]
[JsonSerializable(typeof(FolderSizeResult))]
internal sealed partial class ProtocolJsonContext : JsonSerializerContext;
