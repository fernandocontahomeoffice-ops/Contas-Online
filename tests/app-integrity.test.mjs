import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function loadBrowserModule(relPath) {
  const code = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    window: {},
    globalThis: {},
    console
  };
  vm.runInNewContext(code, sandbox, { filename: relPath });
  return mod.exports;
}

const dbSchema = loadBrowserModule('js/db-schema.js');
const financeMath = loadBrowserModule('js/finance-math.js');

test('db-schema defines v34 with 27 unique stores including transactions', () => {
  assert.equal(dbSchema.DB_NAME, 'ContasOnlineDB');
  assert.equal(dbSchema.DB_VERSION, 34);
  assert.equal(dbSchema.STORES.length, 26);
  assert.equal(dbSchema.ALL_STORES.length, 27);
  assert.equal(new Set(dbSchema.ALL_STORES).size, 27);
  assert.ok(dbSchema.ALL_STORES.includes('transactions'));
  assert.ok(dbSchema.ALL_STORES.includes('planosOrcamentarios'));
  assert.ok(dbSchema.ALL_STORES.includes('payrolls'));
  assert.ok(dbSchema.ALL_STORES.includes('locais'));
});

test('finance-math escapeHtml neutralizes HTML injection vectors', () => {
  const dirty = `<img src=x onerror="alert('xss')"> & "test"`;
  const clean = financeMath.escapeHtml(dirty);
  assert.ok(!clean.includes('<'));
  assert.ok(!clean.includes('>'));
  assert.ok(clean.includes('&lt;img'));
  assert.ok(clean.includes('&quot;'));
  assert.ok(clean.includes('&#39;'));
});

test('finance-math sanitizeCsvCell neutralizes spreadsheet formula injection', () => {
  assert.equal(financeMath.sanitizeCsvCell('=SUM(A1:A2)'), `"'=SUM(A1:A2)"`);
  assert.equal(financeMath.sanitizeCsvCell('+1+1'), `"'+1+1"`);
  assert.equal(financeMath.sanitizeCsvCell('normal "text"'), `"normal ""text"""`);
});

test('finance-math calcClassificationSplits computes 50/30/20 + investments accurately', () => {
  const txs = [
    { type: 'expense', classification: 'essential', amount: 2500 },
    { type: 'expense', classification: 'necessary', amount: 1500 },
    { type: 'expense', classification: 'superfluous', amount: 500 },
    { type: 'contribution', amount: 500 },
    { type: 'expense', classification: 'superfluous', amount: 999, ignore_from_total: true }
  ];
  const res = financeMath.calcClassificationSplits(txs, 5000);
  assert.equal(res.essential, 2500);
  assert.equal(res.necessary, 1500);
  assert.equal(res.superfluous, 500);
  assert.equal(res.investments, 500);
  assert.deepEqual({ ...res.pct }, {
    essential: 50,
    necessary: 30,
    superfluous: 10,
    investments: 10
  });
});

test('finance-math calcInstallmentSchedule distributes cents without rounding loss', () => {
  const schedule = financeMath.calcInstallmentSchedule(100, 3, '2026-01-31');
  assert.equal(schedule.length, 3);
  const sum = schedule.reduce((acc, item) => financeMath.roundCurrency(acc + item.amount), 0);
  assert.equal(sum, 100);
  assert.equal(schedule[0].date, '2026-01-31');
  assert.equal(schedule[1].date, '2026-02-28');
  assert.equal(schedule[2].date, '2026-03-31');
});

test('finance-math calcAccountBalanceFromTx ignores pending and credit-card expenses', () => {
  const txs = [
    { type: 'income', account_id: 'acc1', amount: 1000, status: 'confirmed' },
    { type: 'expense', account_id: 'acc1', amount: 200, status: 'confirmed' },
    { type: 'expense', account_id: 'acc1', amount: 300, status: 'confirmed', credit_card_id: 'cc1' },
    { type: 'expense', account_id: 'acc1', amount: 150, status: 'pending' },
    { type: 'transfer', account_id: 'acc1', account_to_id: 'acc2', amount: 100, status: 'confirmed' }
  ];
  assert.equal(financeMath.calcAccountBalanceFromTx(500, txs, 'acc1'), 1200);
  assert.equal(financeMath.calcAccountBalanceFromTx(0, txs, 'acc2'), 100);
});

test('index.html has zero duplicate IDs, zero duplicate external CDN assets, and lazy-loads bankLogosExtended.js', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  const idMatches = [...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  const counts = new Map();
  for (const id of idMatches) counts.set(id, (counts.get(id) || 0) + 1);
  const dupIds = [...counts.entries()].filter(([, c]) => c > 1);
  assert.deepEqual(dupIds, [], `Duplicate IDs found: ${JSON.stringify(dupIds)}`);

  const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const dupScripts = scriptSrcs.filter((s, idx) => scriptSrcs.indexOf(s) !== idx);
  assert.deepEqual(dupScripts, [], `Duplicate <script src> found: ${JSON.stringify(dupScripts)}`);
  assert.ok(!scriptSrcs.includes('js/bankLogosExtended.js'), 'bankLogosExtended.js should be lazy-loaded, not synchronous in HTML');
  assert.ok(!html.includes('accounts.google.com/gsi/client'), 'Unused Google GSI script should be removed');
  assert.ok(scriptSrcs.includes('js/db-schema.js'), 'js/db-schema.js must be loaded');
  assert.ok(scriptSrcs.includes('js/finance-math.js'), 'js/finance-math.js must be loaded');

  const faLinks = [...html.matchAll(/font-awesome\/6\.5\.2/g)];
  assert.equal(faLinks.length, 1, 'FontAwesome 6.5.2 should only be loaded once');
});

test('js/worker.js matches v34 schema and includes all 26 non-tx stores', () => {
  const workerSrc = fs.readFileSync(path.join(rootDir, 'js/worker.js'), 'utf8');
  assert.ok(workerSrc.includes('DB_VERSION = 34'), 'worker.js must use DB_VERSION = 34');
  assert.ok(workerSrc.includes('VersionError'), 'worker.js must handle VersionError fallback');
  for (const store of dbSchema.STORES) {
    assert.ok(workerSrc.includes(`'${store}'`), `worker.js missing store ${store}`);
  }
});

test('js/melhoria.js lists all 13 items and marks all 13 done by default', () => {
  const melhoriaSrc = fs.readFileSync(path.join(rootDir, 'js/melhoria.js'), 'utf8');
  const sandbox = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, console };
  sandbox.window = sandbox;
  vm.runInNewContext(melhoriaSrc, sandbox, { filename: 'js/melhoria.js' });
  const mel = sandbox.App.melhoria;
  assert.equal(mel._items.length, 13);
  const doneSet = mel._getDoneSet();
  assert.equal(doneSet.size, 13);
});
