# EDITOR.AI — Engineering Contract

This file is the permanent engineering contract for this repository. It applies to every session, human or agent, working on this codebase. Read it before making architectural decisions.

Whoever works this repository — human or agent — acts as its **MEISTER**: principal architect, product strategist, engineering lead, and quality controller, not a "type code until it compiles" assistant. Understand the system, improve the architecture, build the feature, test it, repair what breaks, and leave the repository stronger than it was found. A feature is not done because it compiles — see §17 Definition of Done.

## 1. Identity & Vision

This project (currently named **MontageAI** in its README, evolving into **EDITOR.AI**) is not a simple video editor. It is being built into a complete **AI Content Creation & Automation Platform**: research → script → assets → voice → video → editing → subtitles → thumbnail → SEO → social → publish → engagement → analytics → optimization, all from a single request like *"Create a 60-second Instagram Reel about the latest AI tools."*

The repository `MOT1209/EDITOR.AI` is the **source of truth and primary product**. Never replace it with another repository or rebuild it from scratch — extend, refactor, and modularize the existing architecture.

## 2. Golden Rules (non-negotiable)

1. **Never assume a feature exists — inspect the repository.**
2. **Never assume a feature is missing — search the repository first.**
3. **Never rewrite existing functionality without understanding it.**
4. **Never introduce a dependency without justification.**
5. **Never integrate an external/reference project by copy-pasting its code** — use it only for architecture, algorithm, or workflow inspiration, then implement natively.
6. Before changing anything: inspect existing architecture → understand data flow → identify reusable components, duplicated logic, mock implementations, incomplete integrations, technical debt, security issues, performance issues, UX issues.
7. Workflow discipline: UNDERSTAND → INSPECT → ANALYZE → PLAN → IMPLEMENT → REVIEW → TEST → FIX → RETEST → DOCUMENT. Never jump straight from a request to code.

## 3. Current Architecture (as inspected — keep this section updated)

The codebase already has two cooperating layers. Do not invent a `packages/` monorepo layout on top of this without a concrete need — extend what exists.

```
EDITOR.AI/
├── app/                        Next.js 14 App Router (TypeScript)
│   ├── api/ai/                 AI endpoints: transcribe, subtitles, tts, translate,
│   │                           reframe, scenes, silence, faces, objects, music-sync,
│   │                           metadata, enhance, analyze
│   ├── api/agents/             ceo / pipeline / export — bridges to the Python agent pipeline
│   ├── api/skills/             skill registry endpoint
│   ├── api/jobs/                async job status endpoint
│   ├── api/assets/              import, pexels stock search
│   ├── api/diagnostics/         GET-only: lists/inspects .montage_ai/pipeline/<job_id>/ artifacts
│   ├── api/export/, ffmpeg/, thumbnail/
│   ├── diagnostics/             Pipeline diagnostics dashboard UI (job list + per-stage detail)
│   └── shorts/                 Shorts/Reels workflow UI
├── components/editor/          Timeline-based video editor UI
├── components/shorts/
├── components/diagnostics/     DiagnosticsDashboard.tsx — consumes /api/diagnostics
├── lib/
│   ├── agents/types.ts         Shared agent type contracts (TS side)
│   ├── skills/                 BaseSkill, SkillManager, Workflow, catalog/, registry
│   ├── captions/, server/, api-config.ts, project.ts, types.ts, mockAi.ts
├── src/                        Python multi-agent pipeline (the "CEO/orchestrator" system)
│   ├── agents/
│   │   ├── ceo_agent.py        Orchestrator — plans and dispatches to specialist agents
│   │   ├── director_agent.py   Editing decisions / EDL assembly
│   │   ├── analyst_agent.py    Transcription, scene/content analysis
│   │   ├── audio_agent.py      Audio processing / mixing
│   │   ├── critic_agent.py     Creative QA pass over generated edits
│   │   ├── render_agent.py     FFmpeg render execution
│   │   ├── edl_schema.py, validation.py, registry.py
│   └── tests/
├── plan.md                     Living execution plan — read before starting new work
├── MONTAJI_REPORT.html         Prior comprehensive audit — read before assuming gaps
└── تقرير-الفحص-الشامل.html      (same audit, Arabic)
```

Key facts already established (see `plan.md` and the audit reports — verify current state before relying on them, they age quickly):
- The Python pipeline (`src/agents/*`) is a real, working multi-agent system (CEO orchestrator → specialist agents → validation gates), not a mock — it writes diagnostics to `.montage_ai/pipeline/`.
- `app/api/agents/pipeline/route.ts` is the bridge from the Next.js editor into the Python pipeline.
- Secrets handling has been audited (0 sensitive files in git, triple-checked) — keep it that way; never commit API keys.
- FFmpeg processing runs locally; there is no cloud rendering dependency by default.

When you extend this system, prefer:
- New AI capability → a route under `app/api/ai/*` calling into `lib/` helpers, or a new agent under `src/agents/*` if it belongs in the orchestrated pipeline.
- New automation/orchestration step → extend `ceo_agent.py`'s planning, not a parallel ad-hoc script.
- New reusable skill → `lib/skills/catalog/` following the existing `BaseSkill` contract.

## 4. Product Vision (target end-state)

```
IDEA → RESEARCH → PLANNING → SCRIPT → STORYBOARD → ASSETS → VOICE → VIDEO
→ EDITING → SUBTITLES → THUMBNAIL → SEO → SOCIAL CONTENT → PUBLISH
→ ENGAGEMENT → ANALYTICS → OPTIMIZATION
```

Target module domains (map onto the existing structure above rather than forcing a rewrite): Core, AI, Agents, Skills, Content, Research, Knowledge, Media, Video, Audio, Image, Rendering, Editing, Social, Publishing, Analytics, Integrations, Automation, Workers, Security, UI.

## 5. Reference Projects (inspiration only — never blind code-dumps)

Study these for patterns; adapt concepts natively into this codebase. Never copy their code wholesale, never add them as dependencies without justification, and always prefer an official API over scraping or browser automation.

| Repo | Study for | Adapt into |
|---|---|---|
| Modawen_Agent-For-Wordpress | topic/research/writer/SEO agents, WP + YouTube-to-blog, scheduling | Content Intelligence Engine |
| openreply | webhooks, campaigns, keyword triggers, DM automation, queues, rate limits | Social Automation Engine |
| short-video-maker | text→TTS→Whisper→captions→media→music→render pipeline, REST/MCP API | Short Form Video Engine |
| hyperframes | HTML/CSS deterministic rendering, agentic composition, motion graphics | Agentic Composition + Rendering Engine (complements, does not replace, the existing editor) |
| playwright-mcp | browser automation for agents, verification, publishing flows | fallback only — Official API > Direct integration > Browser automation |
| ponytail | "need it? reuse it? standard/native feature? existing dependency? minimal implementation" discipline | Engineering review checklist |
| OpenBot | agent orchestration, tool gateway, policy enforcement, audit logs, human takeover | Agent Platform direction for `src/agents` + `app/api/agents` |
| ui-ux-pro-max-skill | design systems, accessibility, anti-patterns | Editor/Dashboard/Studio UI decisions |
| OpenDeepSearch | deep research, reranking, multi-hop reasoning | Research Intelligence Engine (feeds `analyst_agent.py`) |
| OpenDeepWiki | knowledge ingestion, incremental indexing, chat-over-knowledge | Content Knowledge Base (brand/style/history memory) |
| auto-editor | silence/motion detection, automatic cuts, pacing | Automatic Editing Engine (relates to `render_agent.py` / silence detection already in `app/api/ai/silence`) |
| MoneyPrinterTurbo | topic→script→keywords→media→captions→music→composition pipeline | Content Factory reference for the Shorts workflow |

## 6. Agent Architecture

Orchestrator model, not uncontrolled agents:

```
User → Intent Understanding → Planner → CEO/Orchestrator Agent
     → Specialized Agents → Tools → Validation → Result
```

This already exists as `ceo_agent.py` dispatching to `analyst_agent.py`, `audio_agent.py`, `director_agent.py`, `critic_agent.py`, `render_agent.py`. Extend this set (research, script, storyboard, image, thumbnail, SEO, social, publishing, analytics agents) rather than building a second orchestrator.

Every agent must define: clear purpose, allowed tools, input/output schema, validation rules, error handling, permission boundaries, logging, retry rules.

## 7. Tool & Provider Architecture

Tools (web search, browser, TTS/STT, FFmpeg, renderer, media search, social/publishing APIs, storage) must sit behind a **Provider Interface → Provider Adapter → External Service** boundary. Never hard-code a specific vendor into every call site — this keeps providers swappable and avoids vendor lock-in (`AIProvider`, `ImageProvider`, `VideoProvider`, `SpeechProvider`, `MusicProvider`, `SearchProvider`, `EmbeddingProvider`).

## 8. Content Object Model

Treat generated content as structured, stable-ID objects with lifecycle states: `draft → planning → generating → processing → review → ready → published → failed → archived`. Examples: Project, Content Brief, Research Report, Script, Scene, Media Asset, Audio Asset, Voiceover, Subtitle Track, Timeline, Thumbnail, Metadata, Social Post, Publishing Job, Analytics Report.

## 9. Workflow Engine

Long-running work is jobs, not one giant synchronous request (the `app/api/jobs` route and `.montage_ai/pipeline/` diagnostics already point this direction). Each job needs: status, progress, retries, cancellation, timeout, logs, error state, recovery.

## 10. Knowledge System

Projects should eventually carry persistent brand/style knowledge (voice, colors, typography, audience, products, competitors, content rules, forbidden subjects, writing/video style, content history) that agents retrieve automatically rather than re-deriving each run.

## 11. Social & Publishing

Use official platform APIs (YouTube, Instagram, TikTok, Facebook, X, LinkedIn, WordPress) wherever one exists. Publishing must support account connection/OAuth, secure token storage, scheduling, platform-specific formatting, upload, publication verification, status tracking, analytics.

## 12. Security (mandatory)

Never: expose API keys, log secrets, store passwords in plaintext, allow unrestricted shell execution, allow SSRF, trust arbitrary URLs, blindly execute agent-generated commands, allow unrestricted MCP servers, or expose internal services to browser agents.

Use: allowlists, permission checks, input validation, sandboxing, audit logs, encryption, rate limits, timeouts, isolation.

## 13. UX Requirements

This is a professional creative application, not "chatbot + buttons." Target surfaces: Workspace, Dashboard, Projects, Editor, AI Studio, Content Studio, Research, Assets, Brand Kit, Automation, Social, Analytics, Settings. Design desktop and mobile layouts intentionally — do not just shrink the desktop UI.

## 14. Code Quality Priorities

Correctness → Security → Maintainability → Performance → Accessibility → UX → Simplicity.

Avoid: unnecessary abstractions, duplicate components/API logic, dead code, mock implementations left in production, hardcoded secrets, giant files, tight coupling. Reuse existing code whenever it is correct.

## 15. Testing

Layers: unit, integration, API, worker, AI workflow, E2E, browser (Playwright), UI, performance, security. Test critical user journeys end-to-end. Existing Python tests live in `src/tests/`; keep `pytest.ini` config current and CI green.

## 16. Final Goal

Turn one idea into research + script + images + video + voice + captions + thumbnail + SEO + social content + publishing + analytics, inside one unified platform: **create once, adapt everywhere, publish everywhere, learn from performance, improve automatically.**

## 17. Task Pipeline (apply to every non-trivial task)

```
1. Understand   — what is requested, which product area (UI/backend/AI/agent/video/
                   audio/research/publishing/social/infra/security), turn vague asks
                   into explicit requirements.
2. Inspect      — repo, README, package.json/pytest.ini, app/components/lib/src,
                   agents, tests, CI. Never duplicate what already exists (§2, §3).
3. Analyze      — current architecture, data flow, dependencies, technical debt,
                   security/performance/UX risks, regression surface.
4. Research     — only when a reference project (§5) is actually relevant: what
                   problem it solves, what's transferable, what's not, license (§18).
5. Plan         — files to touch/create, interfaces, data models, agent
                   responsibilities, tests, rollback.
6. Implement    — incrementally, reusing existing utilities/components/conventions.
7. Review       — self-review against §19 before calling anything done.
8. Test         — per §15/§20.
9. Fix          — repair what testing/review found.
10. Retest      — confirm the fix, check for new regressions.
11. Document    — update plan.md / this file / relevant README when architecture
                   or capabilities changed.
```

Never jump straight from a request to code, and never skip straight to "it compiles" as a stopping point.

## 18. License Hygiene for Reference Projects

Reference repos (§5) are inspiration, not a source to vendor in. Before reusing any code from one, check its actual license file — do not assume compatibility from memory:

| Reference | License (verify in-repo before relying on this) |
|---|---|
| Modawen_Agent-For-Wordpress | MIT |
| openreply | MIT |
| short-video-maker | MIT |
| hyperframes | Apache-2.0 |
| playwright-mcp | Apache-2.0 |
| ponytail | MIT |
| OpenBot | MIT |
| ui-ux-pro-max-skill | MIT |
| OpenDeepSearch | Apache-2.0 |
| OpenDeepWiki | MIT |
| auto-editor | Unlicense |
| MoneyPrinterTurbo | MIT |

Prefer porting the *interface/algorithm/pattern* over the subsystem itself, implemented natively against this repo's own abstractions (agent contracts in `src/agents`, `lib/skills` BaseSkill, provider adapters).

## 19. Review Checklist (run before calling a task done)

- Did I modify the correct part of the architecture (§3), or bolt on a parallel path?
- Did I duplicate code/components/API routes that already existed?
- Did I add a dependency without justification?
- Did I break existing functionality (editor timeline, pipeline bridge, existing API routes)?
- Did I introduce a security problem (§12), a performance regression, or an accessibility gap?
- Did I leave a mock/stub in a path that looks production-ready?
- Did I handle errors, loading states, empty states, and retries — not just the happy path?
- Did I consider mobile (§13) as well as desktop?
- Did I add or update tests (§15), and update `plan.md`/docs if scope or architecture changed?

## 20. Tool Gateway & Failure Recovery

Any tool/capability an agent (Python `src/agents/*` or a future orchestrator step) can call must be declared, not implicit: name, description, input schema, permission/risk level, timeout, rate limit, and whether calls are audit-logged. Higher-risk actions (spending money, publishing publicly, deleting data, executing shell commands) need stronger checks before execution, per §12.

On failure: detect → classify (transient vs. real) → explain → retry only if safe/idempotent → repair the root cause → retest. Don't just surface a raw error when the agent can safely diagnose and fix it; equally, don't silently retry something that could double-charge, double-publish, or corrupt state.

## 21. Decision Rule

When more than one implementation is viable, prefer the option that is more reliable, more secure, more maintainable, more modular, simpler, easier to test, and easier to replace later — over one that merely adds more files, frameworks, dependencies, abstraction layers, or agents. Optimize for maximum product capability with minimum unnecessary complexity (see `ponytail` in §5).
