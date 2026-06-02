import http from "node:http";
import https from "node:https";
import { ProxyAgent } from "proxy-agent";
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
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message = `HTTP ${statusCode}`,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function maskSecret(value: string): string {
  if (/password|token|apikey|secret/i.test(value)) {
    return "******";
  }

  return value;
}

export function getJson<T>(
  url: string,
  proxy: string,
  options: JsonRequestOptions | number = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestOptions =
      typeof options === "number" ? { timeoutMs: options } : options;
    if (requestOptions.signal?.aborted) {
      reject(abortError());
      return;
    }

    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };
    const request = client.request(
      parsed,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "nuget-code",
          ...requestOptions.headers,
        },
        agent: proxy
          ? new ProxyAgent({
              getProxyForUrl: () => proxy,
            })
          : undefined,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const redirect = response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && redirect) {
          response.resume();
          getJson<T>(
            new URL(redirect, parsed).toString(),
            proxy,
            requestOptions,
          )
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(() => {
            reject(new HttpError(statusCode));
          });
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const result = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as T;
            finish(() => {
              resolve(result);
            });
          } catch (error) {
            finish(() => {
              reject(error);
            });
          }
        });
      },
    );
    const abort = (): void => {
      finish(() => {
        request.destroy();
        reject(abortError());
      });
    };
    requestOptions.signal?.addEventListener("abort", abort, { once: true });
    if (requestOptions.timeoutMs !== undefined) {
      request.setTimeout(requestOptions.timeoutMs, () => {
        finish(() => {
          request.destroy();
          reject(new Error(`Timed out after ${requestOptions.timeoutMs}ms`));
        });
      });
    }
    request.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });
    request.on("close", () => {
      requestOptions.signal?.removeEventListener("abort", abort);
    });
    request.end();
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
