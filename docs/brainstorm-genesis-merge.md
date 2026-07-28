# Architectural Blueprint & Product Roadmap: Merging `discord-agent-runner` + `project-genesis`

Status: **APPROVED ARCHITECTURAL DECISION & PRODUCT ROADMAP** (Finalized 2026-07-28).
This document captures the confirmed product architecture, technical requirements, and phased roadmap for building the "AI Dev Agency in Discord".

## 1. The vision, restated

Clone one repo. It interviews you about a product idea, decides the stack, walks you through
every manual step a human still has to do (buy a domain, create hosting/API accounts, generate
keys), then produces **your own repo on your own GitHub**, wired for CI/CD and hosting. From then
on, you maintain that project by typing commands in Discord — the same way this repo already lets
you drive an existing repo from your phone.

## 2. What each repo already brings

**`discord-agent-runner` (this repo)** is the *runtime control plane*: a bot that binds to a
Discord user, discovers local repos (`src/repoManager.ts`), gives each one a private channel
(`ensureUserRepoChannels` in `src/index.ts`), persists the channel↔repo mapping across restarts
(`src/channelRepoMap.ts`), and now — after `feat/permanent-channel-removal` — persists per-user
visibility/removal preferences (`src/repoPrefs.ts`) so a decommissioned project's channel stays
gone. It queues and runs an agent CLI (`opencode run`, per `src/runner.ts`) against whichever repo
is active for a channel, and reports back with embeds, logs, and follow-ups.

**`project-genesis`** is the *generation kit*: two entry-point skills
(`skills/elicit-requirements`, `skills/generate-project`) plus everything they draw on — a stack
decision procedure (`decisions/stack-selection.md`), layered rules (`rules/core|env|stacks|domain`),
project-inherited skills (`skills/project/*`, 8 templates: `onboard`, `new-feature`, `ship-it`,
`triage`, `write-adr`, `db-migration`, `api-endpoint`, `debug-failure`), CI workflow templates
(`ci/github-actions/*.tmpl`), and a hosting decision procedure with real templates
(`deploy/README.md`, `deploy/compose/*`, `deploy/nginx/*`, `deploy/Dockerfile.*.tmpl`). It installs
by copying two skills into `~/.claude/skills/` (`install.sh` / `install.ps1`) so they work in any
directory — it does not vendor into a target project.

**The gap between them**: project-genesis assumes an interactive Claude Code / agent session at a
terminal, driven by a human sitting there. discord-agent-runner assumes short-lived, fire-and-forget
subprocess runs (`opencode run "<prompt>"`, `timeoutMs`-bounded) reported back via Discord embeds.
Neither assumes the other exists. Merging them means designing the missing middle: how does a
multi-round interview (`elicit-requirements` round 1/2/3, `AskUserQuestion`-shaped) happen when the
human is on their phone in Discord and the agent is a subprocess on their PC?

## 3. Three onboarding tiers — name them separately, don't conflate them

- **Tier 0 — bot bootstrap (once, per developer machine).** Today's README steps: create the
  Discord app, get a bot token, get a Discord user ID, `docker compose up`. Add to this: a GitHub
  PAT (for `gh repo create` on the user's behalf) and a default LLM/agent key. This is unavoidably
  manual (Discord does not offer a way to create a bot application via API) but can be made into a
  guided `/setup` flow instead of a README a user has to read top to bottom.
- **Tier 1 — per-project elicitation.** `elicit-requirements` → `generate-project`, once per new
  product idea. This is the new, hard part (§4).
- **Tier 2 — per-integration secrets.** Adding Stripe, email, auth, etc. to an *already-generated*
  project. Smaller, recurring, needs its own idempotent flow (§5).

Keeping these separate matters because they have different frequencies and different security
postures — Tier 0 secrets protect the bot itself, Tier 2 secrets protect the *generated* product,
and they must never end up in the same `.env` or the same GitHub repo.

## 4. The hard problem: an interactive interview over a fire-and-forget bot

`elicit-requirements` is written for a live session: it calls `AskUserQuestion` with up to 4
options per round, reads the answer, and adapts round 2 based on round 1. `runner.ts` today spawns
`opencode run` once per Discord command and waits for exit — there is no standing session, and no
Discord-side tool that can satisfy an `AskUserQuestion` call made by a subprocess CLI, which likely
doesn't expose that tool in headless mode at all.

Two real options, not a spectrum:

**Option A — Discord drives the interview, not the agent (recommended for a first cut).**
The bot itself asks Round 1–3's fixed question set using native Discord components — modals for
free text ("what does it do, and for whom?"), select menus for the range-style questions ("scale
in year one: <100 / hundreds / thousands / 10k+"), buttons for yes/no/"I don't know". This is a
direct reuse of patterns already in `src/index.ts` (`ModalBuilder`/`TextInputBuilder` for
`/followup`, `StringSelectMenuBuilder` for `/repo`). The bot composes `docs/requirements.md` itself
from the captured answers — no agent call needed for the interview at all — and only then queues
one agent task that runs `generate-project` against that file, using the exact fire-and-forget
task/embed/log flow this repo already has. Cost: the question set is fixed at build time instead of
genuinely adaptive; round 2/3 branching ("only ask what round 1 left open") has to be encoded as
Discord-side conditionals, which duplicates logic that already lives in the skill's prose. Benefit:
zero new execution infrastructure, ships fast, and the risky "can a subprocess ask a question
mid-run" problem never has to be solved.

**Option B — a real interactive session bridge.** Add a session-per-thread execution mode to
`runner.ts`: spawn the agent CLI with a PTY, keep stdin open across multiple Discord messages in a
thread, stream stdout back as it arrives (reusing the existing `onLog`/embed-update mechanism), and
detect "the agent is waiting on input" to know when to stop buffering and post a prompt. Detection
is the crux — either a heuristic (a quiet period plus a line matching `?`), or a small protocol the
skill is taught to emit (e.g. a sentinel line before a question, which the bridge intercepts and
turns into a Discord prompt, feeding the reply back as the next stdin line). This preserves the
skill's actual adaptive branching and lets any future skill "just work" over Discord without a
bespoke UI per skill, at the cost of new session-lifecycle machinery (idle timeout, resume-after-
disconnect, one session per contextId instead of one process per task).

Suggest: ship A first — it's a few days of Discord UI wiring, not a new subsystem — and treat B as
the thing to build once a second and third skill *also* want a live back-and-forth (at which point
the bespoke-UI-per-skill cost of A starts exceeding the bridge cost of B).

## 5. Integration packs — API keys, shipped or added on demand

Model this like a small package manager, not a folder of snippets. Proposed manifest, one directory
per integration, e.g. `integrations/stripe/manifest.json`:

```json
{
  "id": "stripe",
  "displayName": "Stripe Payments",
  "appliesWhen": "requirements.money.provider == 'stripe'",
  "requiredEnv": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  "manualSteps": [
    { "id": "stripe-account", "text": "Create a Stripe account", "url": "https://dashboard.stripe.com/register" },
    { "id": "stripe-webhook", "text": "Add a webhook endpoint for {{PUBLIC_URL}}/webhooks/stripe", "url": "https://dashboard.stripe.com/webhooks" }
  ],
  "templateFiles": ["src/integrations/stripe/client.ts.tmpl", "src/integrations/stripe/webhook.ts.tmpl"],
  "rulesFile": "rules/domain/stripe.md",
  "envExampleAppend": "STRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=\n",
  "version": 1
}
```

Every generated repo gets a `genesis.lock.json` recording `{integration, version, filesWritten[]}` —
the same shape as a package-lock or Terraform state, and the same reason: it's what makes
re-running the installer idempotent (skip if version matches, offer an update if the pack shipped a
new version and the target file is byte-identical to what v(n-1) wrote, refuse to silently overwrite
if the user has hand-edited it). This is exactly the discipline project-genesis already applies to
stack packs ("if a copied file needs editing to be true, it belongs one layer lower") — extend it to
integrations instead of inventing a new philosophy.

**Where they live**: ship a small curated set in-kit (Stripe, transactional email, one auth
provider, S3-compatible storage, error tracking) because they cover the large majority of "money is
involved" / "who are the users" answers from the interview, and keep the manifest format documented
and open so more can be added later without bloating the kit's own release cadence — mirroring how
`rules/stacks/` already documents "add a pack in this style" as an extension point rather than a
closed list.

## 6. The manual-steps concierge (domains, hosting, third-party accounts)

None of this can be automated — not as a technical limitation but as a hard boundary: buying a
domain or renting hosting is a real-money transaction on a third-party site, and per this
assistant's own operating rules that stays something the human does themselves, always. So the
design goal isn't automation, it's **making the manual part legible and resumable**:

- A provisioning checklist, generated per project from ADR-0001's hosting decision (`deploy/README.md`'s
  decision procedure already names exactly this fork: single-host compose vs managed platform vs
  k8s vs serverless) plus whichever integration packs were selected. Each step: description, a
  direct link, whether it produces a value the bot needs back (domain name, host IP, API key), and
  a done/not-done state.
- Track it the same way `/repo`'s dropdown and the new `/removechannel` confirm button already
  track state — a small persisted JSON per project (`provisioning-state.json`, same pattern as
  `channel-repo-map.json` / `repo-channel-prefs.json`) plus a Discord embed with buttons the user
  taps as they complete each step, so the flow survives a bot restart and a user closing Discord
  mid-checklist.
- Whatever value a step produces (domain, API key) gets captured through a **modal**, never a plain
  typed message — see §7 on why.

## 7. Secrets: three destinations, one rule

A collected secret (Stripe key, DB URL, hosting token) needs to land in up to three places: the
generated repo's local `.env` (gitignored, for dev), that repo's GitHub Actions secrets (`gh secret
set --repo <user>/<new-repo>`), and the hosting target's own secret store (a VPS's `.env`, or a
managed platform's secret command). None of them is the *bot's* `.env`, and none of them is a
Discord channel.

The one rule: **secrets are captured via Discord modals (submission payload, never posted to
channel history) and are never echoed back into a message, embed, or log line** — not even
truncated or masked, since even a masked echo trains the habit of putting secrets in chat. Log
"stored STRIPE_SECRET_KEY for climbing-gym-booking" — never the value. This is worth a line in
`docs/rules` of the merged repo, not just a convention someone has to remember while writing the
handler.

## 8. New Discord command surface (sketch, not a spec)

| Command | Tier | What it does |
|---|---|---|
| `/newproject` | 1 | Starts the Discord-native interview (§4 Option A); writes `docs/requirements.md`; hands off to `generate-project` as a queued task. |
| `/provision` | 1 | Shows/resumes the manual-steps checklist for the active project (§6). |
| `/integrations add <name>` | 2 | Idempotently installs a pack (§5) into the active repo, prompts for its `manualSteps` and `requiredEnv` via modal. |
| `/integrations list` | 2 | Installed vs. available packs for the active repo, read from `genesis.lock.json`. |
| `/secrets set <KEY>` | 0/1/2 | Modal capture, fans out to the right destination(s) per §7. Never shows the value back. |

All of these are additive to the existing `/repo`, `/task`, `/feature`, `/fix`, `/release`,
`/grabissue`, `/removechannel` set — nothing here replaces the current command surface, it extends
it for the "before there's a repo yet" and "adding a paid integration" moments.

## 9. Lifecycle synergy with what's already here

This is the pleasant surprise from reading both repos side by side: once `generate-project` has run
and `git init`'d a new repo under the bot's `reposDir` workspace, **the existing repo-discovery and
channel machinery in `src/repoManager.ts` / `src/index.ts` just picks it up** — no new plumbing
needed to give a freshly generated project its own private Discord channel; `ensureUserRepoChannels`
already does that for anything it finds under the workspace root. And the channel-removal feature
just merged (`src/repoPrefs.ts`, `/removechannel`) is exactly the tool needed when a generated
project is abandoned or superseded — permanently drop its channel without it reappearing on the
next restart. The two repos are more complementary than the "merge" framing suggests; a lot of this
is *composition*, not rewriting either side.

## 10. Proposed repo layout (one option, not a decision)

```
genesis-runner/                      <- the thing a user clones once
├── bot/                             <- today's discord-agent-runner src/, mostly unchanged
│   └── src/
├── kit/                             <- today's project-genesis content
│   ├── skills/ rules/ decisions/ templates/ ci/ deploy/
│   └── install.sh / install.ps1     <- run once at bot bootstrap (Tier 0)
├── integrations/                    <- NEW: the pack registry from §5
│   └── <name>/manifest.json + templates
├── docs/
└── docker-compose.yml
```

**Vendor-in vs. git-submodule the kit** is the one decision here worth its own ADR (recursively:
write it with `generate-project`'s own ADR template). Submodule keeps project-genesis independently
versioned and forkable, matching its own design intent ("install two skills anywhere"); vendoring
is simpler for a non-technical target user who "just wants to clone one thing" but means kit updates
require a manual sync step. Given the target user in the vision is explicitly not expected to manage
two repos, vendoring with a documented `kit/sync-upstream.sh` (pulls latest project-genesis, diffs,
opens a PR) is the more honest default — but this is exactly the kind of call the merged project's
own ADR-0001-equivalent should record, with the cost stated, per project-genesis's own rule that
"an ADR listing only upsides is a failed ADR."

## 11. Suggested phased build order

1. **MVP**: Tier 0 bootstrap docs (already ~done via README) + Option A interview (§4) writing
   `docs/requirements.md` + a queued `generate-project` task using the existing runner, with zero
   integrations and zero provisioning concierge — the user does everything from the ADR onward by
   hand, same as project-genesis today, just kicked off from Discord instead of a terminal.
2. **v1**: Add the provisioning concierge (§6) driven off ADR-0001's hosting choice, and 2–3
   in-kit integration packs with the manifest/lockfile scheme (§5).
3. **v1.1**: `/integrations add` for on-demand packs, secrets fan-out to GitHub Actions + host (§7).
4. **Stretch**: Option B session bridge (§4), unlocking the *actual* adaptive interview and any
   future skill that wants a live back-and-forth without bespoke Discord UI per skill.

## 12. Open questions / risks to carry forward

- Does the interview (Option A) need to support editing an earlier answer mid-flow, or is
  restart-from-scratch acceptable for v1? Affects whether the requirements-capture state needs to be
  resumable like the provisioning checklist, or can be a single-shot modal sequence.
- Whose LLM/agent key pays for a generated project's ongoing agent runs — the bot owner's, or does
  each project prompt for its own? Affects the Tier 0 vs Tier 1 secret boundary in §3.
- `gh repo create` on the user's behalf is a real GitHub-side action (creating a repo, pushing code)
  — worth an explicit confirm step in Discord before it fires, same posture as the confirm/cancel
  buttons already added for `/removechannel`.
- Integration packs that ship in-kit will go stale (SDK versions, API shapes) faster than the kit's
  own release cadence suggests — needs an owner and a refresh cadence, not just an initial write.
- None of this has been validated against a real interactive Discord session yet — everything in §4
  is a design proposal, not something run end to end.

## 13. Decided Design Directives & Technical Requirements (2026-07-28 Update)

Following evaluation of Option A, five hard technical requirements were finalized:

1. **Option A Execution Engine**: The system will proceed with Option A (Discord-native UI using step-by-step Modals, Select Menus, and Buttons for interview collection).
2. **High-Tier Interviewer Model**: The interview phase (`elicit-requirements`) will use a high-capability LLM (e.g. Pro tier) by default to ensure deep technical probing and robust specification extraction, with user-configurable model selection.
3. **Structured Issue Breakdown with Tiered Agent Tagging**:
   - Post-interview, the system breaks down requirements into fine-grained GitHub Issues (`gh issue create`).
   - Every issue is strictly categorized and labeled by complexity:
     - `tier:low` / `agent:low-tier`: Mechanical UI tweaks, boilerplate, unit tests, single-file edits. Target: Lightweight/Flash models.
     - `tier:high` / `agent:high-tier`: Architectural logic, multi-file refactors, security/auth, schema migrations. Target: High-tier reasoning models.
   - Enables multi-tier autonomous subagents to pick up work based on skill/cost profiles.
4. **Business Requirement Traceability Matrix (`docs/requirements-matrix.md`)**:
   - The bot outputs a structured report mapping every business requirement to its corresponding GitHub Issue(s) and assigned agent tier.
   - Rendered in Discord as a summary embed and saved to `docs/requirements-matrix.md` before work execution begins.
5. **Interactive Sequential Secret Provisioning**:
   - Instead of bulk input, the bot prompts for required secrets (Stripe, SendGrid, DB URLs) **one by one**.
   - Each secret is entered strictly via a **Discord Modal** (never in chat logs), automatically saved to `.env` / GitHub Repo Secrets, and advances to the next step.

---

## 14. Architecture Evaluation & Marketability Strategy

### 14.1 Should the Bot and Generator be Merged or Kept Modular?

**Verdict**: Merging into a single monolithic codebase is a **bad long-term idea**, but coupling them via a **Modular Plugin Architecture (Decoupled Micro-Kernel)** is a **winning strategy**.

#### Why a Direct Monolithic Merge is Problematic:
1. **Tight Coupling Lock-In**: Tying project-genesis directly to Discord makes it impossible to reuse the project generator via CLI, Slack, Web Dashboard, or CI/CD pipelines.
2. **Different Release Cadences**: Generator rules/templates update frequently as tech stacks evolve (e.g. Next.js 15, Tailwind v4). Discord bot runtime infrastructure changes slowly (gateway API updates, container orchestration).

#### The Winning Architecture: Modular Engine + Adapter Plugins
```
┌─────────────────────────────────────────────────────────────┐
│                 Transport / Client Layer                    │
│   ┌──────────────────┐ ┌──────────────────┐ ┌─────────────┐   │
│   │ Discord Bot Client│ │  Slack App Adapter│ │ CLI Runner  │   │
│   └─────────┬────────┘ └─────────┬────────┘ └──────┬──────┘   │
└─────────────┼────────────────────┼──────────────────┼─────────┘
              │                    │                  │
              ▼                    ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                 Core Agent Engine (Runner API)               │
│   - Task Queue Manager & Process Bridge                      │
│   - Secret Store & Fan-Out Manager                           │
│   - Issue Router & Agent Tier Dispatcher                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Project Generator Engine                     │
│   - Elicitation Protocol Engine                              │
│   - Stack Selection Matrix & Template Renderer               │
│   - Integration Pack Registry (Stripe, Auth, S3, Email)     │
└─────────────────────────────┴───────────────────────────────┘
```

---

### 14.2 Making it Marketable, Complete, Maintainable & Scalable

#### 1. "AI Software Agency in Discord" (Product Positioning)
* **Market Concept**: Position the product as a self-hosted or SaaS **Autonomous AI Dev Agency**.
* **Value Prop**: "Turn your Discord server into a software dev team. Interview an AI Lead, generate production-ready codebases, and let multi-tier AI agents build out tickets in parallel."

#### 2. Multi-Tier Agent Dispatcher & Cost Optimizer
* **Cost Efficiency Selling Point**: High-tier models (GPT-4o / Claude Opus / Gemini Pro) draft the specs and architecture tickets; low-tier models (Flash / Haiku / GPT-4o-mini) execute the simple tickets.
* **Auto-Assignment**: Bot monitors open GitHub issues, automatically spawns subagents matching the `agent:low-tier` / `agent:high-tier` tags, and auto-opens Pull Requests.

#### 3. Enterprise-Grade Maintainability & Extensibility
* **Integration Pack SDK**: Expose a standardized schema (`manifest.json`) for community-built integration packs (e.g., Auth0, Supabase, Twilio, Redis).
* **Quality Gates & PR Bot**: Integrated CI verification where agents cannot merge PRs unless `npm run build` and unit tests pass, reporting status back to Discord channels.
* **Auditability & Traceability**: The Requirement Traceability Matrix ensures stakeholders can track ROI and feature progress directly from their phone.

---

## 15. Final Approved Roadmap & Execution Phases

This section outlines the official, step-by-step roadmap for implementing the approved Modular Micro-Kernel Architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Decoupled Core Kernel & Module Separation                       │
│ - Isolate Transport Layer (Discord) from Execution Engine (Runner API)  │
│ - Structure `bot/`, `kit/`, `integrations/`, and `core/` modules        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: High-Tier Interview Engine (Option A UI)                        │
│ - Implement `/newproject` powered by a High-Capability LLM (Pro tier)   │
│ - Drive step-by-step interview via Discord Modals/Menus                 │
│ - Output `docs/requirements.md` & execute `generate-project`             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: Issue Generator & Multi-Tier Agent Dispatcher                   │
│ - Auto-generate GitHub Issues tagged with `agent:low-tier` / `agent:high`│
│ - Publish Business-to-Ticket Traceability Matrix (`docs/matrix.md`)     │
│ - Dispatch Flash/Lite agents for `tier:low` and Pro agents for `tier:high│
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: Interactive One-by-One Secret Provisioning                     │
│ - Sequential modal prompting for keys (Stripe, SendGrid, DB URLs)       │
│ - Auto fan-out to local `.env` and GitHub Repository Secrets            │
│ - Zero secret leakage into channel history or logs                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Detailed Phase Deliverables

1. **Phase 1: Architecture Modularization**
   * Refactor internal modules to separate the Discord client interface from task execution and repository management logic.
   * Establish clear contract interfaces for client adapters (Discord/Slack/CLI) and generator plugins.

2. **Phase 2: High-Tier Interviewer & Spec Engine**
   * Build the `/newproject` command handler in Discord.
   * Integrate the high-capability LLM to drive interactive modal flows asking domain-specific questions.
   * Write compiled outputs to `docs/requirements.md` and queue the initial repository generator process.

3. **Phase 3: Multi-Tier Issue Breakdown & Requirement Traceability Matrix**
   * Add automated requirement decomposition parsing `docs/requirements.md` into structured GitHub Issues.
   * Tag issues with `agent:low-tier` (simple tasks for fast/cheaper models) and `agent:high-tier` (complex architecture for reasoning models).
   * Generate `docs/requirements-matrix.md` and render a Discord embed summary mapping Business Requirements ➔ GitHub Issues ➔ Agent Tiers.

4. **Phase 4: Sequential Modal Secret Provisioning**
   * Implement step-by-step secret collection via `/secrets set` and `/integrations add`.
   * Securely store values directly into `.env` and GitHub Repo Secrets via the GitHub CLI without logging or displaying secret text.

5. **Phase 5: Commercialization & Integration SDK**
   * Publish the `manifest.json` integration pack SDK.
   * Add support for automated pull request quality gates and status reporting back to Discord channels.


