import { SkillManager } from "./SkillManager";
import { createAllSkills } from "./catalog";
import { createDefaultWorkflow, createShortsWorkflow } from "./workflows";

/**
 * يبني مديراً جديداً مع كل الـ Skills والـ Workflows مُسجّلة.
 * استخدمه عند الحاجة لمدير معزول (مثلاً لكل طلب على الخادم).
 */
export function buildSkillManager(): SkillManager {
  const manager = new SkillManager();
  manager.registerAll(createAllSkills());
  manager.registerWorkflow(createDefaultWorkflow());
  manager.registerWorkflow(createShortsWorkflow());
  return manager;
}

// مدير افتراضي مشترك (Singleton) جاهز للاستخدام المباشر.
let shared: SkillManager | null = null;

export function getSkillManager(): SkillManager {
  if (!shared) shared = buildSkillManager();
  return shared;
}
