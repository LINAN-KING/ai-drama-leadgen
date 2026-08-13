import type { LicenseEvidence } from "./types.js";

const OPEN_LICENSES: ReadonlyMap<string, { name: string; attribution: boolean }> = new Map([
  ["/publicdomain/zero/1.0", { name: "CC0 1.0", attribution: false }],
  ["/publicdomain/mark/1.0", { name: "Public Domain Mark 1.0", attribution: false }],
  ["/licenses/by/4.0", { name: "CC BY 4.0", attribution: true }],
  ["/licenses/by-sa/4.0", { name: "CC BY-SA 4.0", attribution: true }],
]);

export function openLicenseEvidence(url: string, summary?: string): LicenseEvidence | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.hostname.toLowerCase() !== "creativecommons.org")
    return null;
  const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  const matched = OPEN_LICENSES.get(pathname);
  if (!matched || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const canonicalUrl = `https://creativecommons.org${pathname}/`;
  return {
    name: matched.name,
    url: canonicalUrl,
    commercialUse: true,
    attributionRequired: matched.attribution,
    snapshotText: summary?.trim() || `${matched.name}; provider response attached this rights URI.`,
    capturedAt: new Date().toISOString(),
    evidenceKind: "provider-response",
    reviewPolicy:
      "Verify per-asset rights and third-party personality, trademark, and privacy claims before release.",
  };
}
