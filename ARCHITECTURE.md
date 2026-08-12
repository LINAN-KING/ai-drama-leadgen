# Architecture

`drama-leadgen` is a local TypeScript orchestration core. Agent adapters collect and confirm inputs, then invoke the same CLI. They never implement provider, scheduling, licensing, audio, or rendering behavior.

## Boundaries

```text
Agent adapter -> CLI -> workflow state machine -> scene/script/media/audio/edit nodes
                                        |-> persistent asset library
                                        |-> HyperFrames compositions
                                        `-> FFmpeg/FFprobe
```

- HyperFrames owns workbench UI, captions, animation, and the visual timeline.
- FFmpeg owns media normalization, cropping, concatenation, mixing, loudness, and H.264 packaging.
- Provider discovery returns candidates only. A candidate cannot enter the EDL without a local original and a recorded commercial license.
- Each job has an isolated workspace. Nodes persist input hashes, attempts, status, and outputs. Resume invalidates only failed nodes or nodes whose input hash changed.
- `count` is the required number of QA-passing outputs. `job_concurrency` is the maximum number in flight. The scheduler may attempt at most `ceil(count * 1.5)` jobs.

## Failure model

Every external operation is bounded by a timeout, retry limit, and typed failure. `429`, memory pressure above 80%, and renderer faults reduce concurrency. Provider loss degrades to another licensed provider or Agnes. Exhaustion returns an explicit quality gap; it never loops indefinitely or reports a failed artifact as complete.

## Security

Configuration stores environment-variable names, not secrets. Installation never reads browser passwords or cookies. UAC, account creation, payment, API-key entry, publishing, and security-policy changes require the user.
