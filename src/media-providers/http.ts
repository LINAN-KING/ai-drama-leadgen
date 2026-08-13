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

class ProviderResponseSizeError extends Error {}

const MAX_JSON_RESPONSE_BYTES = 5 * 1024 * 1024;

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      size += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readBoundedJson<T>(response: Response): Promise<T> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_RESPONSE_BYTES)
    throw new ProviderResponseSizeError(
      `Provider response exceeded ${MAX_JSON_RESPONSE_BYTES} bytes`,
    );
  if (!response.body) throw new Error("Provider response returned an empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_RESPONSE_BYTES)
        throw new ProviderResponseSizeError(
          `Provider response exceeded ${MAX_JSON_RESPONSE_BYTES} bytes`,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function fetchJson<T>(
  url: URL,
  init: RequestInit,
  signal?: AbortSignal,
  attemptTimeoutMs = 30_000,
  maxAttempts = 3,
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new Error("maxAttempts must be a positive integer");
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
      if (response.ok) return await readBoundedJson<T>(response);
      const retryAfter = response.headers.get("retry-after");
      const error = new ProviderHttpError(
        response.status,
        retryAfter ? Number.parseInt(retryAfter, 10) : null,
        `${response.status} ${response.statusText}: ${await readBoundedText(response, 500)}`,
      );
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
      const delay = Math.min(
        2_000,
        Math.max(100, (error.retryAfterSeconds ?? attempt * 0.2) * 1000),
      );
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    } catch (error) {
      if (error instanceof ProviderResponseSizeError) throw error;
      if (error instanceof ProviderHttpError && error.status !== 429 && error.status < 500)
        throw error;
      if (signal?.aborted) throw signal.reason ?? error;
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Provider request failed after ${maxAttempts} attempts`);
}
