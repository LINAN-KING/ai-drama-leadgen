# Scene System

The six V1 workbench templates are `prompt`, `storyboard`, `character`, `scene`, `video`, and `workflow`. Each template must visibly progress through input, AI processing, generated result, camera focus, and completion.

All templates render at `1080x1920`, `1920x1080`, and `1080x1080`. Layout derives from composition dimensions and safe-area tokens. A seeded PRNG is the only randomness source.

Every composition follows the HyperFrames contract: synchronous paused GSAP timelines, unique clip IDs, `data-start`, `data-duration`, `data-track-index`, finite loops, muted video plus separate audio, and registered `window.__timelines`. Multi-scene work uses entrance animation for every visible element and a consistent transition family; only the final scene may animate out.

Leadgen structure targets 35-45 seconds: hook 0-2, high-quality shots 2-7, workbench 7-18, result montage 18-32, process proof 32-37, and user-approved CTA 37-42. TTS may adjust cuts within the duration bounds. Semantic cuts may snap to a nearby beat by at most 120 ms.
