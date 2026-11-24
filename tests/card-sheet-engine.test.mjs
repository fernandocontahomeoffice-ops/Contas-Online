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
    URL,
    console
  };
  vm.runInNewContext(code, sandbox, { filename: relPath });
  return mod.exports;
}

const engine = loadBrowserModule('js/card-sheet-engine.js');

test('mapHeaderKey maps Portuguese, accented, and English headers of testecartao.xlsx', () => {
  assert.equal(engine.mapHeaderKey('Data'), 'date');
  assert.equal(engine.mapHeaderKey('Hora'), 'time');
  assert.equal(engine.mapHeaderKey('Descrição'), 'description');
  assert.equal(engine.mapHeaderKey('descricao'), 'description');
  assert.equal(engine.mapHeaderKey('Categoria'), 'category');
  assert.equal(engine.mapHeaderKey('Classificação'), 'classification');
  assert.equal(engine.mapHeaderKey('Membro'), 'member');
  assert.equal(engine.mapHeaderKey('Parcelas'), 'installments');
  assert.equal(engine.mapHeaderKey('Valor'), 'amount');
});

test('parseAmountBR and resolveTxTypeAndAmount follow testecartao.xlsx signed convention and positive_expense mode', () => {
  assert.equal(engine.parseAmountBR('-125,90'), -125.9);
  assert.equal(engine.parseAmountBR('R$ -1.250,50'), -1250.5);
  assert.equal(engine.parseAmountBR('(49,90)'), -49.9);
  assert.equal(engine.parseAmountBR('50,00'), 50);

  const expSigned = engine.resolveTxTypeAndAmount('-125,90', 'excel_signed');
  assert.equal(expSigned.valid, true);
  assert.equal(expSigned.txType, 'expense');
  assert.equal(expSigned.amount, 125.9);

  const refundSigned = engine.resolveTxTypeAndAmount('50,00', 'excel_signed');
  assert.equal(refundSigned.txType, 'refund');
  assert.equal(refundSigned.amount, 50);

  const expPos = engine.resolveTxTypeAndAmount('125,90', 'positive_expense');
  assert.equal(expPos.txType, 'expense');
  assert.equal(expPos.amount, 125.9);

  const refundPos = engine.resolveTxTypeAndAmount('-50,00', 'positive_expense');
  assert.equal(refundPos.txType, 'refund');
  assert.equal(refundPos.amount, 50);
});

test('normalizeDateCell and normalizeTimeCell handle DD/MM/AAAA, ISO, and Excel serials', () => {
  assert.equal(engine.normalizeDateCell('20/11/2026'), '2026-11-20');
  assert.equal(engine.normalizeDateCell('2026-11-20'), '2026-11-20');
  assert.equal(engine.normalizeDateCell(46000), '2025-12-09');
  assert.equal(engine.normalizeTimeCell('14:35'), '14:35:00');
  assert.equal(engine.normalizeTimeCell(0.5), '12:00:00');
  assert.equal(engine.combineDateAndTime('20/11/2026', '09:15'), '2026-11-20T09:15:00');
});

test('buildTransactionsFromRow builds single, installment, and split credit card transactions accurately', () => {
  const card = { id: 'card_1', name: 'Nubank', account_id: 'acc_1', member_id: 'm_1' };
  const accounts = [{ id: 'acc_1', name: 'Conta Principal' }];
  const members = [
    { id: 'm_1', name: 'Fernando' },
    { id: 'm_2', name: 'Camila' }
  ];

  // 1) 3x installment purchase with cent remainder
  const rowInst = engine.createEmptyRow({
    rowId: 'r_inst',
    date: '2026-01-31',
    time: '10:30',
    description: 'Notebook Loja X',
    category: 'Eletrodomesticos',
    classification: 'Necessário',
    member: 'Fernando',
    installments: 3,
    amount: '-100,00'
  });

  const builtInst = engine.buildTransactionsFromRow(rowInst, { card, members, accounts });
  assert.equal(builtInst.ok, true);
  assert.equal(builtInst.transactions.length, 3);
  const sumInst = builtInst.transactions.reduce((s, t) => s + t.amount, 0);
  assert.equal(Math.round(sumInst * 100), 10000);
  assert.equal(builtInst.transactions[0].date, '2026-01-31T10:30:00');
  assert.equal(builtInst.transactions[1].date, '2026-02-28T10:30:00');
  assert.equal(builtInst.transactions[2].date, '2026-03-31T10:30:00');
  assert.equal(builtInst.transactions[0].classification, 'necessary');
  assert.equal(builtInst.transactions[0].sheet_row_id, 'r_inst');
  assert.equal(builtInst.transactions[0].credit_card_id, 'card_1');

  // 2) Compra dividida with 2 members
  const rowSplit = engine.createEmptyRow({
    rowId: 'r_split',
    date: '2026-11-15',
    description: 'Jantar Casal',
    category: 'Passeios & Restaurantes',
    classification: 'Supérfluo',
    member: 'Compra dividida',
    installments: 1,
    amount: '-150,00'
  });

  const builtSplit = engine.buildTransactionsFromRow(rowSplit, { card, members, accounts });
  assert.equal(builtSplit.ok, true);
  assert.equal(builtSplit.transactions.length, 1);
  assert.equal(builtSplit.transactions[0].member_name, 'Fernando + Camila');
  assert.deepEqual(JSON.parse(JSON.stringify(builtSplit.transactions[0].member_splits)), [
    { member_id: 'm_1', amount: 75 },
    { member_id: 'm_2', amount: 75 }
  ]);
});

test('findDuplicateTransactions ignores own synced IDs and flags unlinked existing matches', () => {
  const existing = [
    { id: 'tx_own', credit_card_id: 'c1', type: 'expense', description: 'Uber', amount: 30, date: '2026-11-20', sheet_row_id: 'r1' },
    { id: 'tx_ext', credit_card_id: 'c1', type: 'expense', description: 'Padaria', amount: 25, date: '2026-11-20' }
  ];

  const ownUpdate = [{ id: 'tx_own', credit_card_id: 'c1', type: 'expense', description: 'Uber', amount: 30, date: '2026-11-20', sheet_row_id: 'r1' }];
  assert.equal(engine.findDuplicateTransactions(ownUpdate, existing, ['tx_own']).length, 0);

  const dupCand = [{ id: 'tx_new', credit_card_id: 'c1', type: 'expense', description: 'Padaria', amount: 25, date: '2026-11-20', sheet_row_id: 'r2' }];
  assert.equal(engine.findDuplicateTransactions(dupCand, existing, []).length, 1);
});

test('parseClipboardTable and buildExportMatrix preserve full testecartao.xlsx roundtrip', () => {
  const pasted = [
    'Data\tHora\tDescrição\tCategoria\tClassificação\tMembro\tParcelas\tValor',
    '20/11/2026\t09:15\tPadaria Central\tLanches & Ifood\tSupérfluo\t\t1\t-32,50',
    '21/11/2026\t\tEstorno Uber\tUber & Transporte\tNecessário\t\t1\t18,00'
  ].join('\n');

  const parsed = engine.parseClipboardTable(pasted);
  assert.equal(parsed.hasHeaders, true);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].date, '2026-11-20');
  assert.equal(parsed.rows[0].time, '09:15');
  assert.equal(parsed.rows[0].classification, 'superfluous');
  assert.equal(parsed.rows[0].amount, '-32,50');
  assert.equal(parsed.rows[1].amount, '18,00');

  const exported = engine.buildExportMatrix(parsed.rows);
  assert.deepEqual(exported[0], engine.CANONICAL_HEADERS);
  assert.equal(exported[1][0], '20/11/2026');
  assert.equal(exported[1][7], -32.5);
  assert.equal(exported[2][7], 18);
});

test('resolveGithubRawUrl converts GitHub blob links safely and blocks SSRF/non-GitHub URLs', () => {
  const ok1 = engine.resolveGithubRawUrl('https://github.com/fernando/contas-online/blob/main/testecartao.xlsx');
  assert.equal(ok1.ok, true);
  assert.equal(ok1.rawUrl, 'https://raw.githubusercontent.com/fernando/contas-online/main/testecartao.xlsx');

  const ok2 = engine.resolveGithubRawUrl('https://raw.githubusercontent.com/fernando/contas-online/main/docs/testecartao.xlsx');
  assert.equal(ok2.ok, true);

  const badHost = engine.resolveGithubRawUrl('https://evil.com/testecartao.xlsx');
  assert.equal(badHost.ok, false);

  const badLocal = engine.resolveGithubRawUrl('http://127.0.0.1:3000/testecartao.xlsx');
  assert.equal(badLocal.ok, false);

  const badExt = engine.resolveGithubRawUrl('https://github.com/fernando/repo/blob/main/README.md');
  assert.equal(badExt.ok, false);
});
