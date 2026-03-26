# Kochko - Master Todo

## Phase 0: Architecture & Planning
- [x] Collect product requirements from user
- [x] Decide tech stack (Expo + Supabase + OpenAI GPT)
- [x] Establish working principles (tasks/lessons.md)
- [x] Define database schema (all tables, relationships, indexes)
- [x] Define API endpoints (Supabase Edge Functions)
- [x] Define AI prompt templates and guardrail rules
- [x] Define screen-by-screen UI flow
- [x] Define MVP phasing with acceptance criteria

## Phase 1: Foundation (MVP Core)
- [x] Initialize Expo project with TypeScript
- [x] Setup Supabase project (auth, database, edge functions)
- [x] Implement authentication flow (email)
- [x] Create database tables and RLS policies
- [x] Build user profile & onboarding screens
- [x] Build daily logging system (meals, workout, weight, water, sleep)
- [x] Build "Today" dashboard screen

## Phase 2: AI Engine
- [x] Build AI context builder (profile + 14-day data)
- [x] Build meal text parser (free text -> structured data)
- [x] Build daily plan generator (nutrition + workout)
- [x] Build guardrail validation engine
- [x] Build Edge Functions for AI endpoints (5 functions)

## Phase 3: Coaching & Reports
- [x] Build end-of-day report generator
- [x] Build weekly report generator
- [x] Build micro-coaching message system (CoachingBanner)
- [x] Build progress charts and analytics screens (weight + compliance)

## Phase 4: Polish & Premium
- [x] Implement premium paywall and subscription gating
- [x] Build premium guard hook (usePremiumGuard)
- [x] Build lab values module with common parameters
- [x] Build data export (JSON/CSV via Share API)
- [x] Build settings & privacy screen (account deletion)
- [x] Build food preference management (love/like/dislike/never + intolerance)
- [x] Build goal settings with guardrail validation

## Remaining for Production
- [ ] Social auth (Google, Apple Sign-In)
- [ ] App Store / Play Store IAP integration (RevenueCat)
- [ ] Push notifications (expo-notifications setup)
- [ ] Offline storage with sync (AsyncStorage queue)
- [ ] Performance optimization & testing
- [ ] App Store assets (screenshots, descriptions)
- [ ] Security audit (RLS policies, API keys, data handling)
- [ ] AI output quality testing (guardrails, language checks)
