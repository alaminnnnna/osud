/* Medora — canonical slug generation, identical semantics to scrape.js
   (name + dosage form; collision → + strength → -2…-999 → medicine-{id}). */
export function slugLatin(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function baseSlugCandidates(rec: { name: string | null; dosageForm: string | null; strength: string | null }): string[] {
  const a = slugLatin([rec.name, rec.dosageForm].filter(Boolean).join(' '));
  const b = slugLatin([rec.name, rec.strength, rec.dosageForm].filter(Boolean).join(' '));
  const c = slugLatin(rec.name ?? '');
  return [...new Set([a, b, c].filter(Boolean))];
}

/**
 * Assigns unique slugs for a batch of records against an in-memory set of
 * taken slugs (all existing DB slugs + everything claimed earlier in this
 * import). Deterministic suffixing keeps repeated imports idempotent.
 */
export function assignSlugs(
  items: { id: number; rec: { name: string | null; dosageForm: string | null; strength: string | null } }[],
  taken: Set<string>,
): Map<number, string> {
  const result = new Map<number, string>();
  for (const item of items) {
    const candidates = baseSlugCandidates(item.rec);
    let slug: string | null = null;
    for (const c of candidates) {
      if (!taken.has(c)) { slug = c; break; }
    }
    if (!slug) {
      const b = candidates[0] || 'medicine';
      for (let i = 2; i < 1000; i++) {
        if (!taken.has(`${b}-${i}`)) { slug = `${b}-${i}`; break; }
      }
    }
    if (!slug) slug = `medicine-${item.id}`;
    taken.add(slug);
    result.set(item.id, slug);
  }
  return result;
}
