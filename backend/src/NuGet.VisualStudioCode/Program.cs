// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Methods;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sdk;

var input = new BufferedStream(Console.OpenStandardInput());
var output = Console.OpenStandardOutput();
using var writer = new MessageWriter(output);
var connection = new RpcConnection(new MessageReader(input), writer);
var sdk = new SdkService();

LifecycleMethods.Register(connection, sdk);

try {
  await connection.RunAsync(CancellationToken.None).ConfigureAwait(false);
  return 0;
}
catch (Exception exception) when (exception is IOException or InvalidDataException) {
  await Console.Error.WriteLineAsync(exception.ToString()).ConfigureAwait(false);
  return 1;
}
finally {
  ChildProcesses.KillAll();
  await input.DisposeAsync().ConfigureAwait(false);
  await output.DisposeAsync().ConfigureAwait(false);
}
