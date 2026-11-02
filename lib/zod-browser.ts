// zod v4 يختبر Function("") لتسريع التحقق (JIT)؛ CSP الصارمة (بلا 'unsafe-eval') تحجبه فيسجّل المتصفح
// انتهاكاً لا ضرر منه. في المتصفح نعطّل JIT صراحةً فلا محاولة eval ولا تقارير انتهاك. الخادم لا يتأثر.
import { z } from "zod";

if (typeof window !== "undefined") z.config({ jitless: true });
