// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Text;
using NuGet.Frameworks;
using NuGet.Packaging;
using NuGet.Packaging.Core;
using NuGet.Versioning;

namespace NuGet.VisualStudioCode.TestSupport;

public static class TestPackages {
  private const string DEFAULT_FRAMEWORK = "netstandard2.0";

  public static void Create(string feedDirectory, string id, string version,
    params (string Id, string Range)[] dependencies)
    => Create(feedDirectory, id, version, DEFAULT_FRAMEWORK, dependencies);

  public static void Create(string feedDirectory, string id, string version, string framework,
    params (string Id, string Range)[] dependencies) {
    Directory.CreateDirectory(feedDirectory);
    var builder = new PackageBuilder {
      Id = id,
      Version = NuGetVersion.Parse(version),
      Description = $"Test package {id}."
    };
    builder.Authors.Add("tests");
    builder.DependencyGroups.Add(new PackageDependencyGroup(NuGetFramework.Parse(framework),
      dependencies.Select(dependency => new PackageDependency(dependency.Id, VersionRange.Parse(dependency.Range)))));
    builder.Files.Add(new PhysicalPackageFile(new MemoryStream(Encoding.UTF8.GetBytes(id)))
      { TargetPath = $"lib/{framework}/_._" });
    var path = Path.Combine(feedDirectory, $"{id}.{version}.nupkg");
    using var stream = File.Create(path);
    builder.Save(stream);
  }
}
