// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;

namespace NuGet.VisualStudioCode.Sdk;

internal static class ChildProcesses {
  private readonly static ConcurrentDictionary<int, Process> Running = new();

  public static void Track(Process process)
    => Running[process.Id] = process;

  public static void Untrack(Process process)
    => Running.TryRemove(KeyValuePair.Create(process.Id, process));

  public static void KillAll() {
    foreach (var process in Running.Values) Kill(process);
  }

  public static void Kill(Process process) {
    try {
      if (!process.HasExited) {
        process.Kill(true);
      }
    }
    catch (InvalidOperationException) {
      // The process exited between the check and the kill.
    }
    catch (Win32Exception) {
      // The process is already terminating.
    }
  }
}
