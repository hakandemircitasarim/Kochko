# KOCHKO — Master Plan (multi-session)

> **This document is the single source of truth for the ongoing overhaul.**
> Any new Claude session can read this file and pick up exactly where the
> previous session left off. Update the **Status** column of each phase as
> work completes. Add notes at the bottom for quirks, blockers, or open
> questions so context survives across sessions.

---

## 1. Vision (why we are rebuilding)

KOCHKO is a **conversation-first** lifestyle coach. It is NOT a form-filling app with a chatbot bolted on. The user experience:

- **Onboarding** happens through **specialized chat sessions** ("coworkers"). Each chat owns a topic, collects its data, and hands off to the next chat. Any chat can opportunistically save cross-topic info, but it politely redirects deep dives to the right coworker.
- **Plan creation** happens in **two dedicated screens** (diet, workout) that are NOT generic chat. Each has a purpose-built UI where Kochko builds a draft plan, the user negotiates with it like a real dietitian consultation, preferences feed back into the profile, and the final plan is saved/archived with a history.
- **Kochko's knowledge of the user** is transparent: the user can always see what Kochko thinks it knows, and correct it.
- **Natural rhythm**: post-onboarding, daily flow is conversational (log meals, request cheat-meal permission, get proactive nudges). Not a dashboard of form fields.

Current state is **far from this vision**. Standing issues:

1. Plan screens redirect to a generic chat that refuses to make plans. Core feature broken.
2. Onboarding chats don't know what other chats collected; user re-answers the same questions.
3. No handoff mechanism between task chats — each feels isolated.
4. AI verbally acknowledges saves ("Kaydettim, profilini güncelledim") instead of using the UI.
5. Plan prerequisites are not enforced; user can try to generate a plan with zero profile data.
6. Free tier quotas don't match the "let users complete onboarding + produce 1 plan" expectation.
7. Many UX details stale (safe area, keyboard, padding) — most cleaned up in the recent buldozer pass.

---

## 2. Scope of this plan

**In scope:**
- Onboarding handoff UX (task completion cards, next-task suggestions)
- Task chat improvements (checklist, silent saves, cross-topic opportunistic saving)
- Diet plan screen (brand-new, specialized)
- Workout plan screen (brand-new, specialized)
- Plan versioning (draft / active / archived)
- Plan preferences feedback loop (dislike → profile write)
- Home screen redesign to surface the two plans
- "Kochko'nun Hakkında Bildikleri" rename + enriched view
- Free-tier quota rework (1 diet + 1 workout plan lifetime, then weekly subscription)
- Post-onboarding daily flow (logging chat, proactive nudges, cheat-meal permission)

**Out of scope** for this plan (may be follow-up projects):
- Native push notification delivery infrastructure (uses existing expo-notifications)
- Widget / watchOS / wearables
- Social features, sharing, friends
- Localization beyond Turkish

---

## 3. Guiding principles

These are **the rules** for every decision. Violating them means reconsidering the design.

1. **Chat is primary, forms are fallback.** Every piece of user data has a conversational capture path. Forms exist only for quick edits.
2. **Kochko never verbally acknowledges saves.** The UI shows what was saved via badges. Model says "tamam" and moves on.
3. **Each chat session has ONE job.** Specialized task chats don't drift. If info outside their scope is volunteered, they save it silently and gently redirect.
4. **Every save is visible and editable.** User can always find what Kochko knows and change it ("Kochko'nun Hakkında Bildikleri" screen).
5. **Plan screens are NOT chat.** They have custom UI with chat as one component, not the whole screen.
6. **Drafts are fluid; published plans are immutable.** Once active, a plan becomes a historical record. Edits create a new draft.
7. **Every recommendation is explainable.** "Nasıl yaptın?" button on any plan returns AI's reasoning (TDEE calc → macro split → meal choice → ingredient sourcing).
8. **Free tier is generous enough to experience value.** User must be able to complete onboarding and produce both plans before hitting a paywall.
9. **No visual clutter.** Badges are small. Cards don't dominate. Plan preview is a card, not a half-screen takeover.
10. **Android edge-to-edge + safe area is mandatory.** Every new screen uses `useSafeAreaInsets`.

---

## 4. Architecture decisions

### 4.1 Onboarding handoff protocol

When a task chat completes its checklist, the AI emits a structured block at the end of its final message:

```xml
<task_completion>
{
  "completed": "introduce_yourself",
  "summary": "25 yaş, erkek, 130 kg, 191 cm",
  "next_suggestions": ["set_goal", "daily_routine", "eating_habits"]
}
</task_completion>
```

Client parses, strips from display, and renders:

- A small completion chip: `✓ Kochko seni tanıdı — 25 yaş, erkek, 130 kg, 191 cm`
- A row of up to 3 **next-task cards**. Each card: icon + title + one-line desc + `Başla →`.
- If fewer than 3 incomplete tasks remain, render however many are left.
- Tap → `createSession({ title, topicTags: [taskKey] })` → `router.push('/chat/[sessionId]?taskModeHint=onboarding_X')`.

Existing DB writes (`ai_summary.onboarding_tasks_completed`) continue to flag tasks as done, so `getIncompleteTasks` excludes them on reload.

### 4.2 Plan screens — structure

Routes (new):
- `/plan/diet` — diet plan home
- `/plan/workout` — workout plan home

Each screen has three sub-states, switched by reading current plan state from DB:

**(a) Empty state** — user has never created a plan of this type.
- Big illustration + short explainer.
- "Plan oluştur" CTA.
- If prerequisites unmet → CTA is disabled, shows what's missing + "Tamamla" button routes to relevant onboarding task chat.

**(b) Draft-in-progress state** — there is a `status='draft'` plan, user is building it.
- Top: sticky **plan preview card** (25% of screen max height).
  - Shows: week label, total calories/day, macro ring, day strip (7 dots, tap to jump).
  - Tap → expands to full-screen plan modal (scrollable 7-day view, each day has meal cards).
  - Close button returns to chat + card view.
- Middle/bottom: **chat column** — purpose-built task chat.
  - Task mode: `plan_diet` or `plan_workout`.
  - AI introduces self, explains what it's about to do using user profile.
  - Generates initial draft, asks for feedback.
  - User negotiates: "yumurta sevmem" → AI patches plan in-place + writes preference to `profiles.disliked_foods` (new column) or similar.
  - Chat composer has **quick action chips**: `Nasıl yaptın?`, `Onayla ve kaydet`, `Baştan başla`.
- When user taps **Onayla**: draft promoted to active, previous active (if any) archived, then screen switches to (c).

**(c) Active plan state** — user has an approved plan.
- Full plan view front and center (no sticky card needed since plan is primary).
- A "Kochko ile konuş" button opens a chat overlay for revisions (creates a new draft from active).
- "Geçmiş planlar" link opens history list.
- Progress indicators if user logs meals/workouts against the plan.

### 4.3 Plan versioning

`weekly_plans` schema extension:

```sql
ALTER TABLE weekly_plans ADD COLUMN status TEXT CHECK (status IN ('draft', 'active', 'archived')) DEFAULT 'active';
ALTER TABLE weekly_plans ADD COLUMN plan_type TEXT CHECK (plan_type IN ('diet', 'workout')) DEFAULT 'diet';
ALTER TABLE weekly_plans ADD COLUMN superseded_by UUID REFERENCES weekly_plans(id);
ALTER TABLE weekly_plans ADD COLUMN approved_at TIMESTAMPTZ;
ALTER TABLE weekly_plans ADD COLUMN user_revisions JSONB DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX uniq_active_plan_per_type ON weekly_plans(user_id, plan_type) WHERE status = 'active';
CREATE UNIQUE INDEX uniq_draft_plan_per_type ON weekly_plans(user_id, plan_type) WHERE status = 'draft';
```

Rules:
- Only ONE `draft` per (user, plan_type) at a time. Creating a new draft fails if one exists → user must approve/discard.
- Only ONE `active` per (user, plan_type). Approving a draft archives the previous active.
- `archived` are read-only history.
- `user_revisions` logs each negotiation turn: `[{ at: ISO, from: "sabah:yumurta", to: "sabah:yulaf", reason: "yumurta sevmiyorum", saved_preference: "disliked_foods:yumurta" }]`.

### 4.4 Plan chat system prompts

Separate prompts (in addition to BASE_SYSTEM_PROMPT):

**`plan_diet` mode:**
- Access to full profile + goals + preferences + dislikes + budget + kitchen.
- First message: explain what it will do, ask for final confirmation on any critical gaps.
- Emit initial draft via `<plan_draft>{...7-day JSON...}</plan_draft>`.
- On user feedback, emit `<plan_patch>{...targeted diff...}</plan_patch>` + optionally `<actions>[{"type":"profile_update","dietary_restriction":"no_dairy"}]</actions>`.
- Never acknowledges verbally ("Kaydettim, güncelledim") — the UI shows plan changes + preference badges.
- Explainability: when user asks "Nasıl yaptın?", emit `<reasoning>...</reasoning>` with structured explanation.

**`plan_workout` mode:** parallel structure, schema differs (exercises, sets, reps, rest, progression).

### 4.5 Plan prerequisites enforcement

Single helper: `isPlanReady(profile, goal, planType): { ready: boolean, missing: string[] }`

**Diet plan requires (all present):**
- profile: height_cm, weight_kg, birth_year, gender, activity_level, cooking_skill, budget_level, meal_count_preference
- goal: goal_type (+ target_weight_kg ideally)
- food_preferences: allergies checked (can be empty, just confirm user was asked)
- health_events: confirmed "no condition" or list
- ANY of: diet_mode, or explicit "standart beslenme" flag

**Workout plan requires:**
- profile: height_cm, weight_kg, birth_year, gender, training_experience, equipment_access, training_style, available_training_times
- goal: goal_type
- health_events: checked for injury history

Each missing field maps to a task card → user can tap "Tamamla" and route to onboarding chat for that task.

### 4.6 Preferences feedback schema

New columns on `profiles`:
```sql
ALTER TABLE profiles ADD COLUMN disliked_foods TEXT[];      -- ["yumurta", "süt ürünleri"]
ALTER TABLE profiles ADD COLUMN preferred_foods TEXT[];     -- user-volunteered favorites
ALTER TABLE profiles ADD COLUMN budget_constraints JSONB;   -- { "seafood": "too_expensive", "imported": "avoid" }
ALTER TABLE profiles ADD COLUMN plan_feedback_notes TEXT;   -- free-form notes AI writes over time
```

When user negotiates during plan creation, `profile_update` actions are emitted with these fields. Kochko'nun Hakkında Bildikleri screen shows them in editable rows.

### 4.7 Subscription / gating

Free tier:
- **Unlimited** chat messages during onboarding (no cap while `profile_completion_pct < X` and `ai_summary.onboarding_tasks_completed.length < 5`).
- **1 active diet plan** + **1 active workout plan** produced lifetime for free.
- After both plans approved → free tier locked. UI shows "Yeni plan oluşturmak için premium'a geç" paywall.
- Premium (weekly subscription via RevenueCat):
  - Unlimited plan regeneration.
  - Unlimited chat messages.
  - Advanced features as they ship (voice, photo vision, progress photos, etc.).

Existing `subscriptions` table + trigger stays; new column `plans_used_free` counts (user_id, diet_count, workout_count). Incremented when a plan is approved (status → active).

### 4.8 Renaming

- Settings entry: "Koçun Hafızası" → **"Kochko'nun Hakkında Bildikleri"**
- Screen title + i18n strings (already in Turkish, just update literal).
- Navigation icon stays (eye).

---

## 5. Phase breakdown

> Each phase should be completable in **one focused session** (or less).
> **Do not batch phases.** Complete one, commit, update status, then move on.
> The next Claude session starts by reading this section to find the first non-completed phase.

### Phase 0 — Foundation & cleanup  ⬜ not started

**Goal:** DB + naming + utility groundwork for everything else.

**DB migrations:**
- `030_plan_versioning.sql` — extend `weekly_plans` with status, plan_type, superseded_by, approved_at, user_revisions + unique indexes.
- `031_profile_preferences.sql` — add `disliked_foods`, `preferred_foods`, `budget_constraints`, `plan_feedback_notes` to `profiles`.
- `032_plans_used_free.sql` — add `plans_used_free` JSONB to `profiles` (`{"diet": 0, "workout": 0}`).

**Code:**
- `src/lib/plan-readiness.ts` — new file, exports `isDietPlanReady`, `isWorkoutPlanReady`, `getMissingFields(planType, profile, goal)`. Returns `{ ready, missing: Array<{ field, taskKey, label }> }`.
- Rename "Koçun Hafızası" → "Kochko'nun Hakkında Bildikleri" in:
  - `app/settings/coach-memory.tsx` title
  - `app/settings/index.tsx` menu entry
  - `app/(tabs)/profile.tsx` if it links there
  - Any i18n dict (none for TR currently — inline strings).

**Acceptance:**
- `supabase db push` applies cleanly.
- `supabase migration list` shows 030, 031, 032 on remote.
- Grep for "Koçun Hafızası" returns 0 matches in code (may remain in markdown docs).
- `plan-readiness.ts` has unit-safe logic (no runtime errors when profile/goal null).

---

### Phase 1 — Onboarding handoff UX  ⬜ not started

**Goal:** Task chats close cleanly with next-task suggestions. Silent saves via badges only.

**Edge function changes:**
- `supabase/functions/ai-chat/index.ts`:
  - On outbound message, parse `<task_completion>` block like we parse `<layer2_update>`.
  - If present, strip from message body, include in response JSON:
    ```ts
    { message, actions, task_mode, task_completion: { completed, summary, next_suggestions: string[] } | null }
    ```
- `supabase/functions/ai-chat/index.ts` task card ctx: instruct AI to emit `<task_completion>` on the FINAL message of a completed task, with `next_suggestions` pulled from remaining tasks (pass list into prompt).
- Include: "list of remaining tasks" in the task card context so AI can choose meaningful next_suggestions (top 3 that relate to current context).

**Client changes:**
- `src/services/chat.service.ts`: add `task_completion` to `ChatResponse` interface.
- `app/chat/[sessionId].tsx`:
  - New `TaskCompletionCard` component at end of message bubble.
  - Shows summary chip + up to 3 next-task cards.
  - Tap → `createSession` + `router.push('/chat/...')`.
- Strip verbal save acknowledgements via stronger prompt rules (already started — verify).
- Remove the `<task_completion>` XML from displayed message text.

**Acceptance:**
- Complete a test task (e.g., tap "Kendini tanıt", answer 4 fields).
- Final AI message shows:
  - Brief human-language closer (1 sentence).
  - Summary chip (green, "✓ Kochko seni tanıdı: ...").
  - 3 task cards.
- Tapping a card opens a new chat with correct `taskModeHint`.
- Old chat's "Kendini tanıt" card vanishes from Kochko tab list (was already working via layer2_update).
- No verbal "Kaydettim/Profilini güncelledim" in any response.

---

### Phase 2 — Diet plan screen  ⬜ not started

**Goal:** Fully functional diet plan creation, negotiation, and activation flow.

**Routes:**
- Create `app/plan/diet.tsx` (screen component).
- Keep existing `app/(tabs)/plan.tsx` stub for now (maybe redirect or remove in Phase 4).

**New components:**
- `src/components/plan/PlanPreviewCard.tsx` — collapsed card (4-tile day strip + macro ring + calorie label).
- `src/components/plan/FullPlanModal.tsx` — full-screen plan view, 7-day scrollable.
- `src/components/plan/MealCard.tsx` — single meal display with macros + alternatives.
- `src/components/plan/PlanChatComposer.tsx` — chat composer with quick-action chips (`Nasıl yaptın?`, `Onayla`, `Baştan başla`).
- `src/services/plan.service.ts` — CRUD for `weekly_plans`: `createDraft`, `getActiveDiet`, `getDraftDiet`, `approveDraft`, `archivePlan`, `patchDraft(planId, patch)`, `loadHistory(planType)`.

**Edge function:**
- New task mode `plan_diet`:
  - `supabase/functions/ai-chat/task-modes.ts` — add case, mode instructions.
  - Model emits `<plan_draft>{full JSON}</plan_draft>` on first message.
  - Subsequent messages: `<plan_patch>{targeted diff}</plan_patch>` + optional `<actions>[{profile_update}]</actions>`.
  - Model explicitly told: NO verbal "Kaydettim" confirmations; the UI shows everything.

**State machine:**
```
No plan          → render EmptyState
                   [Plan oluştur] CTA
                       ↓ (if ready)
                   createDraft() + initial AI message
                       ↓
Draft in progress → render PreviewCard + PlanChatComposer
                   User chats, AI patches draft
                       ↓ (user taps Onayla)
                   approveDraft() archives previous, activates this
                       ↓
Active           → render FullPlanView + [Kochko ile konuş] + [Geçmiş]
                   Tapping chat opens revision draft (back to "Draft in progress")
```

**Acceptance:**
- Empty state works, CTA disabled if prerequisites missing.
- Missing prerequisites show as clickable cards routing to correct onboarding task chats.
- "Plan oluştur" creates a draft, opens chat, AI produces a 7-day menu.
- User can say "yumurta yerine yulaf" → card updates in place.
- "süt ürünlerini sevmem" → AI updates all dairy meals + saves `disliked_foods: ['süt ürünleri']` to profile.
- Approving finalizes plan, archives previous (if any).
- Past plans visible in history.

---

### Phase 3 — Workout plan screen  ⬜ not started

**Goal:** Parallel of Phase 2 for workouts.

**Routes:**
- Create `app/plan/workout.tsx`.

**New/adapted components:**
- `PlanPreviewCard` — reused, variant for workout (weekly split strip: M/T/W/T/F/S/S with exercise count per day).
- `FullPlanModal` — different layout (per day: exercise list with sets/reps/rest).
- `ExerciseCard` — single exercise display with sets, reps, weight, rest, video link placeholder.
- `plan.service.ts` — extended with workout variants (`getActiveWorkout`, etc.).

**Edge function:**
- `plan_workout` task mode (parallel to `plan_diet`).
- Structured plan schema: `{ week: [{ day_index, rest_day?, exercises: [{ name, sets, reps, weight_kg?, rest_sec, notes }] }] }`

**Acceptance criteria:** parallel to Phase 2 but for workouts. User can negotiate: "diz sakatlığım var, squat yapamam" → AI swaps squats for leg press/bridges, saves injury note.

---

### Phase 4 — Home screen redesign  ⬜ not started

**Goal:** Dashboard shows two big plan cards + onboarding progress + daily focus.

**Changes:**
- `app/(tabs)/index.tsx`:
  - New hero order:
    1. Profile completion gauge (donut ring with %). Taps → onboarding task list.
    2. Two big cards: "Bu haftaki diyetin" (with mini meal strip) + "Bu haftaki sporun" (with mini exercise strip). Tap → plan screen.
    3. Today's focus: next meal / next workout / streak / active proactive nudges.
    4. Quick actions (log meal, log weight, etc.).

- Remove the floating FAB "+" tab center button if it's redundant? (Decide: keep for quick actions but behavior is `/log` which stays.)

- `app/(tabs)/plan.tsx`: either delete (update tab layout to remove "plan" tab) OR keep as a combined view. Decision: **remove the plan tab**, since diet + workout are first-class dashboard cards now. Update `app/(tabs)/_layout.tsx` accordingly (4 tabs + FAB + profile = still 5 slots).

**Acceptance:**
- Ana sayfa shows profile completion donut prominently.
- Two plan cards visible, empty state if no plan.
- Tapping a plan card opens respective plan screen.
- Removed plan tab doesn't break navigation.

---

### Phase 5 — Daily flow + proactive nudges  ⬜ not started

**Goal:** Post-onboarding experience — conversational logging, cheat-meal permission flow, nudges when user skips logs.

**Changes:**
- New task mode `daily_log` (default after onboarding, replaces `general` for most sessions).
- AI greets proactively on open if >4h since last message: "Bugünkü öğünleri konuşalım mı?".
- Cheat meal permission: user says "bu akşam düğün var"; AI advises how to navigate, creates a `commitment` action.
- Proactive nudges via `ai-proactive` edge function (already exists):
  - If no meal logged by 14:00 → notification ("Öğle yemeğini henüz konuşmadık").
  - If no workout on scheduled day → light reminder, not push.
  - These use existing notification plumbing; just add the triggers.

**Acceptance:** user can log 3 meals conversationally; AI remembers. Next-day chat references yesterday's pattern.

---

### Phase 6 — Subscription / quotas  ⬜ not started

**Goal:** Free tier lets user complete onboarding + produce both plans; then paywall.

**Changes:**
- `src/lib/premium-gate.ts`: new `canCreatePlan(planType, profile): { allowed: boolean, reason?: string }` based on `plans_used_free`.
- `src/services/plan.service.ts`: `createDraft` checks gate, throws `PREMIUM_REQUIRED` if blocked.
- Rate limit edge function: onboarding mode → no cap; `daily_log` / `plan_*` modes → 50 msg/day free, unlimited premium.
- `plans_used_free.diet` and `.workout` incremented on `approveDraft`. Once a plan is active, creating a NEW draft for same type counts as "already used" unless premium.
- Paywall screen: when gate blocks, navigate to `app/settings/premium.tsx` (already exists, needs wiring).

**Acceptance:**
- Fresh user: creates 1 diet + 1 workout plan without paywall.
- 3rd plan attempt → paywall.
- Premium trial or subscription unlocks.

---

### Phase 7 — Polish & celebrations  ⬜ not started

**Goal:** Small but meaningful UX wins.

**Changes:**
- Task completion confetti/animation (lightweight, Reanimated).
- Profile completion donut animates on change.
- Empty state illustrations (SVG placeholders fine).
- Sound effects for approving a plan (optional, off by default).
- Accessibility pass on new screens.

**Acceptance:** feels fluid, not empty.

---

## 6. Risk & rollback

- **Plan versioning DB changes are non-destructive**: new columns + indexes, no drops. Safe to roll forward; rollback means dropping the unique indexes + columns.
- **Edge function changes are backward compatible**: new task modes don't break existing ones. The old plan page (if kept) continues to work during phases 2-3.
- **Client route changes** (Phase 4 tab removal): test navigation thoroughly; keep old route as redirect for 1 release in case deep links exist.
- **Quota changes** (Phase 6): make sure users mid-plan aren't locked out by a premature gate flip. Migration must set `plans_used_free` based on existing `weekly_plans.status='active'` count.

---

## 7. Open questions (update as they come up)

- None currently. Will log here as work progresses.

---

## 8. Quick-start for next session

1. Read sections 1-4 to load context.
2. Find the first `⬜ not started` or `🟡 in progress` phase in section 5.
3. Follow the phase's Goal + Changes + Acceptance.
4. Work phase-by-phase. After completing, update the checkbox (✅) and commit with message `Phase N: <short summary>`.
5. Log any quirks/blockers in section 7 so they persist.

**Commit convention:** one commit per phase (possibly split into 2-3 if a phase has natural sub-steps). Branch: `claude/KOCHKO` (current). Push after each phase to keep origin in sync.

**Do not** start a phase without reading its Changes list fully and confirming acceptance criteria before marking done.

---

_Last updated: 2026-04-19 by Claude (initial draft, awaiting user approval)._
