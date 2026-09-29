using System.Text.Json;
using NuGet.Versioning;

if (args.Length != 1) throw new ArgumentException("Expected a JSON input file.");
var request = JsonSerializer.Deserialize<Request>(File.ReadAllText(args[0]))
    ?? throw new ArgumentException("Invalid input.");
var parsed = request.Versions.Select(value =>
{
    var valid = NuGetVersion.TryParse(value, out var version);
    return new { value, valid, normalized = version?.ToNormalizedString() };
}).ToArray();
var comparisons = request.Pairs.Select(pair => new
{
    a = pair[0],
    b = pair[1],
    sign = Math.Sign(VersionComparer.VersionRelease.Compare(
        NuGetVersion.Parse(pair[0]), NuGetVersion.Parse(pair[1])))
}).ToArray();
Console.WriteLine(JsonSerializer.Serialize(new { parsed, comparisons }));

record Request(string[] Versions, string[][] Pairs);
