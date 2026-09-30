import { getFeedAuthorizationHeader } from "#client/credentials";
import { networkFor } from "#client/client-network";
import { deadline } from "#client/http-retry";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { getJson, HttpError } from "#client/utils";
import { isHttpUrl } from "#manager";
import type { PackageFeed } from "#contracts/nuget";
import type { ServiceIndex, ServiceResource } from "#client/package-types";

export async function checkFeedHealth(options: {
  feed: PackageFeed;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
}): Promise<{ ok: boolean; error?: string | undefined }> {
  if (!isHttpUrl(options.feed.url)) {
    return { ok: true };
  }

  try {
    const index = await getFeedJson<ServiceIndex>({
      url: options.feed.url,
      feed: options.feed,
      settings: options.settings,
      logger: options.logger,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    return index.resources
      ? { ok: true }
      : { ok: false, error: "Invalid feed service index" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getServiceResource(
  feed: PackageFeed,
  resourceType: string,
  settings: NuGetClientSettings,
  logger: NuGetClientLogger,
  signal?: AbortSignal | undefined,
): Promise<ServiceResource | undefined> {
  const serviceIndex = await getFeedJson<ServiceIndex>({
    url: feed.url,
    feed,
    settings,
    logger,
    signal,
  });
  const resources = serviceIndex.resources?.filter((resource) =>
    resource["@type"]?.toLowerCase().startsWith(resourceType),
  );
  if (resourceType === "registrationsbaseurl") {
    return (
      resources?.find(
        (resource) =>
          resource["@type"]?.toLowerCase() === "registrationsbaseurl/3.6.0",
      ) ?? resources?.[0]
    );
  }
  return resources?.[0];
}

export async function getFeedJson<T>(options: {
  url: string;
  feed: PackageFeed;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}): Promise<T> {
  const budget = deadline(
    options.signal,
    Math.min(90_000, options.timeoutMs ?? 90_000),
  );
  let headers: Record<string, string> | undefined;
  const retryState = { attempt: 0 };
  try {
    for (let attempt = 0; ; attempt++) {
      budget.signal.throwIfAborted();
      try {
        return await requestFeedJson<T>(
          {
            ...options,
            signal: budget.signal,
            deadlineAt: budget.expiresAt,
            retryState,
          },
          headers,
        );
      } catch (error) {
        if (budget.signal.aborted) throw budget.signal.reason;
        if (
          attempt >= 2 ||
          !(error instanceof HttpError) ||
          !error.authenticationAllowed ||
          ![401, 403].includes(error.statusCode)
        )
          throw error;
        // The failed HTTP attempt has released its slot before provider interaction starts.
        const credential = await getFeedAuthorizationHeader({
          feed: options.feed,
          settings: options.settings,
          logger: options.logger,
          retry: attempt > 0,
          signal: budget.signal,
        });
        budget.signal.throwIfAborted();
        if (!credential.authorizationHeader)
          throw new Error(
            credential.providerFound
              ? (credential.error ?? "NuGet feed authentication required")
              : "NuGet credential provider was not found",
            { cause: error },
          );
        headers = { Authorization: credential.authorizationHeader };
      }
    }
  } catch (error) {
    if (budget.signal.aborted) throw budget.signal.reason;
    throw error;
  } finally {
    budget.dispose();
  }
}

async function requestFeedJson<T>(
  options: {
    url: string;
    settings: NuGetClientSettings;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
    deadlineAt?: number | undefined;
    retryState?: { attempt: number } | undefined;
  },
  headers?: Record<string, string> | undefined,
) {
  const network = networkFor(options.settings);
  return getJson<T>(options.url, options.settings.proxy, {
    headers,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    deadlineAt: options.deadlineAt,
    retryState: options.retryState,
    network,
    authContext: network.context(options.settings),
  });
}
