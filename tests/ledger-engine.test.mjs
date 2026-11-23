import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadLedgerEngine() {
  const code = fs.readFileSync(path.resolve('js/ledger-engine.js'), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.window.App.ledgerEngine;
}

const eng = loadLedgerEngine();

test('computeAccountBalances handles >5yr history, ignores credit cards, prevents Saldo Inicial double-count, and stratifies liquidity', () => {
  const accounts = [
    { id: 'acc-cc', name: 'Itaú', type: 'checking', initial_balance: 1000, member_id: 'm1' },
    { id: 'acc-sav', name: 'Reserva', type: 'savings', initial_balance: 5000, member_id: 'm1' },
    { id: 'acc-inv', name: 'XP', type: 'investment', initial_balance: 0, member_id: 'm1' },
    { id: 'acc-other', name: 'Conjunta', type: 'checking', initial_balance: 2000, member_id: 'm2' }
  ];
  const investments = [
    { id: 'i1', account_id: 'acc-inv', current_value: 25000 }
  ];
  const creditCards = [
    { id: 'card-1', name: 'Visa', closing_day: 25, due_day: 5, account_id: 'acc-cc' }
  ];
  const tx = [
    // > 5 years old transaction MUST be counted!
    { id: 't-old', type: 'income', amount: 3000, account_id: 'acc-cc', date: '2018-03-10', status: 'confirmed', member_id: 'm1', reconciled: true },
    // Duplicate Saldo Inicial on account with initial_balance > 0 MUST be skipped
    { id: 't-dup-init', type: 'income', amount: 1000, account_id: 'acc-cc', date: '2018-01-01', category: 'Saldo Inicial', ignore_from_total: true, status: 'confirmed', member_id: 'm1' },
    // Confirmed cash expense
    { id: 't-exp', type: 'expense', amount: 500, account_id: 'acc-cc', date: '2026-11-10', status: 'confirmed', member_id: 'm1', reconciled: false },
    // Confirmed credit card purchase MUST NOT subtract from checking balance
    { id: 't-card', type: 'expense', amount: 900, account_id: 'acc-cc', credit_card_id: 'card-1', date: '2026-11-12', status: 'confirmed', member_id: 'm1' },
    // Pending upcoming expense in 10 days -> enters compromissos30d
    { id: 't-pend', type: 'expense', amount: 1200, account_id: 'acc-cc', date: '2026-11-28', status: 'pending', member_id: 'm1' },
    // Pending credit card expense due on 2026-12-05 -> enters compromissos30d
    { id: 't-card-pend', type: 'expense', amount: 800, account_id: 'acc-cc', credit_card_id: 'card-1', date: '2026-11-15', status: 'pending', member_id: 'm1' }
  ];

  const res = eng.computeAccountBalances(accounts, tx, {
    asOfDate: '2026-11-19',
    memberId: 'm1',
    investments,
    creditCards
  });

  // Itaú: 1000 + 3000 - 500 = 3500 (card 900 ignored, dup init skipped, pending ignored)
  assert.equal(res.byAccount['acc-cc'].balance, 3500);
  assert.equal(res.byAccount['acc-cc'].reconciledBalance, 4000); // 1000 init + 3000 reconciled
  assert.equal(res.byAccount['acc-cc'].unreconciledCount, 1);
  assert.equal(res.byAccount['acc-sav'].balance, 5000);
  assert.equal(res.byAccount['acc-inv'].investmentAssets, 25000);
  // m2 account excluded by memberId filter
  assert.equal(res.byAccount['acc-other'], undefined);

  assert.equal(res.liquidity.caixaDisponivel, 3500);
  assert.equal(res.liquidity.reservaLiquidez, 5000);
  assert.equal(res.liquidity.compromissos30d, 2000); // 1200 + 800
  assert.equal(res.liquidity.saldoLivreReal, 6500); // 3500 + 5000 - 2000
});

test('buildInvestmentPortfolioSeries consolidates multiple assets per date without sawtooth drops', () => {
  const invs = [{ id: 'a' }, { id: 'b' }];
  const history = [
    { investment_id: 'a', date: '2026-01-10', value: 10000 },
    { investment_id: 'b', date: '2026-01-15', value: 5000 },
    { investment_id: 'a', date: '2026-02-10', value: 11000 },
    { investment_id: 'b', date: '2026-02-20', value: 5500 }
  ];

  const series = eng.buildInvestmentPortfolioSeries(history, invs);
  assert.deepEqual(Array.from(series, p => ({ ...p })), [
    { date: '2026-01-10', value: 10000 },
    { date: '2026-01-15', value: 15000 },
    { date: '2026-02-10', value: 16000 },
    { date: '2026-02-20', value: 16500 }
  ]);
});

test('buildDailyCashflowProjection forecasts 30d balance and detects exact negative account alert', () => {
  const accounts = [
    { id: 'acc-1', name: 'Nubank', type: 'checking', initial_balance: 1000 },
    { id: 'acc-2', name: 'Reserva', type: 'savings', initial_balance: 5000 }
  ];
  const tx = [
    { id: 't1', type: 'expense', amount: 1500, account_id: 'acc-1', date: '2026-11-25', status: 'pending' },
    { id: 't2', type: 'income', amount: 2000, account_id: 'acc-1', date: '2026-12-01', status: 'pending' }
  ];

  const proj = eng.buildDailyCashflowProjection(accounts, tx, [], { asOfDate: '2026-11-19', days: 30 });
  assert.equal(proj.startBalance, 6000);
  assert.equal(proj.endBalance, 6500);
  assert.equal(proj.minTotal, 4500);
  assert.equal(proj.negativeAlerts.length, 1);
  assert.equal(proj.negativeAlerts[0].accountId, 'acc-1');
  assert.equal(proj.negativeAlerts[0].firstNegativeDate, '2026-11-25');
  assert.equal(proj.negativeAlerts[0].minBalance, -500);
});

test('computeRunningBalances calculates chronological balance after each account movement', () => {
  const account = { id: 'acc-1', initial_balance: 500 };
  const tx = [
    { id: 't3', type: 'transfer', amount: 100, account_id: 'acc-2', account_to_id: 'acc-1', date: '2026-11-05', status: 'confirmed' },
    { id: 't1', type: 'income', amount: 1000, account_id: 'acc-1', date: '2026-11-01', status: 'confirmed' },
    { id: 't2', type: 'expense', amount: 250, account_id: 'acc-1', date: '2026-11-03', status: 'confirmed' },
    { id: 't-card', type: 'expense', amount: 400, account_id: 'acc-1', credit_card_id: 'c1', date: '2026-11-04', status: 'confirmed' }
  ];

  const map = eng.computeRunningBalances(account, tx);
  assert.equal(map['t1'], 1500);
  assert.equal(map['t2'], 1250);
  assert.equal(map['t3'], 1350);
  assert.equal(map['t-card'], undefined);
});

test('parseBankStatement parses OFX and Brazilian CSV, detects duplicates, and suggests categories', () => {
  const ofxSample = `
    <OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261110120000<TRNAMT>-45.90<FITID>FIT-001<MEMO>UBER *TRIP</STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261112120000<TRNAMT>8500.00<FITID>FIT-002<NAME>SALARIO EMPRESA</STMTTRN>
    </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
  `;
  const existing = [
    { id: 'e1', type: 'expense', amount: 45.90, date: '2026-11-10', account_id: 'a1', description: 'UBER *TRIP', external_fitid: 'FIT-001' }
  ];
  const categories = [{ name: 'Transporte' }, { name: 'Salário' }, { name: 'Alimentação' }];

  const ofxRes = eng.parseBankStatement(ofxSample, 'extrato.ofx', { existingTransactions: existing, accountId: 'a1', categories });
  assert.equal(ofxRes.format, 'OFX');
  assert.equal(ofxRes.totalCount, 2);
  assert.equal(ofxRes.duplicateCount, 1);
  assert.equal(ofxRes.newCount, 1);
  assert.equal(ofxRes.items[0].isDuplicate, true);
  assert.equal(ofxRes.items[0].suggestedCategory, 'Transporte');
  assert.equal(ofxRes.items[1].type, 'income');
  assert.equal(ofxRes.items[1].suggestedCategory, 'Salário');

  const csvSample = `Data;Descrição;Valor\n15/11/2026;IFOOD RESTAURANTE;-89,50\n16/11/2026;DIVIDENDO ITUB4;1.250,00`;
  const csvRes = eng.parseBankStatement(csvSample, 'banco.csv', { existingTransactions: [], accountId: 'a1', categories });
  assert.equal(csvRes.format, 'CSV');
  assert.equal(csvRes.totalCount, 2);
  assert.equal(csvRes.items[0].date, '2026-11-15');
  assert.equal(csvRes.items[0].amount, 89.5);
  assert.equal(csvRes.items[0].type, 'expense');
  assert.equal(csvRes.items[0].suggestedCategory, 'Alimentação');
  assert.equal(csvRes.items[1].amount, 1250);
  assert.equal(csvRes.items[1].type, 'income');
});
