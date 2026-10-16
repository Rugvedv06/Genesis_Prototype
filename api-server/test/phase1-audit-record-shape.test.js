import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('audit rejects parseable records with invalid shapes and preserves valid prefixes', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-audit-record-shape-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const audit = await import('../src/features/audit/index.js');
    const validPrefix = audit.append({ decision: 'valid-prefix', apiId: 'audit-record-shape-test' });
    const auditPath = join(dataDir, 'audit.jsonl');
    const headPath = join(dataDir, 'audit.head.json');
    const backupPath = `${auditPath}.bak`;
    const invalidRecords = [
      ['null record', 'null'],
      ['scalar record', '17'],
      ['object missing required record fields', JSON.stringify({ decision: 'incomplete' })],
    ];

    const setFixture = (invalidLine) => {
      const contents = `${JSON.stringify(validPrefix)}\n${invalidLine}\n`;
      writeFileSync(auditPath, contents);
      writeFileSync(headPath, JSON.stringify({ index: validPrefix.index, hash: validPrefix.hash }));
      return contents;
    };

    for (const [label, invalidLine] of invalidRecords) {
      await t.test(`${label}: verify reports malformed_record`, () => {
        setFixture(invalidLine);
        let verification;
        assert.doesNotThrow(() => { verification = audit.verify(); });
        assert.equal(verification.ok, false);
        assert.equal(verification.reason, 'malformed_record');
        assert.equal(verification.brokenAt, 1);
      });

      await t.test(`${label}: list safely returns only the valid prefix`, () => {
        setFixture(invalidLine);
        let records;
        assert.doesNotThrow(() => { records = audit.list(); });
        assert.deepEqual(records, [validPrefix]);
      });

      await t.test(`${label}: append refuses without changing current files`, () => {
        setFixture(invalidLine);
        const beforeFile = readFileSync(auditPath, 'utf8');
        const beforeHead = readFileSync(headPath, 'utf8');
        assert.throws(() => audit.append({ decision: 'must-not-append', apiId: 'audit-record-shape-test' }));
        assert.equal(readFileSync(auditPath, 'utf8'), beforeFile);
        assert.equal(readFileSync(headPath, 'utf8'), beforeHead);
      });

      await t.test(`${label}: restore rejects without changing current files`, () => {
        const contents = setFixture(invalidLine);
        const beforeFile = readFileSync(auditPath, 'utf8');
        const beforeHead = readFileSync(headPath, 'utf8');
        writeFileSync(backupPath, contents);
        let restored;
        assert.doesNotThrow(() => { restored = audit.restore(); });
        assert.equal(restored, false);
        assert.equal(readFileSync(auditPath, 'utf8'), beforeFile);
        assert.equal(readFileSync(headPath, 'utf8'), beforeHead);
      });
    }
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
