import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AspectRatio } from "../config/schema.js";
import { writeJson } from "../config/files.js";
import {
  CANVAS_SIZES,
  WORKBENCH_TEMPLATES,
  type WorkbenchContent,
  type WorkbenchPlan,
  type WorkbenchTemplate,
} from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const WORKBENCH_TIMING = {
  input: 0.2,
  processing: 1.7,
  result: 4.1,
  focus: 6.2,
  complete: 8.1,
} as const;

export async function loadWorkbenchContent(): Promise<Record<WorkbenchTemplate, WorkbenchContent>> {
  const file = new URL("../../content/workbench.json", import.meta.url);
  return JSON.parse(await readFile(file, "utf8")) as Record<WorkbenchTemplate, WorkbenchContent>;
}

export function createWorkbenchPlan(
  template: WorkbenchTemplate,
  aspectRatio: AspectRatio,
  seed: number,
  content: WorkbenchContent,
  duration = 10,
): WorkbenchPlan {
  const size = CANVAS_SIZES[aspectRatio];
  const scale = duration / 10;
  return {
    id: `${template}-${aspectRatio.replace(":", "x")}`,
    template,
    aspectRatio,
    ...size,
    duration,
    seed,
    content,
    stages: Object.entries(WORKBENCH_TIMING).map(([id, start]) => ({
      id,
      start: start * scale,
    })) as WorkbenchPlan["stages"],
  };
}

export function compileWorkbenchHtml(plan: WorkbenchPlan): string {
  const c = Object.fromEntries(
    Object.entries(plan.content).map(([key, value]) => [key, escapeHtml(value)]),
  ) as Record<keyof WorkbenchContent, string>;
  const portrait = plan.height > plan.width;
  const compact = plan.height === plan.width;
  const scale = plan.duration / 10;
  const time = (seconds: number) => Number((seconds * scale).toFixed(4));
  const stage = (id: WorkbenchPlan["stages"][number]["id"]) =>
    Number(plan.stages.find((item) => item.id === id)!.start.toFixed(4));
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
@font-face{font-family:"Microsoft YaHei";src:local("Microsoft YaHei")}
*{box-sizing:border-box}html,body{margin:0;width:${plan.width}px;height:${plan.height}px;overflow:hidden;background:#11100f;color:#f5f0e8;font-family:"IBM Plex Mono","Microsoft YaHei",monospace;letter-spacing:0}
#root{position:relative;width:100%;height:100%;overflow:hidden;background-color:#11100f}
.ambient{position:absolute;border:1px solid #554a41;opacity:.3}.ambient.a{width:55%;height:38%;right:-8%;top:8%;transform:rotate(7deg)}.ambient.b{width:44%;height:48%;left:-12%;bottom:-9%;transform:rotate(-5deg)}
.shell{display:flex;flex-direction:column;width:100%;height:100%;padding:${portrait ? 86 : compact ? 58 : 62}px;gap:${portrait ? 34 : 22}px}
.topbar{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #554a41;padding-bottom:20px}.brand{font-family:"Microsoft YaHei",sans-serif;font-size:${portrait ? 36 : 30}px;font-weight:800}.status{font-size:20px;color:#f05a47}
.workspace{display:grid;grid-template-columns:${portrait ? "1fr" : "minmax(0,1.1fr) minmax(0,.9fr)"};grid-template-rows:${portrait ? "minmax(0,.9fr) minmax(0,1.1fr)" : "1fr"};gap:${portrait ? 28 : 36}px;min-height:0;flex:1}
.editor,.preview{border:2px solid #554a41;background:#201d1a;padding:${portrait ? 38 : compact ? 30 : 32}px;min-height:0;overflow:hidden}.label{font-size:18px;color:#bdb4a8;margin-bottom:22px}.headline{font-family:"Microsoft YaHei",sans-serif;font-size:${portrait ? 62 : compact ? 46 : 52}px;line-height:1.25;font-weight:800;max-width:95%}
.input{font-size:${portrait ? 32 : 25}px;line-height:1.55;margin-top:30px;color:#f5f0e8}.process{display:flex;gap:10px;margin-top:32px}.process span{height:8px;flex:1;background:#554a41}.process span.on{background:#f05a47}
.preview{position:relative;display:flex;flex-direction:column;justify-content:space-between}.frame{position:relative;flex:1;min-height:0;border:2px solid #6f6258;background:#171513;overflow:hidden;padding:32px;display:flex;align-items:flex-end}.frame::before{content:"${c.title}";position:absolute;left:28px;top:24px;font-family:"Microsoft YaHei",sans-serif;font-size:${portrait ? 44 : 36}px;font-weight:800;color:#f5f0e8}.frame::after{content:"";position:absolute;width:46%;aspect-ratio:1;right:8%;top:18%;border:3px solid #f05a47;transform:rotate(12deg);box-shadow:0 0 0 18px rgba(240,90,71,.08)}
.result{position:relative;z-index:2;font-size:${portrait ? 29 : 24}px;line-height:1.4;max-width:78%}.focus{display:flex;justify-content:space-between;gap:20px;font-size:18px;color:#bdb4a8;padding-top:22px}.focus strong{color:#f05a47;font-weight:600}.done{position:absolute;right:28px;top:22px;background:#f05a47;color:#11100f;padding:15px 20px;font-weight:700;font-size:18px;opacity:0}
.cursor{position:absolute;width:44px;height:44px;border:3px solid #f5f0e8;border-radius:50%;left:20%;top:28%;opacity:0}.cursor::after{content:"";position:absolute;width:10px;height:10px;background:#f05a47;border-radius:50%;left:14px;top:14px}
</style></head><body>
<div id="root" data-composition-id="${plan.id}" data-width="${plan.width}" data-height="${plan.height}" data-start="0" data-duration="${plan.duration}" data-fps="30" data-track-index="0">
<div class="ambient a" data-layout-ignore></div><div class="ambient b" data-layout-ignore></div><main class="shell"><header class="topbar"><div class="brand">${c.title}</div><div class="status">AI PIPELINE / ${plan.seed}</div></header><section class="workspace"><article class="editor"><div class="label">INPUT / ${plan.template.toUpperCase()}</div><div class="headline">${c.input}</div><div class="input">${c.processing}</div><div class="process"><span></span><span></span><span></span><span></span></div></article><article class="preview"><div class="label">GENERATED RESULT</div><div class="frame"><div class="result">${c.result}</div><div class="cursor"></div></div><div class="focus"><span>CAMERA FOCUS</span><strong>${c.focus}</strong></div><div class="done">✓ COMPLETE</div></article></section></main></div>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.from('.topbar',{y:-28,opacity:0,duration:${time(0.55)},ease:'expo.out'},${stage("input")}).from('.editor',{x:-44,opacity:0,duration:${time(0.68)},ease:'power3.out'},${time(0.34)}).from('.headline',{y:38,opacity:0,duration:${time(0.62)},ease:'back.out(1.2)'},${time(0.62)}).from('.input',{opacity:0,duration:${time(0.5)},ease:'sine.out'},${time(1.15)});
tl.to('.process span:nth-child(1)',{backgroundColor:'#f05a47',duration:${time(0.25)},ease:'power1.inOut'},${stage("processing")}).to('.process span:nth-child(2)',{backgroundColor:'#f05a47',duration:${time(0.25)},ease:'power2.inOut'},${time(2.2)}).to('.process span:nth-child(3)',{backgroundColor:'#f05a47',duration:${time(0.25)},ease:'power3.inOut'},${time(2.7)}).to('.process span:nth-child(4)',{backgroundColor:'#f05a47',duration:${time(0.25)},ease:'expo.inOut'},${time(3.2)});
tl.from('.preview',{x:52,opacity:0,duration:${time(0.7)},ease:'power4.out'},${stage("result")}).from('.frame',{scale:.94,opacity:0,duration:${time(0.62)},ease:'back.out(1.15)'},${time(4.35)}).from('.result',{y:32,opacity:0,duration:${time(0.52)},ease:'circ.out'},${time(4.72)});
tl.set('.cursor',{opacity:1},${stage("focus")}).fromTo('.cursor',{x:0,y:0},{x:${portrait ? 300 : compact ? 220 : 260},y:${portrait ? 180 : 90},duration:${time(1.15)},ease:'power2.inOut'},${stage("focus")}).from('.focus',{y:20,opacity:0,duration:${time(0.48)},ease:'expo.out'},${time(6.48)});
tl.fromTo('.done',{opacity:0,scale:.9},{opacity:1,scale:1,duration:${time(0.42)},ease:'back.out(1.6)'},${stage("complete")}).to('.ambient.a',{rotation:10,duration:${time(9.4)},ease:'none'},${time(0.3)}).to('.ambient.b',{rotation:-8,duration:${time(9.2)},ease:'none'},${time(0.4)});
window.__timelines['${plan.id}']=tl;
</script></body></html>`;
}

export async function writeWorkbenchProject(
  outputRoot: string,
  plan: WorkbenchPlan,
): Promise<string> {
  const directory = path.join(outputRoot, plan.id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), compileWorkbenchHtml(plan), "utf8");
  await writeJson(path.join(directory, "scene-plan.json"), plan);
  return directory;
}

export async function writeAllWorkbenchProjects(
  outputRoot: string,
  seed = 20260813,
): Promise<string[]> {
  const content = await loadWorkbenchContent();
  const projects: string[] = [];
  for (const template of WORKBENCH_TEMPLATES) {
    for (const ratio of ["9:16", "16:9", "1:1"] as const) {
      projects.push(
        await writeWorkbenchProject(
          outputRoot,
          createWorkbenchPlan(template, ratio, seed, content[template]),
        ),
      );
    }
  }
  return projects;
}
