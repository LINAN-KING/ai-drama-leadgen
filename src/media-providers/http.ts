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
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    throw new ProviderHttpError(
      response.status,
      retryAfter ? Number.parseInt(retryAfter, 10) : null,
      `${response.status} ${response.statusText}: ${(await response.text()).slice(0, 500)}`,
    );
  }
  return (await response.json()) as T;
}
