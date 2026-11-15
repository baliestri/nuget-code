// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console;

/// <summary>What one console remembers while it is open: where the editor listens and the default project.</summary>
public static class ConsoleSession {
  private readonly static Lock Gate = new();
  private static bool _started;
  private static string? _projectPath;
  private static string? _projectName;

  /// <summary>The text of the prompt: it names the default project, when there is one.</summary>
  [SuppressMessage("ReSharper", "UnusedMember.Global",
    Justification = "Read by the prompt function of NuGetCode.Prompt.ps1, which no C# code calls.")]
  public static string Prompt {
    get
    {
      lock (Gate) {
        Start();
        return _projectName is null ? "PM> " : $"PM [{_projectName}]> ";
      }
    }
  }

  internal static ConsoleClient Client {
    get
    {
      lock (Gate) {
        return field ??= ConsoleClient.FromEnvironment();
      }
    }
  }

  /// <summary>The path of the default project; null when the console has none.</summary>
  internal static string? DefaultProjectPath {
    get
    {
      lock (Gate) {
        Start();
        return _projectPath;
      }
    }
  }

  internal static void SetDefaultProject(Wire.SolutionProject project) {
    lock (Gate) {
      _started = true;
      _projectPath = project.Path;
      _projectName = project.Name;
    }
  }

  /// <summary>The first time, the default project is the one the editor started the shell with.</summary>
  private static void Start() {
    if (_started) {
      return;
    }

    _started = true;
    var path = Environment.GetEnvironmentVariable(ConsoleEnvironment.PROJECT);
    if (string.IsNullOrEmpty(path)) {
      return;
    }

    _projectPath = path;
    // The name the solution gives it is learned with the first request; until then, the name of the file.
    _projectName = Path.GetFileNameWithoutExtension(path);
  }
}
