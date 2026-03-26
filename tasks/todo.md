# Kochko - Master Todo

## Phase 0: Architecture & Planning
- [x] Collect product requirements from user
- [x] Decide tech stack (Expo + Supabase + OpenAI GPT)
- [x] Establish working principles (tasks/lessons.md)
- [ ] Write comprehensive architecture document (docs/ARCHITECTURE.md)
- [ ] Define database schema (all tables, relationships, indexes)
- [ ] Define API endpoints (Supabase Edge Functions)
- [ ] Define AI prompt templates and guardrail rules
- [ ] Define screen-by-screen UI flow
- [ ] Define MVP phasing with acceptance criteria

## Phase 1: Foundation (MVP Core)
- [ ] Initialize Expo project with TypeScript
- [ ] Setup Supabase project (auth, database, edge functions)
- [ ] Implement authentication flow (email + social)
- [ ] Create database tables and RLS policies
- [ ] Build user profile & onboarding screens
- [ ] Build daily logging system (meals, workout, weight, water, sleep)
- [ ] Build "Today" dashboard screen
- [ ] Implement offline storage with sync

## Phase 2: AI Engine
- [ ] Build AI context builder (profile + 14-day data)
- [ ] Build meal text parser (free text -> structured data)
- [ ] Build daily plan generator (nutrition + workout)
- [ ] Build guardrail validation engine
- [ ] Deploy Edge Functions for AI endpoints

## Phase 3: Coaching & Reports
- [ ] Build end-of-day report generator
- [ ] Build weekly report generator
- [ ] Build micro-coaching message system
- [ ] Build notification system (limited, smart triggers)
- [ ] Build progress charts and analytics screens

## Phase 4: Polish & Premium
- [ ] Implement subscription system (App Store + Play Store)
- [ ] Build lab values module (optional)
- [ ] Build data export (JSON/CSV/PDF)
- [ ] Build settings & privacy screen
- [ ] Build food preference management (like/dislike lists)
- [ ] Performance optimization & testing

## Review Checkpoints
- [ ] Each phase reviewed against acceptance criteria
- [ ] Security audit (RLS policies, data handling, API keys)
- [ ] AI output quality testing (guardrails, language checks)
