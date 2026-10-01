import http from "node:http";
import https from "node:https";
import { promisify } from "node:util";
import { gunzip, inflate, brotliDecompress } from "node:zlib";
import { ProxyAgent } from "proxy-agent";
import { networkFor, type ClientNetwork } from "#client/client-network";
import {
  deadline,
  HttpError,
  HttpTimeoutError,
  retryAfterMilliseconds,
  retryDecision,
  transientNetworkError,
  waitForRetry,
} from "#client/http-retry";
export { HttpError } from "#client/http-retry";
export {
  comparePackageVersions,
  isHttpUrl,
  isPrereleaseVersion,
  mergeInstalled,
  mergePackageResults,
  mergeVersions,
  prependVersion,
} from "#manager";

export interface JsonRequestOptions {
  generation?: number | undefined;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  deadlineAt?: number | undefined;
  network?: ClientNetwork | undefined;
  authContext?: string | undefined;
  retryState?: { attempt: number; redirects?: number } | undefined;
}

export function maskSecret(value: string): string {
  if (/password|token|apikey|secret/i.test(value)) {
    return "******";
  }

  return value;
}

export async function getJson<T>(
  url: string,
  proxy: string,
  options: JsonRequestOptions | number = {},
): Promise<T> {
  const requestOptions =
    typeof options === "number" ? { timeoutMs: options } : options;
  let current = new URL(url);
  const budget = deadline(
    requestOptions.signal,
    Math.max(
      0,
      Math.min(
        90_000,
        (requestOptions.deadlineAt ?? Date.now() + 90_000) - Date.now(),
      ),
    ),
  );
  const network = networkFor(requestOptions);
  let headers = { ...requestOptions.headers };
  const retryState = requestOptions.retryState ?? { attempt: 0, redirects: 0 };
  let authenticationAllowed = true;
  const timeoutMs = Math.min(30_000, requestOptions.timeoutMs ?? 30_000);
  try {
    for (;;) {
      budget.signal.throwIfAborted();
      if (Date.now() >= budget.expiresAt) throw new HttpTimeoutError();
      if (!["http:", "https:"].includes(current.protocol))
        throw new Error("Unsupported HTTP redirect protocol.");
      const key = network.key([
        "GET",
        "json",
        current.toString(),
        proxy,
        requestOptions.authContext ?? "anonymous",
        requestOptions.generation ?? network.facts.generation,
        Object.entries(headers).sort(),
        timeoutMs,
      ]);
      try {
        const target = current;
        const attemptHeaders = headers;
        const response = await network.requests.run(
          key,
          (signal) =>
            requestJsonOnce<T>(
              target,
              proxy,
              attemptHeaders,
              timeoutMs,
              signal,
            ),
          budget.signal,
        );
        if (budget.signal.aborted) throw budget.signal.reason;
        if (Date.now() >= budget.expiresAt) throw new HttpTimeoutError();
        if (response.kind === "value") return response.value;
        retryState.redirects = (retryState.redirects ?? 0) + 1;
        if (retryState.redirects > 5)
          throw new Error("HTTP redirect limit exceeded.");
        const next = new URL(response.location, current);
        if (next.origin !== current.origin) {
          authenticationAllowed = false;
          headers = Object.fromEntries(
            Object.entries(headers).filter(
              ([name]) =>
                ![
                  "authorization",
                  "cookie",
                  "proxy-authorization",
                  "host",
                ].includes(name.toLowerCase()),
            ),
          );
        }
        if (!authenticationAllowed) {
          next.username = "";
          next.password = "";
        }
        current = next;
      } catch (error) {
        if (budget.signal.aborted) throw budget.signal.reason;
        const decision = retryDecision({
          attempt: retryState.attempt,
          status: error instanceof HttpError ? error.statusCode : null,
          transientNetworkError: transientNetworkError(error),
          retryAfterMs: error instanceof HttpError ? error.retryAfterMs : null,
          remainingMs: budget.expiresAt - Date.now(),
          random: Math.random,
        });
        if (!decision.retry) {
          if (error instanceof HttpError && !authenticationAllowed)
            throw new HttpError(
              error.statusCode,
              error.message,
              error.retryAfterMs,
              false,
            );
          throw error;
        }
        retryState.attempt++;
        await waitForRetry(decision.delayMs, budget.signal);
      }
    }
  } finally {
    budget.dispose();
  }
}

async function requestJsonOnce<T>(
  url: URL,
  proxy: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<
  { kind: "redirect"; location: string } | { kind: "value"; value: T }
> {
  const agent = proxy
    ? new ProxyAgent({ getProxyForUrl: () => proxy })
    : undefined;
  const attempt = deadline(signal, timeoutMs);
  try {
    attempt.signal.throwIfAborted();
    if (Date.now() >= attempt.expiresAt) throw new HttpTimeoutError();
    return await new Promise((resolve, reject) => {
      let finished = false;
      let closed = false;
      let afterClose: (() => void) | undefined;
      const chunks: Buffer[] = [];
      const complete = (callback: () => void, destroy = false) => {
        if (finished) return;
        finished = true;
        chunks.length = 0;
        attempt.signal.removeEventListener("abort", abort);
        if (destroy && !closed) {
          afterClose = callback;
          request.destroy();
        } else callback();
      };
      const fail = (error: unknown) => complete(() => reject(error), true);
      const abort = () => fail(attempt.signal.reason);
      const request = (url.protocol === "http:" ? http : https).request(
        url,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "nuget-code",
            ...headers,
          },
          agent,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          response.on("error", fail);
          response.on("aborted", () =>
            fail(
              Object.assign(new Error("HTTP response interrupted."), {
                code: "ECONNRESET",
              }),
            ),
          );
          if (
            [301, 302, 303, 307, 308].includes(status) &&
            response.headers.location
          ) {
            const location = response.headers.location;
            complete(() => resolve({ kind: "redirect", location }), true);
            return;
          }
          if (status < 200 || status >= 300) {
            fail(
              new HttpError(
                status,
                undefined,
                retryAfterMilliseconds(
                  response.headers["retry-after"],
                  Date.now(),
                ),
              ),
            );
            return;
          }
          response.on("data", (chunk: Buffer) => {
            if (!finished) chunks.push(chunk);
          });
          response.on("end", () => {
            if (finished) return;
            void decodeJson<T>(
              Buffer.concat(chunks),
              response.headers["content-encoding"],
            ).then(
              (value) => complete(() => resolve({ kind: "value", value })),
              fail,
            );
          });
        },
      );
      request.on("error", fail);
      request.on("close", () => {
        closed = true;
        afterClose?.();
      });
      attempt.signal.addEventListener("abort", abort, { once: true });
      if (attempt.signal.aborted) abort();
      else request.end();
    });
  } finally {
    attempt.dispose();
    agent?.destroy();
  }
}

const decompress = {
  gzip: promisify(gunzip),
  deflate: promisify(inflate),
  br: promisify(brotliDecompress),
};

async function decodeJson<T>(
  body: Buffer,
  contentEncoding?: string,
): Promise<T> {
  let decoded: Buffer = body;
  for (const encoding of (contentEncoding ?? "identity")
    .toLowerCase()
    .split(",")
    .reverse()) {
    const coding = encoding.trim();
    if (coding === "identity") continue;
    if (coding !== "gzip" && coding !== "deflate" && coding !== "br")
      throw new Error("Unsupported response content encoding.");
    decoded = await decompress[coding](decoded);
  }
  return JSON.parse(decoded.toString("utf8")) as T;
}
