# KOCHKO — Master Plan (multi-session)

> **This document is the single source of truth for the ongoing overhaul.**
> Any new Claude session can read this file and pick up exactly where the
> previous session left off. Update the **Status** column of each phase as
> work completes. Add notes at the bottom for quirks, blockers, or open
> questions so context survives across sessions.

**Revision:** rev2 (2026-04-19) — incorporates second-opinion review feedback.

---

## 1. Vision (why we are rebuilding)

KOCHKO is a **conversation-first** lifestyle coach. It is NOT a form-filling app with a chatbot bolted on. The user experience:

- **Onboarding** happens through **specialized chat sessions** ("coworkers"). Each chat owns a topic, collects its data, and hands off to the next chat. Any chat can opportunistically save cross-topic info, but it politely redirects deep dives to the right coworker.
- **Plan creation** happens in **two dedicated screens** (diet, workout) that are NOT generic chat. Each has a purpose-built UI where Kochko builds a draft plan, the user negotiates with it like a real dietitian consultation, preferences feed back into the profile, and the final plan is saved/archived with a history.
- **Kochko's knowledge of the user** is transparent: the user can always see what Kochko thinks it knows, and correct it.
- **Natural rhythm**: post-onboarding, daily flow is conversational (log meals, request cheat-meal permission, get proactive nudges). Not a dashboard of form fields.
- **Value-first, detail-later.** The user should be able to get a first usable plan after answering 5 core questions (height, weight, age, gender, main goal). Richer answers improve the plan progressively; they are never peşin prerequisites.

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
- Task chat improvements (checklist, silent saves, cross-topic opportunistic saving, server-validated completion)
- Diet plan screen (brand-new, specialized)
- Workout plan screen (brand-new, specialized)
- Plan versioning (draft / active / archived, with discarded-draft preservation)
- Plan drift detection (profile changes invalidate active plans)
- Plan preferences feedback loop (dislike → structured JSONB in profile)
- Home screen redesign to surface the two plans + profile completion gauge
- "Kochko'nun Senin Hakkında Bildikleri" rename + enriched view
- Free-tier quota rework (1 diet + 1 workout plan lifetime **approved**, daily message cap on plan chats)
- Post-onboarding daily flow (logging chat, proactive nudges, cheat-meal permission)
- General-chat → plan-screen routing (intent detection + deep link)
- Robust XML/JSON parsing with retry + fallback in all structured protocols

**Out of scope** for this plan (may be follow-up projects):
- Native push notification delivery infrastructure (uses existing expo-notifications)
- Widget / watchOS / wearables
- Social features, sharing, friends
- Localization beyond Turkish

---

## 3. Guiding principles

These are **the rules** for every decision. Violating them means reconsidering the design.

1. **Chat is primary, forms are fallback.** Every piece of user data has a conversational capture path. Forms exist only for quick edits.
2. **Kochko never verbally acknowledges saves, but the UI is assertive.** The model says "tamam" and moves on. The UI confirms via badge + short haptic + 200ms bounce-in animation. No toast. No chat text pollution.
3. **Each chat session has ONE job.** Specialized task chats don't drift. If info outside their scope is volunteered, they save it silently and gently redirect.
4. **Every save is visible and editable.** User can always find what Kochko knows and change it ("Kochko'nun Senin Hakkında Bildikleri" screen).
5. **Plan screens are NOT chat.** They have custom UI with chat as one component, not the whole screen.
6. **Drafts are fluid; published plans are immutable.** Once active, a plan becomes a historical record. Edits create a new draft. Discarded drafts are archived, not deleted.
7. **Every recommendation is explainable.** "Nasıl yaptın?" button on any plan returns AI's reasoning (TDEE calc → macro split → meal choice → ingredient sourcing).
8. **Value-first free tier.** Minimum-viable plan after 5 questions. Users must be able to complete onboarding + approve 1 diet + 1 workout plan before any paywall.
9. **No visual clutter.** Badges are small. Cards don't dominate. Plan preview is a card, not a half-screen takeover.
10. **Android edge-to-edge + safe area is mandatory.** Every new screen uses `useSafeAreaInsets`.
11. **Defensive parsing.** Every structured protocol (XML/JSON) has validate → 1 retry → drop + log. Never crash on a bad AI response.
12. **Full snapshot, not diff.** Plan updates from the model are always complete draft snapshots (never patches). Client diffs visually but trusts the server's single source of truth.

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

**Server-side validation (critical — prevents false positives):**

Before trusting `task_completion`, the edge function checks that the task's required fields are actually persisted in `profiles` / `goals` / etc. Each task has a `requiredFields` map:

```ts
const TASK_REQUIREMENTS = {
  introduce_yourself: (p) => p?.height_cm && p?.weight_kg && p?.birth_year && p?.gender,
  set_goal: (p, g) => g?.goal_type, // target_weight_kg optional
  // ... per task
};
```

If requirements unmet → `task_completion` is dropped from the response, the model receives a tool-response-style follow-up ("Eksik: height_cm. Kullanıcıdan al.") and continues the conversation. This prevents the model from closing a task it only *thinks* it finished.

**Next-suggestions validation (client side):**

Client whitelists `next_suggestions` against the active task registry. Invalid keys are dropped. If the result is empty, client falls back to `getIncompleteTasks()[:3]`.

**Rendering:**

- A small completion chip: `✓ Kochko seni tanıdı — 25 yaş, erkek, 130 kg, 191 cm`
- A row of up to 3 **next-task cards**. Each card: icon + title + one-line desc + `Başla →`.
- If fewer than 3 incomplete tasks remain, render however many are left.
- Tap → `createSession({ title, topicTags: [taskKey] })` → `router.push('/chat/[sessionId]?taskModeHint=onboarding_X')`.
- Completion chip appears with brief haptic + 200ms fade-in.

Existing DB writes (`ai_summary.onboarding_tasks_completed`) continue to flag tasks as done, so `getIncompleteTasks` excludes them on reload.

### 4.2 Plan screens — structure

Routes (new):
- `/plan/diet` — diet plan home
- `/plan/workout` — workout plan home

**Transitional navigation (phases 2-3 only):** the existing `(tabs)/plan.tsx` becomes a bridge screen showing two big cards ("Diyet Planı" / "Spor Planı") that route to the new screens. This bridge stays until Phase 4 removes the tab entirely and promotes the cards to the home screen.

Each plan screen has three sub-states, switched by reading current plan state from DB:

**(a) Empty state** — user has never created a plan of this type.
- Big illustration + short explainer.
- "Plan oluştur" CTA.
- If MVP prerequisites unmet → CTA is disabled, shows exactly what's missing + "Tamamla" buttons routing to relevant onboarding task chats.

**(b) Draft-in-progress state** — there is a `status='draft'` plan, user is building it.
- Top: sticky **plan preview card** (25% of screen max height).
  - Shows: week label, total calories/day, macro ring, day strip (7 dots, tap to jump).
  - Tap → expands to full-screen plan modal (scrollable 7-day view, each day has meal cards).
  - Close button returns to chat + card view.
- Middle/bottom: **chat column** — purpose-built task chat.
  - Task mode: `plan_diet` or `plan_workout`.
  - AI introduces self, explains what it's about to do using user profile.
  - Generates initial draft, asks for feedback.
  - User negotiates: "yumurta sevmem" → AI re-emits **full updated draft snapshot** + writes structured preference to `profiles.disliked_foods` JSONB.
  - Chat composer has **quick action chips**: `Nasıl yaptın?`, `Onayla ve kaydet`, `Alternatif gör`, `Baştan başla`.
  - **`Alternatif gör`**: AI produces a 2nd draft using same inputs but a different approach. Client shows side-by-side comparison modal; user picks one, the other is discarded (archived).
  - **`Onayla` is gated**: disabled until `hasViewedFullPlan === true`. The full-plan modal sets this flag when user has scrolled past the last day. Tooltip on disabled button: "Önce tüm haftaya bak".
  - **Flag is reset to `false` every time a new `<plan_snapshot>` arrives** (user could have approved-scrolled v1 and AI then patched to v2; they must re-view). Preview card shows a small "v2 · az önce güncellendi" badge next to the week label so the user sees which snapshot they are about to approve.
- When user taps **Onayla**: draft promoted to active, previous active (if any) archived, then screen switches to (c).

**(c) Active plan state** — user has an approved plan.
- Full plan view front and center (no sticky card needed since plan is primary).
- A "Kochko ile konuş" button opens a chat overlay for revisions (creates a new draft from active).
- "Geçmiş planlar" link opens history list (includes archived discarded drafts, marked with reason).
- Progress indicators if user logs meals/workouts against the plan.
- **Plan drift banner:** if profile has changed significantly since the plan was approved (TDEE delta >5% OR weight delta >3kg OR goal changed), a passive yellow banner: "Verilerinde önemli değişiklik var, planı güncelleyelim mi?" with a "Güncelle" button that creates a new draft prefilled from current profile.

### 4.3 Plan versioning

`weekly_plans` schema extension:

```sql
ALTER TABLE weekly_plans ADD COLUMN status TEXT CHECK (status IN ('draft', 'active', 'archived')) DEFAULT 'active';
ALTER TABLE weekly_plans ADD COLUMN plan_type TEXT CHECK (plan_type IN ('diet', 'workout')) DEFAULT 'diet';
ALTER TABLE weekly_plans ADD COLUMN superseded_by UUID REFERENCES weekly_plans(id);
ALTER TABLE weekly_plans ADD COLUMN approved_at TIMESTAMPTZ;
ALTER TABLE weekly_plans ADD COLUMN archived_reason TEXT; -- 'superseded', 'user_discarded', 'alternative_rejected', 'plan_drift'
ALTER TABLE weekly_plans ADD COLUMN user_revisions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE weekly_plans ADD COLUMN approval_snapshot JSONB; -- copy of profile at approve time (for drift detection)

CREATE UNIQUE INDEX uniq_active_plan_per_type ON weekly_plans(user_id, plan_type) WHERE status = 'active';
CREATE UNIQUE INDEX uniq_draft_plan_per_type ON weekly_plans(user_id, plan_type) WHERE status = 'draft';
```

Rules:
- Only ONE `draft` per (user, plan_type) at a time. `Alternatif gör` temporarily creates a second candidate; picking one archives the other immediately (keeps invariant).
- Only ONE `active` per (user, plan_type). Approving a draft archives the previous active (`archived_reason='superseded'`).
- `archived` are read-only history. Discarded drafts go here with `archived_reason='user_discarded'`, so users can still review past negotiations.
- `user_revisions` logs each negotiation turn: `[{ at: ISO, from: "sabah:yumurta", to: "sabah:yulaf", reason: "yumurta sevmiyorum", saved_preference: {"field":"disliked_foods","value":"yumurta"} }]`.
- `approval_snapshot` stores key profile fields at approval time so we can compute drift later (TDEE-relevant: weight_kg, height_cm, activity_level, goal_type, target_weight_kg).

### 4.4 Plan chat system prompts & protocol

Separate task modes (in addition to BASE_SYSTEM_PROMPT):

**`plan_diet` mode:**
- Access to full profile + goals + preferences + dislikes + budget + kitchen.
- First message: introduces self ("Kochko diyet uzmanıyım"), references known profile in 1 sentence, announces the plan about to be produced.
- Emits initial full draft via `<plan_snapshot>{...7-day JSON...}</plan_snapshot>`.
- **Every subsequent change re-emits a full `<plan_snapshot>`, never a patch.** Model instruction: "Her öğün değişikliğinde bile tam haftalık JSON'u yeniden yaz. Patch gönderme."
- Alongside snapshot, optionally emits `<actions>[{"type":"profile_update","disliked_foods":[{"item":"yumurta","context":"breakfast","severity":"strong","learned_at":"ISO"}]}]</actions>`.
- Never acknowledges verbally ("Kaydettim, güncelledim") — the UI shows plan changes + preference badges.
- Explainability: when user asks "Nasıl yaptın?", emit `<reasoning>{...structured explanation...}</reasoning>` with TDEE calc, macro split rationale, meal choice logic.
- When user taps "Onayla", client emits `user_approved: true` in the next request. **Approval is authoritative on the server side**: the edge function promotes the current `status='draft'` row for `(user, plan_type)` to `status='active'` regardless of what the AI's text response contains. If the AI emits `<plan_finalize>{}` that's fine (nice closing line), but its absence, corruption, or even an accidental new `<plan_snapshot>` does NOT block promotion. This prevents a finalize-race where a user's approval fails because the model "forgot" the tag. User approval is a user action, not a model action.

**`plan_workout` mode:** parallel structure, schema differs.

**Structured protocol error handling (applies to all modes):**

Every structured block in an AI response is parsed via:
1. Regex extract between tags.
2. `JSON.parse`.
3. Zod schema validate.
4. On failure: edge function immediately re-prompts the model ("Önceki JSON bozuktu: <error>. Sadece JSON'u yeniden gönder.") with a budget of **1 retry**.
5. Still bad → strip the block from response, log the failure, send user-facing message: "Plan güncellenemedi, tekrar dene." Client shows a retry chip.
6. Client validates all known blocks defensively before rendering.

### 4.5 Plan prerequisites enforcement

Two tiers: **MVP minimum** (required to generate any plan at all) + **Enrichment** (fields that, if present, make the plan better — surfaced as gentle prompts in chat but never block plan generation).

**MVP minimum (all required to unlock plan creation):**
- profile: height_cm, weight_kg, birth_year, gender
- goal: goal_type (target_weight_kg optional)

Just 5 fields total. Everything else gets **sane defaults** if missing:
- activity_level → `sedentary`
- budget_level → `medium`
- cooking_skill → `basic`
- meal_count_preference → `3`
- diet_mode → `standard`
- disliked_foods → `[]`
- food allergies → fetched from `food_preferences` table; empty is valid
- training_experience → `beginner` (workout plan only)
- equipment_access → `home` (workout plan only)
- training_style → `mixed` (workout plan only)
- available_training_times → `['evening']` (workout plan only)

Single helper: `src/lib/plan-readiness.ts` exports:
```ts
isPlanReady(profile, goal, planType): { ready: boolean, missingCore: Field[], weakSpots: Field[] }
```

`missingCore` blocks generation (CTA disabled). `weakSpots` surface as "Plan daha iyi olabilir — bize {X} konusunu da anlat" chips on the plan screen, each chip routes to the relevant onboarding chat.

### 4.6 Preferences feedback schema

New columns on `profiles` (structured, not flat arrays):
```sql
ALTER TABLE profiles ADD COLUMN disliked_foods JSONB DEFAULT '[]'::jsonb;
-- [{ "item": "yumurta", "context": "breakfast"|null, "severity": "mild"|"strong", "learned_at": ISO }]

ALTER TABLE profiles ADD COLUMN preferred_foods JSONB DEFAULT '[]'::jsonb;
-- same shape

ALTER TABLE profiles ADD COLUMN budget_constraints JSONB DEFAULT '{}'::jsonb;
-- { "seafood": "too_expensive", "imported": "avoid", "organic": "unaffordable" }

ALTER TABLE profiles ADD COLUMN plan_feedback_notes TEXT; -- free-form notes AI writes over time
```

Handler for `profile_update` action merges incoming JSONB with existing array/object (doesn't overwrite). "Kochko'nun Senin Hakkında Bildikleri" screen shows these in editable rows, grouped by category.

### 4.7 Subscription / gating (option C — message-based)

Free tier:
- **Unlimited** chat messages during onboarding (no cap while any of the 13 onboarding tasks is incomplete).
- **Daily message cap on non-onboarding chats** (plan chats, general chats, daily-log chats): 50 messages/day free. Premium: unlimited.
- **Plan approval cap:** 1 lifetime approved diet plan + 1 lifetime approved workout plan. Unlimited draft generation and regeneration for both — the user can try as many alternatives as they want within the daily message cap.
- Once both plans are approved → creating a NEW plan (regeneration after the fact) requires premium.
- Premium (weekly subscription via RevenueCat):
  - Unlimited plan regeneration and replacement.
  - Unlimited chat messages.
  - Advanced features as they ship.

Rationale: The draft/message cap prevents AI cost abuse without punishing legitimate negotiation. Users who want to keep iterating pay for it via the subscription.

Existing `subscriptions` table + trigger stays. New fields:
```sql
ALTER TABLE profiles ADD COLUMN plans_used_free JSONB DEFAULT '{"diet": 0, "workout": 0}'::jsonb;
ALTER TABLE profiles ADD COLUMN daily_msg_count JSONB DEFAULT '{"date": null, "count": 0}'::jsonb;
```

`plans_used_free.{type}` increments when a plan is approved (status → active). Existing active plans at migration time → increment accordingly.

Rate limit helper already exists at `supabase/functions/shared/rate-limit.ts`; extend to read the onboarding-completion flag + daily_msg_count.

**Daily cap timezone:** the "day" for counting resets at **user's local midnight**, using `profiles.home_timezone` + `profiles.day_boundary_hour` (default 4). UTC is only a fallback if the user has no timezone set. Rationale: Turkish users at UTC midnight (03:00 local) would otherwise be told "resets in the morning" — confusing. The existing `src/lib/day-boundary.ts` helper already handles this for meal logs; reuse it so cap and meals use the same day definition.

### 4.8 Plan drift detection

When user's profile changes in a way that would materially affect an active plan, flag it on the plan screen. Two severities:

**Soft drift (passive yellow banner — user decides when to act):**
- Weight delta > 3 kg from `approval_snapshot.weight_kg`
- Height change
- Activity level change
- Goal type change
- Target weight change
- `disliked_foods` or `budget_constraints` significantly expanded (≥2 new entries since approval)
- `diet_mode` changed (e.g. standart → vegan)

**Hard drift (red banner + plan items hidden/flagged until user resolves):**
- New food allergy added to `food_preferences` (even one) — meals that contain the allergen are dimmed and marked "⚠ Alerjen içeriyor" until user regenerates the plan
- New medical condition that changes dietary safety (diabetes added, kidney condition, pregnancy) — full plan locked behind "Güvenliğin için planı güncelleyelim" modal

Computed client-side using `approval_snapshot` vs current profile (soft) and real-time against `food_preferences` / `health_events` (hard). No backend polling.

Action on soft: banner button "Yeni plan oluştur" → creates a new draft based on fresh profile, existing active plan stays until approved.
Action on hard: modal blocks meal viewing, CTA "Planı güncelle" is mandatory to dismiss (still doesn't auto-change the plan — user approves the new draft).

### 4.9 General chat → plan routing

In the default non-task general chat, if the user expresses plan intent ("diyet listesi istiyorum", "spor programı lazım"), AI runs intent detection and responds with:

```xml
<navigate_to>{"route": "/plan/diet"}</navigate_to>
```

Client parses and either auto-navigates (with user confirmation chip) or shows a "Diyet planı oluştur →" button in the AI message.

If prerequisites are unmet, the AI first continues the conversation to gather the remaining core fields (boy/kilo/yaş/cinsiyet/hedef), emits relevant `profile_update` actions, then navigates.

### 4.10 Renaming

- Settings entry: "Koçun Hafızası" → **"Kochko'nun Senin Hakkında Bildikleri"**
- Screen title matches.
- Navigation icon stays (eye).
- Deep-link any references in chat/UI that say the old name.

---

## 5. Phase breakdown

> Each phase should be completable in **one focused session** (or less).
> **Do not batch phases.** Complete one, commit, update status, then move on.
> The next Claude session starts by reading this section to find the first non-completed phase.

### Phase 0 — Foundation & cleanup  ✅ done (2026-04-19)

**Goal:** DB + naming + utility groundwork for everything else.

**DB migrations:**
- `030_plan_versioning.sql` — extend `weekly_plans`: status, plan_type, superseded_by, approved_at, archived_reason, user_revisions, approval_snapshot + 2 unique indexes.
- `031_profile_preferences.sql` — add `disliked_foods` (JSONB), `preferred_foods` (JSONB), `budget_constraints` (JSONB), `plan_feedback_notes` (TEXT) to `profiles`.
- `032_plans_used_free.sql` — add `plans_used_free` JSONB + `daily_msg_count` JSONB to `profiles`. Backfill `plans_used_free` from existing `weekly_plans.status='active'` counts (group by user_id, plan_type).

**Code:**
- `src/lib/plan-readiness.ts` — new file exporting `isPlanReady`, `getMissingCore`, `getWeakSpots`.
- Rename "Koçun Hafızası" → "Kochko'nun Senin Hakkında Bildikleri":
  - `app/settings/coach-memory.tsx` screen header + any visible labels.
  - `app/settings/index.tsx` menu row.
  - Any other references (grep literal).
- No UI changes yet beyond the rename. Phases 1-7 consume the new schema and utility.

**Acceptance:**
- `supabase db push` applies 030, 031, 032 cleanly on remote.
- `plans_used_free` is correctly backfilled for existing users (verify one sample manually).
- `plan-readiness.ts` has a quick unit-style test function that runs without errors on a null profile.
- `grep -r "Koçun Hafızası"` returns 0 in source (markdown docs OK to keep).

---

### Phase 1 — Onboarding handoff UX  ✅ done (2026-04-19)

**Goal:** Task chats close cleanly with next-task suggestions. Silent saves via badges + haptic. Server validates completion.

**Edge function changes:**
- `supabase/functions/ai-chat/index.ts`:
  - Parse `<task_completion>` block (mirrors `<layer2_update>` handling).
  - **Server-side requirement validation:** for the claimed task, check profile/goals contain the required fields. If not, drop the block, append a re-prompt to the model ("Eksik: X. Kullanıcıdan al."), and do NOT write `onboarding_tasks_completed`.
  - Validated completion is returned as `task_completion` field in response JSON.
- Prompt updates:
  - Provide the model with remaining incomplete task keys (for `next_suggestions`).
  - Include examples of valid `<task_completion>` blocks.
  - Reinforce existing "no verbal save acknowledgement" rules.

**Client changes:**
- `src/services/chat.service.ts`: add `task_completion` to `ChatResponse`. Whitelist `next_suggestions` against active task registry.
- `app/chat/[sessionId].tsx`:
  - New `TaskCompletionCard` component (summary chip + up to 3 next-task cards).
  - Haptic feedback on render (`expo-haptics` — already installed or add to package).
  - Existing `<task_completion>` XML stripped from rendered text.
  - Tap card → `createSession` + navigate.
- Strip structured XML tags from displayed message content (update the message renderer's content sanitizer).

**Acceptance:**
- Complete a test task (Kendini tanıt) by providing all 4 fields.
- Final AI message shows:
  - 1-sentence human closer.
  - Summary chip with brief haptic.
  - Up to 3 next-task cards.
- Tapping a card opens a new chat with correct `taskModeHint`.
- Old task's card vanishes from Kochko tab list.
- Server-side validation: artificially block one field (e.g., remove gender from DB write), verify task completion is **rejected** and AI continues asking.
- No verbal "Kaydettim/Profilini güncelledim" in any response (grep chat history).

---

### Phase 2 — Diet plan screen  🟡 implemented, awaiting test (2026-04-19)

**Goal:** Fully functional diet plan creation, negotiation, and activation flow.

**Routes & bridge:**
- Create `app/plan/diet.tsx`.
- Update `app/(tabs)/plan.tsx` as **bridge**: two big cards (Diyet | Spor) linking to new routes. Bridge stays until Phase 4 removes the tab.

**New components:**
- `src/components/plan/PlanPreviewCard.tsx` — collapsed card (day strip + macro ring + calorie label).
- `src/components/plan/FullPlanModal.tsx` — full-screen 7-day view. **Tracks `hasViewedFullPlan`** via scroll position: last day fully in viewport → flag true, stored in screen state.
- `src/components/plan/MealCard.tsx` — single meal display with macros + inline edit affordance.
- `src/components/plan/PlanChatComposer.tsx` — chat composer with quick-action chips.
- `src/components/plan/AlternativeComparisonModal.tsx` — side-by-side compare of two drafts (for "Alternatif gör").
- `src/services/plan.service.ts` — full CRUD: `getActive`, `getDraft`, `getHistory`, `createDraft`, `approveDraft`, `discardDraft`, `requestAlternative`, `applySnapshot`, `logRevision`.

**Edge function:**
- New task mode `plan_diet` in `task-modes.ts` with structured output contract (plan_snapshot, reasoning, plan_finalize, actions).
- Parse `<plan_snapshot>`, `<reasoning>`, `<plan_finalize>` with validate+retry+drop pattern.
- When request body contains `user_approved: true`, expect `<plan_finalize>`; on receive, promote draft status in DB.

**State machine:**
```
No plan          → EmptyState  [Plan oluştur] CTA (disabled if missingCore)
                       ↓
Draft in progress → PreviewCard + PlanChatComposer
                       ↓ (Alternatif gör) → AlternativeComparisonModal → pick one
                       ↓ (Onayla — gated by hasViewedFullPlan) → approve
                       ↓
Active           → FullPlanView + [Kochko ile konuş] + [Geçmiş] + drift banner (if applicable)
```

**Acceptance:**
- Empty state works, CTA disabled when `missingCore.length > 0`.
- Missing core fields show as clickable cards routing to onboarding tasks.
- Weak spots show as gentle suggestion chips, not blockers.
- "Plan oluştur" creates a draft, opens chat, AI produces a 7-day menu via `<plan_snapshot>`.
- User says "yumurta yerine yulaf" → AI emits new full snapshot, preview card re-renders, the changed meal cell gets a 500ms green highlight.
- User says "süt ürünleri sevmem" → AI updates all dairy meals + emits `profile_update` with `disliked_foods` structured entry.
- "Alternatif gör" produces a 2nd draft; comparison modal shows both; picking one archives the other.
- "Onayla" is disabled until user has scrolled the full plan modal to end.
- Approving activates the plan, archives previous (if any), switches screen to state (c).
- Past plans (including discarded drafts) visible in history with `archived_reason`.

---

### Phase 3 — Workout plan screen  🟡 implemented, awaiting test (2026-04-19)

**Goal:** Parallel of Phase 2 for workouts.

**Routes:**
- Create `app/plan/workout.tsx`.
- Bridge tab gets the second card active (was already linking).

**Components:**
- Reuse `PlanPreviewCard`, `FullPlanModal`, `AlternativeComparisonModal` with plan_type variant props.
- New `ExerciseCard.tsx` — name, sets × reps, weight/RPE, rest, video link placeholder.
- `plan.service.ts` extended with workout variants.

**Edge function:**
- New task mode `plan_workout` with analogous structured contract.
- Plan schema: `{ week: [{ day_index, rest_day?, exercises: [{ name, sets, reps, weight_kg?|rpe?, rest_sec, notes }] }] }`

**Acceptance:** parallel to Phase 2 but workout-shaped. "Diz sakatlığım var, squat yapamam" → AI swaps squats for leg press/bridges, saves injury note to profile.

---

### Phase 4 — Home screen redesign  🟡 implemented, awaiting test (2026-04-22)

**Goal:** Dashboard surfaces the two plans and profile completion. Plan tab removed.

**Changes:**
- `app/(tabs)/index.tsx`:
  - New hero order:
    1. **Profile completion donut** with weighted score (see Principle 8 and formula below). Taps → scrolls to the incomplete-tasks section.
    2. **Two big plan cards:** "Bu haftaki diyetin" + "Bu haftaki sporun". Empty state renders if no active plan, with "Plan oluştur →" CTA. Active state shows today's highlight (today's meals count / today's workout name). Tap → respective plan screen.
    3. Today's focus: next meal / next workout / streak / proactive nudges.
    4. Onboarding task row (if any incomplete tasks).
    5. Quick actions (log meal, log weight).
- `app/(tabs)/plan.tsx`: delete. Remove from tab layout.
- `app/(tabs)/_layout.tsx`: update to 4 tabs + FAB + profile.

**Profile completion scoring (formula):**
```
critical_fields = [height_cm, weight_kg, birth_year, gender, goal_type]   // 12% each → 60%
important_fields = [activity_level, food_allergies_acknowledged, diet_mode, health_checked, budget_level, cooking_skill]  // 5% each → 30%
enrichment_fields = [sleep_quality, stress_level, training_experience, previous_diets, social_eating_notes, ...]  // cap 10% total
completion_pct = sum(critical) + sum(important) + min(10, sum(enrichment))
```
Implementation lives in `src/lib/profile-completion.ts` (already exists, needs extension).

**Acceptance:**
- Ana sayfa shows profile donut prominently.
- Two plan cards visible, correct empty/active state.
- Tapping a plan card opens respective plan screen.
- Tab layout has 4 tabs + FAB (no "plan" tab).
- Deep link `/plan` (if any old one exists) redirects to home or diet screen.

---

### Phase 5 — Daily flow + proactive nudges  🟡 implemented, awaiting test (2026-04-22)

**Goal:** Post-onboarding experience — conversational logging, cheat-meal flow, proactive nudges. General chat intent routing.

**Changes:**
- New task mode `daily_log` for post-onboarding general chats. System prompt references today's active plan if present.
- AI greets proactively on open if >4h since last message.
- Cheat-meal permission: user says "bu akşam düğün var, tatlı yiyeceğim"; AI gives advice + emits `<actions>[{"type":"commitment", ...}]</actions>`.
  - `commitment` handler already exists (`user_commitments` table insert). No schema change needed.
- Proactive nudges via `ai-proactive` (already exists):
  - If no meal logged by 14:00 → notification.
  - If no workout on scheduled day → light reminder.
- **General-chat intent detection:** if user mentions diet/workout plan in general chat, AI emits `<navigate_to>` block. Client renders an inline "Plana git →" button in the AI message. If prerequisites missing, AI continues gathering first, then navigates.

**Acceptance:** user logs 3 meals conversationally; next-day chat references yesterday. "Diyet planı istiyorum" in general chat → either prompts for missing fields or surfaces a navigate button.

---

### Phase 6 — Subscription / quotas  🟡 implemented, awaiting test (2026-04-22)

**Goal:** Onboarding unlimited; daily message cap post-onboarding; 1+1 lifetime approved plans free; paywall after.

**Changes:**
- `src/lib/premium-gate.ts`: new `canApprovePlan(planType, profile): { allowed: boolean, reason? }` based on `plans_used_free` and active premium.
- `src/services/plan.service.ts`: `approveDraft` checks gate, returns `PREMIUM_REQUIRED` error if blocked. UI shows paywall prompt.
- Rate limit edge function (`shared/rate-limit.ts`):
  - If user has any incomplete onboarding task → no cap.
  - Otherwise: 50 msg/day free (any non-onboarding chat type). Unlimited premium.
  - Resets at UTC midnight (or user's day_boundary_hour if set).
- `plans_used_free` increments on `approveDraft`.
- Paywall screen (`app/settings/premium.tsx` already exists, needs wiring to RevenueCat stubs).

**Acceptance:**
- Fresh user: can approve 1 diet + 1 workout plan, no paywall.
- Subsequent "Onayla" for a 2nd plan of the same type → paywall modal.
- Daily message cap hits at 50 for general/daily_log chats (simulate with repeated messages); onboarding unaffected.
- Premium mock unlock via `subscriptions` table clears all gates.

---

### Phase 7 — Polish & celebrations  🟡 partial (2026-04-22) — animations done, illustrations deferred

**Goal:** Small but meaningful UX wins.

**Changes:**
- Task completion mini-confetti/celebration (lightweight, Reanimated).
- Profile completion donut animates on change.
- Empty state illustrations (SVG placeholders).
- Optional approval sound effect (off by default).
- Accessibility pass on new screens.
- Final visual polish on plan preview card, meal card, exercise card.

**Acceptance:** feels fluid, not empty.

---

## 6. Risk & rollback

- **DB changes** (030, 031, 032): all additive. Rollback = drop the new columns/indexes. Safe.
- **Edge function changes**: all new task modes. Old ones continue to work. Safe to roll forward partially.
- **Client route changes** (Phase 4): test navigation thoroughly. The bridge tab (phases 2-3) minimizes discovery risk.
- **Quota changes** (Phase 6): the backfill query for `plans_used_free` must run BEFORE gating is enabled, to avoid locking out existing users with active plans. Migration handles this atomically.
- **Protocol parsing** (all phases): with retry+drop pattern, bad AI responses degrade gracefully; worst case is "plan güncellenemedi, tekrar dene" for a single turn.
- **Drift detection**: passive banner only, never auto-changes an active plan. User always in control.

---

## 7. Open decisions & their resolutions

Record every material design decision here so the next session has context.

| # | Decision | Resolved | Rationale |
|---|---|---|---|
| 1 | Rename of "Koçun Hafızası" | "Kochko'nun Senin Hakkında Bildikleri" (2026-04-19) | User preference; more natural than earlier draft. |
| 2 | Draft quota strategy | Option C — daily message cap during plan chats, unlimited draft regeneration, 1+1 approved plans lifetime free (2026-04-19) | Least punitive to legitimate negotiation; caps AI cost via message count. |
| 3 | Plan update protocol | Full snapshot every turn, no patches (2026-04-19, rev2) | Diff semantics are fragile; snapshot is robust and token cost is bounded. |
| 4 | XML/JSON parse failures | 1 retry with error feedback, then drop+log (2026-04-19, rev2) | Production-grade; prevents crashes on malformed model output. |
| 5 | `task_completion` server validation | Required, reject if profile fields not actually written (2026-04-19, rev2) | Prevents false positives from model mid-conversation. |
| 6 | Minimum plan prerequisites | 5 core fields (boy/kilo/yaş/cinsiyet/hedef), rest defaulted (2026-04-19, rev2) | Value-first principle; heavy prereqs delay value delivery. |
| 7 | Parallel drafts | MVP = single draft + "Alternatif gör" produces a 2nd temp draft → pick one (2026-04-19, rev2) | Consultation feel without UX complexity of managing N drafts. |
| 8 | `disliked_foods` schema | JSONB with `{item, context, severity, learned_at}` (2026-04-19, rev2) | Nuance capture (e.g. "sabahları yumurta sevmem"). |
| 9 | Plan drift response | Passive banner + manual "Güncelle" button (2026-04-19, rev2) | User in control; no silent plan changes. |
| 10 | Approval guardrail | `hasViewedFullPlan` flag via scroll tracking gates Onayla button (2026-04-19, rev2) | Prevents blind approvals and later complaints. |
| 11 | Discarded drafts | Archived with `archived_reason='user_discarded'`, NOT deleted (2026-04-19, rev2) | Preserves negotiation history; users can review past ideas. |
| 12 | General chat → plan navigation | AI emits `<navigate_to>` when intent detected (2026-04-19, rev2) | Avoids dead-end chats; routes user to correct tool. |
| 13 | Silent save feedback | Badge + haptic + 200ms bounce animation; no toast (2026-04-19, rev2) | Noticeable without cluttering chat. |
| 14 | `hasViewedFullPlan` reset | Resets to false on every new `<plan_snapshot>`; preview shows version badge (2026-04-19, rev2.1) | Prevents approving a plan version user hasn't seen. |
| 15 | `plan_finalize` authority | Server promotes draft→active on `user_approved: true` regardless of AI output (2026-04-19, rev2.1) | User action must be reliable; model tag is cosmetic. |
| 16 | Drift severity tiers | Soft banner (weight/goal/etc.) vs hard block (new allergy / medical condition) (2026-04-19, rev2.1) | Allergens and new conditions are safety issues, not preferences. |
| 17 | Daily cap timezone | User's local midnight via `day_boundary_hour`, UTC fallback only (2026-04-19, rev2.1) | UTC midnight ≠ Turkey midnight; cap resetting at 03:00 local is bad UX. |

**Deferred to implementation phases (will be resolved in code, logged here when done):**

- **Alternative-of-alternative:** When "Alternatif gör" produces 2 drafts and user rejects both, a "Yeni iki alternatif daha" button should be available inside the comparison modal. Decided in Phase 2 while building the modal.
- **Snapshot diff highlighting:** Client must keep `previousSnapshot` in state and compute a shallow diff to highlight changed meal cells for 500ms. Implementer's choice whether to ship a small `deepDiff` util or use `lodash.isEqual` per cell. Phase 2 decision.
- **"Nasıl yaptın?" UX:** Free or premium? Inline reasoning bubble vs modal? Default: free, inline bubble that is collapsible. Revisit if it drowns the chat visually.
- **Subscription lapse behavior:** When premium expires and user has >1 active plan, read access stays, write is locked. Active plans remain viewable; creating/approving new plans requires resubscription. Decided per industry pattern; formalize in Phase 6.
- **`preferred_foods` usage:** Either wire into `plan_diet` prompt (mirror of `disliked_foods`) or remove the column. Decide in Phase 2 when writing the prompt — if it doesn't earn its cost in prompt tokens, drop it.
- **`navigate_to` rejection handling:** General-chat prompt instructs "kullanıcı yönlendirmeyi reddederse `<navigate_to>` tekrar gönderme, burada konuşmaya devam et." Simple prompt rule, verify in Phase 5.
- **Profile completion `health_checked` definition:** Counts as "checked" if user has submitted any `health_events` row (including explicit "no condition" entry via a new onboarding action) or has explicitly skipped the health task. Phase 4 implementation detail.
- **Snapshot token cost audit:** Post-launch metric. Log plan-chat output token counts in `chat_messages.token_count` (already captured) and review after 2 weeks. If free-tier users average >200K tokens/day, consider tightening plan-chat cap (20/day) or introducing server-side semantic edit (AI says "change day 3 breakfast to oats" → server mutates canonical JSON). Not a launch blocker.

---

## 8. Quick-start for next session

1. Read sections 1-4 to load context.
2. Find the first `⬜ not started` or `🟡 in progress` phase in section 5.
3. Follow the phase's Goal + Changes + Acceptance.
4. Work phase-by-phase. After completing, update the checkbox (✅) and commit with message `Phase N: <short summary>`.
5. Log any quirks/blockers in section 7 or below in the Notes section.

**Commit convention:** one commit per phase (possibly split into 2-3 if a phase has natural sub-steps). Branch: `claude/KOCHKO` (current). Push after each phase to keep origin in sync.

**Do not** start a phase without reading its Changes list fully and confirming acceptance criteria before marking done.

---

## 9. Session notes

Use this section to log session-by-session observations: what was completed, what surprised you, what broke, what the next session needs to know. Newest entry on top.

### 2026-04-19 — rev2 review integrated
- Received second-opinion review, integrated 13 decisions (see table above).
- No code changes yet; plan document updated and ready for Phase 0.
- Ready to begin execution on user confirmation.

### 2026-04-19 — Phase 1 complete
- Edge function parses `<task_completion>` and also treats `<layer2_update>{onboarding_task_completed}` as equivalent. Either path is validated server-side against the task's required fields via `validateTaskCompletion(userId, taskKey)`.
- Removed the old unvalidated writer in `processLayer2Updates` — the validated handler in the main request flow is now the only code path that writes `ai_summary.onboarding_tasks_completed`.
- Response body now carries `task_completion: { completed, summary, next_suggestions[] } | null`. Suggestions are whitelisted against `VALID_TASK_KEYS`; if empty, server computes fallback from incomplete tasks.
- `src/services/chat.service.ts`: `ChatResponse` extended with `task_completion`. New `TaskCompletion` type exported.
- `src/services/onboarding-tasks.service.ts`: new `getTaskByKey(key)` lookup so the card renders task metadata.
- `UIMessage.taskCompletion` field set when a server-validated completion arrives in the assistant reply.
- `TaskCompletionCard` component (end of `[sessionId].tsx`) renders: green summary chip ("Kochko seni tanıdı — ...") + up to 3 tappable next-task cards. Tap creates a new session via `createSession({ title, topicTags })` and navigates with the right `taskModeHint`.
- Brief `Vibration.vibrate(30)` on card mount (RN core, no native rebuild). Full haptic via expo-haptics deferred (noted in Section 7 deferred list).
- `sanitizeAssistantText` belt-and-suspenders stripper added for `<actions>`, `<layer2_update>`, `<task_completion>`, `<plan_snapshot>`, `<plan_finalize>`, `<reasoning>`, `<navigate_to>` — even if server forgets, user never sees raw XML.
- **Next session: Phase 2** — diet plan screen. See §5 Phase 2.

### 2026-04-22 — Phases 5, 6, 7 implemented (uncommitted, all autonomous)
User deployed ai-chat edge function, then asked to power through 5→6→7 without stopping for tests. Worst-case recovery acceptable to them.

**Phase 5 — Daily flow + nudges:**
- `task-modes.ts`: new `daily_log` mode. Post-onboarding conversational layer — records logs via `<actions>`, handles cheat-meal intents via `commitment` action (existing handler), respects active plan, suggests MVD mode when motivation is low. Explicit bans on verbal save acknowledgements and judgmental tone.
- Same file: `<navigate_to>` contract — AI in daily_log emits `<navigate_to>{"route":"/plan/diet"}</navigate_to>` when user expresses plan intent, server validates against whitelist, client renders a pill button.
- `retrieval-planner.ts`: `daily_log` case with focused nutrition+training layer1, minimal layer2 patterns, 7-day layer3 meals+workouts+metrics, full 15-turn layer4.
- `ai-chat/index.ts`: new `extractNavigateTo` parser with route whitelist (`VALID_NAVIGATE_ROUTES`). Parses and strips the tag; response now includes `navigate_to: string | null`.
- `chat.service.ts`: `ChatResponse.navigate_to` added.
- `app/chat/[sessionId].tsx`: `UIMessage.navigateTo` field; pill button rendered below assistant message content when set; taps `router.push(navigateTo)`. Proactive greeting: on chat reopen with >4h since last assistant message in a non-task chat, a gentle "Uzun zamandır konuşmadık…" starter is injected client-only (no DB write until user replies).

**Phase 6 — Subscription / quotas:**
- `premium-gate.ts`: new `canApprovePlan(planType): PlanApprovalGate` — free tier allows 1 lifetime approved plan per type, premium bypasses. Reads `plans_used_free` JSONB from profile.
- `app/plan/diet.tsx` + `app/plan/workout.tsx`: `handleApprove` now gates — if blocked, pushes a paywall message into the chat stream and routes to `/settings/premium` for upgrade.
- `shared/rate-limit.ts` rewritten:
  - Onboarding bypass — users with any unfinished onboarding task get unlimited messages.
  - Free daily cap raised 5 → 50 messages.
  - Premium stays 200/day + 30/hour.
  - "Day" resets at user's local midnight (honors `home_timezone` + `day_boundary_hour`, UTC fallback). Uses `Intl.DateTimeFormat` inside an inline helper so no new dependencies.

**Phase 7 — Polish:**
- `TaskCompletionCard`: summary chip now scale-in bounces on mount (spring friction 4, tension 120) + vibration pulse pattern `[0, 40, 40, 30]`. Replaces the prior single-shot vibration.
- `SavedBadge` component extracted: each silent-save pill bounces in with spring + fade. Feels rewarding without being loud.
- Empty-state illustrations, sound effects, accessibility pass — **deferred** (each is a small independent follow-up and not blocking).

**Nothing committed this session.** User can't test right now but approved the autonomous push; recovery via `git checkout -- .` if anything regresses.

**Remaining open items:**
- Full user test of phases 2-7 end-to-end.
- If approved: single big commit across all uncommitted work (all phases 2-7).
- Phase 4 leftover: delete the `display:none` legacy diet/workout tab code + remove `(tabs)/plan.tsx` entirely once the new cards are proven. Plan tab is still a live bridge.
- Phase 7 deferred items (illustrations + sounds + a11y) in a focused polish pass.
- Snapshot token cost audit (logged as deferred decision in §7) after 2 weeks of real usage.

### 2026-04-22 — Phase 4 full implementation (uncommitted)
User returned after a few days. Asked to continue with Phase 4 while they deploy edge functions.

Full home redesign implemented:
- `src/components/dashboard/ProfileCompletionDonut.tsx` — animated SVG donut, red/amber/green scale, one-line hint about biggest gap, tap routes to Kochko tab. Consumes existing `src/lib/profile-completion.ts` weighted formula (unchanged).
- `src/components/dashboard/PlanOverviewCards.tsx` — two large cards (diet + workout) with today's focus (meal count / workout focus / rest-day label). Empty state with "Oluşturmak için dokun". Self-fetches active plans via plan.service, re-fetches on focus.
- `app/(tabs)/index.tsx` — new hero order: profile completion donut → plan overview cards → activity timeline. The legacy diet/workout tab selector block is wrapped in `display: 'none'` View (code preserved for rollback, ~170 lines). If the new layout proves itself after user testing, the legacy block can be deleted in a small follow-up.
- Plan tab (`app/(tabs)/plan.tsx`) still exists as bridge; removal deferred until home cards are validated in production.

### 2026-04-19 — Phases 2/3/4 implemented (uncommitted)
User authorized an autonomous push to implement as far as possible while they were away. Committed nothing (per user request); code lives on disk ready for review/merge.

**Phase 2 — Diet plan screen (complete):**
- `src/services/plan.service.ts`: CRUD + full plan_data type definitions (DietPlanData, WorkoutPlanData, DietMeal, DietDay, WorkoutExercise, WorkoutDay), lifecycle helpers (createDraft, applySnapshot, approveDraft, discardDraft, getActive, getDraft, getHistory), helpers (isoDateMondayOfWeek, computeDayTotals, dietPlanDiff, emptyDietPlan, emptyWorkoutPlan).
- `src/components/plan/MealCard.tsx`: expandable meal card with items list, macros, edit affordance, 600ms green-glow on highlighted change.
- `src/components/plan/ExerciseCard.tsx`: workout analogue.
- `src/components/plan/PlanPreviewCard.tsx`: sticky compact card with 7-day strip + version badge + "az önce güncellendi" label.
- `src/components/plan/FullPlanModal.tsx`: full-screen 7-day view, day-by-day accordion, `onFullyViewed` callback tied to scroll-to-bottom → enables Onayla button.
- `src/components/plan/AlternativeComparisonModal.tsx`: side-by-side summary of two drafts with "Bunu seç" + "Hiçbiri olmadı, 2 alternatif daha göster".
- `src/components/plan/PlanChatComposer.tsx`: chat composer with Nasıl yaptın? / Alternatif gör / Baştan başla / Onayla chips.
- `src/components/plan/PlanEmptyState.tsx`: empty + CTA with missingCore blocking and weakSpots as suggestion chips.
- `src/components/plan/PlanActiveView.tsx`: active plan view with Kochko ile konuş, Geçmiş, soft + hard drift banners.
- `app/plan/diet.tsx`: three-state screen (loading / empty / draft / active) wired to plan.service, invokePlanChat, FullPlanModal, AlternativeComparisonModal, PlanChatComposer. Handles approve → load() to switch state.
- Edge function (`supabase/functions/ai-chat/index.ts`): new body params `plan_type`, `user_approved`, `draft_id`. `extractPlanSnapshot` + `extractReasoning` parsers. Plan snapshot persistence (upsert on draft). Approval path: archive previous active, promote draft, write `approval_snapshot`, increment `plans_used_free`. Response exposes `plan_snapshot`, `plan_reasoning`, `plan_persist_error`, `plan_approved`.
- `supabase/functions/shared/retrieval-planner.ts`: `plan_diet` / `plan_workout` cases with full layer1 + layer2 preferences + 14-day layer3 + 10-turn layer4.
- `supabase/functions/ai-chat/task-modes.ts`: TaskMode extended with `plan_diet` and `plan_workout`; full prompt instructions for each including the structured output contract, negotiation flow, bans list.
- `src/services/chat.service.ts`: added `TaskCompletion`, `invokePlanChat(params)` helper, response fields.

**Phase 3 — Workout plan screen (complete):**
- Edge fn done in Phase 2 commit above.
- `app/plan/workout.tsx`: parallel of diet.tsx with plan_type='workout', WorkoutPlanData, purple accent.
- Components reused across both plans.

**Phase 4 — Home redesign (partial):**
- Full redesign deferred (risky without tests). Instead:
- `app/(tabs)/plan.tsx`: bridge replacing old `daily_plans` screen. Two hub cards (Diyet / Antrenman) routing to `/plan/diet` and `/plan/workout`. Summarizes active plan if present, shows missing-field count otherwise.
- `app/(tabs)/index.tsx`: legacy `/diet-plan` and `/workout-plan` links retargeted to new `/plan/diet` and `/plan/workout`. Existing card structure left intact.
- Plan tab removal (full Phase 4 scope) deferred pending test of phases 2/3.

**Nothing committed in this session.** All changes live on working tree; user will review and commit when back.

**Next session priorities:**
1. User tests phases 2/3 end-to-end.
2. Fix issues that emerge.
3. Commit staged phases.
4. Phase 4 full redesign (home cards + remove plan tab) after 2/3 proven.
5. Phase 5 (daily logging flow), Phase 6 (quota gates), Phase 7 (polish) remain.

### 2026-04-19 — Phase 0 complete
- Migrations 030 (plan versioning), 031 (profile preferences), 032 (free-tier counters) applied to remote.
- Old `UNIQUE(user_id, week_start)` constraint dropped; replaced with partial indexes per `(user_id, plan_type)` for draft/active. Pre-existing rows backfilled: approved→'active', unapproved→'archived' (avoids partial-index collisions).
- `plans_used_free` backfill ran via subquery on active `weekly_plans` rows.
- `src/lib/plan-readiness.ts` created with `isPlanReady`, `getMissingCore`, `getWeakSpots`, `canAttemptPlan`.
- "Koçun Hafızası" → "Kochkonun Senin Hakkinda Bildikleri" across coach-memory.tsx (3 titles + 2 alert texts) and the profile tab menu row.
- Profile type has an index signature, new JSONB columns accessible via that — no breaking type changes.
- **Next session: Phase 1** — onboarding handoff UX. See §5 Phase 1.

### 2026-04-19 — rev2.1 second-review patch
- Applied 5 critical pre-implementation fixes from independent review:
  1. `hasViewedFullPlan` resets on every new snapshot (4.2)
  2. `plan_finalize` is cosmetic; server authoritatively promotes on user action (4.4)
  3. Drift detection has soft/hard tiers; allergies are hard-stop (4.8)
  4. Daily cap uses user's local midnight, not UTC (4.7)
  5. Added Appendix A — authoritative 13 onboarding task registry
- Remaining review items logged as "Deferred to implementation phases" in Section 7. These are implementation decisions, not design decisions — will be resolved in code.
- Reviewer's meta-advice accepted: no rev3. Moving to Phase 0.

### 2026-04-19 — rev1 initial draft
- Master plan first written after user clarifications (A–F answers).
- Pre-review version. Superseded by rev2.

---

## Appendix A — Onboarding task registry

Canonical list. Phases reference this when building `TASK_REQUIREMENTS`, the handoff cards, and the prerequisites checker. Keys match `src/services/onboarding-tasks.service.ts`.

| Key | Title (TR) | Required fields (server validates completion) | Critical for plan? |
|---|---|---|---|
| `introduce_yourself` | Kendini tanıt | `profiles.height_cm`, `weight_kg`, `birth_year`, `gender` | ✅ (diet + workout) |
| `set_goal` | Hedefini belirle | `goals.goal_type` (active row); `target_weight_kg` optional | ✅ (diet + workout) |
| `daily_routine` | Günlük rutin | `profiles.occupation` OR `work_start` | ⬜ enrichment |
| `eating_habits` | Beslenme alışkanlıkları | `profiles.eating_out_frequency` OR `meal_count_preference` | ⬜ enrichment (diet) |
| `allergies` | Alerji ve hassasiyetler | `food_preferences` has ≥1 row with `is_allergen=true` OR explicit "no allergy" flag | ✅ (diet — safety) |
| `kitchen_logistics` | Mutfak imkânları | `profiles.kitchen_equipment` OR `meal_prep_time` | ⬜ enrichment (diet) |
| `exercise_history` | Spor geçmişi | `profiles.training_experience` OR `exercise_history` | ✅ (workout) |
| `health_history` | Sağlık geçmişi | `health_events` has ≥1 row (including explicit "no condition") | ✅ (both — safety) |
| `weight_history` | Kilo geçmişi | `profiles.previous_diets` non-null | ⬜ enrichment |
| `lab_values` | Kan tahlilleri | `lab_values` has ≥1 row OR user dismissed | ⬜ enrichment |
| `sleep_patterns` | Uyku düzeni | `profiles.sleep_time` AND `sleep_quality` | ⬜ enrichment |
| `stress_motivation` | Stres ve motivasyon | `profiles.stress_level` OR `motivation_source` | ⬜ enrichment |
| `home_environment` | Ev ve çevre | `profiles.household_cooking` | ⬜ enrichment |

"Critical for plan?" column drives the CTA-disabled state on plan screens. MVP (as decided in §4.5) is just `introduce_yourself` + `set_goal`. The other ✅ tasks are strongly-recommended weak spots surfaced as suggestion chips.

Any task not in this table is invalid — server-side `task_completion` validation must reject unknown keys, and client-side `next_suggestions` whitelist must drop them.

---

_Last updated: 2026-04-19 by Claude (rev2.1 patch, heading to Phase 0)._
