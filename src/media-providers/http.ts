import { assertSafeDownloadUrl } from "./download.js";
import { withSafeDispatcher } from "./safe-network.js";

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export async function fetchJson<T>(
  url: URL,
  init: RequestInit,
  signal?: AbortSignal,
  attemptTimeoutMs = 30_000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error("Request aborted");
    const attemptSignal = AbortSignal.any([
      signal ?? new AbortController().signal,
      AbortSignal.timeout(attemptTimeoutMs),
    ]);
    try {
      let current = assertSafeDownloadUrl(url);
      let requestInit = init;
      let response!: Response;
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        response = await fetch(
          current,
          withSafeDispatcher({
            ...requestInit,
            signal: attemptSignal,
            redirect: "manual",
          }) as RequestInit,
        );
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Provider redirect did not include a location");
        if (redirects === 5) throw new Error("Provider request exceeded 5 redirects");
        const target = assertSafeDownloadUrl(new URL(location, current));
        if (target.origin !== current.origin) {
          const headers = new Headers(requestInit.headers);
          for (const name of ["authorization", "proxy-authorization", "cookie"])
            headers.delete(name);
          requestInit = { ...requestInit, headers };
        }
        current = target;
      }
      if (response.ok) return (await response.json()) as T;
      const retryAfter = response.headers.get("retry-after");
      const error = new ProviderHttpError(
        response.status,
        retryAfter ? Number.parseInt(retryAfter, 10) : null,
        `${response.status} ${response.statusText}: ${(await response.text()).slice(0, 500)}`,
      );
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
      const delay = Math.min(
        2_000,
        Math.max(100, (error.retryAfterSeconds ?? attempt * 0.2) * 1000),
      );
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status !== 429 && error.status < 500)
        throw error;
      if (signal?.aborted) throw signal.reason ?? error;
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Provider request failed after 3 attempts");
}
