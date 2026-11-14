/* Debug: sample normalize() failures from the real JSONL. */
import fs from 'node:fs';
import readline from 'node:readline';
import { normalize } from '../src/normalize.js';

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream('../data/products.jsonl', 'utf8'), crlfDelay: Infinity });
  const reasons = new Map<string, number>();
  let oks = 0, fails = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = normalize(line);
    if (!r.ok) {
      fails++;
      const key = r.reason.replace(/\d+/g, 'N');
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    } else {
      if (oks < 2) console.log('OK sample:', r.rec.sourceProductId, r.rec.name, JSON.stringify(r.rec.prices));
      oks++;
    }
  }
  console.log('oks:', oks, 'fails:', fails);
  console.log('failure histogram:');
  for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(v).padStart(7)}  ${k}`);
  }
  rl.close();
}
main();
