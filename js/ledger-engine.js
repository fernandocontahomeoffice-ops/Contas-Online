// =====================================================================
// ARQUIVO: ledger-engine.js
// Motor puro de Saldos, Liquidez, Projeção de Caixa, Saldo Acumulado,
// Conciliação e Importação Universal OFX/CSV (Browser + Node tests)
// =====================================================================
(function (root) {
  function round2(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function isoDateOnly(val) {
    if (!val) return '';
    return String(val).slice(0, 10);
  }

  function addDaysISO(iso, days) {
    const [y, m, d] = isoDateOnly(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) + Number(days || 0)));
    return dt.toISOString().slice(0, 10);
  }

  function normalizeText(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function resolveInvoiceDueDate(card, txDateISO, getInvoicePeriodFn) {
    const d = isoDateOnly(txDateISO);
    if (!card || !d) return d;
    if (typeof getInvoicePeriodFn === 'function') {
      try {
        const p = getInvoicePeriodFn(card, d);
        if (p && p.due) return isoDateOnly(p.due);
      } catch (e) {}
    }
    const closingDay = parseInt(card.closing_day || card.closingDay || 1, 10) || 1;
    const dueDay = parseInt(card.due_day || card.dueDay || 10, 10) || 10;
    const [y, m, day] = d.split('-').map(Number);
    let targetMonth = m;
    let targetYear = y;
    if (day >= closingDay) {
      targetMonth += 1;
    }
    if (dueDay < closingDay) {
      targetMonth += 1;
    }
    while (targetMonth > 12) {
      targetMonth -= 12;
      targetYear += 1;
    }
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const clampedDue = Math.min(dueDay, lastDay);
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(clampedDue).padStart(2, '0')}`;
  }

  /**
   * Calcula saldos de todas as contas com fonte única de verdade (sem corte de 5 anos).
   * Ignora compras de cartão de crédito (credit_card_id / invoice_locked) e evita dupla contagem de Saldo Inicial.
   */
  function computeAccountBalances(accounts, transactions, options = {}) {
    const today = isoDateOnly(options.asOfDate || new Date().toISOString().slice(0, 10));
    const includeArchived = Boolean(options.includeArchived);
    const memberId = options.memberId || null;
    const investments = Array.isArray(options.investments) ? options.investments : [];
    const creditCards = Array.isArray(options.creditCards) ? options.creditCards : [];
    const getInvoicePeriodFn = options.getInvoicePeriodFn || null;
    const horizonDays = Number(options.commitmentDays || 30);
    const horizonEnd = addDaysISO(today, horizonDays);

    const allAccounts = Array.isArray(accounts) ? accounts : [];
    const visibleAccounts = allAccounts.filter(a => (!a.archived || includeArchived) && (!memberId || !a.member_id || a.member_id === memberId));
    const accountMap = Object.fromEntries(visibleAccounts.map(a => [a.id, a]));

    const byAccount = {};
    for (const acc of visibleAccounts) {
      const init = round2(acc.initial_balance || 0);
      byAccount[acc.id] = {
        accountId: acc.id,
        name: acc.name || '',
        type: acc.type || 'other',
        member_id: acc.member_id || '',
        exclude_from_total: Boolean(acc.exclude_from_total),
        archived: Boolean(acc.archived),
        initial: init,
        income: 0,
        expense: 0,
        transferIn: 0,
        transferOut: 0,
        balance: init,
        totalIncludedBalance: init,
        reconciledBalance: init,
        unreconciledCount: 0,
        reconciledCount: 0,
        lastReconciledDate: acc.last_reconciled_at || null,
        lastReconciledBalance: typeof acc.last_reconciled_balance === 'number' ? acc.last_reconciled_balance : null,
        investmentAssets: 0
      };
    }

    // Soma ativos de investimento vinculados a cada conta
    for (const inv of investments) {
      if (!inv || !inv.account_id || !byAccount[inv.account_id]) continue;
      byAccount[inv.account_id].investmentAssets = round2(
        byAccount[inv.account_id].investmentAssets + (parseFloat(inv.current_value) || 0)
      );
    }

    const txList = Array.isArray(transactions) ? transactions : [];
    const cardMap = Object.fromEntries(creditCards.map(c => [c.id, c]));

    let compromissos30d = 0;
    let entradasPrevistas30d = 0;

    for (const t of txList) {
      if (!t) continue;
      if (memberId && t.member_id && t.member_id !== memberId) continue;
      const d = isoDateOnly(t.date);
      if (!d) continue;
      const amt = parseFloat(t.amount) || 0;

      // Compromissos futuros nos próximos N dias (pendentes ou faturas de cartão)
      if (!t.ignore_from_total && t.status === 'pending') {
        if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
          const card = cardMap[t.credit_card_id];
          if (!card || card.card_type !== 'prepaid') {
            const due = resolveInvoiceDueDate(card, d, getInvoicePeriodFn);
            if (due >= today && due <= horizonEnd) {
              compromissos30d += (t.type === 'refund' ? -amt : amt);
            }
          }
        } else if (d >= today && d <= horizonEnd) {
          if (t.type === 'expense') compromissos30d += amt;
          else if (t.type === 'income' || t.type === 'refund') entradasPrevistas30d += amt;
        }
      }

      // Cálculo de saldo efetivo até `today`
      if (t.status !== 'confirmed' || d > today) continue;
      if (t.invoice_locked || t.credit_card_id) continue;

      const isSaldoInicialIgnored = Boolean(t.ignore_from_total && t.category === 'Saldo Inicial');
      if (t.ignore_from_total && !isSaldoInicialIgnored) continue;

      const applyDelta = (accId, field, delta, includeInTotal, isReconciled) => {
        const entry = byAccount[accId];
        if (!entry) return;
        // Evita dupla contagem de Saldo Inicial quando conta já tem initial_balance > 0
        if (isSaldoInicialIgnored && entry.initial > 0) return;

        entry[field] = round2(entry[field] + Math.abs(delta));
        entry.balance = round2(entry.balance + delta);
        if (includeInTotal) {
          entry.totalIncludedBalance = round2(entry.totalIncludedBalance + delta);
        }
        if (isReconciled) {
          entry.reconciledBalance = round2(entry.reconciledBalance + delta);
          entry.reconciledCount += 1;
        } else {
          entry.unreconciledCount += 1;
        }
      };

      const includeInTotal = !t.ignore_from_total;
      const isRec = Boolean(t.reconciled);

      if (t.type === 'income' || t.type === 'refund') {
        applyDelta(t.account_id, 'income', amt, includeInTotal, isRec);
      } else if (t.type === 'expense') {
        applyDelta(t.account_id, 'expense', -amt, includeInTotal, isRec);
      } else if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') {
        if (t.account_id) applyDelta(t.account_id, 'transferOut', -amt, includeInTotal, isRec);
        if (t.account_to_id) applyDelta(t.account_to_id, 'transferIn', amt, includeInTotal, isRec);
      }
    }

    let totalBalance = 0;
    let caixaDisponivel = 0;
    let reservaLiquidez = 0;
    let investimentosCaixa = 0;
    let investimentosAtivos = 0;
    let outrasContas = 0;
    let emprestimos = 0;

    for (const acc of visibleAccounts) {
      const st = byAccount[acc.id];
      if (!st) continue;
      if (!acc.exclude_from_total) {
        totalBalance = round2(totalBalance + st.totalIncludedBalance);
      }
      if (acc.type === 'checking' || acc.type === 'wallet') {
        if (!acc.exclude_from_total) caixaDisponivel = round2(caixaDisponivel + st.balance);
      } else if (acc.type === 'savings') {
        if (!acc.exclude_from_total) reservaLiquidez = round2(reservaLiquidez + st.balance);
      } else if (acc.type === 'investment') {
        investimentosCaixa = round2(investimentosCaixa + st.balance);
        investimentosAtivos = round2(investimentosAtivos + st.investmentAssets);
      } else if (acc.type === 'loan') {
        emprestimos = round2(emprestimos + st.balance);
      } else {
        if (!acc.exclude_from_total) outrasContas = round2(outrasContas + st.balance);
      }
    }

    compromissos30d = round2(Math.max(0, compromissos30d));
    entradasPrevistas30d = round2(Math.max(0, entradasPrevistas30d));
    const saldoLivreReal = round2(caixaDisponivel + reservaLiquidez - compromissos30d);

    return {
      asOfDate: today,
      byAccount,
      accountMap,
      totalBalance,
      liquidity: {
        caixaDisponivel,
        reservaLiquidez,
        investimentosCaixa,
        investimentosAtivos,
        outrasContas,
        emprestimos,
        compromissos30d,
        entradasPrevistas30d,
        saldoLivreReal
      }
    };
  }

  /**
   * Consolida o histórico de investimentos somando o último valor conhecido de CADA ativo por data,
   * eliminando o efeito serrilhado quando há múltiplos investimentos.
   */
  function buildInvestmentPortfolioSeries(investmentHistory, investments) {
    const history = Array.isArray(investmentHistory) ? investmentHistory : [];
    const invs = Array.isArray(investments) ? investments : [];
    const validIds = new Set(invs.map(i => i.id));

    if (!history.length) {
      const totalInv = round2(invs.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0));
      if (totalInv <= 0) return [];
      const today = new Date().toISOString().slice(0, 10);
      return [
        { date: addDaysISO(today, -30), value: totalInv },
        { date: today, value: totalInv }
      ];
    }

    const filtered = history
      .filter(h => h && h.date && (!validIds.size || validIds.has(h.investment_id)))
      .map(h => ({
        investment_id: h.investment_id || '__default__',
        date: isoDateOnly(h.date),
        value: parseFloat(h.value) || 0
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!filtered.length) return [];

    // Agrupa atualizações por data
    const updatesByDate = new Map();
    for (const row of filtered) {
      if (!updatesByDate.has(row.date)) updatesByDate.set(row.date, []);
      updatesByDate.get(row.date).push(row);
    }

    const latestByInv = new Map();
    const series = [];
    const dates = [...updatesByDate.keys()].sort();
    for (const date of dates) {
      for (const upd of updatesByDate.get(date)) {
        latestByInv.set(upd.investment_id, upd.value);
      }
      let sum = 0;
      for (const v of latestByInv.values()) sum += v;
      series.push({ date, value: round2(sum) });
    }

    return series;
  }

  /**
   * Projeta o saldo diário consolidado e por conta para os próximos N dias (30/60/90),
   * detectando antecipadamente qualquer conta que vá ficar negativa.
   */
  function buildDailyCashflowProjection(accounts, transactions, creditCards, options = {}) {
    const today = isoDateOnly(options.asOfDate || new Date().toISOString().slice(0, 10));
    const days = Math.max(1, parseInt(options.days || 30, 10));
    const memberId = options.memberId || null;
    const getInvoicePeriodFn = options.getInvoicePeriodFn || null;
    const endDate = addDaysISO(today, days);

    const base = computeAccountBalances(accounts, transactions, {
      asOfDate: today,
      includeArchived: false,
      memberId,
      creditCards,
      getInvoicePeriodFn
    });

    const activeAccounts = (accounts || []).filter(
      a => !a.archived && !a.exclude_from_total && a.type !== 'investment' && a.type !== 'loan' && (!memberId || !a.member_id || a.member_id === memberId)
    );
    const activeIds = new Set(activeAccounts.map(a => a.id));
    const cardMap = Object.fromEntries((creditCards || []).map(c => [c.id, c]));

    // Delta diário por conta e total
    const dailyTotalDelta = {};
    const dailyAccDelta = {};
    for (const a of activeAccounts) dailyAccDelta[a.id] = {};

    const addDelta = (dateStr, accId, delta) => {
      if (dateStr < today || dateStr > endDate) return;
      dailyTotalDelta[dateStr] = round2((dailyTotalDelta[dateStr] || 0) + delta);
      if (accId && dailyAccDelta[accId]) {
        dailyAccDelta[accId][dateStr] = round2((dailyAccDelta[accId][dateStr] || 0) + delta);
      }
    };

    for (const t of transactions || []) {
      if (!t || t.ignore_from_total) continue;
      if (memberId && t.member_id && t.member_id !== memberId) continue;
      const d = isoDateOnly(t.date);
      if (!d) continue;
      const amt = parseFloat(t.amount) || 0;

      // Transações pendentes futuras ou de hoje, ou confirmadas estritamente futuras
      const isFutureConfirmed = t.status === 'confirmed' && d > today;
      const isPendingUpcoming = t.status === 'pending' && d >= today;
      if (!isFutureConfirmed && !isPendingUpcoming) continue;

      if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
        const card = cardMap[t.credit_card_id];
        if (card && card.card_type === 'prepaid') continue;
        const due = resolveInvoiceDueDate(card, d, getInvoicePeriodFn);
        const payAccId = (card && card.account_id && activeIds.has(card.account_id)) ? card.account_id : null;
        const delta = t.type === 'refund' ? amt : -amt;
        addDelta(due, payAccId, delta);
      } else if (t.type === 'income' || t.type === 'refund') {
        if (!t.account_id || activeIds.has(t.account_id)) {
          addDelta(d, t.account_id, amt);
        }
      } else if (t.type === 'expense') {
        if (!t.account_id || activeIds.has(t.account_id)) {
          addDelta(d, t.account_id, -amt);
        }
      } else if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') {
        if (t.account_id && activeIds.has(t.account_id)) {
          addDelta(d, t.account_id, -amt);
        }
        if (t.account_to_id && activeIds.has(t.account_to_id)) {
          addDelta(d, t.account_to_id, amt);
        }
      }
    }

    let runningTotal = round2(
      activeAccounts.reduce((s, a) => s + (base.byAccount[a.id]?.totalIncludedBalance || 0), 0)
    );
    const accRunning = {};
    const accAlerts = {};
    for (const a of activeAccounts) {
      accRunning[a.id] = round2(base.byAccount[a.id]?.balance || 0);
      accAlerts[a.id] = {
        accountId: a.id,
        accountName: a.name,
        firstNegativeDate: accRunning[a.id] < 0 ? today : null,
        minBalance: accRunning[a.id],
        minBalanceDate: today
      };
    }

    const points = [];
    let minTotal = runningTotal;
    let minTotalDate = today;

    for (let i = 0; i <= days; i++) {
      const curDate = addDaysISO(today, i);
      const deltaTotal = dailyTotalDelta[curDate] || 0;
      runningTotal = round2(runningTotal + deltaTotal);
      if (runningTotal < minTotal) {
        minTotal = runningTotal;
        minTotalDate = curDate;
      }

      for (const a of activeAccounts) {
        const dAcc = dailyAccDelta[a.id][curDate] || 0;
        accRunning[a.id] = round2(accRunning[a.id] + dAcc);
        if (accRunning[a.id] < accAlerts[a.id].minBalance) {
          accAlerts[a.id].minBalance = accRunning[a.id];
          accAlerts[a.id].minBalanceDate = curDate;
        }
        if (accRunning[a.id] < 0 && !accAlerts[a.id].firstNegativeDate) {
          accAlerts[a.id].firstNegativeDate = curDate;
        }
      }

      points.push({
        date: curDate,
        balance: runningTotal,
        delta: deltaTotal
      });
    }

    const negativeAlerts = Object.values(accAlerts)
      .filter(a => a.minBalance < 0)
      .sort((a, b) => (a.firstNegativeDate || '').localeCompare(b.firstNegativeDate || ''));

    return {
      startDate: today,
      endDate,
      days,
      startBalance: points.length ? round2(points[0].balance - points[0].delta) : runningTotal,
      endBalance: points.length ? points[points.length - 1].balance : runningTotal,
      minTotal,
      minTotalDate,
      points,
      negativeAlerts
    };
  }

  /**
   * Calcula o saldo acumulado (running balance) após cada lançamento de uma conta específica.
   * Retorna um Map/objeto { [tx.id]: saldoAposLancamento }.
   */
  function computeRunningBalances(account, allTransactions, options = {}) {
    if (!account || !account.id) return {};
    const accountId = account.id;
    const includePending = Boolean(options.includePending);
    const initial = round2(account.initial_balance || 0);

    const relevant = (allTransactions || [])
      .filter(t => {
        if (!t) return false;
        if (!includePending && t.status !== 'confirmed') return false;
        if (t.invoice_locked || t.credit_card_id) return false;
        if (t.ignore_from_total && t.category !== 'Saldo Inicial') return false;
        if (t.ignore_from_total && t.category === 'Saldo Inicial' && initial > 0) return false;
        return t.account_id === accountId || t.account_to_id === accountId;
      })
      .sort((a, b) => {
        const cmpDate = String(a.date || '').localeCompare(String(b.date || ''));
        if (cmpDate !== 0) return cmpDate;
        return (a.position || 0) - (b.position || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });

    let running = initial;
    const map = {};
    for (const t of relevant) {
      const amt = parseFloat(t.amount) || 0;
      let delta = 0;
      if (t.type === 'income' || t.type === 'refund') {
        if (t.account_id === accountId) delta += amt;
      } else if (t.type === 'expense') {
        if (t.account_id === accountId) delta -= amt;
      } else if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') {
        if (t.account_id === accountId) delta -= amt;
        if (t.account_to_id === accountId) delta += amt;
      }
      running = round2(running + delta);
      map[t.id] = running;
    }
    return map;
  }

  /**
   * Sugere categoria com base no histórico real do usuário e em regras financeiras comuns (PT-BR).
   */
  function suggestCategory(description, type, existingTransactions = [], categories = []) {
    const normDesc = normalizeText(description);
    if (!normDesc) return type === 'income' ? 'Salário' : 'Outros';

    // 1. Aprende com o histórico real do próprio usuário
    const catScores = {};
    for (const tx of existingTransactions || []) {
      if (!tx || !tx.category || tx.category === 'Saldo Inicial') continue;
      if (type && tx.type && tx.type !== type) continue;
      const txNorm = normalizeText(tx.description);
      if (!txNorm) continue;
      if (txNorm === normDesc) {
        catScores[tx.category] = (catScores[tx.category] || 0) + 10;
      } else if (txNorm.includes(normDesc) || normDesc.includes(txNorm)) {
        catScores[tx.category] = (catScores[tx.category] || 0) + 5;
      } else {
        const words = normDesc.split(' ').filter(w => w.length >= 4);
        const matches = words.filter(w => txNorm.includes(w)).length;
        if (matches > 0) {
          catScores[tx.category] = (catScores[tx.category] || 0) + matches * 2;
        }
      }
    }
    const bestHist = Object.entries(catScores).sort((a, b) => b[1] - a[1])[0];
    if (bestHist && bestHist[1] >= 4) return bestHist[0];

    // 2. Regras integradas
    const availNames = (categories || []).map(c => c.name || c).filter(Boolean);
    const findBestAvailable = (candidates, fallback) => {
      for (const cand of candidates) {
        const nc = normalizeText(cand);
        const exact = availNames.find(a => normalizeText(a) === nc);
        if (exact) return exact;
        const partial = availNames.find(a => normalizeText(a).includes(nc));
        if (partial) return partial;
      }
      return fallback;
    };

    if (type === 'income') {
      if (/salario|folha|pagto salario|holerite|pro labore/.test(normDesc)) return findBestAvailable(['Salário', 'Salario'], 'Salário');
      if (/dividendo|jcp|rendimento|provento|fii|cdb|tesouro/.test(normDesc)) return findBestAvailable(['Rendimentos', 'Investimentos', 'Dividendos'], 'Rendimentos');
      if (/pix recebido|ted recebida|reembolso|estorno/.test(normDesc)) return findBestAvailable(['Outros', 'Reembolso'], 'Outros');
      return findBestAvailable(['Salário', 'Outras Receitas', 'Outros'], 'Outros');
    }

    const rules = [
      { re: /uber|99app|99pop|cabify|posto|combustivel|shell|ipiranga|petrobras|estacionamento|sem parar|veloe|pedagio|metro|bilhete/, cats: ['Transporte', 'Uber & Transporte', 'Carro - Combustível'] },
      { re: /ifood|rappi|mercado|supermercado|carrefour|assai|atacadao|pao de acucar|padaria|restaurante|lanchonete|mc donalds|burger|cafe|starbucks|acougue|hortifruti/, cats: ['Alimentação', 'Mercado Básico Mensal', 'Lanches & Ifood', 'Passeios & Restaurantes'] },
      { re: /farmacia|drogaria|drogasil|droga raia|pacheco|hospital|clinica|medico|dentista|laboratorio|fleury|plano de saude|unimed|amil|sulamerica/, cats: ['Saúde'] },
      { re: /aluguel|condominio|iptu|energia|enel|cemig|copel|light|sabesp|agua|gas|comgas|internet|vivo|claro|tim|oi fibra/, cats: ['Moradia', 'Despesas Residenciais'] },
      { re: /netflix|spotify|amazon prime|disney|hbo|max|youtube|icloud|apple com bill|google one|chatgpt|openai|assinatura/, cats: ['Assinaturas'] },
      { re: /cinema|ingresso|teatro|show|viagem|hotel|airbnb|latam|gol|azul|booking|bar|lazer/, cats: ['Lazer'] },
      { re: /escola|faculdade|curso|udemy|alura|livro|livraria|educacao/, cats: ['Educação'] },
      { re: /pet|petz|cobasi|veterinario|racao/, cats: ['Pet'] },
      { re: /renner|riachuelo|zara|cea|nike|adidas|centauro|roupa|calcado|vestuario/, cats: ['Vestuário'] }
    ];

    for (const r of rules) {
      if (r.re.test(normDesc)) {
        return findBestAvailable(r.cats, r.cats[0]);
      }
    }

    return findBestAvailable(['Outros'], 'Outros');
  }

  function parseNumberFlexible(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
    let s = String(raw || '').trim();
    if (!s) return NaN;
    s = s.replace(/R\$/gi, '').replace(/\s+/g, '');
    const isNegParen = s.startsWith('(') && s.endsWith(')');
    if (isNegParen) s = '-' + s.slice(1, -1);

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
      // Decide pelo último separador decimal
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (hasComma) {
      s = s.replace(',', '.');
    }
    const num = parseFloat(s);
    return Number.isFinite(num) ? num : NaN;
  }

  function parseDateFlexible(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    // OFX YYYYMMDD...
    const ofxMatch = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (ofxMatch && !s.includes('-') && !s.includes('/')) {
      return `${ofxMatch[1]}-${ofxMatch[2]}-${ofxMatch[3]}`;
    }
    // ISO YYYY-MM-DD
    const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }
    // BR DD/MM/YYYY ou DD-MM-YYYY
    const brMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (brMatch) {
      let y = brMatch[3];
      if (y.length === 2) y = (parseInt(y, 10) >= 70 ? '19' : '20') + y;
      return `${y}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
    }
    return '';
  }

  function parseOFX(text) {
    const content = String(text || '');
    const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];
    const items = [];

    const readTag = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    };

    for (const block of blocks) {
      const dtRaw = readTag(block, 'DTPOSTED');
      const amtRaw = readTag(block, 'TRNAMT');
      const fitid = readTag(block, 'FITID');
      const name = readTag(block, 'NAME');
      const memo = readTag(block, 'MEMO');
      const trnType = readTag(block, 'TRNTYPE').toUpperCase();

      const date = parseDateFlexible(dtRaw);
      const signedAmount = parseNumberFlexible(amtRaw);
      if (!date || !Number.isFinite(signedAmount) || signedAmount === 0) continue;

      const description = [name, memo].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' - ') || trnType || 'Lançamento OFX';
      const type = signedAmount > 0 ? 'income' : 'expense';
      items.push({
        date,
        type,
        amount: round2(Math.abs(signedAmount)),
        signedAmount: round2(signedAmount),
        description,
        fitid: fitid || ''
      });
    }

    return items;
  }

  function splitCsvLine(line, delimiter) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseCSV(text) {
    const lines = String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return [];

    // Detecta delimitador predominante (; ou , ou tab)
    const sample = lines.slice(0, 5).join('\n');
    const semiCount = (sample.match(/;/g) || []).length;
    const commaCount = (sample.match(/,/g) || []).length;
    const tabCount = (sample.match(/\t/g) || []).length;
    const delimiter = tabCount > semiCount && tabCount > commaCount ? '\t' : (semiCount >= commaCount ? ';' : ',');

    // Encontra linha de cabeçalho
    let headerIdx = 0;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const norm = normalizeText(lines[i]);
      if ((norm.includes('data') || norm.includes('date')) && (norm.includes('valor') || norm.includes('amount') || norm.includes('debito') || norm.includes('credito'))) {
        headerIdx = i;
        break;
      }
    }

    const headers = splitCsvLine(lines[headerIdx], delimiter).map(h => normalizeText(h));
    const idxDate = headers.findIndex(h => /data|date|dt/.test(h));
    const idxDesc = headers.findIndex(h => /descr|historico|lancamento|memo|estabelecimento|titulo|title|nome/.test(h));
    const idxVal = headers.findIndex(h => /^valor|amount|quantia|vlr/.test(h));
    const idxDeb = headers.findIndex(h => /debito|saida/.test(h));
    const idxCred = headers.findIndex(h => /credito|entrada/.test(h));
    const idxType = headers.findIndex(h => /tipo|natureza|d c/.test(h));
    const idxId = headers.findIndex(h => /identificador|fitid|documento|id/.test(h));

    const items = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i], delimiter);
      if (cols.length < 2) continue;
      const date = parseDateFlexible(idxDate >= 0 ? cols[idxDate] : cols[0]);
      if (!date) continue;

      let signedAmount = NaN;
      if (idxVal >= 0 && cols[idxVal]) {
        signedAmount = parseNumberFlexible(cols[idxVal]);
        if (idxType >= 0 && cols[idxType]) {
          const tFlag = normalizeText(cols[idxType]);
          if ((tFlag === 'd' || tFlag.includes('debito') || tFlag.includes('saida') || tFlag.includes('despesa')) && signedAmount > 0) {
            signedAmount = -signedAmount;
          } else if ((tFlag === 'c' || tFlag.includes('credito') || tFlag.includes('entrada') || tFlag.includes('receita')) && signedAmount < 0) {
            signedAmount = Math.abs(signedAmount);
          }
        }
      } else if (idxDeb >= 0 || idxCred >= 0) {
        const deb = idxDeb >= 0 ? parseNumberFlexible(cols[idxDeb]) : NaN;
        const cred = idxCred >= 0 ? parseNumberFlexible(cols[idxCred]) : NaN;
        if (Number.isFinite(cred) && cred !== 0) signedAmount = Math.abs(cred);
        else if (Number.isFinite(deb) && deb !== 0) signedAmount = -Math.abs(deb);
      } else {
        // Fallback: tenta última coluna numérica
        for (let c = cols.length - 1; c >= 1; c--) {
          const parsed = parseNumberFlexible(cols[c]);
          if (Number.isFinite(parsed) && parsed !== 0) {
            signedAmount = parsed;
            break;
          }
        }
      }

      if (!Number.isFinite(signedAmount) || signedAmount === 0) continue;
      const description = (idxDesc >= 0 ? cols[idxDesc] : cols[1]) || 'Lançamento CSV';
      const fitid = idxId >= 0 ? (cols[idxId] || '') : '';

      items.push({
        date,
        type: signedAmount > 0 ? 'income' : 'expense',
        amount: round2(Math.abs(signedAmount)),
        signedAmount: round2(signedAmount),
        description: String(description).trim(),
        fitid: String(fitid).trim()
      });
    }

    return items;
  }

  function detectDuplicates(parsedItems, existingTransactions = [], accountId = '') {
    const existing = (existingTransactions || []).filter(t => !accountId || t.account_id === accountId);
    const fitidSet = new Set(existing.map(t => t.external_fitid || t.fitid).filter(Boolean));

    return (parsedItems || []).map(item => {
      let isDuplicate = false;
      let duplicateReason = '';

      if (item.fitid && fitidSet.has(item.fitid)) {
        isDuplicate = true;
        duplicateReason = 'ID bancário (FITID) já importado';
      } else {
        const itemNorm = normalizeText(item.description);
        const match = existing.find(ex => {
          if (ex.type !== item.type) return false;
          if (Math.abs((parseFloat(ex.amount) || 0) - item.amount) > 0.01) return false;
          const exDate = isoDateOnly(ex.date);
          if (!exDate) return false;
          const dDiff = Math.abs(
            (Date.parse(item.date + 'T00:00:00Z') - Date.parse(exDate + 'T00:00:00Z')) / 86400000
          );
          if (dDiff > 1) return false;
          const exNorm = normalizeText(ex.description);
          return !itemNorm || !exNorm || exNorm === itemNorm || exNorm.includes(itemNorm) || itemNorm.includes(exNorm);
        });
        if (match) {
          isDuplicate = true;
          duplicateReason = `Lançamento equivalente em ${isoDateOnly(match.date)}`;
        }
      }

      return { ...item, isDuplicate, duplicateReason };
    });
  }

  function parseBankStatement(fileContent, fileName = '', options = {}) {
    const raw = String(fileContent || '');
    const lowerName = String(fileName || '').toLowerCase();
    const isOFX = lowerName.endsWith('.ofx') || lowerName.endsWith('.qfx') || /<OFX>|<STMTTRN>/i.test(raw);

    const parsed = isOFX ? parseOFX(raw) : parseCSV(raw);
    const withDup = detectDuplicates(parsed, options.existingTransactions || [], options.accountId || '');
    const enriched = withDup.map((item, idx) => ({
      ...item,
      rowIndex: idx,
      suggestedCategory: suggestCategory(
        item.description,
        item.type,
        options.existingTransactions || [],
        options.categories || []
      ),
      selected: !item.isDuplicate
    }));

    return {
      format: isOFX ? 'OFX' : 'CSV',
      totalCount: enriched.length,
      duplicateCount: enriched.filter(i => i.isDuplicate).length,
      newCount: enriched.filter(i => !i.isDuplicate).length,
      items: enriched
    };
  }

  const api = {
    round2,
    isoDateOnly,
    addDaysISO,
    resolveInvoiceDueDate,
    computeAccountBalances,
    buildInvestmentPortfolioSeries,
    buildDailyCashflowProjection,
    computeRunningBalances,
    suggestCategory,
    parseOFX,
    parseCSV,
    detectDuplicates,
    parseBankStatement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.App = root.App || {};
    root.App.ledgerEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
