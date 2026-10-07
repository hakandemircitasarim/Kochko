import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { sha256Hex } from './sha256.ts';

async function webCrypto(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.test('sha256Hex matches the FIPS 180-4 vectors', () => {
  assertEquals(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assertEquals(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assertEquals(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

Deno.test('sha256Hex equals WebCrypto across block boundaries and UTF-8', async () => {
  const cases = ['ığüşöçİĞÜŞÖÇ', 'v2_understand_shadow4750e6be-0000-0000-0000-000000000001'];
  for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 1000]) cases.push('a'.repeat(n));
  for (const c of cases) assertEquals(sha256Hex(c), await webCrypto(c), `len ${c.length}`);
});
