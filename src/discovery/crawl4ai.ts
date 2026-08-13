import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assertSafeDownloadUrl } from "../media-providers/download.js";
import { withSafeDispatcher } from "../media-providers/safe-network.js";

const execFileAsync = promisify(execFile);
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_MARKDOWN_BYTES = 256 * 1024;

export interface PythonCommand {
  command: string;
  args: string[];
}

function pythonCandidates(): PythonCommand[] {
  const configured = process.env.DRAMA_LEADGEN_PYTHON?.trim();
  return [
    ...(configured ? [{ command: configured, args: [] }] : []),
    ...(process.platform === "win32" ? [{ command: "py", args: ["-3"] }] : []),
    { command: "python", args: [] },
    { command: "python3", args: [] },
  ];
}

export async function findCrawl4AiPython(signal?: AbortSignal): Promise<PythonCommand | null> {
  for (const candidate of pythonCandidates()) {
    signal?.throwIfAborted();
    try {
      await execFileAsync(candidate.command, [...candidate.args, "-c", "import crawl4ai"], {
        windowsHide: true,
        timeout: 8_000,
        maxBuffer: 1024 * 1024,
        signal,
      });
      return candidate;
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
    }
  }
  return null;
}

const EXTRACT_SCRIPT = String.raw`
import asyncio, json, pathlib, sys

async def main():
    from crawl4ai import AsyncWebCrawler, CacheMode, CrawlerRunConfig
    html = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        excluded_tags=["script", "style", "nav", "footer"],
        exclude_external_links=True,
        process_in_browser=False,
    )
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url="raw:" + html, config=config)
    if not result.success:
        raise RuntimeError(result.error_message or "Crawl4AI extraction failed")
    markdown = result.markdown
    if hasattr(markdown, "fit_markdown"):
        markdown = markdown.fit_markdown or markdown.raw_markdown
    print(json.dumps({"markdown": str(markdown or "")}, ensure_ascii=False))

asyncio.run(main())
`;

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new Error(`Reference page exceeded ${maxBytes} bytes`);
  if (!response.body) throw new Error("Reference page returned an empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Reference page exceeded ${maxBytes} bytes`);
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
  return new TextDecoder().decode(bytes);
}

export async function fetchReferenceHtml(
  urlValue: string | URL,
  signal?: AbortSignal,
): Promise<string> {
  const url = assertSafeDownloadUrl(urlValue);
  const response = await fetch(
    url,
    withSafeDispatcher({
      redirect: "manual",
      signal: AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(30_000),
      ]),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "ai-drama-leadgen/0.1",
      },
    }) as RequestInit,
  );
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("Reference page redirects are not followed");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Reference page returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    await response.body?.cancel();
    throw new Error(
      `Reference page returned unsupported content type: ${contentType || "unknown"}`,
    );
  }
  return readBoundedText(response, MAX_HTML_BYTES);
}

export async function isCrawl4AiAvailable(signal?: AbortSignal): Promise<boolean> {
  return Boolean(await findCrawl4AiPython(signal));
}

export async function extractReferenceMarkdown(
  html: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES)
    throw new Error(`Reference page exceeded ${MAX_HTML_BYTES} bytes`);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "drama-leadgen-crawl4ai-"));
  const input = path.join(tempRoot, "input.html");
  try {
    await writeFile(input, html, "utf8");
    const python = await findCrawl4AiPython(signal);
    if (!python) throw new Error("Crawl4AI is not importable by a supported Python interpreter");
    const { stdout } = await execFileAsync(
      python.command,
      [...python.args, "-c", EXTRACT_SCRIPT, input],
      {
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: MAX_MARKDOWN_BYTES * 2,
        signal,
      },
    );
    const parsed = JSON.parse(stdout) as { markdown?: unknown };
    if (typeof parsed.markdown !== "string") throw new Error("Crawl4AI returned invalid output");
    return Buffer.from(parsed.markdown, "utf8").subarray(0, MAX_MARKDOWN_BYTES).toString("utf8");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
