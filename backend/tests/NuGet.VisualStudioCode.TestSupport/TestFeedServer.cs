// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security;
using System.Text;
using NuGet.Versioning;

namespace NuGet.VisualStudioCode.TestSupport;

public sealed class TestFeedServer : IDisposable {
  private const string ATOM = "application/atom+xml";
  private const string INDEX_SUFFIX = "/index.json";
  private const string BINARY = "application/octet-stream";
  private const string JSON = "application/json";
  private const string PACKAGE_SUFFIX = ".nupkg";

  private readonly string _baseUrl;
  private readonly HttpListener _listener = new();
  private readonly Task _loop;
  private readonly TempDirectory _packageFiles = new();
  private readonly IReadOnlyList<TestFeedPackage> _packages;
  private readonly ConcurrentQueue<string> _requestedPaths = new();
  private readonly CancellationTokenSource _stopping = new();

  private string? _expectedAuthorization;

  public TestFeedServer(params TestFeedPackage[] packages) {
    _packages = packages;
    _baseUrl = string.Create(CultureInfo.InvariantCulture, $"http://localhost:{FreePort()}");
    _listener.Prefixes.Add(_baseUrl + "/");
    _listener.Start();
    _loop = Task.Run(ServeAsync);
  }

  public string V3Url => _baseUrl + "/v3/index.json";

  public string V2Url => _baseUrl + "/v2/";

  public IReadOnlyCollection<string> RequestedPaths => _requestedPaths;

  /// <summary>How long the server holds a package download, so a test can act while a restore is running.</summary>
  public TimeSpan PackageDelay { get; init; }

  public void Dispose() {
    _stopping.Cancel();
    _listener.Stop();
    _listener.Close();
    try {
      _loop.Wait(TimeSpan.FromSeconds(5));
    }
    catch (AggregateException) {
      // The loop ends with an error when the listener closes.
    }

    _packageFiles.Dispose();
    _stopping.Dispose();
  }

  public void RequireBasicAuthentication(string user, string password)
    => _expectedAuthorization = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{password}"));

  private static int FreePort() {
    using var probe = new TcpListener(IPAddress.Loopback, 0);
    probe.Start();
    return ((IPEndPoint)probe.LocalEndpoint).Port;
  }

  private async Task ServeAsync() {
    while (_listener.IsListening) {
      HttpListenerContext context;
      try {
        context = await _listener.GetContextAsync().ConfigureAwait(false);
      }
      catch (HttpListenerException) {
        return;
      }
      catch (ObjectDisposedException) {
        return;
      }

      await HandleAsync(context).ConfigureAwait(false);
    }
  }

  private async Task HandleAsync(HttpListenerContext context) {
    var path = context.Request.Url!.AbsolutePath;
    _requestedPaths.Enqueue(path);
    var authorization = context.Request.Headers["Authorization"];
    if (_expectedAuthorization is not null &&
        !string.Equals(authorization, _expectedAuthorization, StringComparison.Ordinal)) {
      context.Response.StatusCode = 401;
      context.Response.AddHeader("WWW-Authenticate", "Basic realm=\"test\"");
      context.Response.Close();
      return;
    }

    var query = context.Request.QueryString;
    var isPackage = path.EndsWith(PACKAGE_SUFFIX, StringComparison.OrdinalIgnoreCase);
    var (contentType, body) = isPackage ? (BINARY, null) : Route(path, query["q"], query["id"], query["prerelease"]);
    var bytes = isPackage ? PackageContent(path) : body is null ? null : Encoding.UTF8.GetBytes(body);
    if (isPackage &&
        PackageDelay > TimeSpan.Zero) {
      try {
        await Task.Delay(PackageDelay, _stopping.Token).ConfigureAwait(false);
      }
      catch (OperationCanceledException) {
        context.Response.Abort();
        return;
      }
    }

    if (bytes is null) {
      context.Response.StatusCode = 404;
      context.Response.Close();
      return;
    }

    context.Response.ContentType = contentType;
    context.Response.ContentLength64 = bytes.Length;
    await context.Response.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
    context.Response.Close();
  }

  private (string ContentType, string? Body) Route(string path, string? query, string? idFilter, string? prerelease) {
    if (string.Equals(path, "/v3/index.json", StringComparison.Ordinal)) {
      return (JSON, ServiceIndex());
    }

    if (string.Equals(path, "/v3/query", StringComparison.Ordinal)) {
      var includePrerelease = string.Equals(prerelease, "true", StringComparison.OrdinalIgnoreCase);
      return (JSON, Search(query ?? string.Empty, includePrerelease));
    }

    if (path.StartsWith("/v3/flat/", StringComparison.Ordinal) &&
        path.EndsWith(INDEX_SUFFIX, StringComparison.Ordinal)) {
      return (JSON, FlatVersions(Segment(path, 3)));
    }

    if (path.StartsWith("/v3/reg/", StringComparison.Ordinal) &&
        path.EndsWith(INDEX_SUFFIX, StringComparison.Ordinal)) {
      return (JSON, Registration(Segment(path, 3)));
    }

    if (string.Equals(path, "/v2/FindPackagesById()", StringComparison.Ordinal)) {
      return (ATOM, AtomFeed((idFilter ?? string.Empty).Trim('\'')));
    }

    return (JSON, null);
  }

  private static string Segment(string path, int index)
    => path.Split('/')[index];

  // /v3/flat/<id>/<version>/<id>.<version>.nupkg: a real package, built the first time it is asked for.
  private byte[]? PackageContent(string path) {
    var segments = path.Split('/');
    if (segments.Length < 6) {
      return null;
    }

    var package = _packages.FirstOrDefault(candidate
      => string.Equals(candidate.Id, segments[3], StringComparison.OrdinalIgnoreCase) &&
         string.Equals(candidate.Version, segments[4], StringComparison.OrdinalIgnoreCase));
    if (package is null) {
      return null;
    }

    var file = _packageFiles.Combine($"{package.Id}.{package.Version}.nupkg");
    if (!File.Exists(file)) {
      TestPackages.Create(_packageFiles.Path, package.Id, package.Version);
    }

    return File.ReadAllBytes(file);
  }

  private List<TestFeedPackage> Versions(string id)
    => _packages
      .Where(package => string.Equals(package.Id, id, StringComparison.OrdinalIgnoreCase))
      .OrderBy(package => NuGetVersion.Parse(package.Version))
      .ToList();

  private string ServiceIndex()
    => $$"""
      {
        "version": "3.0.0",
        "resources": [
          { "@id": "{{_baseUrl}}/v3/query", "@type": "SearchQueryService" },
          { "@id": "{{_baseUrl}}/v3/query", "@type": "SearchQueryService/3.0.0-beta" },
          { "@id": "{{_baseUrl}}/v3/query", "@type": "SearchQueryService/3.0.0-rc" },
          { "@id": "{{_baseUrl}}/v3/query", "@type": "SearchQueryService/3.5.0" },
          { "@id": "{{_baseUrl}}/v3/query", "@type": "SearchQueryService/Versioned", "clientVersion": "4.0.0" },
          { "@id": "{{_baseUrl}}/v3/reg/", "@type": "RegistrationsBaseUrl" },
          { "@id": "{{_baseUrl}}/v3/reg/", "@type": "RegistrationsBaseUrl/3.6.0" },
          { "@id": "{{_baseUrl}}/v3/flat/", "@type": "PackageBaseAddress/3.0.0" }
        ]
      }
      """;

  private string Search(string term, bool prerelease) {
    var hits = _packages
      .Where(package => package.Id.Contains(term, StringComparison.OrdinalIgnoreCase))
      .Where(package => prerelease || !NuGetVersion.Parse(package.Version).IsPrerelease)
      .GroupBy(package => package.Id, StringComparer.OrdinalIgnoreCase)
      .Select(group => group.MaxBy(package => NuGetVersion.Parse(package.Version))!)
      .Select(SearchHit)
      .ToList();
    return string.Create(
      CultureInfo.InvariantCulture,
      $$"""{ "totalHits": {{hits.Count}}, "data": [{{string.Join(",", hits)}}] }"""
    );
  }

  private string SearchHit(TestFeedPackage package) {
    var lower = package.Id.ToLowerInvariant();
    return $$"""
      {
        "id": "{{package.Id}}",
        "version": "{{package.Version}}",
        "description": "{{package.Description}}",
        "authors": ["tests"],
        "totalDownloads": 42,
        "versions": [
          { "version": "{{package.Version}}", "downloads": 42, "@id": "{{_baseUrl}}/v3/reg/{{lower}}/{{package.Version}}.json" }
        ]
      }
      """;
  }

  private string? FlatVersions(string id) {
    var versions = Versions(id);
    if (versions.Count == 0) {
      return null;
    }

    var list = string.Join(",", versions.Select(package => $"\"{package.Version.ToLowerInvariant()}\""));
    return $$"""{ "versions": [{{list}}] }""";
  }

  private string? Registration(string id) {
    var versions = Versions(id);
    if (versions.Count == 0) {
      return null;
    }

    var lower = id.ToLowerInvariant();
    var leaves = string.Join(",", versions.Select(package => RegistrationLeaf(lower, package)));
    return string.Create(CultureInfo.InvariantCulture,
      $$"""
      {
        "count": 1,
        "items": [{
          "@id": "{{_baseUrl}}/v3/reg/{{lower}}/index.json#page",
          "count": {{versions.Count}},
          "lower": "{{versions[0].Version}}",
          "upper": "{{versions[^1].Version}}",
          "items": [{{leaves}}]
        }]
      }
      """);
  }

  private string RegistrationLeaf(string lower, TestFeedPackage package)
    => $$"""
      {
        "@id": "{{_baseUrl}}/v3/reg/{{lower}}/{{package.Version}}.json",
        "packageContent": "{{_baseUrl}}/v3/flat/{{lower}}/{{package.Version}}/{{lower}}.{{package.Version}}.nupkg",
        "catalogEntry": {
          "@id": "{{_baseUrl}}/v3/catalog/{{lower}}.{{package.Version}}.json",
          "id": "{{package.Id}}",
          "version": "{{package.Version}}",
          "description": "{{package.Description}}",
          "authors": "tests",
          "listed": true,
          "licenseExpression": "MIT",
          "dependencyGroups": []
        }
      }
      """;

  private string AtomFeed(string id) {
    var entries = string.Join(Environment.NewLine, Versions(id).Select(AtomEntry));
    return $"""
      <?xml version="1.0" encoding="utf-8"?>
      <feed xml:base="{_baseUrl}/v2/" xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
        <id>{_baseUrl}/v2/FindPackagesById</id>
        <title type="text">FindPackagesById</title>
        <updated>2026-01-01T00:00:00Z</updated>
        {entries}
      </feed>
      """;
  }

  private string AtomEntry(TestFeedPackage package) {
    var description = SecurityElement.Escape(package.Description);
    var isPrerelease = NuGetVersion.Parse(package.Version).IsPrerelease ? "true" : "false";
    return $"""
      <entry>
        <id>{_baseUrl}/v2/Packages(Id='{package.Id}',Version='{package.Version}')</id>
        <title type="text">{package.Id}</title>
        <summary type="text">{description}</summary>
        <updated>2026-01-01T00:00:00Z</updated>
        <author><name>tests</name></author>
        <content type="application/zip" src="{_baseUrl}/v2/package/{package.Id}/{package.Version}" />
        <m:properties>
          <d:Id>{package.Id}</d:Id>
          <d:Version>{package.Version}</d:Version>
          <d:Description>{description}</d:Description>
          <d:Authors>tests</d:Authors>
          <d:Dependencies></d:Dependencies>
          <d:Published m:type="Edm.DateTime">2026-01-01T00:00:00</d:Published>
          <d:IsPrerelease m:type="Edm.Boolean">{isPrerelease}</d:IsPrerelease>
        </m:properties>
      </entry>
      """;
  }
}
