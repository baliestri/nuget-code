// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using NuGet.VisualStudioCode.Feeds;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.TestSupport;

namespace NuGet.VisualStudioCode.AotTests;

public sealed class CredentialsTests(PublishedBackend backend) {
  private const string ALPHA = "Alpha";
  private const string PASSWORD = "s3cr3t-pass";
  private const string USER = "user";

  private readonly static CredentialsRequestResult Valid = new(USER, PASSWORD, false);
  private readonly static CredentialsRequestResult Cancelled = new(null, null, true);

  private static TestFeedServer CreateServer() {
    var server = new TestFeedServer(new TestFeedPackage(ALPHA, "5.0.0", "Alpha from private feed."));
    server.RequireBasicAuthentication(USER, PASSWORD);
    return server;
  }

  private static TestWorkspace CreateWorkspace(TestFeedServer server) {
    var workspace = new TestWorkspace();
    workspace.WriteConfig(
      $"""
        <packageSources>
          <clear />
          <add key="private" value="{server.V3Url}" allowInsecureConnections="true" />
        </packageSources>
      """
    );
    return workspace;
  }

  private static ConcurrentQueue<CredentialsRequestParams> AnswerWith(BackendClient client,
    Func<CredentialsRequestParams, CredentialsRequestResult> answer) {
    var asked = new ConcurrentQueue<CredentialsRequestParams>();
    client.Connection.OnRequest(MethodNames.CREDENTIALS_REQUEST, ProtocolJsonContext.Default.CredentialsRequestParams,
      ProtocolJsonContext.Default.CredentialsRequestResult, (request, _) =>
      {
        asked.Enqueue(request);
        return Task.FromResult(answer(request));
      });
    return asked;
  }

  private static Task<PackagesSearchResult> SearchAsync(BackendClient client, CancellationToken ct)
    => client.Connection.RequestAsync(MethodNames.PACKAGES_SEARCH, new PackagesSearchParams(ALPHA, null, false, 0, 10),
      ProtocolJsonContext.Default.PackagesSearchParams, ProtocolJsonContext.Default.PackagesSearchResult, ct);

  [Fact]
  public async Task Host_credentials_unlock_a_private_feed() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = CreateWorkspace(server);
    await using var client = BackendClient.Start(backend, workspace.Path);
    var asked = AnswerWith(client, _ => Valid);
    await client.InitializeAsync(ct);

    var result = await SearchAsync(client, ct);

    Assert.Equal(ALPHA, Assert.Single(result.Packages).Id);
    Assert.Empty(result.Failures);
    Assert.NotEmpty(asked);
    Assert.All(asked, request => Assert.StartsWith("http://localhost", request.Source, StringComparison.Ordinal));
  }

  [Fact]
  public async Task Rejected_credentials_are_asked_again_as_a_retry() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = CreateWorkspace(server);
    await using var client = BackendClient.Start(backend, workspace.Path);
    var asked = AnswerWith(client,
      request => new CredentialsRequestResult(USER, request.IsRetry ? PASSWORD : "wrong", false));
    await client.InitializeAsync(ct);

    var result = await SearchAsync(client, ct);

    Assert.Single(result.Packages);
    Assert.Contains(asked, request => request.IsRetry);
  }

  [Fact]
  public async Task Cancelling_marks_the_feed_and_does_not_ask_again_until_reset() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = CreateWorkspace(server);
    await using var client = BackendClient.Start(backend, workspace.Path);
    var answer = new StrongBox<CredentialsRequestResult>(Cancelled);
    var asked = AnswerWith(client, _ => answer.Value!);
    await client.InitializeAsync(ct);

    var first = await SearchAsync(client, ct);
    var askedAfterFirst = asked.Count;
    var second = await SearchAsync(client, ct);
    var askedAfterSecond = asked.Count;
    answer.Value = Valid;
    await client.Connection.NotifyAsync(MethodNames.CREDENTIALS_RESET, new CredentialsResetParams(null),
      ProtocolJsonContext.Default.CredentialsResetParams);
    var third = await SearchAsync(client, ct);

    Assert.Equal(FeedFailureKinds.AUTHENTICATION, Assert.Single(first.Failures).Kind);
    Assert.Equal(FeedFailureKinds.AUTHENTICATION, Assert.Single(second.Failures).Kind);
    Assert.Equal(1, askedAfterFirst);
    Assert.Equal(1, askedAfterSecond);
    Assert.Single(third.Packages);
    Assert.Empty(third.Failures);
  }

  [Fact]
  public async Task Credentials_never_appear_in_the_log() {
    var ct = TestContext.Current.CancellationToken;
    using var server = CreateServer();
    using var workspace = CreateWorkspace(server);
    await using var client = BackendClient.Start(backend, workspace.Path);
    var messages = new ConcurrentQueue<string>();
    client.Connection.OnNotification(MethodNames.LOG_ENTRY, ProtocolJsonContext.Default.LogEntry,
      entry =>
      {
        messages.Enqueue(entry.Message);
        return Task.CompletedTask;
      });
    AnswerWith(client, _ => Valid);
    await client.InitializeAsync(ct);

    await SearchAsync(client, ct);
    await Task.Delay(500, ct);

    Assert.NotEmpty(messages);
    Assert.DoesNotContain(messages, message => message.Contains(PASSWORD, StringComparison.Ordinal));
  }
}
