export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message = `HTTP ${statusCode}`,
    readonly retryAfterMs: number | null = null,
    readonly authenticationAllowed = true,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
export class HttpTimeoutError extends Error {
  readonly code = "ETIMEDOUT";
  constructor() {
    super("HTTP deadline exceeded.");
    this.name = "TimeoutError";
  }
}
export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}
export function retryDecision(options: {
  attempt: number;
  status: number | null;
  transientNetworkError: boolean;
  retryAfterMs: number | null;
  remainingMs: number;
  random: () => number;
}): RetryDecision {
  if (
    options.attempt >= 2 ||
    !(options.status === null
      ? options.transientNetworkError
      : [408, 429, 500, 502, 503, 504].includes(options.status))
  )
    return { retry: false, delayMs: 0 };
  const delayMs =
    options.retryAfterMs ??
    Math.round(
      500 *
        2 ** options.attempt *
        (0.5 + Math.min(1, Math.max(0, options.random()))),
    );
  return {
    retry:
      Number.isFinite(delayMs) && delayMs >= 0 && delayMs < options.remainingMs,
    delayMs,
  };
}
export function retryAfterMilliseconds(
  value: string | undefined,
  now: number,
): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : null;
}
export function transientNetworkError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    ["ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ETIMEDOUT"].includes(
      String(error.code),
    )
  );
}
export function deadline(
  parent: AbortSignal | undefined,
  durationMs: number,
): { signal: AbortSignal; expiresAt: number; dispose(): void } {
  const controller = new AbortController();
  const expiresAt = Date.now() + durationMs;
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(
    () => controller.abort(new HttpTimeoutError()),
    Math.max(0, durationMs),
  );
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    expiresAt,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
export function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}
