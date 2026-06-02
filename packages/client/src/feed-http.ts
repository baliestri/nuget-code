import { getFeedAuthorizationHeader } from "#client/credentials";
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
  return serviceIndex.resources?.find((resource) =>
    resource["@type"]?.toLowerCase().startsWith(resourceType),
  );
}

export async function getFeedJson<T>(options: {
  url: string;
  feed: PackageFeed;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}): Promise<T> {
  try {
    return await getJson<T>(
      options.url,
      options.settings.proxy,
      requestOptions(options),
    );
  } catch (error) {
    if (
      !(error instanceof HttpError) ||
      (error.statusCode !== 401 && error.statusCode !== 403)
    ) {
      throw error;
    }

    return getFeedJsonWithCredentials(options, false);
  }
}

async function getFeedJsonWithCredentials<T>(
  options: {
    url: string;
    feed: PackageFeed;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
  },
  retry: boolean,
): Promise<T> {
  const credential = await getFeedAuthorizationHeader({
    feed: options.feed,
    settings: options.settings,
    logger: options.logger,
    retry,
  });
  if (!credential.authorizationHeader) {
    throw new Error(
      credential.providerFound
        ? (credential.error ?? "NuGet feed authentication required")
        : "NuGet credential provider was not found",
    );
  }

  try {
    return await getJson<T>(
      options.url,
      options.settings.proxy,
      requestOptions(options, {
        Authorization: credential.authorizationHeader,
      }),
    );
  } catch (error) {
    if (
      retry ||
      !(error instanceof HttpError) ||
      (error.statusCode !== 401 && error.statusCode !== 403)
    ) {
      throw error;
    }

    return getFeedJsonWithCredentials(options, true);
  }
}

function requestOptions(
  options: {
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
  },
  headers?: Record<string, string> | undefined,
) {
  return {
    ...(headers ? { headers } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  };
}
