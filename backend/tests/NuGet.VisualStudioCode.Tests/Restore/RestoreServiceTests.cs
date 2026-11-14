// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Tests.Restore;

public sealed class RestoreServiceTests {
  private const string BROKEN = "the engine broke";

  private readonly static RestoreTarget Target =
    new(new SolutionDescriptor("Sample.slnx", ".", SolutionKind.Slnx, []), [], true, false);

  private static Exception EngineFailure()
    => new RestoreEngineException(BROKEN, new InvalidOperationException(BROKEN));

  private static RestoreService Service(BackendLog log, BackendOptions options, params FakeRestoreEngine[] engines)
    => new(engines.ToDictionary(engine => engine.Name, IRestoreEngine (engine) => engine, StringComparer.Ordinal),
      options, log);

  private static BackendLog Log(ConcurrentQueue<LogEntry>? entries = null)
    => new(entry =>
    {
      entries?.Enqueue(entry);
      return Task.CompletedTask;
    });

  [Fact]
  public async Task Embedded_result_is_returned_as_is() {
    var ct = TestContext.Current.CancellationToken;
    await using var log = Log();
    var embedded = new FakeRestoreEngine(RestoreEngineNames.EMBEDDED, RestoreStates.FAILED);
    var console = new FakeRestoreEngine(RestoreEngineNames.CONSOLE);

    var result = await Service(log, new BackendOptions(), embedded, console).RestoreAsync(Target, null, ct);

    Assert.Equal(RestoreEngineNames.EMBEDDED, result.Engine);
    Assert.False(result.FellBack);
    Assert.Equal(RestoreStates.FAILED, Assert.Single(result.Projects).Restore);
    Assert.Equal(0, console.Calls);
  }

  [Fact]
  public async Task Engine_failure_falls_back_to_console() {
    var ct = TestContext.Current.CancellationToken;
    var entries = new ConcurrentQueue<LogEntry>();
    var log = Log(entries);
    var embedded = new FakeRestoreEngine(RestoreEngineNames.EMBEDDED, failure: EngineFailure());
    var console = new FakeRestoreEngine(RestoreEngineNames.CONSOLE);

    var result = await Service(log, new BackendOptions(), embedded, console).RestoreAsync(Target, null, ct);
    await log.DisposeAsync();

    Assert.Equal(RestoreEngineNames.CONSOLE, result.Engine);
    Assert.True(result.FellBack);
    Assert.Equal(RestoreStates.SUCCEEDED, Assert.Single(result.Projects).Restore);
    Assert.Contains(entries, entry
      => string.Equals(entry.Level, LogLevels.WARNING, StringComparison.Ordinal) &&
         entry.Message.Contains(BROKEN, StringComparison.Ordinal));
  }

  [Fact]
  public async Task Cancellation_is_reported_per_project_and_does_not_fall_back() {
    var ct = TestContext.Current.CancellationToken;
    await using var log = Log();
    var embedded = new FakeRestoreEngine(RestoreEngineNames.EMBEDDED, failure: new OperationCanceledException());
    var console = new FakeRestoreEngine(RestoreEngineNames.CONSOLE);
    var app = new EvaluatedProject(new ProjectInfo("App", "App.csproj", [], false, null), [], null);
    var target = Target with { Projects = [app] };

    var result = await Service(log, new BackendOptions(), embedded, console).RestoreAsync(target, null, ct);

    var project = Assert.Single(result.Projects);
    Assert.Equal("App.csproj", project.Project);
    Assert.Equal(RestoreStates.CANCELLED, project.Restore);
    Assert.False(result.FellBack);
    Assert.Equal(0, console.Calls);
  }

  [Fact]
  public async Task Explicit_console_never_falls_back() {
    var ct = TestContext.Current.CancellationToken;
    await using var log = Log();
    var embedded = new FakeRestoreEngine(RestoreEngineNames.EMBEDDED);
    var console = new FakeRestoreEngine(RestoreEngineNames.CONSOLE, failure: EngineFailure());
    var service = Service(log, new BackendOptions(), embedded, console);

    await Assert.ThrowsAsync<RestoreEngineException>(()
      => service.RestoreAsync(Target, RestoreEngineNames.CONSOLE, ct));

    Assert.Equal(1, console.Calls);
    Assert.Equal(0, embedded.Calls);
  }

  [Fact]
  public async Task Explicit_msbuild_is_used() {
    var ct = TestContext.Current.CancellationToken;
    await using var log = Log();
    var embedded = new FakeRestoreEngine(RestoreEngineNames.EMBEDDED);
    var msbuild = new FakeRestoreEngine(RestoreEngineNames.MSBUILD);
    var console = new FakeRestoreEngine(RestoreEngineNames.CONSOLE);

    var result = await Service(log, new BackendOptions(), embedded, msbuild, console)
      .RestoreAsync(Target, RestoreEngineNames.MSBUILD, ct);

    Assert.Equal(RestoreEngineNames.MSBUILD, result.Engine);
    Assert.Equal((0, 1, 0), (embedded.Calls, msbuild.Calls, console.Calls));
  }

  [Fact]
  public async Task Configured_engine_is_the_default() {
    var ct = TestContext.Current.CancellationToken;
    await using var log = Log();
    var embedded = new FakeRestoreEngine(RestoreEngineNames.EMBEDDED);
    var console = new FakeRestoreEngine(RestoreEngineNames.CONSOLE);
    var options = new BackendOptions { RestoreEngine = RestoreEngineNames.CONSOLE };

    var result = await Service(log, options, embedded, console).RestoreAsync(Target, null, ct);

    Assert.Equal(RestoreEngineNames.CONSOLE, result.Engine);
    Assert.False(result.FellBack);
    Assert.Equal(0, embedded.Calls);
  }
}
