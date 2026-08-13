# AI Drama Leadgen

`ai-drama-leadgen` is a Windows-first local TypeScript CLI for deterministic AI-drama process clips and licensed 35-45 second lead-generation videos. HyperFrames renders the workbench and visual timeline; FFmpeg performs media normalization, editing, mixing, subtitle burn-in, and H.264 packaging.

## Capabilities

- Six animated workbench templates in `9:16`, `16:9`, and `1:1`.
- Isolated persistent jobs, adaptive concurrency, bounded replacement jobs, and node-level resume.
- Pexels, Pixabay, Wikimedia Commons, Internet Archive, Europeana, and Smithsonian Open Access media adapters with license evidence and a cross-batch asset library.
- Optional Agnes integration is an internal extension point; this package does not ship a concrete Agnes client, and `AGNES_API_KEY` alone never makes it available.
- Edge and MiMo TTS, Whisper alignment, phrase or word-highlight captions, narration ducking, and audio/video QA.
- Thin adapters for Codex, TRAE, Hermes, CodeBuddy, and WorkBuddy.

Internet Archive and Wikimedia Commons work without credentials. Europeana and Smithsonian require their free API keys and accept only resource-level open rights with explicit dimensions. Agent Reach, Crawl4AI, Firecrawl, SearXNG, and the remaining provider names in `PROVIDER_CATALOG` are optional discovery or extension capabilities. V1 detects or catalogs them but does not claim a provider-specific runtime adapter. Catalog placeholders remain unavailable until an implementation is supplied; credentials alone never grant licensing or produce media.

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

See [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [SCENE-SYSTEM.md](SCENE-SYSTEM.md), and [CONTENT-LIBRARY.md](CONTENT-LIBRARY.md) for implementation boundaries and deterministic rules.

## License

MIT. Third-party media retains its recorded per-asset license and attribution requirements.
