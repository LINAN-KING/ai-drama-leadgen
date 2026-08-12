import type { AspectRatio } from "../config/schema.js";
import { CANVAS_SIZES } from "../hyperframes/types.js";
import type { CaptionCue } from "./build.js";

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

function escapeAss(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
}

export function toAss(cues: CaptionCue[], aspectRatio: AspectRatio, ctaStart?: number): string {
  const size = CANVAS_SIZES[aspectRatio];
  const fontSize = aspectRatio === "9:16" ? 54 : 42;
  const baseline = Math.round(size.height * 0.78);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${size.width}\nPlayResY: ${size.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,Microsoft YaHei,${fontSize},&H0000FFFF,&H0000FFFF,&H0011100F,&H70000000,-1,0,0,0,100,100,0,0,1,4,1,5,40,40,0,1\nStyle: CTA,Microsoft YaHei,${Math.round(fontSize * 1.18)},&H00FFFFFF,&H00FFFFFF,&H0011100F,&HA0000000,-1,0,0,0,100,100,0,0,3,5,0,5,54,54,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  return (
    header +
    cues
      .map((cue) => {
        const style = ctaStart !== undefined && cue.start >= ctaStart - 0.05 ? "CTA" : "Caption";
        return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${style},,0,0,0,,{\\pos(${Math.round(size.width / 2)},${baseline})}${escapeAss(cue.text)}`;
      })
      .join("\n") +
    "\n"
  );
}
