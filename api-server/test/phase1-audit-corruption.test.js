import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('audit safely handles malformed anchors, corrupted chains, and empty restores', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-audit-corruption-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const audit = await import('../src/features/audit/index.js');
    const record = audit.append({ decision: 'seed', apiId: 'audit-corruption-test' });
    const auditPath = join(dataDir, 'audit.jsonl');
    const headPath = join(dataDir, 'audit.head.json');

    await t.test('malformed HEAD returns an explicit invalid result without throwing', () => {
      writeFileSync(headPath, '{not-json');

      let verification;
      assert.doesNotThrow(() => {
        verification = audit.verify();
      });
      assert.equal(verification.ok, false);
      assert.equal(verification.reason, 'malformed_head');
    });

    await t.test('valid JSON with an invalid HEAD shape is reported as malformed', () => {
      writeFileSync(headPath, 'null');

      let verification;
      assert.doesNotThrow(() => {
        verification = audit.verify();
      });
      assert.equal(verification.ok, false);
      assert.equal(verification.reason, 'malformed_head');
    });

    await t.test('append refuses a hash-invalid chain without changing its file', () => {
      writeFileSync(headPath, JSON.stringify({ index: record.index, hash: record.hash }));
      const corrupted = { ...record, decision: 'edited-without-rehashing' };
      writeFileSync(auditPath, `${JSON.stringify(corrupted)}\n`);
      const before = readFileSync(auditPath, 'utf8');

      assert.throws(() => audit.append({ decision: 'must-not-append', apiId: 'audit-corruption-test' }));
      assert.equal(readFileSync(auditPath, 'utf8'), before);
      assert.equal(audit.verify().reason, 'hash_mismatch');
    });

    await t.test('restoring an empty backup clears a stale anchor and verifies cleanly', () => {
      writeFileSync(auditPath, '');
      audit.backup();
      writeFileSync(headPath, JSON.stringify({ index: 9, hash: 'stale-anchor' }));

      assert.equal(audit.restore(), true);
      const verification = audit.verify();
      assert.equal(verification.ok, true);
      assert.equal(verification.count, 0);
      assert.equal(verification.anchor, null);
    });
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
