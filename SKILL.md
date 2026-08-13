---
name: ai-drama-leadgen
description: Generate licensed AI drama process clips or complete lead-generation videos through the local drama-leadgen CLI.
---

# AI Drama Leadgen

Use this skill when the user asks for an AI drama workbench process clip, a complete lead-generation video, or a resumable batch of either.

## Collect and confirm

Ask in short A/B/C rounds for the mode, topic, workflow, platform, aspect ratio, duration, audience, user-supplied CTA, count, concurrency, caption mode, Edge/MiMo ratio, voice style, theme, skin, style, motion intensity, and seed. A leadgen CTA is limited to 20 Unicode characters so it fits the final narration window. Show one final task summary and obtain explicit confirmation before any network, model, download, or render operation.

Never invent revenue, price, customer, gift, feature, or performance claims. Social-platform media is reference-only unless the user supplies commercial-use evidence.

## Execute

Write the confirmed answers to a JSON file and run:

```powershell
node "<repo-root>\dist\cli\index.js" doctor --output "<workspace>\doctor-report.json"
node "<repo-root>\dist\cli\index.js" configure --input "<workspace>\task.json" --output "<workspace>\config.json"
node "<repo-root>\dist\cli\index.js" validate --config "<workspace>\config.json"
```

After validation, run exactly one command:

```powershell
node "<repo-root>\dist\cli\index.js" generate --config "<workspace>\config.json" --workspace "<workspace>"
node "<repo-root>\dist\cli\index.js" batch --config "<workspace>\config.json" --workspace "<workspace>"
node "<repo-root>\dist\cli\index.js" resume --config "<workspace>\config.json" --workspace "<workspace>"
```

Use `batch` for counts above one and `resume` for an existing workspace. Run `doctor` before the first run and use `configure` to normalize a user-edited config.

## Complete

Success means the CLI exits successfully, every counted video passed hard QA, and the output directory includes the video, process clip, preview, config, scene plan, EDL, captions, SRT, media manifest, media/audio QA, and generation report. Report degradations and actual TTS/provider usage.

See `ARCHITECTURE.md`, `SCENE-SYSTEM.md`, and `CONTENT-LIBRARY.md` for deterministic implementation rules.
