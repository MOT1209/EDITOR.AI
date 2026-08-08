import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Face {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface ZoomKeyframe {
  time: number;
  zoom: number;
  x: number;
  y: number;
}

export class AutoZoomSkill extends BaseSkill {
  readonly name = "AutoZoomSkill";
  readonly description = "إضافة تكبير تلقائي (Auto Zoom) نحو الوجه/الذروة.";
  readonly category: SkillCategory = "visual";
  readonly inputSpec = { faces: "Face[]", highlights: "Highlight[]" };
  readonly outputSpec = { zoomKeyframes: "ZoomKeyframe[]" };
  protected readonly defaultConfig = { maxZoom: 1.4, baseZoom: 1.0 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const faces = (input.faces as Face[] | undefined) ?? [];
    const maxZoom = this.cfg("maxZoom", 1.4);
    const base = this.cfg("baseZoom", 1.0);

    const zoomKeyframes: ZoomKeyframe[] = [];
    for (const f of faces) {
      // ادخل التكبير عند ظهور الوجه واخرج عند نهايته.
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      zoomKeyframes.push({ time: +f.start.toFixed(2), zoom: base, x: 0.5, y: 0.5 });
      zoomKeyframes.push({
        time: +((f.start + f.end) / 2).toFixed(2),
        zoom: maxZoom,
        x: +cx.toFixed(3),
        y: +cy.toFixed(3),
      });
      zoomKeyframes.push({ time: +f.end.toFixed(2), zoom: base, x: 0.5, y: 0.5 });
    }
    zoomKeyframes.sort((a, b) => a.time - b.time);
    this.log("info", `تم إنشاء ${zoomKeyframes.length} نقطة تكبير`);
    return { zoomKeyframes };
  }
}
