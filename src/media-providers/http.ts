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

export async function fetchJson<T>(url: URL, init: RequestInit, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error("Request aborted");
    try {
      const response = await fetch(url, { ...init, signal });
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
      await new Promise((resolve) => setTimeout(resolve, delay));
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
