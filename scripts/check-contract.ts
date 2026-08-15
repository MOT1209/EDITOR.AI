/**
 * فحص مطابقة العقد الموحّد: edl_schema.py (Pydantic camelCase) ↔ lib/agents/types.ts.
 *
 * الاستخدام:  node scripts/check-contract.ts
 * الخروج: 0 = متطابق، 1 = انحراف (أخطاء)، 2 = تعذّر التحليل.
 *
 * القاعدة: مخطط Python هو superset — كل حقل في TypeScript يجب أن يوجد في نموذج
 * Python المقابل (باسم camelCase ونوع متوافق)، وقيم التعدادات المشتركة تتطابق
 * في الاتجاهين. أي تغيير في العقد يُطبَّق في الملفين معاً (المبدأ الثابت 3).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PY_SCHEMA = join(ROOT, "src", "agents", "edl_schema.py");
const TS_TYPES = join(ROOT, "lib", "agents", "types.ts");

/* ------------------------------------------------------------------ */
/* أدوات                                                               */
/* ------------------------------------------------------------------ */

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** تطبيع نوع Python إلى شكل قابل للمقارنة: float/int→number، bool→boolean، List→[] */
function normPyType(raw: string): string {
  let t = raw.trim().replace(/\s+/g, " ");
  t = t.replace(/^Optional\[(.*)\]$/, "$1");
  t = t.replace(/^List\[(.*)\]$/, "$1[]");
  t = t.replace(/^list\[(.*)\]$/, "$1[]");
  t = t.replace(/^Dict\[.*\]$/, "object");
  t = t.replace(/^dict\[.*\]$/, "object");
  t = t.replace(/^Tuple.*$/, "object");
  t = t.replace(/^Any$/, "any");
  t = t.replace(/^(float|int)$/, "number");
  t = t.replace(/^(bool)$/, "boolean");
  t = t.replace(/^(str)$/, "string");
  // اسم تعداد = سلسلة
  if (/^[A-Z][A-Za-z0-9]*$/.test(t) && !["object", "number", "boolean", "string", "any"].includes(t)) {
    t = "string";
  }
  return t;
}

/** تطبيع نوع TypeScript: union من سلاسل → string، X[] يُبقى، inline object → object */
const KNOWN_ENUM_TYPES = new Set([
  "ColorFilterId",
  "MusicMood",
  "CaptionStyle",
  "OverlayPosition",
  "QualityInfo",
]);

function normTsType(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("{")) return "object";
  if (t.includes("|")) {
    // union: إن كانت كل القيم سلاسل حرفية → string
    const members = t.split("|").map((m) => m.trim());
    if (members.every((m) => /^"[^"]*"$/.test(m))) return "string";
    return "any"; // union معقد — لا نحكم
  }
  // مرجع نوع تعداد معروف → سلسلة (تعدادات Python من نوع str)
  if (KNOWN_ENUM_TYPES.has(t)) return "string";
  return t;
}

/* ------------------------------------------------------------------ */
/* تحليل Python                                                         */
/* ------------------------------------------------------------------ */

interface PyModel {
  name: string;
  fields: Map<string, string>; // camelCase → type
  enums: Map<string, Set<string>>; // enum name → قيم
}

function parsePython(src: string): { models: Map<string, PyModel>; enums: Map<string, Set<string>> } {
  const models = new Map<string, PyModel>();
  const enums = new Map<string, Set<string>>();
  const lines = src.split("\n");
  let current: PyModel | null = null;
  let currentEnum: { name: string; values: Set<string> } | null = null;

  for (const line of lines) {
    let m = /^class (\w+)\(EdlBase\):/.exec(line);
    if (m) {
      current = { name: m[1], fields: new Map(), enums: new Map() };
      models.set(m[1], current);
      currentEnum = null;
      continue;
    }
    m = /^class (\w+)\(str, Enum\):/.exec(line);
    if (m) {
      currentEnum = { name: m[1], values: new Set() };
      enums.set(m[1], currentEnum.values);
      current = null;
      continue;
    }
    if (currentEnum) {
      m = /^\s{4}(\w+)\s*=\s*"([^"]*)"/.exec(line);
      if (m) currentEnum.values.add(m[2]);
      continue;
    }
    if (current) {
      m = /^\s{4}(\w+)\s*:\s*([^#=]+?)(?:\s*=\s*Field.*)?(?:\s*=\s*[^#]*)?$/.exec(line);
      if (m) {
        current.fields.set(toCamel(m[1]), normPyType(m[2]));
      }
    }
  }
  return { models, enums };
}

/* ------------------------------------------------------------------ */
/* تحليل TypeScript                                                     */
/* ------------------------------------------------------------------ */

interface TsInterface {
  name: string;
  fields: Map<string, { type: string; optional: boolean }>;
}

function parseTypeScript(src: string): Map<string, TsInterface> {
  const interfaces = new Map<string, TsInterface>();
  const lines = src.split("\n");
  let current: TsInterface | null = null;
  let braceDepth = 0;

  for (const line of lines) {
    const m = /^export interface (\w+) \{/.exec(line);
    if (m) {
      current = { name: m[1], fields: new Map() };
      interfaces.set(m[1], current);
      braceDepth = 1;
      continue;
    }
    if (!current) continue;
    const prevDepth = braceDepth;
    braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (prevDepth === 1) {
      // حقل مباشر (وليس داخل كائن متداخل) — ينهي بفاصلة منقوطة أو يفتح كائناً مضمّناً
      const fm = /^\s{2}(\w+)(\??):\s*([^;{]+);/.exec(line);
      const objStart = /^\s{2}(\w+)(\??):\s*\{$/.exec(line);
      if (fm && !line.trimStart().startsWith("//")) {
        current.fields.set(fm[1], { type: normTsType(fm[3]), optional: fm[2] === "?" });
      } else if (objStart && !line.trimStart().startsWith("//")) {
        current.fields.set(objStart[1], { type: "object", optional: objStart[2] === "?" });
      }
    }
    if (braceDepth <= 0) current = null;
  }
  return interfaces;
}

/* ------------------------------------------------------------------ */
/* الفحص                                                               */
/* ------------------------------------------------------------------ */

/** جدول ربط: واجهة TypeScript → نموذج Python */
const INTERFACE_TO_MODEL: Record<string, string> = {
  PlanSegment: "PlanSegment",
  PlanOverlay: "PlanOverlay",
  DirectorPlan: "EdlPlan",
  SceneInfo: "SceneInfo",
  HighlightInfo: "HighlightInfo",
  QualityInfo: "QualityInfo",
  AnalystReport: "AnalystReport",
};

/** الأعدادات المشتركة: TS union name → Python enum name */
const SHARED_ENUMS: Record<string, string> = {
  ColorFilterId: "ColorFilterId",
  MusicMood: "MusicMood",
  CaptionStyle: "CaptionStyle",
  OverlayPosition: "OverlayPosition",
};

/** حقول كائن style المضمّن في DirectorPlan ↔ VideoStyle */
const STYLE_FIELDS: Record<string, string> = {
  colorFilter: "ColorFilterId",
  musicMood: "MusicMood",
  captions: "boolean",
  captionStyle: "CaptionStyle",
  musicVolume: "number",
};

const errors: string[] = [];
const warnings: string[] = [];
let checks = 0;

function expect(ok: boolean, msg: string): void {
  checks++;
  if (!ok) errors.push(msg);
}

function typeCompatible(tsType: string, pyType: string): boolean {
  if (pyType === "any" || tsType === "any") return true;
  if (tsType === "object") return true;
  // TS: X[] مقابل Python: X[]
  if (tsType.endsWith("[]") || pyType.endsWith("[]")) {
    return tsType.endsWith("[]") && pyType.endsWith("[]");
  }
  return tsType === pyType;
}

function run(): number {
  let pySrc: string;
  let tsSrc: string;
  try {
    pySrc = readFileSync(PY_SCHEMA, "utf-8");
    tsSrc = readFileSync(TS_TYPES, "utf-8");
  } catch (e) {
    console.error(`تعذّر قراءة الملفات: ${(e as Error).message}`);
    return 2;
  }
  const { models, enums } = parsePython(pySrc);
  const interfaces = parseTypeScript(tsSrc);

  // 1) تعدادات مشتركة: تطابق القيم في الاتجاهين (تُقرأ من المصدر الخام —
  //    union من سلاسل حرفية في types.ts مقابل أزواج القيم في edl_schema.py)
  const tsRaw = tsSrc;
  for (const [tsName, pyEnumName] of Object.entries(SHARED_ENUMS)) {
    const pyValues = enums.get(pyEnumName);
    if (!pyValues) {
      expect(false, `تعداد Python مفقود: ${pyEnumName}`);
      continue;
    }
    const re = new RegExp(`export type ${tsName}\\s*=\\s*([^;]+);`);
    const m = re.exec(tsRaw);
    if (!m) {
      expect(false, `لم يُعثر على تعريف ${tsName} في types.ts`);
      continue;
    }
    const tsValues = new Set(
      m[1]
        .split("|")
        .map((x) => x.trim().replace(/^"|"$/g, ""))
        .filter((x) => x.length > 0)
    );
    for (const v of tsValues) {
      expect(pyValues.has(v), `قيمة تعداد ناقصة في Python: ${pyEnumName}.${v} (مطلوبة من types.ts)`);
    }
    for (const v of pyValues) {
      expect(tsValues.has(v), `قيمة تعداد ناقصة في types.ts: ${tsName}.${v} (مطلوبة من edl_schema.py)`);
    }
    checks++;
  }

  // 2) الحقول: كل حقل TypeScript موجود في نموذج Python بنوع متوافق
  for (const [tsName, pyModelName] of Object.entries(INTERFACE_TO_MODEL)) {
    const tsIface = interfaces.get(tsName);
    const pyModel = models.get(pyModelName);
    if (!tsIface) {
      expect(false, `واجهة TypeScript مفقودة: ${tsName}`);
      continue;
    }
    if (!pyModel) {
      expect(false, `نموذج Python مفقود: ${pyModelName} (مطلوب من واجهة ${tsName})`);
      continue;
    }
    for (const [field, info] of tsIface.fields) {
      const pyType = pyModel.fields.get(field);
      if (!pyType) {
        if (!info.optional) {
          expect(false, `حقل مفقود في ${pyModelName}: ${field} (مطلوب من ${tsName})`);
        } else {
          warnings.push(`حقل اختياري غير موجود في ${pyModelName}: ${field} — راجع إن كان مقصوداً`);
        }
        continue;
      }
      if (!typeCompatible(info.type, pyType)) {
        expect(false, `نوع غير متوافق لـ ${pyModelName}.${field}: TS=${info.type} مقابل Python=${pyType}`);
      }
    }
  }

  // 3) كائن style المضمّن في DirectorPlan ↔ VideoStyle
  const videoStyle = models.get("VideoStyle");
  const director = interfaces.get("DirectorPlan");
  if (videoStyle && director) {
    const styleField = director.fields.get("style");
    if (styleField && styleField.type === "object") {
      for (const [field, tsType] of Object.entries(STYLE_FIELDS)) {
        const pyType = videoStyle.fields.get(field);
        expect(!!pyType, `حقل مفقود في VideoStyle: ${field} (مطلوب من DirectorPlan.style)`);
        if (pyType) {
          const normTs = normTsType(tsType);
          expect(
            typeCompatible(normTs, pyType),
            `نوع غير متوافق لـ VideoStyle.${field}: TS=${tsType} مقابل Python=${pyType}`
          );
        }
      }
    } else {
      warnings.push("DirectorPlan.style ليس كائناً مضمّناً — لم يُفحص ضد VideoStyle");
    }
  }

  // 4) ملخص
  console.log("──────────────────────────────────────────────");
  console.log(`فحص العقد: ${PY_SCHEMA.split(/[\\/]/).pop()} ↔ ${TS_TYPES.split(/[\\/]/).pop()}`);
  console.log(`التحققات: ${checks} | أخطاء: ${errors.length} | تحذيرات: ${warnings.length}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log("──────────────────────────────────────────────");
  if (errors.length) {
    console.log("النتيجة: ✗ انحراف في العقد — عدّل الملفين معاً (المبدأ الثابت 3).");
    return 1;
  }
  console.log("النتيجة: ✓ العقد متطابق (Python superset مسموح).");
  return 0;
}

process.exit(run());
