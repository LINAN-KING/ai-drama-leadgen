import { describe, expect, it } from "vitest";
import { alignWithSectionRepairs } from "../../src/alignment/repair.js";
import type { TranscriptWord } from "../../src/alignment/types.js";

const sections = [
  { id: "first", narration: "生成分镜", start: 0, end: 2 },
  { id: "second", narration: "锁定角色", start: 2, end: 4 },
];

function words(text: string, start: number): TranscriptWord[] {
  return [...text].map((character, index) => ({
    text: character,
    start: start + index * 0.2,
    end: start + index * 0.2 + 0.1,
  }));
}

describe("section-scoped alignment repair", () => {
  it("repairs only the failed section and stops after success", async () => {
    const transcripts = [
      [...words("生成分镜", 0), ...words("错误内容", 2)],
      [...words("生成分镜", 0), ...words("锁定角色", 2)],
    ];
    const repairs: Array<{ indexes: number[]; attempt: number }> = [];
    const result = await alignWithSectionRepairs({
      sections,
      initialAudioPath: "narration.wav",
      async transcribe() {
        return transcripts.shift()!;
      },
      async repair(indexes, attempt) {
        repairs.push({ indexes, attempt });
        return "repaired.wav";
      },
    });
    expect(result.report.passed).toBe(true);
    expect(result.audioPath).toBe("repaired.wav");
    expect(result.repairs).toEqual([{ sectionIds: ["second"], attempt: 1 }]);
    expect(repairs).toEqual([{ indexes: [1], attempt: 1 }]);
  });

  it("stops after two repair attempts and returns an explicit failure", async () => {
    let transcriptions = 0;
    const result = await alignWithSectionRepairs({
      sections,
      initialAudioPath: "narration.wav",
      async transcribe() {
        transcriptions += 1;
        return [...words("生成分镜", 0), ...words("错误内容", 2)];
      },
      async repair(_indexes, attempt) {
        return `repair-${attempt}.wav`;
      },
    });
    expect(result.report.passed).toBe(false);
    expect(result.repairs).toHaveLength(2);
    expect(transcriptions).toBe(3);
  });

  it("rejects matching words that cross their sentence window", async () => {
    const result = await alignWithSectionRepairs({
      sections,
      initialAudioPath: "narration.wav",
      async transcribe() {
        return [...words("生成分镜", 0), ...words("锁定角色", 1.8)];
      },
      async repair() {
        return "repaired.wav";
      },
      maxRepairAttempts: 0,
    });
    expect(result.report.passed).toBe(false);
    expect(result.report.failures).toContain("word-crosses-sentence-boundary");
  });

  it("localizes non-monotonic timestamps to the affected sentence", async () => {
    const repairs: number[][] = [];
    const result = await alignWithSectionRepairs({
      sections,
      initialAudioPath: "narration.wav",
      async transcribe(_audio, attempt) {
        if (attempt > 0) return [...words("生成分镜", 0), ...words("锁定角色", 2)];
        const second = words("锁定角色", 2);
        second[2] = { ...second[2]!, start: 2.05, end: 2.15 };
        return [...words("生成分镜", 0), ...second];
      },
      async repair(indexes) {
        repairs.push(indexes);
        return "repaired.wav";
      },
    });
    expect(result.report.passed).toBe(true);
    expect(repairs).toEqual([[1]]);
  });
});
