import dns from "node:dns";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";
import { runBinary } from "../ffmpeg/process.js";

export function isSafePublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress())
      parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export function assertSafeNetworkUrl(value: string | URL): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Media requests require HTTPS");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || (ipaddr.isValid(hostname) && !isSafePublicAddress(hostname)))
    throw new Error(`Unsafe media request host: ${url.hostname}`);
  return url;
}

export async function resolveSafePublicAddresses(hostname: string): Promise<dns.LookupAddress[]> {
  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isSafePublicAddress(address)))
    throw new Error(`Unsafe DNS result for media host: ${hostname}`);
  return addresses;
}

export async function fetchJsonWithPinnedCurl<T>(
  urlValue: string | URL,
  signal?: AbortSignal,
): Promise<T> {
  const url = assertSafeNetworkUrl(urlValue);
  const addresses = (await dns.promises.lookup(url.hostname, { all: true })).filter(({ address }) =>
    isSafePublicAddress(address),
  );
  if (!addresses.length)
    throw new Error(`No safe public DNS result for media host: ${url.hostname}`);
  const selected = addresses[0]!;
  const pinned = selected.family === 6 ? `[${selected.address}]` : selected.address;
  const response = await runBinary(
    "curl.exe",
    [
      "-fsS",
      "--proto",
      "=https",
      "--max-redirs",
      "0",
      "--connect-timeout",
      "15",
      "--max-time",
      "45",
      "--resolve",
      `${url.hostname}:443:${pinned}`,
      "-A",
      "ai-drama-leadgen/0.1",
      url.toString(),
    ],
    60_000,
    signal,
  );
  return JSON.parse(response.stdout) as T;
}

export const safeNetworkDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, [], 0);
        if (!addresses.length || addresses.some(({ address }) => !isSafePublicAddress(address)))
          return callback(new Error(`Unsafe DNS result for media host: ${hostname}`), [], 0);
        if (options.all) return callback(null, addresses);
        const selected = addresses[0]!;
        callback(null, selected.address, selected.family);
      });
    },
  },
});

export type SafeFetchInit = RequestInit & { dispatcher?: Agent };

export function withSafeDispatcher(init: RequestInit): SafeFetchInit {
  return { ...init, dispatcher: safeNetworkDispatcher };
}
