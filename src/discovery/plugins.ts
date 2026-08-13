import { fetchJson } from "../media-providers/http.js";
import { assertSafeNetworkUrl } from "../media-providers/safe-network.js";
import { runPool } from "../scheduler/pool.js";
import { inspectAgentReachServer, runMcporter, type McporterRunner } from "./mcporter.js";

export interface DiscoveryReference {
  source: string;
  title: string;
  url: string;
  snippet?: string;
}

export interface DiscoveryPluginResult {
  keywords: string[];
  references: DiscoveryReference[];
}

export interface DiscoveryPlugin {
  readonly id: string;
  isAvailable(signal?: AbortSignal): Promise<boolean>;
  discover(query: string, signal?: AbortSignal): Promise<DiscoveryPluginResult>;
}

export interface DiscoverySignals extends DiscoveryPluginResult {
  failures: Array<{ plugin: string; error: string }>;
  unavailable: string[];
}

const STOP_WORDS = new Set([
  "about",
  "from",
  "into",
  "with",
  "this",
  "that",
  "video",
  "image",
  "official",
]);

const EMPTY_RESULT: DiscoveryPluginResult = { keywords: [], references: [] };

function cleanKeyword(value: string): string | null {
  const cleaned = value
    .replace(/[\p{C}\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if ([...cleaned].length < 2 || [...cleaned].length > 40 || STOP_WORDS.has(cleaned.toLowerCase()))
    return null;
  return cleaned;
}

function cleanReferenceText(value: string, maxLength: number): string {
  return value
    .replace(/[\p{C}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function keywordsFromReferences(references: DiscoveryReference[]): string[] {
  return references.flatMap(({ title }) =>
    title
      .split(/[^\p{L}\p{N}]+/u)
      .map(cleanKeyword)
      .filter((value): value is string => Boolean(value)),
  );
}

function normalizeKeywords(values: string[], limit = Number.POSITIVE_INFINITY): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const cleaned = cleanKeyword(value);
    if (cleaned && !unique.has(cleaned.toLowerCase())) unique.set(cleaned.toLowerCase(), cleaned);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

function normalizeResult(source: string, result: DiscoveryPluginResult): DiscoveryPluginResult {
  const references = result.references
    .filter((reference) => {
      try {
        return new URL(reference.url).protocol === "https:";
      } catch {
        return false;
      }
    })
    .map((reference) => ({
      source,
      title: cleanReferenceText(reference.title, 300),
      url: reference.url,
      ...(reference.snippet ? { snippet: cleanReferenceText(reference.snippet, 1_000) } : {}),
    }))
    .filter((reference) => reference.title.length > 0)
    .slice(0, 10);
  const keywords = normalizeKeywords(
    [...result.keywords, ...keywordsFromReferences(references)],
    8,
  );
  return { keywords, references };
}

export async function collectDiscoverySignals(
  plugins: DiscoveryPlugin[],
  query: string,
  concurrency = 3,
  signal?: AbortSignal,
): Promise<DiscoverySignals> {
  const results = await runPool(
    plugins,
    () => Math.min(Math.max(1, concurrency), Math.max(1, plugins.length)),
    async (plugin) => {
      signal?.throwIfAborted();
      if (!(await plugin.isAvailable(signal))) return { unavailable: true as const };
      signal?.throwIfAborted();
      return normalizeResult(plugin.id, await plugin.discover(query, signal));
    },
  );
  signal?.throwIfAborted();
  const keywords: string[] = [];
  const references: DiscoveryReference[] = [];
  const failures: DiscoverySignals["failures"] = [];
  const unavailable: string[] = [];
  for (const [index, result] of results.entries()) {
    const plugin = plugins[index]!;
    if (result.status === "rejected") {
      failures.push({
        plugin: plugin.id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    } else if ("unavailable" in result.value) {
      unavailable.push(plugin.id);
    } else {
      keywords.push(...result.value.keywords);
      references.push(...result.value.references);
    }
  }
  const uniqueKeywords = normalizeKeywords(keywords, 8);
  const uniqueReferences = [
    ...new Map(references.map((reference) => [reference.url, reference])).values(),
  ].sort((left, right) => left.url.localeCompare(right.url));
  return {
    keywords: uniqueKeywords,
    references: uniqueReferences,
    failures: failures.sort((left, right) => left.plugin.localeCompare(right.plugin)),
    unavailable: unavailable.sort(),
  };
}

function parseAgentReachOutput(output: string): DiscoveryReference[] {
  const references: DiscoveryReference[] = [];
  let title = "";
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("Title:")) title = line.slice("Title:".length).trim();
    if (line.startsWith("URL:")) {
      const url = line.slice("URL:".length).trim();
      if (title && url) references.push({ source: "agent-reach", title, url });
      title = "";
    }
  }
  return references;
}

export class AgentReachDiscoveryPlugin implements DiscoveryPlugin {
  readonly id = "agent-reach";
  constructor(
    private readonly runner: McporterRunner = runMcporter,
    private readonly server = process.env.AGENT_REACH_SERVER ?? "exa",
  ) {}
  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    try {
      return await inspectAgentReachServer(this.server, this.runner, signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return false;
    }
  }
  async discover(query: string, signal?: AbortSignal): Promise<DiscoveryPluginResult> {
    const output = await this.runner(
      ["call", `${this.server}.web_search_exa`, `query=${query}`, "numResults=5"],
      60_000,
      signal,
    );
    return { keywords: [], references: parseAgentReachOutput(output.stdout) };
  }
}

interface SearchApiItem {
  title?: string;
  url?: string;
  description?: string;
  content?: string;
}

export class FirecrawlDiscoveryPlugin implements DiscoveryPlugin {
  readonly id = "firecrawl";
  constructor(
    private readonly baseUrl = process.env.FIRECRAWL_URL,
    private readonly apiKey = process.env.FIRECRAWL_API_KEY,
  ) {}
  async isAvailable(): Promise<boolean> {
    return Boolean(this.baseUrl && this.apiKey);
  }
  async discover(query: string, signal?: AbortSignal): Promise<DiscoveryPluginResult> {
    if (!this.baseUrl || !this.apiKey) return EMPTY_RESULT;
    const baseUrl = assertSafeNetworkUrl(this.baseUrl);
    const url = new URL("v1/search", baseUrl.href.endsWith("/") ? baseUrl : `${baseUrl.href}/`);
    const result = await fetchJson<{ data?: SearchApiItem[] }>(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 5 }),
      },
      signal,
    );
    return {
      keywords: [],
      references: (result.data ?? []).flatMap((item) =>
        item.title && item.url
          ? [
              {
                source: this.id,
                title: item.title,
                url: item.url,
                snippet: item.description ?? item.content,
              },
            ]
          : [],
      ),
    };
  }
}

export class SearxngDiscoveryPlugin implements DiscoveryPlugin {
  readonly id = "searxng";
  constructor(private readonly baseUrl = process.env.SEARXNG_URL) {}
  async isAvailable(): Promise<boolean> {
    return Boolean(this.baseUrl);
  }
  async discover(query: string, signal?: AbortSignal): Promise<DiscoveryPluginResult> {
    if (!this.baseUrl) return EMPTY_RESULT;
    const baseUrl = assertSafeNetworkUrl(this.baseUrl);
    const url = new URL("search", baseUrl.href.endsWith("/") ? baseUrl : `${baseUrl.href}/`);
    url.search = new URLSearchParams({
      q: query,
      format: "json",
      categories: "images,videos",
    }).toString();
    const result = await fetchJson<{ results?: SearchApiItem[] }>(url, {}, signal);
    return {
      keywords: [],
      references: (result.results ?? []).flatMap((item) =>
        item.title && item.url
          ? [{ source: this.id, title: item.title, url: item.url, snippet: item.content }]
          : [],
      ),
    };
  }
}

export function createDiscoveryPlugins(): DiscoveryPlugin[] {
  return [
    new AgentReachDiscoveryPlugin(),
    new FirecrawlDiscoveryPlugin(),
    new SearxngDiscoveryPlugin(),
  ];
}
