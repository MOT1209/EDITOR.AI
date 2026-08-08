// ====================================================================
// نظام Skills — نقطة الدخول العامة
// ====================================================================
export * from "./types";
export { BaseSkill } from "./BaseSkill";
export { SkillManager } from "./SkillManager";
export type { SkillMetrics, ManagerErrorEntry } from "./SkillManager";
export { Workflow } from "./Workflow";
export type { WorkflowStep, WorkflowResult, WorkflowRunOptions } from "./Workflow";
export { createAllSkills, SKILL_CLASSES } from "./catalog";
export { createDefaultWorkflow, createShortsWorkflow } from "./workflows";
export { buildSkillManager, getSkillManager } from "./registry";
