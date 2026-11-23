// =====================================================================
// ARQUIVO: planning-engine.js
// Motor puro de Planejamento Financeiro: vigência, linha do tempo,
// detecção de sobreposições, apuração Orçado x Realizado e médias reais.
// Compatível com Browser (window.App.planningEngine) e Node (module.exports).
// =====================================================================
(function (root) {
  'use strict';

  const MONTHS_SHORT_PT = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ];

  const MONTHS_LONG_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const SYSTEM_EXCLUDED_CATEGORIES = new Set([
    'Pagamento Fatura',
    'Saldo Inicial',
    'Ajuste de Saldo'
  ]);

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * Normalizes any date-like string ('YYYY-MM', 'YYYY-MM-DD', ISO timestamp) into 'YYYY-MM'.
   */
  function normalizeMonthKey(input) {
    if (!input) return null;
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
      return `${input.getFullYear()}-${pad2(input.getMonth() + 1)}`;
    }
    const str = String(input).trim();
    const match = str.match(/^(\d{4})-(\d{2})/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    if (month < 1 || month > 12 || year < 1970 || year > 2199) return null;
    return `${year}-${pad2(month)}`;
  }

  function currentMonthKey(refDate) {
    if (refDate) {
      const normalized = normalizeMonthKey(refDate);
      if (normalized) return normalized;
    }
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }

  function addMonthsToKey(ym, delta) {
    const norm = normalizeMonthKey(ym);
    if (!norm) return null;
    const [y, m] = norm.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
  }

  function monthStartISO(ym) {
    const norm = normalizeMonthKey(ym);
    if (!norm) return null;
    return `${norm}-01`;
  }

  function monthEndISO(ym) {
    const norm = normalizeMonthKey(ym);
    if (!norm) return null;
    const [y, m] = norm.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${norm}-${pad2(lastDay)}`;
  }

  function monthBounds(ym) {
    const start = monthStartISO(ym);
    const endDate = monthEndISO(ym);
    if (!start || !endDate) return null;
    return {
      ym: normalizeMonthKey(ym),
      start,
      endDate,
      end: `${endDate}T23:59:59`
    };
  }

  function formatMonthShort(ym) {
    const norm = normalizeMonthKey(ym);
    if (!norm) return '—';
    const [y, m] = norm.split('-').map(Number);
    return `${MONTHS_SHORT_PT[m - 1]}/${y}`;
  }

  function formatMonthLong(ym) {
    const norm = normalizeMonthKey(ym);
    if (!norm) return '—';
    const [y, m] = norm.split('-').map(Number);
    return `${MONTHS_LONG_PT[m - 1]} de ${y}`;
  }

  function formatPeriodLabel(startMonth, endMonth) {
    const s = normalizeMonthKey(startMonth);
    const e = normalizeMonthKey(endMonth);
    if (!s && !e) return 'Período não definido';
    if (!e || s === e) return formatMonthShort(s || e);
    return `${formatMonthShort(s)} a ${formatMonthShort(e)}`;
  }

  function enumerateMonths(startMonth, endMonth) {
    const s = normalizeMonthKey(startMonth);
    const e = normalizeMonthKey(endMonth);
    if (!s || !e || s > e) return [];
    const list = [];
    let cursor = s;
    let safety = 0;
    while (cursor <= e && safety < 240) {
      list.push(cursor);
      cursor = addMonthsToKey(cursor, 1);
      safety++;
    }
    return list;
  }

  /**
   * Infers validity startMonth / endMonth for legacy plans that only had a name.
   */
  function inferPlanPeriod(rawPlan, fallbackYear) {
    const existingStart = normalizeMonthKey(rawPlan?.startMonth || rawPlan?.vigencia_inicio || rawPlan?.start_date);
    const existingEnd = normalizeMonthKey(rawPlan?.endMonth || rawPlan?.vigencia_fim || rawPlan?.end_date);
    if (existingStart && existingEnd) {
      return existingStart <= existingEnd
        ? { startMonth: existingStart, endMonth: existingEnd }
        : { startMonth: existingEnd, endMonth: existingStart };
    }
    if (existingStart && !existingEnd) {
      return { startMonth: existingStart, endMonth: `${existingStart.slice(0, 4)}-12` };
    }

    const name = String(rawPlan?.nome || '');
    const yearMatch = name.match(/\b(20\d{2})\b/);
    const createdYear = rawPlan?.criado_em ? parseInt(String(rawPlan.criado_em).slice(0, 4), 10) : null;
    const year = yearMatch ? parseInt(yearMatch[1], 10) : (createdYear || fallbackYear || new Date().getFullYear());

    if (/1[ºo°]?\s*semestre/i.test(name)) {
      return { startMonth: `${year}-01`, endMonth: `${year}-06` };
    }
    if (/2[ºo°]?\s*semestre/i.test(name)) {
      return { startMonth: `${year}-07`, endMonth: `${year}-12` };
    }
    if (/1[ºo°]?\s*trimestre|\bQ1\b/i.test(name)) {
      return { startMonth: `${year}-01`, endMonth: `${year}-03` };
    }
    if (/2[ºo°]?\s*trimestre|\bQ2\b/i.test(name)) {
      return { startMonth: `${year}-04`, endMonth: `${year}-06` };
    }
    if (/3[ºo°]?\s*trimestre|\bQ3\b/i.test(name)) {
      return { startMonth: `${year}-07`, endMonth: `${year}-09` };
    }
    if (/4[ºo°]?\s*trimestre|\bQ4\b/i.test(name)) {
      return { startMonth: `${year}-10`, endMonth: `${year}-12` };
    }
    return { startMonth: `${year}-01`, endMonth: `${year}-12` };
  }

  /**
   * Determines effective lifecycle status for a plan relative to refMonth ('YYYY-MM').
   */
  function computePlanStatus(plan, refMonth) {
    if (plan?.arquivado === true || plan?.status === 'arquivado') {
      return 'arquivado';
    }
    const ref = currentMonthKey(refMonth);
    const start = normalizeMonthKey(plan?.startMonth || plan?.vigencia_inicio);
    const end = normalizeMonthKey(plan?.endMonth || plan?.vigencia_fim);
    if (!start || !end) return 'em_vigor';
    if (ref < start) return 'agendado';
    if (ref > end) return 'encerrado';
    return 'em_vigor';
  }

  function statusMeta(status) {
    switch (status) {
      case 'em_vigor':
        return { code: 'em_vigor', label: 'Em vigor', shortLabel: 'Em vigor', tone: 'active' };
      case 'agendado':
        return { code: 'agendado', label: 'Agendado', shortLabel: 'Futuro', tone: 'upcoming' };
      case 'encerrado':
        return { code: 'encerrado', label: 'Encerrado', shortLabel: 'Encerrado', tone: 'ended' };
      case 'arquivado':
        return { code: 'arquivado', label: 'Arquivado', shortLabel: 'Arquivado', tone: 'archived' };
      default:
        return { code: 'em_vigor', label: 'Em vigor', shortLabel: 'Em vigor', tone: 'active' };
    }
  }

  function normalizePlan(rawPlan, refDateOrMonth) {
    const refMonth = currentMonthKey(refDateOrMonth);
    const fallbackYear = parseInt(refMonth.slice(0, 4), 10);
    const { startMonth, endMonth } = inferPlanPeriod(rawPlan, fallbackYear);
    const months = enumerateMonths(startMonth, endMonth);
    const status = computePlanStatus({ ...rawPlan, startMonth, endMonth }, refMonth);
    const meta = statusMeta(status);
    const startDate = monthStartISO(startMonth);
    const endDate = monthEndISO(endMonth);

    // Progress of elapsed calendar months inside validity window
    let elapsedMonths = 0;
    if (refMonth >= endMonth) {
      elapsedMonths = months.length;
    } else if (refMonth >= startMonth) {
      elapsedMonths = months.filter(m => m <= refMonth).length;
    }
    const timeProgressPct = months.length > 0 ? Math.round((elapsedMonths / months.length) * 100) : 0;

    return {
      ...rawPlan,
      id: rawPlan.id,
      nome: rawPlan.nome || 'Plano Orçamentário',
      descricao: rawPlan.descricao || '',
      startMonth,
      endMonth,
      vigencia_inicio: startMonth,
      vigencia_fim: endMonth,
      startDate,
      endDate,
      months,
      durationMonths: months.length,
      periodLabel: formatPeriodLabel(startMonth, endMonth),
      metaReceitaMensal: Math.max(0, parseFloat(rawPlan.metaReceitaMensal) || 0),
      metaEconomiaPct: Math.max(0, Math.min(100, parseFloat(rawPlan.metaEconomiaPct) || 0)),
      arquivado: Boolean(rawPlan.arquivado || rawPlan.status === 'arquivado'),
      ativo: Boolean(rawPlan.ativo),
      status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      elapsedMonths,
      timeProgressPct,
      criado_em: rawPlan.criado_em || new Date().toISOString()
    };
  }

  function sortPlansChronologically(plans, refDateOrMonth) {
    const normalized = (plans || []).map(p => normalizePlan(p, refDateOrMonth));
    const statusOrder = { em_vigor: 0, agendado: 1, encerrado: 2, arquivado: 3 };
    return normalized.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 9;
      const sb = statusOrder[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      if (a.startMonth !== b.startMonth) return b.startMonth.localeCompare(a.startMonth);
      return (b.criado_em || '').localeCompare(a.criado_em || '');
    });
  }

  /**
   * Returns the financial plan in effect for a given month ('YYYY-MM' or 'YYYY-MM-DD').
   * Ignores archived plans. If multiple plans cover the month, prefers `ativo: true`,
   * then narrowest period (most specific), then most recently created.
   */
  function findActivePlanForMonth(plans, refDateOrMonth) {
    const targetMonth = currentMonthKey(refDateOrMonth);
    const candidates = (plans || [])
      .map(p => normalizePlan(p, targetMonth))
      .filter(p => !p.arquivado && p.startMonth <= targetMonth && p.endMonth >= targetMonth);

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
      if (a.durationMonths !== b.durationMonths) return a.durationMonths - b.durationMonths;
      return (b.criado_em || '').localeCompare(a.criado_em || '');
    });
    return candidates[0];
  }

  /**
   * Detects overlapping months between non-archived plans.
   * Returns array of { planA, planB, overlapStart, overlapEnd, overlapMonths, label }.
   */
  function detectPlanOverlaps(plans, refDateOrMonth) {
    const activePlans = (plans || [])
      .map(p => normalizePlan(p, refDateOrMonth))
      .filter(p => !p.arquivado)
      .sort((a, b) => a.startMonth.localeCompare(b.startMonth));

    const overlaps = [];
    for (let i = 0; i < activePlans.length; i++) {
      for (let j = i + 1; j < activePlans.length; j++) {
        const a = activePlans[i];
        const b = activePlans[j];
        const start = a.startMonth > b.startMonth ? a.startMonth : b.startMonth;
        const end = a.endMonth < b.endMonth ? a.endMonth : b.endMonth;
        if (start <= end) {
          const months = enumerateMonths(start, end);
          overlaps.push({
            planA: a,
            planB: b,
            overlapStart: start,
            overlapEnd: end,
            overlapMonths: months,
            label: formatPeriodLabel(start, end)
          });
        }
      }
    }
    return overlaps;
  }

  /**
   * Builds a 12-month visual timeline structure for a given year.
   */
  function buildYearTimeline(plans, year, refDateOrMonth) {
    const y = parseInt(year, 10) || parseInt(currentMonthKey(refDateOrMonth).slice(0, 4), 10);
    const refMonth = currentMonthKey(refDateOrMonth);
    const yearStart = `${y}-01`;
    const yearEnd = `${y}-12`;

    const normalized = (plans || [])
      .map(p => normalizePlan(p, refMonth))
      .filter(p => !p.arquivado)
      .sort((a, b) => a.startMonth.localeCompare(b.startMonth) || a.endMonth.localeCompare(b.endMonth));

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${pad2(m)}`;
      const covering = normalized.filter(p => p.startMonth <= ym && p.endMonth >= ym);
      const primary = findActivePlanForMonth(normalized, ym);
      months.push({
        ym,
        monthIndex: m - 1,
        shortLabel: MONTHS_SHORT_PT[m - 1],
        isCurrentMonth: ym === refMonth,
        coveringPlans: covering,
        primaryPlan: primary,
        hasOverlap: covering.length > 1,
        hasGap: covering.length === 0
      });
    }

    const bars = [];
    for (const p of normalized) {
      if (p.endMonth < yearStart || p.startMonth > yearEnd) continue;
      const clippedStart = p.startMonth < yearStart ? yearStart : p.startMonth;
      const clippedEnd = p.endMonth > yearEnd ? yearEnd : p.endMonth;
      const startCol = parseInt(clippedStart.slice(5, 7), 10); // 1..12
      const endCol = parseInt(clippedEnd.slice(5, 7), 10);     // 1..12
      bars.push({
        plan: p,
        startCol,
        endCol,
        spanCols: endCol - startCol + 1,
        clippedLeft: p.startMonth < yearStart,
        clippedRight: p.endMonth > yearEnd
      });
    }

    const coveredMonthsCount = months.filter(m => !m.hasGap).length;
    const overlapMonthsCount = months.filter(m => m.hasOverlap).length;

    return {
      year: y,
      refMonth,
      months,
      bars,
      coveredMonthsCount,
      gapMonthsCount: 12 - coveredMonthsCount,
      overlapMonthsCount
    };
  }

  /**
   * Lists available years across all plans + current year for the timeline switcher.
   */
  function getAvailableTimelineYears(plans, refDateOrMonth) {
    const refYear = parseInt(currentMonthKey(refDateOrMonth).slice(0, 4), 10);
    const years = new Set([refYear]);
    for (const raw of (plans || [])) {
      const p = normalizePlan(raw, refDateOrMonth);
      const sy = parseInt(p.startMonth.slice(0, 4), 10);
      const ey = parseInt(p.endMonth.slice(0, 4), 10);
      for (let y = sy; y <= ey && y <= sy + 10; y++) {
        years.add(y);
      }
    }
    return Array.from(years).sort((a, b) => a - b);
  }

  /**
   * Maps transaction dates to effective date (accounting for credit card invoice due month when provided).
   */
  function resolveEffectiveDate(tx, cardsMap, getInvoiceDueFn) {
    const rawDate = String(tx?.date || '').slice(0, 10);
    if (!rawDate) return '';
    if (tx.credit_card_id && cardsMap && typeof getInvoiceDueFn === 'function') {
      const card = cardsMap[tx.credit_card_id];
      if (card) {
        try {
          const due = getInvoiceDueFn(card, rawDate);
          if (due && /^\d{4}-\d{2}-\d{2}/.test(due)) {
            return due.slice(0, 10);
          }
        } catch (e) {
          // fallback to transaction date
        }
      }
    }
    return rawDate;
  }

  /**
   * Builds category lookup maps for expense categories (parent roll-up support).
   */
  function buildCategoryLookup(categories) {
    const expenseCats = (categories || []).filter(c => c.type === 'expense' && !c.archived);
    const byId = {};
    const byName = {};
    expenseCats.forEach(c => {
      byId[c.id] = c;
      byName[c.name] = c;
    });

    const parentNameByCatName = {};
    expenseCats.forEach(c => {
      if (c.parent_id && byId[c.parent_id]) {
        parentNameByCatName[c.name] = byId[c.parent_id].name;
      } else {
        parentNameByCatName[c.name] = c.name;
      }
    });

    const topLevelCategories = expenseCats.filter(c => !c.parent_id || !byId[c.parent_id]);

    return {
      expenseCats,
      topLevelCategories,
      byId,
      byName,
      parentNameByCatName
    };
  }

  /**
   * Deduplicates budgets for a specific plan & month ('YYYY-MM').
   * Keeps the most recently saved budget per category if legacy duplicates exist.
   */
  function getMonthBudgetsMap(budgets, planId, ym) {
    const bounds = monthBounds(ym);
    if (!bounds) return {};
    const map = {};
    for (const b of (budgets || [])) {
      if (b.plano_id !== planId) continue;
      const bMonth = normalizeMonthKey(b.cycle_start || b.month);
      if (bMonth !== ym) continue;
      const amt = parseFloat(b.amount) || 0;
      if (amt <= 0) continue;
      map[b.category] = {
        ...b,
        amount: amt
      };
    }
    return map;
  }

  /**
   * Evaluates a financial plan against real transactions & budgets.
   * Supports scope: 'month' (single month targetMonth) or 'full' (entire plan validity range).
   */
  function computePlanEvaluation({
    plan,
    budgets = [],
    transactions = [],
    categories = [],
    scope = 'month',
    targetMonth = null,
    memberId = null,
    cardsMap = null,
    getInvoiceDueFn = null,
    refDateOrMonth = null
  }) {
    const normPlan = normalizePlan(plan, refDateOrMonth);
    const effectiveTargetMonth = normalizeMonthKey(targetMonth) ||
      (normPlan.months.includes(currentMonthKey(refDateOrMonth))
        ? currentMonthKey(refDateOrMonth)
        : normPlan.startMonth);

    const evaluatedMonths = scope === 'full' ? normPlan.months : [effectiveTargetMonth];
    const evalSet = new Set(evaluatedMonths);
    const planMonthSet = new Set(normPlan.months);

    const catLookup = buildCategoryLookup(categories);
    const allMonthBudgets = {};

    // Collect budgets for every month in the plan (plus evaluated month if outside plan)
    const monthsToIndex = Array.from(new Set([...normPlan.months, ...evaluatedMonths])).sort();
    for (const ym of monthsToIndex) {
      allMonthBudgets[ym] = getMonthBudgetsMap(budgets, normPlan.id, ym);
    }

    // Fallback suggestion when viewing a single month with zero budgets configured
    let usingFallbackBudgets = false;
    let fallbackSourceMonth = null;
    if (scope === 'month' && Object.keys(allMonthBudgets[effectiveTargetMonth] || {}).length === 0) {
      const prevYm = addMonthsToKey(effectiveTargetMonth, -1);
      const prevMap = getMonthBudgetsMap(budgets, normPlan.id, prevYm);
      if (Object.keys(prevMap).length > 0) {
        allMonthBudgets[effectiveTargetMonth] = prevMap;
        usingFallbackBudgets = true;
        fallbackSourceMonth = prevYm;
      }
    }

    // Determine all category names that have explicit budgets in the evaluated scope
    const explicitBudgetCategories = new Set();
    for (const ym of evaluatedMonths) {
      Object.keys(allMonthBudgets[ym] || {}).forEach(name => explicitBudgetCategories.add(name));
    }

    // Filter valid transactions once and bucket by effective month
    const txByMonth = {};
    for (const tx of (transactions || [])) {
      if (!tx || tx.ignore_from_total) continue;
      if (tx.status !== 'confirmed' && tx.status !== 'pending') continue;
      if (memberId && tx.member_id !== memberId) continue;
      if (SYSTEM_EXCLUDED_CATEGORIES.has(tx.category)) continue;
      if (tx.type !== 'expense' && tx.type !== 'income' && tx.type !== 'refund') continue;

      const effDate = tx.type === 'expense' || tx.type === 'refund'
        ? resolveEffectiveDate(tx, cardsMap, getInvoiceDueFn)
        : String(tx.date || '').slice(0, 10);
      const ym = normalizeMonthKey(effDate);
      if (!ym) continue;
      if (!planMonthSet.has(ym) && !evalSet.has(ym)) continue;

      if (!txByMonth[ym]) txByMonth[ym] = [];
      txByMonth[ym].push({ ...tx, _effectiveDate: effDate, _ym: ym });
    }

    // Helper: resolve which category bucket a transaction maps into
    const resolveTxCategoryBucket = (rawCatName) => {
      const name = rawCatName || 'Sem categoria';
      if (explicitBudgetCategories.has(name)) return name;
      const parent = catLookup.parentNameByCatName[name];
      if (parent && (explicitBudgetCategories.has(parent) || catLookup.byName[parent])) {
        return parent;
      }
      return name;
    };

    // Build per-month evolution across ALL months of the plan's validity window
    const monthlySeries = normPlan.months.map(ym => {
      const bMap = allMonthBudgets[ym] || {};
      const monthPlanned = Object.values(bMap).reduce((s, b) => s + b.amount, 0);
      const mTx = txByMonth[ym] || [];
      let monthRealizedExp = 0;
      let monthRealizedInc = 0;
      for (const t of mTx) {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'expense') monthRealizedExp += amt;
        else if (t.type === 'refund') monthRealizedExp = Math.max(0, monthRealizedExp - amt);
        else if (t.type === 'income') monthRealizedInc += amt;
      }
      const monthSavings = monthRealizedInc - monthRealizedExp;
      const adherencePct = monthPlanned > 0 ? Math.round((monthRealizedExp / monthPlanned) * 100) : 0;
      return {
        ym,
        label: formatMonthShort(ym),
        planned: round2(monthPlanned),
        realized: round2(monthRealizedExp),
        income: round2(monthRealizedInc),
        plannedIncome: round2(normPlan.metaReceitaMensal),
        savings: round2(monthSavings),
        diff: round2(monthPlanned - monthRealizedExp),
        adherencePct,
        hasBudget: monthPlanned > 0
      };
    });

    // Aggregate categories for the active evaluation scope ('month' or 'full')
    const plannedByCat = {};
    const realizedByCat = {};
    const txByCat = {};
    let realizedIncome = 0;

    for (const ym of evaluatedMonths) {
      const bMap = allMonthBudgets[ym] || {};
      for (const [catName, bud] of Object.entries(bMap)) {
        plannedByCat[catName] = (plannedByCat[catName] || 0) + bud.amount;
      }
      for (const t of (txByMonth[ym] || [])) {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'income') {
          realizedIncome += amt;
        } else if (t.type === 'expense') {
          const bucket = resolveTxCategoryBucket(t.category);
          realizedByCat[bucket] = (realizedByCat[bucket] || 0) + amt;
          if (!txByCat[bucket]) txByCat[bucket] = [];
          txByCat[bucket].push(t);
        } else if (t.type === 'refund') {
          const bucket = resolveTxCategoryBucket(t.category);
          realizedByCat[bucket] = Math.max(0, (realizedByCat[bucket] || 0) - amt);
          if (!txByCat[bucket]) txByCat[bucket] = [];
          txByCat[bucket].push(t);
        }
      }
    }

    // Union of top-level expense categories + any category with explicit budget or actual spend
    const categoryNames = new Set();
    catLookup.topLevelCategories.forEach(c => categoryNames.add(c.name));
    Object.keys(plannedByCat).forEach(n => categoryNames.add(n));
    Object.keys(realizedByCat).forEach(n => categoryNames.add(n));

    const categoryRows = Array.from(categoryNames).map(name => {
      const catObj = catLookup.byName[name] || null;
      const planned = round2(plannedByCat[name] || 0);
      const realized = round2(realizedByCat[name] || 0);
      const diff = round2(planned - realized);
      const pct = planned > 0 ? Math.round((realized / planned) * 1000) / 10 : (realized > 0 ? null : 0);

      let status = 'empty';
      let statusLabel = 'Sem orçamento';
      if (planned > 0) {
        if (realized > planned) {
          status = 'over';
          statusLabel = 'Estourado';
        } else if (pct >= 85) {
          status = 'warning';
          statusLabel = 'Atenção';
        } else {
          status = 'ok';
          statusLabel = 'Dentro da meta';
        }
      } else if (realized > 0) {
        status = 'unplanned';
        statusLabel = 'Fora do plano';
      }

      const catTransactions = (txByCat[name] || []).slice().sort((a, b) =>
        (b._effectiveDate || b.date || '').localeCompare(a._effectiveDate || a.date || '')
      );

      return {
        name,
        categoryId: catObj ? catObj.id : null,
        color: catObj?.color || '#64748b',
        planned,
        realized,
        diff,
        pct,
        status,
        statusLabel,
        txCount: catTransactions.length,
        transactions: catTransactions
      };
    });

    // Sort: budgeted/active items first by max(planned, realized) desc, then alphabetical
    categoryRows.sort((a, b) => {
      const aActive = a.planned > 0 || a.realized > 0 ? 1 : 0;
      const bActive = b.planned > 0 || b.realized > 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aMag = Math.max(a.planned, a.realized);
      const bMag = Math.max(b.planned, b.realized);
      if (aMag !== bMag) return bMag - aMag;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    const totalPlannedExpenses = round2(categoryRows.reduce((s, r) => s + r.planned, 0));
    const totalRealizedExpenses = round2(categoryRows.reduce((s, r) => s + r.realized, 0));
    const expenseDiff = round2(totalPlannedExpenses - totalRealizedExpenses);
    const expensePct = totalPlannedExpenses > 0
      ? Math.round((totalRealizedExpenses / totalPlannedExpenses) * 1000) / 10
      : 0;

    const plannedIncome = round2(normPlan.metaReceitaMensal * evaluatedMonths.length);
    const realizedIncomeR = round2(realizedIncome);
    const realizedSavings = round2(realizedIncomeR - totalRealizedExpenses);
    const plannedSavings = plannedIncome > 0
      ? round2(normPlan.metaEconomiaPct > 0 ? (plannedIncome * normPlan.metaEconomiaPct) / 100 : (plannedIncome - totalPlannedExpenses))
      : 0;
    const savingsRatePct = realizedIncomeR > 0
      ? Math.round((realizedSavings / realizedIncomeR) * 1000) / 10
      : 0;

    const budgetedCategories = categoryRows.filter(r => r.planned > 0);
    const overBudgetCategories = budgetedCategories.filter(r => r.status === 'over');
    const warningCategories = budgetedCategories.filter(r => r.status === 'warning');
    const unplannedSpendCategories = categoryRows.filter(r => r.status === 'unplanned');

    return {
      plan: normPlan,
      scope,
      targetMonth: effectiveTargetMonth,
      scopeLabel: scope === 'full' ? normPlan.periodLabel : formatMonthShort(effectiveTargetMonth),
      evaluatedMonths,
      usingFallbackBudgets,
      fallbackSourceMonth,
      totalPlannedExpenses,
      totalRealizedExpenses,
      expenseDiff,
      expensePct,
      plannedIncome,
      realizedIncome: realizedIncomeR,
      plannedSavings,
      realizedSavings,
      savingsRatePct,
      budgetedCount: budgetedCategories.length,
      overBudgetCategories,
      warningCategories,
      unplannedSpendCategories,
      categories: categoryRows,
      monthlySeries
    };
  }

  /**
   * Computes average real monthly expense per category over the last N months before beforeMonth.
   */
  function computeCategoryAverages({
    transactions = [],
    categories = [],
    beforeMonth = null,
    lookbackMonths = 3,
    memberId = null,
    cardsMap = null,
    getInvoiceDueFn = null
  }) {
    const refYm = currentMonthKey(beforeMonth);
    const months = [];
    for (let i = 1; i <= lookbackMonths; i++) {
      months.push(addMonthsToKey(refYm, -i));
    }
    const monthSet = new Set(months);
    const catLookup = buildCategoryLookup(categories);
    const totals = {};
    const monthsWithData = new Set();

    for (const tx of (transactions || [])) {
      if (!tx || tx.ignore_from_total) continue;
      if (tx.status !== 'confirmed' && tx.status !== 'pending') continue;
      if (memberId && tx.member_id !== memberId) continue;
      if (tx.type !== 'expense' && tx.type !== 'refund') continue;
      if (SYSTEM_EXCLUDED_CATEGORIES.has(tx.category)) continue;

      const effDate = resolveEffectiveDate(tx, cardsMap, getInvoiceDueFn);
      const ym = normalizeMonthKey(effDate);
      if (!ym || !monthSet.has(ym)) continue;

      monthsWithData.add(ym);
      const parent = catLookup.parentNameByCatName[tx.category] || tx.category || 'Outros';
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'expense') {
        totals[parent] = (totals[parent] || 0) + amt;
      } else if (tx.type === 'refund') {
        totals[parent] = Math.max(0, (totals[parent] || 0) - amt);
      }
    }

    const divisor = Math.max(1, monthsWithData.size);
    const averages = {};
    for (const [cat, total] of Object.entries(totals)) {
      const avg = round2(total / divisor);
      if (avg > 0) averages[cat] = avg;
    }

    return {
      monthsEvaluated: months,
      monthsWithData: monthsWithData.size,
      averages
    };
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  const PlanningEngine = {
    MONTHS_SHORT_PT,
    MONTHS_LONG_PT,
    SYSTEM_EXCLUDED_CATEGORIES,
    normalizeMonthKey,
    currentMonthKey,
    addMonthsToKey,
    monthStartISO,
    monthEndISO,
    monthBounds,
    formatMonthShort,
    formatMonthLong,
    formatPeriodLabel,
    enumerateMonths,
    inferPlanPeriod,
    computePlanStatus,
    statusMeta,
    normalizePlan,
    sortPlansChronologically,
    findActivePlanForMonth,
    detectPlanOverlaps,
    buildYearTimeline,
    getAvailableTimelineYears,
    resolveEffectiveDate,
    buildCategoryLookup,
    getMonthBudgetsMap,
    computePlanEvaluation,
    computeCategoryAverages
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlanningEngine;
  }
  if (root) {
    root.App = root.App || {};
    root.App.planningEngine = PlanningEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
