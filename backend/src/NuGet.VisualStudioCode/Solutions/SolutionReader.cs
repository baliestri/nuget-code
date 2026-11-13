// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text.Json;
using System.Xml;
using Microsoft.VisualStudio.SolutionPersistence.Model;
using Microsoft.VisualStudio.SolutionPersistence.Serializer;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Solutions;

internal static class SolutionReader {
  private readonly static string[] ProjectExtensions = [".csproj", ".fsproj", ".vbproj"];

  public static async Task<SolutionDescriptor> ReadAsync(
    string path,
    IReadOnlyList<string>? implicitProjects,
    CancellationToken ct
  ) {
    if (implicitProjects is not null) {
      return new SolutionDescriptor(
        path,
        Path.GetFullPath(path),
        SolutionKind.Implicit,
        Normalize(implicitProjects.Select(Path.GetFullPath))
      );
    }

    if (!File.Exists(path)) {
      throw Unreadable(path, "The file does not exist.");
    }

    var directory = Path.GetDirectoryName(Path.GetFullPath(path))!;
    var extension = Path.GetExtension(path);
    if (HasExtension(extension, ".slnf")) {
      return await ReadFilterAsync(path, directory, ct).ConfigureAwait(false);
    }

    SolutionKind kind;
    if (HasExtension(extension, ".sln")) {
      kind = SolutionKind.Sln;
    }
    else if (HasExtension(extension, ".slnx")) {
      kind = SolutionKind.Slnx;
    }
    else {
      throw Unreadable(path, "The file is not a .sln, .slnx or .slnf.");
    }

    var relative = await ReadProjectsAsync(path, ct).ConfigureAwait(false);
    return new SolutionDescriptor(
      path,
      directory,
      kind,
      Normalize(relative.Select(project => Resolve(directory, project)))
    );
  }

  private static bool HasExtension(string extension, string expected)
    => string.Equals(extension, expected, StringComparison.OrdinalIgnoreCase);

  private static async Task<IReadOnlyList<string>> ReadProjectsAsync(string path, CancellationToken ct) {
    var serializer = SolutionSerializers.GetSerializerByMoniker(path) ??
                     throw Unreadable(path, "No serializer accepts this file.");
    try {
      var model = await serializer.OpenAsync(path, ct).ConfigureAwait(false);
      return model.SolutionProjects.Select(project => project.FilePath).ToList();
    }
    catch (SolutionException exception) {
      throw Unreadable(path, exception.Message);
    }
    catch (XmlException exception) {
      throw Unreadable(path, exception.Message);
    }
  }

  private static async Task<SolutionDescriptor> ReadFilterAsync(string path, string directory, CancellationToken ct) {
    try {
      var stream = File.OpenRead(path);
      await using (stream.ConfigureAwait(false)) {
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
        var solution = document.RootElement.GetProperty("solution");
        var solutionPath = Resolve(directory, solution.GetProperty("path").GetString()!);
        var solutionDirectory = Path.GetDirectoryName(solutionPath)!;
        var projects = solution.GetProperty("projects")
          .EnumerateArray()
          .Select(project => Resolve(solutionDirectory, project.GetString()!));
        return new SolutionDescriptor(path, solutionDirectory, SolutionKind.Slnf, Normalize(projects));
      }
    }
    catch (JsonException exception) {
      throw Unreadable(path, exception.Message);
    }
    catch (KeyNotFoundException) {
      throw Unreadable(path, "The solution filter has no 'solution.path' or 'solution.projects'.");
    }
    catch (InvalidOperationException exception) {
      throw Unreadable(path, exception.Message);
    }
  }

  private static string Resolve(string directory, string relative)
    => Path.GetFullPath(Path.Combine(directory, relative.Replace('\\', Path.DirectorySeparatorChar)));

  private static List<string> Normalize(IEnumerable<string> paths)
    => paths
      .Where(path => ProjectExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase))
      .Distinct(StringComparer.OrdinalIgnoreCase)
      .Order(StringComparer.OrdinalIgnoreCase)
      .ToList();

  private static RpcException Unreadable(string path, string reason)
    => new(RpcErrorCodes.SOLUTION_UNREADABLE, $"The solution '{path}' could not be read.", reason);
}
