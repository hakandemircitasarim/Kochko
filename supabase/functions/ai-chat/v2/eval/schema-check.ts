/**
 * Minimal JSON-Schema checker for the strict-mode subset (type, enum, const, properties,
 * required, additionalProperties:false, items, anyOf/oneOf, numeric/length/item bounds, local
 * $ref). The eval counts schema violations for the §9.4 E gate ("ayrıştırma/şema hatası ≤ %0,5")
 * on any path where the provider did not enforce the schema (json_object fallback gateway).
 *
 * Deliberately NOT the runtime validator: validate.ts (registry) owns business rules; this only
 * answers "is the decision the shape we asked for?".
 */

type Schema = Record<string, unknown>;

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(actual: string, wanted: string): boolean {
  return actual === wanted || (wanted === 'number' && actual === 'integer');
}

function deref(s: Schema, root: Schema): Schema {
  const ref = s.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return s;
  let cur: unknown = root;
  for (const part of ref.slice(2).split('/')) cur = (cur as Record<string, unknown> | undefined)?.[part];
  return (cur && typeof cur === 'object') ? deref(cur as Schema, root) : s;
}

/** Returns human-readable violations ("$.writes[0].unit: enum dışı \"cup\""); [] = conforms. */
export function checkSchema(value: unknown, schema: Schema, root: Schema = schema, at = '$', out: string[] = []): string[] {
  if (out.length >= 25) return out; // a wrong-shape blob would otherwise produce thousands of lines
  const s = deref(schema, root);
  const anyOf = (s.anyOf ?? s.oneOf) as Schema[] | undefined;
  if (Array.isArray(anyOf)) {
    const ok = anyOf.some((alt) => checkSchema(value, alt, root, at, []).length === 0);
    if (!ok) out.push(`${at}: anyOf seçeneklerinin hiçbirine uymuyor`);
    return out;
  }
  const t = typeOf(value);
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((w) => typeMatches(t, w))) {
      out.push(`${at}: tip ${t}, beklenen ${types.join('|')}`);
      return out;
    }
  }
  if ('const' in s && JSON.stringify(value) !== JSON.stringify(s.const)) out.push(`${at}: const ${JSON.stringify(s.const)} değil`);
  if (Array.isArray(s.enum) && !(s.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    out.push(`${at}: enum dışı ${JSON.stringify(value)}`);
  }
  if (t === 'number' || t === 'integer') {
    const n = value as number;
    if (typeof s.minimum === 'number' && n < s.minimum) out.push(`${at}: ${n} < minimum ${s.minimum}`);
    if (typeof s.maximum === 'number' && n > s.maximum) out.push(`${at}: ${n} > maximum ${s.maximum}`);
  }
  if (t === 'string') {
    const len = [...(value as string)].length;
    if (typeof s.maxLength === 'number' && len > s.maxLength) out.push(`${at}: uzunluk ${len} > ${s.maxLength}`);
    if (typeof s.minLength === 'number' && len < s.minLength) out.push(`${at}: uzunluk ${len} < ${s.minLength}`);
  }
  if (t === 'array') {
    const arr = value as unknown[];
    if (typeof s.minItems === 'number' && arr.length < s.minItems) out.push(`${at}: ${arr.length} öğe < minItems ${s.minItems}`);
    if (typeof s.maxItems === 'number' && arr.length > s.maxItems) out.push(`${at}: ${arr.length} öğe > maxItems ${s.maxItems}`);
    if (s.items && typeof s.items === 'object') arr.forEach((el, i) => checkSchema(el, s.items as Schema, root, `${at}[${i}]`, out));
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const r of (s.required ?? []) as string[]) if (!(r in obj)) out.push(`${at}: zorunlu alan eksik "${r}"`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) checkSchema(v, props[k], root, `${at}.${k}`, out);
      else if (s.additionalProperties === false) out.push(`${at}: tanımsız alan "${k}"`);
    }
  }
  return out;
}
