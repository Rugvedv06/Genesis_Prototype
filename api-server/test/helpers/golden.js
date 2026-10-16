// Phase 1 golden test helper: loads validated contract fixtures.
// Every file under /contracts is valid JSON (see FX2); this module asserts that.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(process.cwd(), 'contracts');

export function loadGolden(style, id) {
  const p = join(ROOT, 'errors', style, `${id}.json`);
  const raw = readFileSync(p, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Golden fixture is not valid JSON: ${p}: ${e.message}`);
  }
  assert.ok(parsed._status, `Fixture ${p} missing _status`);
  assert.ok(parsed._note, `Fixture ${p} missing _note`);
  return parsed;
}

export function loadAllGoldens() {
  const styles = ['pydantic-v1', 'pydantic-v2', 'problem-json'];
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'];
  const out = {};
  for (const style of styles) {
    out[style] = {};
    for (const id of ids) {
      out[style][id] = loadGolden(style, id);
    }
  }
  return out;
}

export function goldenBody(style, id) {
  return loadGolden(style, id).body;
}

export function goldenHeader(style, id) {
  return loadGolden(style, id).header;
}
