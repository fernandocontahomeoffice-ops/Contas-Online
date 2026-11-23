import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function loadPlanningEngine() {
  const code = fs.readFileSync(path.join(rootDir, 'js/planning-engine.js'), 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    window: {},
    globalThis: {},
    console
  };
  vm.runInNewContext(code, sandbox, { filename: 'js/planning-engine.js' });
  return mod.exports;
}

const eng = loadPlanningEngine();

test('inferPlanPeriod parses semester, quarter, and annual plan names cleanly', () => {
  assert.deepEqual(
    { ...eng.inferPlanPeriod({ nome: 'Orçamento 1º Semestre 2026' }, 2026) },
    { startMonth: '2026-01', endMonth: '2026-06' }
  );
  assert.deepEqual(
    { ...eng.inferPlanPeriod({ nome: 'Orçamento 2º Semestre 2026' }, 2026) },
    { startMonth: '2026-07', endMonth: '2026-12' }
  );
  assert.deepEqual(
    { ...eng.inferPlanPeriod({ nome: 'Planejamento Anual 2025' }, 2026) },
    { startMonth: '2025-01', endMonth: '2025-12' }
  );
  assert.deepEqual(
    { ...eng.inferPlanPeriod({ nome: 'Plano Customizado', startMonth: '2026-03', endMonth: '2026-08' }, 2026) },
    { startMonth: '2026-03', endMonth: '2026-08' }
  );
});

test('formatPeriodLabel and computePlanStatus classify Em vigor, Agendado, Encerrado, and Arquivado', () => {
  assert.equal(eng.formatPeriodLabel('2026-01', '2026-12'), 'Jan/2026 a Dez/2026');
  assert.equal(eng.formatPeriodLabel('2026-01', '2026-06'), 'Jan/2026 a Jun/2026');
  assert.equal(eng.formatPeriodLabel('2026-04', '2026-04'), 'Abr/2026');

  assert.equal(eng.computePlanStatus({ startMonth: '2026-01', endMonth: '2026-06' }, '2026-04'), 'em_vigor');
  assert.equal(eng.computePlanStatus({ startMonth: '2026-07', endMonth: '2026-12' }, '2026-04'), 'agendado');
  assert.equal(eng.computePlanStatus({ startMonth: '2025-01', endMonth: '2025-12' }, '2026-04'), 'encerrado');
  assert.equal(eng.computePlanStatus({ startMonth: '2026-01', endMonth: '2026-12', arquivado: true }, '2026-04'), 'arquivado');
});

test('findActivePlanForMonth and buildYearTimeline accurately identify plans in effect and overlaps', () => {
  const plans = [
    { id: 'p2025', nome: 'Plano 2025', startMonth: '2025-01', endMonth: '2025-12', criado_em: '2025-01-01T00:00:00Z' },
    { id: 'p2026s1', nome: 'Orçamento 1º Semestre 2026', startMonth: '2026-01', endMonth: '2026-06', ativo: true, criado_em: '2026-01-01T00:00:00Z' },
    { id: 'p2026s2', nome: 'Orçamento 2º Semestre 2026', startMonth: '2026-07', endMonth: '2026-12', criado_em: '2026-01-02T00:00:00Z' },
    { id: 'pOverlap', nome: 'Plano Revisão Mar-Abr', startMonth: '2026-03', endMonth: '2026-04', criado_em: '2026-02-01T00:00:00Z' }
  ];

  const activeApr = eng.findActivePlanForMonth(plans, '2026-04');
  assert.equal(activeApr.id, 'p2026s1');

  const activeOct = eng.findActivePlanForMonth(plans, '2026-10');
  assert.equal(activeOct.id, 'p2026s2');

  const active2025 = eng.findActivePlanForMonth(plans, '2025-08');
  assert.equal(active2025.id, 'p2025');

  const overlaps = eng.detectPlanOverlaps(plans, '2026-04');
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].label, 'Mar/2026 a Abr/2026');

  const timeline2026 = eng.buildYearTimeline(plans, 2026, '2026-04');
  assert.equal(timeline2026.coveredMonthsCount, 12);
  assert.equal(timeline2026.overlapMonthsCount, 2);
  assert.equal(timeline2026.bars.length, 3);
  assert.equal(timeline2026.months[3].isCurrentMonth, true);
});

test('computePlanEvaluation reconciles budgets, subcategory roll-ups, refunds, credit cards, and full-period series', () => {
  const plan = {
    id: 'p1',
    nome: 'Orçamento 1º Semestre 2026',
    startMonth: '2026-01',
    endMonth: '2026-06',
    metaReceitaMensal: 10000,
    metaEconomiaPct: 25
  };

  const categories = [
    { id: 'c1', name: 'Alimentação', type: 'expense', color: '#e67e22' },
    { id: 'c1a', name: 'Supermercado', type: 'expense', parent_id: 'c1', color: '#e67e22' },
    { id: 'c2', name: 'Moradia', type: 'expense', color: '#3498db' },
    { id: 'c3', name: 'Lazer', type: 'expense', color: '#9b59b6' }
  ];

  const budgets = [
    { id: 'b1', plano_id: 'p1', category: 'Alimentação', amount: 1500, cycle_start: '2026-04-01', cycle_end: '2026-04-30T23:59:59' },
    { id: 'b2', plano_id: 'p1', category: 'Moradia', amount: 3000, cycle_start: '2026-04-01', cycle_end: '2026-04-30T23:59:59' },
    { id: 'b3', plano_id: 'p1', category: 'Moradia', amount: 3000, cycle_start: '2026-03-01', cycle_end: '2026-03-31T23:59:59' }
  ];

  const transactions = [
    { id: 't1', type: 'income', category: 'Salário', amount: 11000, date: '2026-04-05', status: 'confirmed' },
    { id: 't2', type: 'expense', category: 'Supermercado', amount: 900, date: '2026-04-10', status: 'confirmed' },
    { id: 't3', type: 'expense', category: 'Alimentação', amount: 800, date: '2026-04-12', status: 'confirmed' },
    { id: 't4', type: 'refund', category: 'Alimentação', amount: 100, date: '2026-04-15', status: 'confirmed' },
    { id: 't5', type: 'expense', category: 'Moradia', amount: 2800, date: '2026-04-02', status: 'confirmed' },
    { id: 't6', type: 'expense', category: 'Lazer', amount: 350, date: '2026-04-18', status: 'pending' },
    { id: 't7', type: 'expense', category: 'Pagamento Fatura', amount: 5000, date: '2026-04-20', status: 'confirmed' },
    { id: 't8', type: 'expense', category: 'Moradia', amount: 2900, date: '2026-03-02', status: 'confirmed' }
  ];

  const monthEval = eng.computePlanEvaluation({
    plan,
    budgets,
    transactions,
    categories,
    scope: 'month',
    targetMonth: '2026-04',
    refDateOrMonth: '2026-04'
  });

  // Alimentação = 900 (Supermercado roll-up) + 800 - 100 (refund) = 1600 vs 1500 planned (Estourado)
  const alim = monthEval.categories.find(c => c.name === 'Alimentação');
  assert.equal(alim.planned, 1500);
  assert.equal(alim.realized, 1600);
  assert.equal(alim.status, 'over');
  assert.equal(alim.txCount, 3);

  // Lazer has 350 spend with 0 budget -> unplanned
  const lazer = monthEval.categories.find(c => c.name === 'Lazer');
  assert.equal(lazer.status, 'unplanned');
  assert.equal(lazer.realized, 350);

  // Totals exclude Pagamento Fatura
  assert.equal(monthEval.totalPlannedExpenses, 4500);
  assert.equal(monthEval.totalRealizedExpenses, 4750);
  assert.equal(monthEval.realizedIncome, 11000);
  assert.equal(monthEval.realizedSavings, 6250);
  assert.equal(monthEval.monthlySeries.length, 6);

  // Full-period evaluation aggregates March + April across the semester
  const fullEval = eng.computePlanEvaluation({
    plan,
    budgets,
    transactions,
    categories,
    scope: 'full',
    targetMonth: '2026-04',
    refDateOrMonth: '2026-04'
  });
  assert.equal(fullEval.totalPlannedExpenses, 7500);
  assert.equal(fullEval.totalRealizedExpenses, 7650);
});

test('computeCategoryAverages calculates average monthly spend across previous months', () => {
  const categories = [
    { id: 'c1', name: 'Moradia', type: 'expense' },
    { id: 'c2', name: 'Alimentação', type: 'expense' }
  ];
  const transactions = [
    { id: '1', type: 'expense', category: 'Moradia', amount: 3000, date: '2026-01-05', status: 'confirmed' },
    { id: '2', type: 'expense', category: 'Moradia', amount: 3000, date: '2026-02-05', status: 'confirmed' },
    { id: '3', type: 'expense', category: 'Moradia', amount: 3300, date: '2026-03-05', status: 'confirmed' },
    { id: '4', type: 'expense', category: 'Alimentação', amount: 1200, date: '2026-02-10', status: 'confirmed' },
    { id: '5', type: 'expense', category: 'Alimentação', amount: 1500, date: '2026-03-10', status: 'confirmed' }
  ];

  const result = eng.computeCategoryAverages({
    transactions,
    categories,
    beforeMonth: '2026-04',
    lookbackMonths: 3
  });

  assert.equal(result.monthsWithData, 3);
  assert.equal(result.averages['Moradia'], 3100);
  assert.equal(result.averages['Alimentação'], 900);
});
