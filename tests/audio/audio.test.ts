import { describe, expect, it } from "vitest";
import { splitNarration } from "../../src/tts/segments.js";
import { actualProviderRatio, allocateProviders } from "../../src/tts/scheduler.js";
import { alignTranscript } from "../../src/alignment/match.js";
import { buildCaptions, toSrt } from "../../src/captions/build.js";

describe("TTS and captions", () => {
  it("splits only at natural punctuation and allocates providers by ratio", () => {
    expect(
      splitNarration("先生成分镜，再锁定角色。最后完成视频！").map((item) => item.text),
    ).toEqual(["先生成分镜，", "再锁定角色。", "最后完成视频！"]);
    const assignments = allocateProviders(10, 0.7, 0.3);
    expect(actualProviderRatio(assignments)).toEqual({ edge: 0.7, mimo: 0.3 });
  });

  it("aligns original text and produces non-overlapping single-line cues", () => {
    const source = "先生成分镜，再锁定角色！";
    const transcript = [..."先生成分镜再锁定角色"].map((text, index) => ({
      text,
      start: index * 0.18,
      end: index * 0.18 + 0.14,
    }));
    const alignment = alignTranscript(source, transcript);
    expect(alignment.coverage).toBe(1);
    expect(alignment.passed).toBe(true);
    const cues = buildCaptions(alignment.words, "word", 6);
    expect(
      cues.every(
        (cue) => cue.text.length <= 6 && cue.end - cue.start >= 0.65 && cue.baselinePercent === 22,
      ),
    ).toBe(true);
    expect(toSrt(cues)).toContain("00:00:00,000 -->");
  });

  it("fails alignment below 98 percent coverage", () => {
    const report = alignTranscript("一二三四五六七八九十", [
      { text: "一二三", start: 0, end: 0.5 },
    ]);
    expect(report.failures).toContain("source-coverage-below-98-percent");
  });

  it("does not count Chinese sentence punctuation as spoken content", () => {
    expect(
      alignTranscript(
        "好吗？当然！",
        [..."好吗当然"].map((text, index) => ({
          text,
          start: index * 0.2,
          end: index * 0.2 + 0.1,
        })),
      ).coverage,
    ).toBe(1);
  });

  it("distributes multi-character Whisper tokens into non-overlapping word times", () => {
    const report = alignTranscript("生成分镜", [{ text: "生成分镜", start: 1, end: 1.8 }]);
    expect(report.passed).toBe(true);
    expect(report.medianErrorMs).toBe(100);
    expect(report.words.map(({ start, end }) => [start, end])).toEqual([
      [1, 1.2],
      [1.2, 1.4],
      [1.4, 1.6],
      [1.6, 1.8],
    ]);
  });
});
