import { describe, expect, it } from "vitest";
import { snapToBeat, trimToBar } from "../../src/music/beats.js";
import { rotateMusic, selectMusicRotation, type MusicTrack } from "../../src/music/library.js";
import { selectSoundEffects } from "../../src/music/freesound.js";

const track = (id: string, overrides: Partial<MusicTrack> = {}): MusicTrack => ({
  id,
  path: `${id}.wav`,
  title: id,
  instrumental: true,
  mood: ["cinematic"],
  bpm: 120,
  license: { name: "CC0", url: "https://license", commercialUse: true, snapshotText: "allowed" },
  ...overrides,
});

describe("music and effects selection", () => {
  it("snaps semantic cuts only within 120ms", () => {
    expect(snapToBeat(2, [1.7, 2.08, 2.11])).toBe(2.08);
    expect(snapToBeat(2, [1.7, 2.2])).toBe(2);
    expect(trimToBar(10, 120)).toBe(10);
  });

  it("rotates 3-5 licensed instrumental tracks", () => {
    const tracks = [
      track("a"),
      track("b"),
      track("c"),
      track("vocal", { instrumental: false }),
      track("bad", { license: { name: "NC", url: "x", commercialUse: false, snapshotText: "no" } }),
    ];
    const rotation = selectMusicRotation(tracks, "cinematic", 9, 5);
    expect(rotation).toHaveLength(3);
    expect(rotateMusic(rotation, 4)).toBe(rotation[1]);
  });

  it("accepts only 5-8 CC0 or CC BY effects", () => {
    const effects = Array.from({ length: 9 }, (_, id) => ({
      id,
      name: String(id),
      sourceUrl: "s",
      previewUrl: "p",
      duration: 1,
      license: (id === 8 ? "CC BY" : "CC0") as "CC0" | "CC BY",
      author: "a",
    }));
    expect(selectSoundEffects(effects, 1, 6)).toHaveLength(6);
    expect(() => selectSoundEffects(effects, 1, 4)).toThrow();
  });
});
