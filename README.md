# AI Drama Leadgen

`ai-drama-leadgen` is a Windows-first local TypeScript CLI for deterministic AI-drama process clips and licensed 35-45 second lead-generation videos. HyperFrames renders the workbench and visual timeline; FFmpeg performs media normalization, editing, mixing, subtitle burn-in, and H.264 packaging.

## Capabilities

- Six animated workbench templates in `9:16`, `16:9`, and `1:1`.
- Isolated persistent jobs, adaptive concurrency, bounded replacement jobs, and node-level resume.
- Pexels, Pixabay, Wikimedia Commons, Internet Archive, Europeana, and Smithsonian Open Access media adapters with license evidence and a cross-batch asset library.
- Bounded Agent Reach (`mcporter`/Exa), Firecrawl, and SearXNG discovery plugins, plus Crawl4AI raw-HTML reference enrichment.
- Agnes Video V2.0 integration uses the official asynchronous `video_id` polling contract, bounded retries, safe downloads, and the same media QA as provider assets.
- Edge and MiMo TTS, Whisper alignment, phrase or word-highlight captions, narration ducking, and audio/video QA.
- Thin adapters for Codex, TRAE, Hermes, CodeBuddy, and WorkBuddy.

Internet Archive and Wikimedia Commons work without credentials. Europeana and Smithsonian require their free API keys and accept only resource-level open rights with explicit dimensions. Agent Reach uses `mcporter` and defaults to the configured `exa` MCP server; override the server name with `AGENT_REACH_SERVER`. Firecrawl requires both `FIRECRAWL_URL` and `FIRECRAWL_API_KEY`; SearXNG requires `SEARXNG_URL`. Service URLs must be public HTTPS endpoints.

Discovery output is untrusted reference data only. Its keywords may expand a licensed provider query, but its URLs never become media candidates and never prove commercial rights. Crawl4AI cleans raw HTML fetched by the hardened TypeScript network layer; it does not navigate to URLs, follow redirects, search independently, or grant licenses. The remaining provider names in `PROVIDER_CATALOG` are explicit unavailable placeholders until a real API contract and asset-level commercial-use evidence are implemented; credentials alone never grant licensing or produce media. Coverr's current public pages contain conflicting API-use terms, while NASA promotional use requires asset-level identity, logo, endorsement, and third-party-rights review, so neither source is auto-admitted into lead-generation ads.

Pexels and Pixabay currently record a dated, manually authored license summary and the official license URL. That summary is not an official page snapshot or legal approval. Before publishing a generated video, archive the current official license page and complete human license review for every included asset.

## Requirements

- Windows 10 or 11
- Node.js 22 or newer
- PowerShell 7
- Git
- FFmpeg and FFprobe
- Chrome for HyperFrames rendering
- Python, Edge TTS, and Whisper for complete lead-generation audio

## Install

From PowerShell 7:

```powershell
pwsh -File .\installer\install.ps1 -InstallSafeDependencies -InstallAdapters
```

Add `-InstallOptionalTools` to install Edge TTS, Whisper, Crawl4AI, and Playwright Chromium at user scope. Account creation, payment, API-key entry, UAC, publishing, and security-policy changes remain manual.

Store a rotated Agnes key without writing it to a file or shell history:

```powershell
pwsh -File .\installer\store-agnes-credential.ps1
```

Run the environment check:

```powershell
node .\dist\cli\index.js doctor --output doctor-report.json
```

## Generate

Start from the published [`examples/process-config.json`](examples/process-config.json) or [`examples/leadgen-config.json`](examples/leadgen-config.json), then normalize and validate the confirmed configuration:

```powershell
node .\dist\cli\index.js configure --input task.json --output config.json
node .\dist\cli\index.js validate --config config.json
node .\dist\cli\index.js generate --config config.json --workspace workspaces\first-run
```

For multiple outputs use `batch`; to continue an interrupted workspace use `resume` with the same confirmed configuration.

Every successful lead-generation job contains the final video, process clip, preview, configuration, scene plan, EDL, captions, SRT, media manifest, media/audio QA reports, and generation report. Only hard-QA-passing jobs count toward the requested total.

## Development

```powershell
npm install
npm test
npm run check
npm run lint
npm run format
npm run build
```

See [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [SCENE-SYSTEM.md](SCENE-SYSTEM.md), [CONTENT-LIBRARY.md](CONTENT-LIBRARY.md), and [RELEASE-READINESS.md](RELEASE-READINESS.md) for implementation boundaries, deterministic rules, and the section-by-section acceptance audit.

## License

MIT. Third-party media retains its recorded per-asset license and attribution requirements.
