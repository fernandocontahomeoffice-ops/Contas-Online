import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadAiLocaisEngine() {
  const code = fs.readFileSync(path.resolve('js/ai-locais-engine.js'), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.window.App.aiLocaisEngine;
}

const engine = loadAiLocaisEngine();

test('extractUnmatchedMerchants captura despesas confirmadas e pendentes sem local e ignora receitas/ja identificadas', () => {
  const locais = [
    { id: 'loc_uber', nome: 'Uber', categoria: 'Transporte', icone: '🚗', padroes: ['uber'], excluir_do_ranking: false }
  ];

  const transactions = [
    { id: 't1', type: 'expense', status: 'confirmed', description: 'UBER *TRIP 123', amount: 32.5, category: 'Transporte' },
    { id: 't2', type: 'expense', status: 'confirmed', description: 'PG *PADARIA PAO DOURADO', amount: 24.0, category: 'Alimentação' },
    { id: 't3', type: 'expense', status: 'pending', description: 'PG *PADARIA PAO DOURADO', amount: 18.5, category: 'Alimentação' },
    { id: 't4', type: 'expense', status: 'pending', description: 'DROGASIL FILIAL 42', amount: 89.9, category: 'Saúde' },
    { id: 't5', type: 'income', status: 'confirmed', description: 'SALARIO EMPRESA', amount: 5000, category: 'Salário' },
    { id: 't6', type: 'expense', status: 'confirmed', description: 'Ajuste inicial', amount: 100, category: 'Saldo Inicial' }
  ];

  const res = engine.extractUnmatchedMerchants(transactions, locais);
  assert.equal(res.totalUnmatchedTx, 3);
  assert.equal(res.pendingStatusTxCount, 2);
  assert.equal(res.uniqueMerchantsCount, 2);
  assert.equal(res.groups[0].description, 'PG *PADARIA PAO DOURADO');
  assert.equal(res.groups[0].count, 2);
  assert.equal(res.groups[0].amount, 42.5);
  assert.equal(res.groups[1].description, 'DROGASIL FILIAL 42');
  assert.equal(res.groups[1].pendingCount, 1);
});

test('buildSafeMerchantPattern escapa caracteres especiais de regex e garante match na descrição original', () => {
  const p1 = engine.buildSafeMerchantPattern('UBER *TRIP HELP.UBER.COM', 'UBER *TRIP', 'Uber');
  const re1 = new RegExp(p1, 'i');
  assert.equal(re1.test('UBER *TRIP HELP.UBER.COM'), true);
  assert.equal(p1.includes('\\*'), true);

  // Quando a IA sugere padrão que não casa na descrição original, usa fallback seguro que casa
  const p2 = engine.buildSafeMerchantPattern('PG *LOJA (CENTRO)+', 'NOME QUE NAO EXISTE', 'Loja Centro');
  const re2 = new RegExp(p2, 'i');
  assert.equal(re2.test('PG *LOJA (CENTRO)+'), true);
});

test('mergeCategorizationsIntoLocais cria novos locais e atualiza existentes sem duplicar padrões', () => {
  const existingLocais = [
    {
      id: 'loc_drogasil',
      nome: 'Drogasil',
      categoria: 'Farmácia',
      icone: '💊',
      padroes: ['drogasil'],
      excluir_do_ranking: false
    }
  ];

  const groups = [
    { description: 'DROGASIL LJ 042', count: 2, amount: 120 },
    { description: 'PG *PADARIA PAO DOURADO', count: 3, amount: 75 }
  ];

  const aiResults = [
    {
      description: 'DROGASIL LJ 042',
      nome: 'Drogasil',
      categoria: 'Farmácia',
      icone: '💊',
      padrao: 'drogasil',
      excluir_do_ranking: false
    },
    {
      description: 'PG *PADARIA PAO DOURADO',
      nome: 'Padaria Pão Dourado',
      categoria: 'Padaria',
      icone: '🥖',
      padrao: 'padaria pao dourado',
      excluir_do_ranking: false
    }
  ];

  const merged = engine.mergeCategorizationsIntoLocais(existingLocais, aiResults, groups, '2026-06-01T12:00:00.000Z');
  assert.equal(merged.createdCount, 1);
  assert.equal(merged.updatedCount, 1);
  assert.equal(merged.organizedTxCount, 5);
  assert.equal(merged.updatedRecords.length, 1);
  assert.equal(merged.updatedRecords[0].id, 'loc_padaria_pao_dourado');
  assert.equal(merged.updatedRecords[0].auto_ai, true);
  assert.deepEqual(Array.from(merged.updatedRecords[0].padroes), ['padaria pao dourado']);

  // Confirma que após merge, as compras da padaria passam a casar automaticamente
  const allLocais = [...existingLocais, ...merged.updatedRecords];
  const after = engine.extractUnmatchedMerchants([
    { id: 'x1', type: 'expense', status: 'confirmed', description: 'PG *PADARIA PAO DOURADO', amount: 25 },
    { id: 'x2', type: 'expense', status: 'confirmed', description: 'DROGASIL LJ 042', amount: 60 }
  ], allLocais);
  assert.equal(after.totalUnmatchedTx, 0);
});

test('buildProjectContextSnapshot calcula saldos, receitas/despesas do mês e pendentes de locais', () => {
  const ctx = engine.buildProjectContextSnapshot({
    currentPage: 'locais',
    referenceMonth: '2026-06',
    accounts: [
      { id: 'a1', name: 'Conta Corrente', type: 'checking', initial_balance: 1000, exclude_from_total: false },
      { id: 'a2', name: 'Reserva Oculta', type: 'savings', initial_balance: 5000, exclude_from_total: true }
    ],
    transactions: [
      { id: 't1', type: 'income', status: 'confirmed', date: '2026-06-05', amount: 4000, account_id: 'a1', category: 'Salário', description: 'Salário' },
      { id: 't2', type: 'expense', status: 'confirmed', date: '2026-06-08', amount: 350, account_id: 'a1', category: 'Mercado', description: 'ATACADAO CENTRO' },
      { id: 't3', type: 'expense', status: 'pending', date: '2026-06-10', amount: 150, account_id: 'a1', category: 'Farmácia', description: 'RAIA FILIAL 9' }
    ],
    locais: [
      { id: 'loc_atacadao', nome: 'Atacadão', categoria: 'Mercado', icone: '🛒', padroes: ['atacadao'], excluir_do_ranking: false }
    ],
    investments: [
      { id: 'i1', current_value: 12500 }
    ],
    plans: [
      { name: 'Plano 2026', startMonth: '2026-01', endMonth: '2026-12' }
    ]
  });

  assert.equal(ctx.saldo_total_contas, 4650);
  assert.equal(ctx.mes.receitas, 4000);
  assert.equal(ctx.mes.despesas, 500);
  assert.equal(ctx.mes.resultado, 3500);
  assert.equal(ctx.locais_de_compras.compras_sem_local, 1);
  assert.equal(ctx.locais_de_compras.top_locais[0].nome, 'Atacadão');
  assert.equal(ctx.investimentos.valor_total, 12500);
  assert.equal(ctx.planos_orcamentarios[0].nome, 'Plano 2026');
  assert.equal(ctx.gastos_classificacao.pendentes_total, 2);
});

test('extractPendingExpensesForAI identifica gastos sem categoria específica ou sem classificação 50/30/20', () => {
  const transactions = [
    { id: 'e1', type: 'expense', status: 'confirmed', date: '2026-06-10', description: 'IFOOD BURGER', amount: 65, category: 'Outros', classification: '' },
    { id: 'e2', type: 'expense', status: 'pending', date: '2026-06-11', description: 'ENEL ENERGIA', amount: 220, category: 'Despesas Residenciais', classification: '' },
    { id: 'e3', type: 'expense', status: 'confirmed', date: '2026-06-12', description: 'ATACADAO', amount: 400, category: 'Mercado Básico Mensal', classification: 'essential' },
    { id: 'e4', type: 'expense', status: 'confirmed', date: '2026-06-13', description: 'PAGAMENTO FATURA', amount: 1200, category: 'Pagamento Fatura', classification: '' },
    { id: 'e5', type: 'income', status: 'confirmed', date: '2026-06-14', description: 'SALARIO', amount: 5000, category: 'Salário', classification: '' }
  ];

  const pending = engine.extractPendingExpensesForAI(transactions);
  assert.equal(pending.totalPending, 2);
  assert.equal(pending.needsCategoryCount, 1);
  assert.equal(pending.needsClassificationCount, 2);
  assert.equal(pending.pendingTransactions[0].tx.id, 'e2');
  assert.equal(pending.pendingTransactions[0].needsCategory, false);
  assert.equal(pending.pendingTransactions[1].tx.id, 'e1');
  assert.equal(pending.pendingTransactions[1].needsCategory, true);
});

test('applyExpenseCategorizations respeita categorias manuais existentes, valida categorias do app e aplica Essencial/Necessário/Supérfluo', () => {
  const categories = [
    { id: 'c1', name: 'Lanches & Ifood', type: 'expense', classification: 'superfluous', archived: false },
    { id: 'c2', name: 'Despesas Residenciais', type: 'expense', classification: 'essential', archived: false },
    { id: 'c3', name: 'Carro - Combustível', type: 'expense', classification: 'necessary', archived: false },
    { id: 'c4', name: 'Outros', type: 'expense', classification: 'necessary', archived: false }
  ];

  const transactions = [
    { id: 'e1', type: 'expense', status: 'confirmed', date: '2026-06-10', description: 'IFOOD BURGER', amount: 65, category: 'Outros', classification: '' },
    { id: 'e2', type: 'expense', status: 'confirmed', date: '2026-06-11', description: 'ENEL ENERGIA', amount: 220, category: 'Despesas Residenciais', classification: '' },
    { id: 'e3', type: 'expense', status: 'pending', date: '2026-06-12', description: 'POSTO SHELL', amount: 180, category: '', classification: '' }
  ];

  const aiResults = [
    { id: 'e1', category: 'lanches & ifood', classification: 'Supérfluo' },
    { id: 'e2', category: 'Categoria Inventada', classification: 'essencial' },
    { id: 'e3', category: 'Carro - Combustível', classification: 'necessary' }
  ];

  const applied = engine.applyExpenseCategorizations(transactions, aiResults, categories, {
    nowIso: '2026-06-15T10:00:00.000Z',
    provider: 'deepseek'
  });

  assert.equal(applied.updatedTransactions.length, 3);
  assert.equal(applied.categorizedCount, 2);
  assert.equal(applied.classifiedCount, 3);
  assert.equal(applied.countsByClassification.superfluous, 1);
  assert.equal(applied.countsByClassification.essential, 1);
  assert.equal(applied.countsByClassification.necessary, 1);

  const byId = new Map(applied.updatedTransactions.map(t => [t.id, t]));
  assert.equal(byId.get('e1').category, 'Lanches & Ifood');
  assert.equal(byId.get('e1').classification, 'superfluous');
  // Preserva categoria específica do usuário mesmo se IA sugeriu outra
  assert.equal(byId.get('e2').category, 'Despesas Residenciais');
  assert.equal(byId.get('e2').classification, 'essential');
  assert.equal(byId.get('e3').category, 'Carro - Combustível');
  assert.equal(byId.get('e3').classification, 'necessary');

  // Após aplicar, não ficam mais pendentes
  const after = engine.extractPendingExpensesForAI(applied.updatedTransactions);
  assert.equal(after.totalPending, 0);
});
