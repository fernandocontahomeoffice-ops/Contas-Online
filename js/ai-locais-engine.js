// =====================================================================
// ARQUIVO: ai-locais-engine.js
// Lógica pura e testável da IA para categorização de Locais de Compras
// e snapshot de contexto financeiro para o chat integrado.
// =====================================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.App = window.App || {};
    window.App.aiLocaisEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const IGNORED_TECHNICAL_CATEGORIES = new Set([
    'saldo inicial',
    'ajuste de saldo',
    'transferência',
    'transferencia'
  ]);

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugifyLocalId(name) {
    const slug = normalizeText(name)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return 'loc_' + (slug || 'estabelecimento');
  }

  function escapeRegexLiteral(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function compileLocalPatterns(local) {
    if (!local || !Array.isArray(local.padroes)) return [];
    return local.padroes.map(p => {
      if (p instanceof RegExp) return p;
      if (typeof p === 'string' && p.trim()) {
        const trimmed = p.trim();
        const slashMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
        if (slashMatch) {
          try { return new RegExp(slashMatch[1], slashMatch[2] || 'i'); } catch (_) { return null; }
        }
        try { return new RegExp(trimmed, 'i'); } catch (_) { return null; }
      }
      return null;
    }).filter(Boolean);
  }

  function matchTransactionToLocal(tx, compiledLocais) {
    if (!tx || !Array.isArray(compiledLocais)) return null;
    const haystacks = [
      String(tx.description || ''),
      String(tx.account_name || ''),
      String(tx.member_name || '')
    ];

    for (let pass = 0; pass < 2; pass++) {
      const wantExcluded = pass === 0;
      for (let i = 0; i < compiledLocais.length; i++) {
        const local = compiledLocais[i];
        if (Boolean(local.excluir_do_ranking) !== wantExcluded) continue;
        const regs = local._compiled || compileLocalPatterns(local);
        for (let j = 0; j < regs.length; j++) {
          if (haystacks.some(h => regs[j].test(h))) return local;
        }
      }
    }
    return null;
  }

  function isEligiblePurchase(tx, options = {}) {
    if (!tx || tx.type !== 'expense') return false;
    if (options.onlyConfirmed && tx.status !== 'confirmed') return false;
    const desc = String(tx.description || '').trim();
    if (desc.length < 2) return false;
    const catNorm = normalizeText(tx.category || '');
    if (IGNORED_TECHNICAL_CATEGORIES.has(catNorm)) return false;
    return true;
  }

  /**
   * Extrai despesas (confirmadas e pendentes por padrão) ainda sem local atribuído
   * e agrupa por descrição normalizada para envio eficiente em lote à IA.
   */
  function extractUnmatchedMerchants(transactions, locais, options = {}) {
    const txs = Array.isArray(transactions) ? transactions : [];
    const compiled = (Array.isArray(locais) ? locais : []).map(l => ({
      ...l,
      _compiled: compileLocalPatterns(l)
    }));

    const unmatchedTransactions = [];
    const groupedMap = new Map();

    for (const tx of txs) {
      if (!isEligiblePurchase(tx, options)) continue;
      const matched = matchTransactionToLocal(tx, compiled);
      if (matched) continue;

      unmatchedTransactions.push(tx);
      const rawDesc = String(tx.description || '').trim();
      const key = normalizeText(rawDesc);
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          key,
          description: rawDesc,
          category: String(tx.category || '').trim(),
          amount: 0,
          count: 0,
          pendingCount: 0,
          confirmedCount: 0,
          txIds: []
        });
      }
      const entry = groupedMap.get(key);
      entry.count += 1;
      entry.amount += parseFloat(tx.amount) || 0;
      if (tx.status === 'pending') entry.pendingCount += 1;
      else entry.confirmedCount += 1;
      if (tx.id) entry.txIds.push(tx.id);
    }

    const groups = Array.from(groupedMap.values())
      .sort((a, b) => (b.count - a.count) || (b.amount - a.amount));

    return {
      unmatchedTransactions,
      groups,
      totalUnmatchedTx: unmatchedTransactions.length,
      pendingStatusTxCount: unmatchedTransactions.filter(t => t.status === 'pending').length,
      uniqueMerchantsCount: groups.length
    };
  }

  /**
   * Constrói um padrão regex seguro (case-insensitive) que garante match na descrição original.
   */
  function buildSafeMerchantPattern(rawDescription, suggestedPattern, canonicalName) {
    const raw = String(rawDescription || '').trim();
    const candidates = [
      String(suggestedPattern || '').trim(),
      String(canonicalName || '').trim(),
      raw
    ].filter(Boolean);

    for (const candidate of candidates) {
      const cleaned = candidate.replace(/^\/+|\/+[gimsuy]*$/g, '').trim();
      if (cleaned.length < 3 || cleaned.length > 80) continue;

      // Escapa para literal seguro (evita ReDoS e regex quebrado em "UBER *TRIP" ou "PG *LOJA")
      const escaped = escapeRegexLiteral(cleaned);
      try {
        const re = new RegExp(escaped, 'i');
        if (!raw || re.test(raw)) {
          return escaped;
        }
      } catch (_) {
        // tenta próximo candidato
      }
    }

    // Fallback garantido: descrição literal escapada
    return escapeRegexLiteral(raw.slice(0, 80));
  }

  /**
   * Mescla os resultados retornados pela IA no dicionário atual de locais,
   * reaproveitando locais existentes (por nome normalizado ou id) e evitando duplicação de padrões.
   */
  function mergeCategorizationsIntoLocais(existingLocais, aiResults, groups = [], nowIso = new Date().toISOString()) {
    const existingList = Array.isArray(existingLocais) ? existingLocais : [];
    const results = Array.isArray(aiResults) ? aiResults : [];
    const groupByDesc = new Map();
    for (const g of (Array.isArray(groups) ? groups : [])) {
      groupByDesc.set(normalizeText(g.description), g);
    }

    const byNameKey = new Map();
    const byId = new Map();
    for (const loc of existingList) {
      const copy = {
        ...loc,
        padroes: Array.isArray(loc.padroes) ? [...loc.padroes] : []
      };
      byNameKey.set(normalizeText(copy.nome), copy);
      if (copy.id) byId.set(copy.id, copy);
    }

    const dirtyIds = new Set();
    const summaryItems = [];

    for (const item of results) {
      if (!item || !item.nome) continue;
      const nome = String(item.nome).trim().slice(0, 80);
      if (!nome) continue;

      const categoria = String(item.categoria || 'Outros').trim().slice(0, 50) || 'Outros';
      const icone = String(item.icone || '🏪').trim().slice(0, 6) || '🏪';
      const excluir = Boolean(item.excluir_do_ranking);
      const rawDesc = String(item.description || '').trim();
      const pattern = buildSafeMerchantPattern(rawDesc, item.padrao, nome);
      if (!pattern) continue;

      const nameKey = normalizeText(nome);
      const candidateId = slugifyLocalId(nome);
      const existing = byNameKey.get(nameKey) || byId.get(candidateId);
      const matchedGroup = groupByDesc.get(normalizeText(rawDesc));
      const txCount = matchedGroup ? matchedGroup.count : 1;

      if (existing) {
        const hasPattern = existing.padroes.some(p => String(p).toLowerCase() === pattern.toLowerCase());
        let changed = false;
        if (!hasPattern) {
          existing.padroes.push(pattern);
          changed = true;
        }
        if (!existing.categoria && categoria) {
          existing.categoria = categoria;
          changed = true;
        }
        if (!existing.icone && icone) {
          existing.icone = icone;
          changed = true;
        }
        if (changed) {
          existing.updatedAt = nowIso;
          dirtyIds.add(existing.id);
        }
        summaryItems.push({
          action: 'updated',
          localId: existing.id,
          nome: existing.nome,
          categoria: existing.categoria || categoria,
          icone: existing.icone || icone,
          description: rawDesc,
          pattern,
          txCount
        });
      } else {
        const created = {
          id: candidateId,
          nome,
          categoria,
          icone,
          padroes: [pattern],
          excluir_do_ranking: excluir,
          auto_ai: true,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        byNameKey.set(nameKey, created);
        byId.set(created.id, created);
        dirtyIds.add(created.id);
        summaryItems.push({
          action: 'created',
          localId: created.id,
          nome: created.nome,
          categoria: created.categoria,
          icone: created.icone,
          description: rawDesc,
          pattern,
          txCount
        });
      }
    }

    const updatedRecords = Array.from(dirtyIds)
      .map(id => byId.get(id))
      .filter(Boolean);

    return {
      updatedRecords,
      summaryItems,
      createdCount: summaryItems.filter(s => s.action === 'created').length,
      updatedCount: summaryItems.filter(s => s.action === 'updated').length,
      organizedTxCount: summaryItems.reduce((sum, s) => sum + (s.txCount || 0), 0)
    };
  }

  const GENERIC_EXPENSE_CATEGORIES = new Set([
    '',
    'outros',
    'outras',
    'outro',
    'sem categoria',
    'a categorizar',
    'diversos',
    'geral'
  ]);

  const TECHNICAL_EXPENSE_CATEGORIES = new Set([
    'saldo inicial',
    'ajuste de saldo',
    'pagamento fatura',
    'transferencia',
    'transferência',
    'aporte',
    'resgate'
  ]);

  const VALID_CLASSIFICATIONS = new Set(['essential', 'necessary', 'superfluous']);

  function normalizeClassification(value) {
    const norm = normalizeText(value);
    if (!norm) return '';
    if (norm === 'essential' || norm.startsWith('essenc')) return 'essential';
    if (norm === 'necessary' || norm.startsWith('necess')) return 'necessary';
    if (norm === 'superfluous' || norm.startsWith('superfl')) return 'superfluous';
    return '';
  }

  function formatClassificationLabel(code) {
    const norm = normalizeClassification(code);
    if (norm === 'essential') return 'Essencial';
    if (norm === 'necessary') return 'Necessário';
    if (norm === 'superfluous') return 'Supérfluo';
    return 'Sem classificação';
  }

  function needsExpenseCategorization(tx, options = {}) {
    if (!tx || tx.type !== 'expense') {
      return { eligible: false, needsCategory: false, needsClassification: false };
    }
    if (tx.ignore_from_total || tx.invoice_locked) {
      return { eligible: false, needsCategory: false, needsClassification: false };
    }
    const desc = String(tx.description || '').trim();
    if (desc.length < 2) {
      return { eligible: false, needsCategory: false, needsClassification: false };
    }
    const catNorm = normalizeText(tx.category || '');
    if (TECHNICAL_EXPENSE_CATEGORIES.has(catNorm)) {
      return { eligible: false, needsCategory: false, needsClassification: false };
    }

    const force = Boolean(options.force);
    const alreadyReviewed = Boolean(tx.ai_categorized_at);
    const isGenericCat = GENERIC_EXPENSE_CATEGORIES.has(catNorm);
    const needsCategory = isGenericCat && (force || !alreadyReviewed || !catNorm);
    const currentCls = normalizeClassification(tx.classification);
    const needsClassification = !VALID_CLASSIFICATIONS.has(currentCls);

    return {
      eligible: needsCategory || needsClassification,
      needsCategory,
      needsClassification
    };
  }

  function extractPendingExpensesForAI(transactions, options = {}) {
    const txs = Array.isArray(transactions) ? transactions : [];
    const pendingTransactions = [];
    let needsCategoryCount = 0;
    let needsClassificationCount = 0;

    for (const tx of txs) {
      const check = needsExpenseCategorization(tx, options);
      if (!check.eligible) continue;
      if (check.needsCategory) needsCategoryCount += 1;
      if (check.needsClassification) needsClassificationCount += 1;
      pendingTransactions.push({
        tx,
        needsCategory: check.needsCategory,
        needsClassification: check.needsClassification
      });
    }

    pendingTransactions.sort((a, b) => String(b.tx.date || '').localeCompare(String(a.tx.date || '')));

    return {
      pendingTransactions,
      needsCategoryCount,
      needsClassificationCount,
      totalPending: pendingTransactions.length
    };
  }

  function applyExpenseCategorizations(transactions, aiResults, categories = [], options = {}) {
    const txs = Array.isArray(transactions) ? transactions : [];
    const results = Array.isArray(aiResults) ? aiResults : [];
    const cats = Array.isArray(categories) ? categories : [];
    const nowIso = options.nowIso || new Date().toISOString();
    const provider = options.provider || 'ai';

    const activeExpenseCats = cats.filter(c => c && c.type === 'expense' && !c.archived && c.name);
    const catByNorm = new Map();
    for (const c of activeExpenseCats) {
      catByNorm.set(normalizeText(c.name), c);
    }

    const txById = new Map();
    for (const tx of txs) {
      if (tx && tx.id) txById.set(tx.id, tx);
    }

    const updatedTransactions = [];
    const summaryItems = [];
    const countsByClassification = { essential: 0, necessary: 0, superfluous: 0 };
    let categorizedCount = 0;
    let classifiedCount = 0;

    for (const item of results) {
      if (!item || !item.id) continue;
      const orig = txById.get(item.id);
      if (!orig) continue;

      const check = needsExpenseCategorization(orig, options);
      if (!check.eligible) continue;

      const updated = { ...orig };
      let categoryChanged = false;
      let classificationChanged = false;

      const suggestedCatObj = catByNorm.get(normalizeText(item.category || ''));
      if (check.needsCategory) {
        if (suggestedCatObj) {
          if (updated.category !== suggestedCatObj.name) {
            updated.category = suggestedCatObj.name;
            categoryChanged = true;
            categorizedCount += 1;
          }
        } else if (!updated.category) {
          const fallbackCat = catByNorm.get('outros');
          updated.category = fallbackCat ? fallbackCat.name : 'Outros';
          categoryChanged = true;
          categorizedCount += 1;
        }
      }

      if (check.needsClassification) {
        let cls = normalizeClassification(item.classification);
        if (!cls) {
          const currentCatObj = catByNorm.get(normalizeText(updated.category || ''));
          cls = normalizeClassification(currentCatObj?.classification) || 'necessary';
        }
        updated.classification = cls;
        classificationChanged = true;
        classifiedCount += 1;
        countsByClassification[cls] = (countsByClassification[cls] || 0) + 1;
      }

      updated.ai_categorized_at = nowIso;
      updated.ai_classification_provider = provider;
      updated.updatedAt = nowIso;

      updatedTransactions.push(updated);
      summaryItems.push({
        kind: 'expense',
        txId: updated.id,
        description: String(updated.description || '').trim(),
        category: updated.category || 'Outros',
        classification: updated.classification || '',
        classificationLabel: formatClassificationLabel(updated.classification),
        categoryChanged,
        classificationChanged,
        amount: parseFloat(updated.amount) || 0
      });
    }

    return {
      updatedTransactions,
      summaryItems,
      categorizedCount,
      classifiedCount,
      countsByClassification
    };
  }

  /**
   * Monta um resumo compacto e seguro dos dados reais do projeto para o Chat com IA.
   */
  function buildProjectContextSnapshot({
    accounts = [],
    transactions = [],
    locais = [],
    investments = [],
    plans = [],
    currentPage = 'panel',
    referenceMonth = null
  } = {}) {
    const activeAccounts = (accounts || []).filter(a => !a.archived);
    const txs = Array.isArray(transactions) ? transactions : [];
    const monthKey = referenceMonth || new Date().toISOString().slice(0, 7);

    // Saldo consolidado de contas (respeitando exclude_from_total)
    const txByAcc = new Map();
    for (const t of txs) {
      if (t.status !== 'confirmed' || t.ignore_from_total) continue;
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income' && t.account_id) {
        txByAcc.set(t.account_id, (txByAcc.get(t.account_id) || 0) + amt);
      } else if (t.type === 'expense' && t.account_id && !t.credit_card_id) {
        txByAcc.set(t.account_id, (txByAcc.get(t.account_id) || 0) - amt);
      } else if (t.type === 'refund' && t.account_id && !t.credit_card_id) {
        txByAcc.set(t.account_id, (txByAcc.get(t.account_id) || 0) + amt);
      } else if (t.type === 'transfer') {
        if (t.account_id) txByAcc.set(t.account_id, (txByAcc.get(t.account_id) || 0) - amt);
        if (t.account_to_id) txByAcc.set(t.account_to_id, (txByAcc.get(t.account_to_id) || 0) + amt);
      }
    }

    const accountSummaries = activeAccounts.map(a => {
      const bal = (parseFloat(a.initial_balance) || 0) + (txByAcc.get(a.id) || 0);
      return {
        nome: a.name,
        tipo: a.type || 'checking',
        saldo: Number(bal.toFixed(2)),
        excluida_do_total: Boolean(a.exclude_from_total)
      };
    });

    const totalSaldo = accountSummaries
      .filter(a => !a.excluida_do_total)
      .reduce((s, a) => s + a.saldo, 0);

    // Mês de referência
    const monthTxs = txs.filter(t => String(t.date || '').slice(0, 7) === monthKey && !t.ignore_from_total);
    let receitasMes = 0;
    let despesasMes = 0;
    const gastosPorCategoria = new Map();

    for (const t of monthTxs) {
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income' && t.status === 'confirmed') {
        receitasMes += amt;
      } else if (t.type === 'expense' && t.category !== 'Pagamento Fatura' && !t.invoice_locked) {
        despesasMes += amt;
        const cat = t.category || 'Sem categoria';
        gastosPorCategoria.set(cat, (gastosPorCategoria.get(cat) || 0) + amt);
      }
    }

    const topCategoriasMes = Array.from(gastosPorCategoria.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([categoria, total]) => ({ categoria, total: Number(total.toFixed(2)) }));

    // Locais de compras + pendentes
    const compiled = (locais || []).map(l => ({ ...l, _compiled: compileLocalPatterns(l) }));
    const localTotals = new Map();
    for (const t of txs) {
      if (t.type !== 'expense') continue;
      const loc = matchTransactionToLocal(t, compiled);
      if (loc && !loc.excluir_do_ranking) {
        const cur = localTotals.get(loc.nome) || { nome: loc.nome, categoria: loc.categoria || 'Outros', compras: 0, total: 0 };
        cur.compras += 1;
        cur.total += parseFloat(t.amount) || 0;
        localTotals.set(loc.nome, cur);
      }
    }
    const topLocais = Array.from(localTotals.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map(l => ({ ...l, total: Number(l.total.toFixed(2)) }));

    const unmatched = extractUnmatchedMerchants(txs, locais);
    const pendingExpenses = extractPendingExpensesForAI(txs);
    const totalInvestimentos = (investments || []).reduce((s, inv) => s + (parseFloat(inv.current_value) || 0), 0);

    return {
      tela_atual: currentPage,
      mes_referencia: monthKey,
      saldo_total_contas: Number(totalSaldo.toFixed(2)),
      contas: accountSummaries.slice(0, 12),
      mes: {
        receitas: Number(receitasMes.toFixed(2)),
        despesas: Number(despesasMes.toFixed(2)),
        resultado: Number((receitasMes - despesasMes).toFixed(2)),
        top_categorias: topCategoriasMes
      },
      locais_de_compras: {
        total_cadastrados: (locais || []).length,
        compras_sem_local: unmatched.totalUnmatchedTx,
        estabelecimentos_pendentes: unmatched.uniqueMerchantsCount,
        exemplos_pendentes: unmatched.groups.slice(0, 6).map(g => g.description),
        top_locais: topLocais
      },
      gastos_classificacao: {
        pendentes_total: pendingExpenses.totalPending,
        sem_categoria_especifica: pendingExpenses.needsCategoryCount,
        sem_classificacao_50_30_20: pendingExpenses.needsClassificationCount
      },
      investimentos: {
        quantidade_ativos: (investments || []).length,
        valor_total: Number(totalInvestimentos.toFixed(2))
      },
      planos_orcamentarios: (plans || []).slice(0, 6).map(p => ({
        nome: p.name || p.nome || 'Plano',
        inicio: p.startMonth || p.start_date || '',
        fim: p.endMonth || p.end_date || ''
      }))
    };
  }

  return {
    normalizeText,
    slugifyLocalId,
    escapeRegexLiteral,
    compileLocalPatterns,
    matchTransactionToLocal,
    isEligiblePurchase,
    extractUnmatchedMerchants,
    buildSafeMerchantPattern,
    mergeCategorizationsIntoLocais,
    normalizeClassification,
    formatClassificationLabel,
    needsExpenseCategorization,
    extractPendingExpensesForAI,
    applyExpenseCategorizations,
    buildProjectContextSnapshot
  };
});
