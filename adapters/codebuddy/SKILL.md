---
name: ai-drama-leadgen
description: Collect confirmed AI drama video inputs and invoke the shared drama-leadgen CLI.
---

Read `{{REPO_ROOT}}\SKILL.md` and collect every required field. Show the complete values to the user and proceed only after explicit confirmation.

Write the confirmed JSON, including `"confirmed": true`, to a stable path such as `<workspace>\config.json`. Then invoke the shared CLI with that exact file:

```powershell
node "{{REPO_ROOT}}\dist\cli\index.js" validate --config "<workspace>\config.json"
```

After validation, run exactly one command: `generate` for one new output, `batch` for a new multi-output run, or `resume` for an existing interrupted workspace.

```powershell
node "{{REPO_ROOT}}\dist\cli\index.js" generate --config "<workspace>\config.json" --workspace "<workspace>"
node "{{REPO_ROOT}}\dist\cli\index.js" batch --config "<workspace>\config.json" --workspace "<workspace>"
node "{{REPO_ROOT}}\dist\cli\index.js" resume --config "<workspace>\config.json" --workspace "<workspace>"
```

Run `node "{{REPO_ROOT}}\dist\cli\index.js" doctor --output "<workspace>\doctor-report.json"` before the first use. Normalize edited input with `node "{{REPO_ROOT}}\dist\cli\index.js" configure --input "<workspace>\task.json" --output "<workspace>\config.json"`. Do not generate media directly in the agent.
