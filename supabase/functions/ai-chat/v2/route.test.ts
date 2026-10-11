/**
 * route.test.ts — v1 or v2 for a request (index.ts serve() → routeTurn). Pinned: with the step
 * unset/off v1 gets the ORIGINAL request and nothing else runs; the cohort decision is
 * rolloutMode's; a v2 hand-over or a crash BEFORE any side effect runs v2's cleanup and gives v1 a
 * readable copy of the body; a crash AFTER a side effect never re-runs v1 (double write) and is
 * answered honestly; the routing id is the JWT claim (verified later by the v2 handler).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { rolloutEnvKey } from '../../shared/rollout.ts';
import type { TurnState, V2Outcome } from './handler.ts';
import { routeTurn, routingUserId, v2TurnConfigured, type RouteDeps } from './route.ts';
import { USER } from './testing.ts';
import { chatRequest, fakeJwt } from './turn-testing.ts';

interface Spy {
  v1Bodies: unknown[];
  v2Calls: number;
  honest: number;
  cleaned: string[];
  logs: string[];
}

function deps(over: Partial<RouteDeps> & { v2Impl?: (state: TurnState) => Promise<V2Outcome> } = {}): { d: RouteDeps; spy: Spy } {
  const spy: Spy = { v1Bodies: [], v2Calls: 0, honest: 0, cleaned: [], logs: [] };
  const d: RouteDeps = {
    configured: () => true,
    mode: () => 'on',
    v1: async (req) => {
      spy.v1Bodies.push(req.method === 'POST' ? await req.json() : null);
      return new Response(JSON.stringify({ via: 'v1' }));
    },
    v2: async (req, _uid, state) => {
      spy.v2Calls++;
      await req.json(); // the v2 handler consumes the body
      if (over.v2Impl) return await over.v2Impl(state);
      return { kind: 'response', response: new Response(JSON.stringify({ via: 'v2' })) };
    },
    honest: () => { spy.honest++; return Promise.resolve(new Response(JSON.stringify({ via: 'honest' }))); },
    log: (line) => { spy.logs.push(line); },
    ...over,
  };
  return { d, spy };
}

const via = async (r: Response) => ((await r.json()) as { via: string }).via;

Deno.test('step unset/off → v1 with the original request; v2 never runs', async () => {
  const { d, spy } = deps({ configured: () => false });
  const r = await routeTurn(chatRequest({ message: 'selam' }), d);
  assertEquals(await via(r), 'v1');
  assertEquals(spy.v2Calls, 0);
  assertEquals(spy.v1Bodies, [{ message: 'selam' }]);
});

Deno.test('v2_turn unset or off (the real env reader): v1 gets the very SAME request — no clone, no body read, no cohort lookup', async () => {
  for (const value of [null, 'off', 'OFF', '0', 'false', '']) {
    const req = chatRequest({ message: 'selam' });
    const seen: Request[] = [];
    let cohortLookups = 0;
    const d: RouteDeps = {
      configured: () => v2TurnConfigured((k) => (k === rolloutEnvKey('v2_turn') ? value : null)),
      mode: () => { cohortLookups++; return 'on'; },
      v1: (r) => { seen.push(r); return Promise.resolve(new Response('v1')); },
      v2: () => { throw new Error('v2 must not run while the step is off'); },
      honest: () => { throw new Error('no honest answer while the step is off'); },
      log: () => { throw new Error('nothing to log while the step is off'); },
    };
    const res = await routeTurn(req, d);
    assertEquals(await res.text(), 'v1');
    assert(seen[0] === req, `${value}: v1 gets the original Request object itself`);
    assertEquals(req.bodyUsed, false, `${value}: the body is untouched for v1 to read`);
    assertEquals(cohortLookups, 0, `${value}: no rollout decode`);
  }
});

Deno.test('index.ts: serve() routes through routeTurn with the env gate; v1 is handleChat itself, and v1 ledger writes are gated on the same flag', () => {
  const v1 = Deno.readTextFileSync(new URL('../index.ts', import.meta.url));
  assert(v1.includes('const res = await routeChatTurn(req, timer);'), 'serve() goes through the router');
  assert(v1.includes('configured: () => v2TurnConfigured(),'), 'the gate is the KOCHKO_ROLLOUT_V2_TURN secret');
  assert(v1.includes('v1: (r) => handleChat(r, timer),'), 'v1 is the untouched handleChat');
  assert(v1.includes('const v1Ledger: V1Ledger | undefined = v2TurnConfigured() ? newV1Ledger(crypto.randomUUID()) : undefined;'), 'unset/off → no ledger work in v1');
});

Deno.test('outside the cohort → v1; OPTIONS → v1', async () => {
  const { d, spy } = deps({ mode: () => 'off' });
  assertEquals(await via(await routeTurn(chatRequest({ message: 'x' }), d)), 'v1');
  const opt = await routeTurn(new Request('https://edge.test/ai-chat', { method: 'OPTIONS' }), d);
  assertEquals(await via(opt), 'v1');
  assertEquals(spy.v2Calls, 0);
});

Deno.test('a shadow-mode value is not "on": the v2 turn only answers when the step is on for the user', async () => {
  const { d, spy } = deps({ mode: () => 'shadow' });
  assertEquals(await via(await routeTurn(chatRequest({ message: 'x' }), d)), 'v1');
  assertEquals(spy.v2Calls, 0);
});

Deno.test('cohort → v2 answers', async () => {
  const { d, spy } = deps();
  assertEquals(await via(await routeTurn(chatRequest({ message: 'x' }), d)), 'v2');
  assertEquals(spy.v1Bodies.length, 0);
});

Deno.test('v2 hands over → cleanup runs, v1 reads the original body from the clone', async () => {
  const { d, spy } = deps({
    v2Impl: (state) => {
      state.cleanup.push(() => { spy.cleaned.push('journal'); return Promise.resolve(); });
      return Promise.resolve({ kind: 'fallback_v1', reason: 'image' });
    },
  });
  const r = await routeTurn(chatRequest({ message: 'bu ne', image_base64: 'xx' }), d);
  assertEquals(await via(r), 'v1');
  assertEquals(spy.cleaned, ['journal']);
  assertEquals(spy.v1Bodies, [{ message: 'bu ne', image_base64: 'xx' }]);
});

Deno.test('v2 crash before any side effect → logged, cleanup, v1 answers', async () => {
  const { d, spy } = deps({
    v2Impl: (state) => {
      state.cleanup.push(() => { spy.cleaned.push('reservation'); return Promise.resolve(); });
      return Promise.reject(new Error('boom'));
    },
  });
  assertEquals(await via(await routeTurn(chatRequest({ message: 'x' }), d)), 'v1');
  assertEquals(spy.cleaned, ['reservation']);
  assert(spy.logs.includes('[v2_route] v2 crashed'));
});

Deno.test('v2 crash AFTER a side effect → never v1 again (it would write twice): the honest answer', async () => {
  const { d, spy } = deps({
    v2Impl: (state) => {
      state.sideEffects = true;
      state.cleanup.push(() => { spy.cleaned.push('x'); return Promise.resolve(); });
      return Promise.reject(new Error('boom after write'));
    },
  });
  assertEquals(await via(await routeTurn(chatRequest({ message: 'x' }), d)), 'honest');
  assertEquals(spy.v1Bodies.length, 0);
  assertEquals(spy.cleaned, [], 'the journal claim is not released after a write');
});

Deno.test('routingUserId: the JWT sub (unverified, routing only); service calls route on x-user-id', () => {
  assertEquals(routingUserId(chatRequest({})), USER);
  const svc = new Request('https://edge.test', { method: 'POST', headers: { authorization: 'Bearer not-a-jwt', 'x-user-id': 'u-svc' } });
  assertEquals(routingUserId(svc), 'u-svc');
  const noSub = new Request('https://edge.test', { method: 'POST', headers: { authorization: `Bearer ${fakeJwt('')}` } });
  assertEquals(routingUserId(noSub), null);
  assertEquals(routingUserId(new Request('https://edge.test', { method: 'POST' })), null);
});

Deno.test('v2TurnConfigured: unset and every off word are off; an allowlist / pct / on is configured', () => {
  const env = (v: string | null) => (k: string) => (k === rolloutEnvKey('v2_turn') ? v : null);
  assertEquals(v2TurnConfigured(env(null)), false);
  for (const off of ['off', 'OFF ', '0', 'false', 'no', '']) assertEquals(v2TurnConfigured(env(off)), false, off);
  for (const on of ['on', 'pct=5', `${USER}`, `on:${USER}`]) assertEquals(v2TurnConfigured(env(on)), true, on);
  assertEquals(rolloutEnvKey('v2_turn'), 'KOCHKO_ROLLOUT_V2_TURN');
});
