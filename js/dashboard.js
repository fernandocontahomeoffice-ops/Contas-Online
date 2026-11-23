// =====================================================================
// ARQUIVO: dashboard.js
// Visão Geral, Painel, Saldos, Projeção, Evolução Patrimonial, Tabela
// Dinâmica, Member Detail
// =====================================================================
var App = window.App || {};

// =======================================================================
// Visão Geral (Dashboard) – layout moderno
// =======================================================================
App.dashboard = {
  currentMonthStart: null,
  _ovDonut: null,
  _valoresOcultos: false,

  async refresh() {
    try {
      if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
      const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);

      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      if (!App.cache.accounts) App.cache.accounts = accounts;
      const members = App.cache.members || await App.db.getAll('members');
      if (!App.cache.members) App.cache.members = members;
      const cards = App.cache.creditCards || await App.db.getAll('creditCards');
      if (!App.cache.creditCards) App.cache.creditCards = cards;

      const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

      const nome = App.state.globalMemberFilter
        ? memberMap[App.state.globalMemberFilter] || 'você'
        : (members[0] ? members[0].name : 'você');
      document.getElementById('ovGreetingName').textContent = nome;

      const hoje = App.utils.todayISO();
      const allTx = await App.db.getAll('transactions');

      const activeAccounts = accounts.filter(a => !a.archived && !a.exclude_from_total);
      const saldoAtual = App.utils.calculateBalance(activeAccounts, allTx);
      document.getElementById('ovSaldoAtual').textContent = App.utils.formatCurrency(saldoAtual);

      let receitasMes = 0, despesasMes = 0;
      for (const t of allTx) {
        if (t.status !== 'confirmed' || t.ignore_from_total) continue;
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'income') {
          const d = t.date.slice(0, 10);
          if (d >= cycle.start.slice(0, 10) && d <= cycle.end.slice(0, 10)) receitasMes += amt;
        } else if (t.type === 'expense') {
          let dEff = t.date.slice(0, 10);
          if (t.credit_card_id) {
            const card = cards.find(c => c.id === t.credit_card_id);
            if (card) {
              try {
                const p = App.cardInvoice.getInvoicePeriodForDate(card, dEff);
                dEff = p.due.slice(0, 10);
              } catch (e) {}
            }
          }
          if (dEff >= cycle.start.slice(0, 10) && dEff <= cycle.end.slice(0, 10)) despesasMes += amt;
        }
      }
      document.getElementById('ovReceitasMes').textContent = App.utils.formatCurrency(receitasMes);
      document.getElementById('ovDespesasMes').textContent = App.utils.formatCurrency(despesasMes);

      const dHoje = new Date(hoje + 'T12:00:00');
      const dIni = new Date(dHoje); dIni.setDate(dIni.getDate() - 7);
      const dFim = new Date(dHoje); dFim.setDate(dFim.getDate() + 7);
      const iniStr = dIni.toISOString().slice(0, 10);
      const fimStr = dFim.toISOString().slice(0, 10);

      let vencRec = 0, vencDesp = 0, hoRec = 0, hoDesp = 0, futRec = 0, futDesp = 0;
      for (const t of allTx) {
        if (t.status !== 'pending') continue;
        if (t.ignore_from_total) continue;
        const d = t.date.slice(0, 10);
        if (d < iniStr || d > fimStr) continue;
        const amt = parseFloat(t.amount) || 0;
        const isEntrada = t.type === 'income' || t.type === 'refund';
        if (d < hoje) { if (isEntrada) vencRec += amt; else vencDesp += amt; }
        else if (d === hoje) { if (isEntrada) hoRec += amt; else hoDesp += amt; }
        else { if (isEntrada) futRec += amt; else futDesp += amt; }
      }
      document.getElementById('ovVencidosReceitas').textContent = App.utils.formatCurrency(vencRec);
      document.getElementById('ovVencidosDespesas').textContent = App.utils.formatCurrency(vencDesp);
      document.getElementById('ovHojeReceitas').textContent = App.utils.formatCurrency(hoRec);
      document.getElementById('ovHojeDespesas').textContent = App.utils.formatCurrency(hoDesp);
      document.getElementById('ovFuturoReceitas').textContent = App.utils.formatCurrency(futRec);
      document.getElementById('ovFuturoDespesas').textContent = App.utils.formatCurrency(futDesp);

      const subsEl = document.getElementById('ovGreetingSub');
      if (hoDesp === 0) {
        subsEl.innerHTML = '✓ Não há nada a pagar no dia de hoje.';
      } else {
        subsEl.innerHTML = `⚠️ ${App.utils.formatCurrency(hoDesp)} a pagar hoje.`;
      }

      this._renderAccountsList(accounts, allTx);
      await this._renderCategoryDonut(allTx, cards);
      await this._renderActivePlanningCard(cycle);
      this._renderCurrentInvoices(cards, allTx);
      this._aplicarVisibilidadeValores();

    } catch (e) {
      console.error('Erro ao carregar Visão Geral:', e);
      App.utils.showToast('Erro ao carregar Visão Geral.', 'error');
    }
  },

  _renderAccountsList(accounts, allTx) {
    const wrap = document.getElementById('ovAccountsList');
    if (!wrap) return;
    const ativas = accounts.filter(a => !a.archived && !a.exclude_from_total);
    if (ativas.length === 0) {
      wrap.innerHTML = '<div class="ov-empty-mini">Nenhuma conta ativa.</div>';
      return;
    }
    const balanceMap = {};
    ativas.forEach(a => balanceMap[a.id] = a.initial_balance || 0);
    const hoje = App.utils.todayISO();
    allTx.forEach(t => {
      if (t.status !== 'confirmed' || t.ignore_from_total) return;
      if (t.date.slice(0, 10) > hoje) return;
      if (t.invoice_locked || t.credit_card_id) return;
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
      else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
      else if (t.type === 'transfer' || t.type === 'contribution') {
        balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
        balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt;
      } else if (t.type === 'withdrawal') {
        balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
        balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt;
      }
    });
    wrap.innerHTML = ativas.map(a => {
      const logoHTML = App.bankLogos
        ? App.bankLogos.renderLogoHtml(a)
        : a.name.charAt(0).toUpperCase();
      const tipo = a.type === 'checking' ? 'Conta Corrente'
                 : a.type === 'savings' ? 'Poupança'
                 : a.type === 'investment' ? 'Investimento'
                 : a.type === 'wallet' ? 'Carteira'
                 : a.type === 'loan' ? 'Empréstimo' : 'Conta';
      const saldo = balanceMap[a.id] || 0;
      return `<div class="ov-account-row" onclick="App.accountDetail.load('${a.id}')">
        <div class="ov-account-logo">${logoHTML}</div>
        <div class="ov-account-info">
          <div class="ov-account-name">${a.name}</div>
          <div class="ov-account-type">${tipo}</div>
        </div>
        <div class="ov-account-balance ov-valor-sensivel">${App.utils.formatCurrency(saldo)}</div>
      </div>`;
    }).join('');
  },

  async _renderCategoryDonut(allTx, cards) {
    const empty = document.getElementById('ovExpensesEmpty');
    const chartWrap = document.getElementById('ovExpensesChart');
    const canvas = document.getElementById('ovCategoryDonut');
    const legend = document.getElementById('ovCategoryLegend');
    if (!empty || !chartWrap || !canvas) return;

    const hojeStr = App.utils.todayISO();
    const dHoje = new Date(hojeStr + 'T12:00:00');
    const dIni = new Date(dHoje); dIni.setDate(dIni.getDate() - 28);
    const iniStr = dIni.toISOString().slice(0, 10);

    const porCat = {};
    for (const t of allTx) {
      if (t.type !== 'expense' || t.ignore_from_total) continue;
      if (t.status !== 'confirmed' && t.status !== 'pending') continue;
      let dEff = t.date.slice(0, 10);
      if (t.credit_card_id) {
        const card = cards.find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const p = App.cardInvoice.getInvoicePeriodForDate(card, dEff);
            dEff = p.due.slice(0, 10);
          } catch (e) {}
        }
      }
      if (dEff < iniStr || dEff > hojeStr) continue;
      const cat = t.category || 'Outros';
      porCat[cat] = (porCat[cat] || 0) + (parseFloat(t.amount) || 0);
    }

    const entries = Object.entries(porCat).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      empty.style.display = 'flex';
      chartWrap.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    chartWrap.style.display = 'block';

    const total = entries.reduce((s, [, v]) => s + v, 0);
    const paleta = App.config.COLORS;

    if (this._ovDonut) this._ovDonut.destroy();
    this._ovDonut = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((_, i) => paleta[i % paleta.length]),
          borderColor: '#1f1f1f',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${App.utils.formatCurrency(ctx.raw)}` } }
        }
      }
    });

    legend.innerHTML = entries.slice(0, 6).map(([cat, val], i) => {
      const pct = ((val / total) * 100).toFixed(1);
      const cor = paleta[i % paleta.length];
      return `<div class="ov-legend-item">
        <span class="ov-legend-dot" style="background:${cor};"></span>
        <span class="ov-legend-name">${cat}</span>
        <span class="ov-legend-value ov-valor-sensivel">${App.utils.formatCurrency(val)}</span>
        <span class="ov-legend-pct">${pct}%</span>
      </div>`;
    }).join('');
  },

  _renderCurrentInvoices(cards, allTx) {
    const wrap = document.getElementById('ovInvoicesList');
    if (!wrap) return;
    const faturas = [];
    for (const card of cards) {
      if (card.card_type === 'prepaid') continue;
      let totalPendente = 0;
      let vencimento = null;
      const period = App.cardInvoice.getCurrentInvoicePeriod(card);
      for (const t of allTx) {
        if (t.credit_card_id !== card.id) continue;
        if (t.status !== 'pending' && t.status !== 'confirmed') continue;
        let dEff = t.date.slice(0, 10);
        try {
          const p = App.cardInvoice.getInvoicePeriodForDate(card, dEff);
          dEff = p.due.slice(0, 10);
        } catch (e) {}
        if (dEff >= period.start && dEff <= period.end) {
          vencimento = period.due;
          if (t.type === 'expense') totalPendente += parseFloat(t.amount) || 0;
          else if (t.type === 'refund') totalPendente -= parseFloat(t.amount) || 0;
        }
      }
      if (totalPendente > 0.005) {
        faturas.push({ card, total: totalPendente, vencimento });
      }
    }

    if (faturas.length === 0) {
      wrap.innerHTML = `<div class="ov-invoices-empty">
        <p>Não existem faturas abertas para exibir.</p>
        <button class="ov-empty-btn" onclick="App.ui.navigateTo('credit-cards')">→ Cartões de Crédito</button>
      </div>`;
      return;
    }

    wrap.innerHTML = faturas.map(f => {
      const logoHTML = App.bankLogos
        ? App.bankLogos.renderLogoHtml(f.card)
        : f.card.name.charAt(0).toUpperCase();
      return `<div class="ov-account-row" onclick="App.cardInvoice.open('${f.card.id}')">
        <div class="ov-account-logo">${logoHTML}</div>
        <div class="ov-account-info">
          <div class="ov-account-name">${f.card.name}</div>
          <div class="ov-account-type">Vence em ${App.utils.formatDate(f.vencimento)}</div>
        </div>
        <div class="ov-account-balance ov-red ov-valor-sensivel">${App.utils.formatCurrency(f.total)}</div>
      </div>`;
    }).join('');
  },

  async _renderActivePlanningCard(cycle) {
    const row = document.getElementById('ovPlanningRow');
    const card = document.getElementById('ovPlanningCard');
    if (!row || !card || !App.planning || typeof App.planning.getDashboardWidgetData !== 'function') return;

    try {
      const data = await App.planning.getDashboardWidgetData(cycle.startDate || cycle.start);
      if (!data) {
        row.style.display = 'none';
        return;
      }
      row.style.display = '';
      const esc = (v) => App.utils.escapeHtml(v == null ? '' : String(v));

      if (!data.hasActivePlan) {
        card.innerHTML = `
          <div class="ov-card-head">
            <span class="ov-card-title">Planejamento Financeiro <span class="ov-card-sub">${esc(data.targetLabel)}</span></span>
            <button type="button" class="ov-empty-btn" onclick="App.ui.navigateTo('planning')">→ Planos Orçamentários</button>
          </div>
          <div class="ov-plan-empty">
            <span>Nenhum plano em vigor para <strong>${esc(data.targetLabel)}</strong> (${data.totalPlans} plano(s) cadastrado(s)).</span>
            <button type="button" class="btn btn-primary btn-sm" onclick="App.ui.navigateTo('planning'); setTimeout(() => App.planning.openPlanModal(), 120);">+ Criar Plano</button>
          </div>
        `;
        return;
      }

      const { plan, evaluation } = data;
      const pct = evaluation.totalPlannedExpenses > 0 ? Math.min(evaluation.expensePct, 100) : 0;
      const over = evaluation.totalPlannedExpenses > 0 && evaluation.totalRealizedExpenses > evaluation.totalPlannedExpenses;

      card.innerHTML = `
        <div class="ov-card-head">
          <span class="ov-card-title">
            <span class="plan-status-dot tone-active" style="display:inline-block; vertical-align:middle; margin-right:6px;"></span>
            Planejamento em Vigor <span class="ov-card-sub">${esc(plan.periodLabel)}</span>
          </span>
          <div class="ov-plan-actions">
            <button type="button" class="ov-empty-btn" onclick="App.planning.openPlan('${esc(plan.id)}')">Ver Orçamento</button>
            <button type="button" class="ov-empty-btn" onclick="App.planning.openAcompanhamentoForPlan('${esc(plan.id)}')">📊 Acompanhamento</button>
          </div>
        </div>
        <div class="ov-plan-body">
          <div class="ov-plan-info">
            <div class="ov-plan-name">${esc(plan.nome)}</div>
            <div class="ov-plan-meta">
              Referência: <strong>${esc(data.targetLabel)}</strong> • ${evaluation.budgetedCount} categoria(s) planejada(s)
              ${evaluation.overBudgetCategories.length > 0 ? ` • <span class="planning-over">${evaluation.overBudgetCategories.length} estourada(s)</span>` : ''}
            </div>
          </div>
          <div class="ov-plan-metrics">
            <div class="ov-plan-values tabular-nums ov-valor-sensivel">
              <strong class="${over ? 'planning-over' : ''}">${App.utils.formatCurrency(evaluation.totalRealizedExpenses)}</strong>
              <span>de ${App.utils.formatCurrency(evaluation.totalPlannedExpenses)} (${evaluation.expensePct}%)</span>
            </div>
            <div class="plan-status-bar"><div class="plan-status-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div>
          </div>
        </div>
      `;
    } catch (e) {
      row.style.display = 'none';
    }
  },

  _aplicarVisibilidadeValores() {
    document.querySelectorAll('.ov-valor-sensivel').forEach(el => {
      el.style.filter = this._valoresOcultos ? 'blur(5px)' : '';
      el.style.userSelect = this._valoresOcultos ? 'none' : '';
    });
  },

  toggleValores() {
    this._valoresOcultos = !this._valoresOcultos;
    this._aplicarVisibilidadeValores();
  },

  prevMonth() {
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() - 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    this.refresh();
  },
  nextMonth() {
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() + 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    this.refresh();
  },
  gotoMonth() {
    const month = document.getElementById('dashboardMonthPicker')?.value;
    if (month) {
      const [y, m] = month.split('-');
      this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate;
      this.refresh();
    }
  },
  filterTransactions(type, sub = '') {
    document.getElementById('filterType').value = type;
    document.getElementById('filterAccount').value = 'all';
    document.getElementById('filterCreditCard').value = 'all';
    document.getElementById('filterTag').value = 'all';
    document.getElementById('searchTransactions').value = '';
    document.getElementById('periodPreset').value = '';
    App.transactions.currentSubFilter = sub;
    App.ui.navigateTo('transactions');
    App.transactions.load();
  },
  async openCalendar() {
    await App.calendar.load();
    App.ui.openModal('modalCalendar');
  },
  enableCardDragDrop() {},
  getDragAfterElement() { return null; },
  saveCardsOrder() {},
  loadCardsOrder() {}
};

// =======================================================================
// Member Detail – otimizado
// =======================================================================
App.memberDetail = {
  currentMemberId: null,
  _pies: {},

  async load(memberId) {
    this.currentMemberId = memberId;
    App.ui.navigateTo('member-detail');
    await this.render();
  },

  async render() {
    try {
      const member = await App.db.getById('members', this.currentMemberId);
      if (!member) return;

      const cycle = App.utils.currentMonth();
      const cycleTxAll = await App.db.getTransactionsInRange(cycle.start, cycle.end, { memberId: this.currentMemberId });
      const memberTx = cycleTxAll.filter(t => t.status === 'confirmed');

      const incomeCycle = memberTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
      const expenseCycle = memberTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);

      const fiveYearsAgo = App.utils.addMonths(App.utils.todayISO(), -60);
      const allEffective = await App.db.getTransactionsInRange(fiveYearsAgo, App.utils.todayISO(), { memberId: this.currentMemberId, status: 'confirmed' });
      const totalIncome = allEffective.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
      const totalExpense = allEffective.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
      const balance = totalIncome - totalExpense;

      let html = `
        <div class="cards-row">
          <div class="card"><div class="card-label">👤 Membro</div><div class="card-value">${member.name}</div></div>
          <div class="card"><div class="card-label">📥 Receitas Totais</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(totalIncome)}</div></div>
          <div class="card"><div class="card-label">📤 Despesas Totais</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(totalExpense)}</div></div>
          <div class="card"><div class="card-label">⚖️ Saldo</div><div class="card-value" style="color:${balance >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(balance)}</div></div>
        </div>
        <div class="chart-container">
          <h3>🌊 Fluxo do Ciclo Atual (${cycle.refMonth})</h3>
          <div class="waterfall-row">📥 Receitas <div class="waterfall-bar" style="width:${(incomeCycle / Math.max(incomeCycle, 1)) * 100}%;background:#4CAF50;"></div> +${App.utils.formatCurrency(incomeCycle)}</div>
          <div class="waterfall-row">📤 Despesas <div class="waterfall-bar" style="width:${(expenseCycle / Math.max(expenseCycle, 1)) * 100}%;background:#c62828;"></div> -${App.utils.formatCurrency(expenseCycle)}</div>
          <div class="waterfall-row">⚖️ Saldo do ciclo <div class="waterfall-bar" style="width:${Math.abs(incomeCycle - expenseCycle) / Math.max(1, Math.abs(incomeCycle - expenseCycle)) * 100}%;background:${incomeCycle - expenseCycle >= 0 ? '#4CAF50' : '#c62828'};"></div> ${App.utils.formatCurrency(incomeCycle - expenseCycle)}</div>
        </div>
        <div class="chart-container" style="display:flex; gap:20px; flex-wrap:wrap;">
          <div style="flex:1;min-width:300px;"><h3>📊 Participação Despesas</h3><div style="max-width:250px;margin:0 auto;"><canvas id="memberPieExp"></canvas></div></div>
          <div style="flex:1;min-width:300px;"><h3>📊 Participação Receitas</h3><div style="max-width:250px;margin:0 auto;"><canvas id="memberPieInc"></canvas></div></div>
        </div>
        <div class="chart-container">
          <h3>📈 Evolução Mensal (últimos 12 ciclos)</h3>
          <div style="height:200px;"><canvas id="memberBarChart"></canvas></div>
        </div>
        <div class="chart-container" style="margin-top:20px;">
          <h3>🕐 Últimas Transações</h3>
          <div class="table-container" id="memberRecent"></div>
        </div>
      `;
      document.getElementById('memberDetailContent').innerHTML = html;

      await new Promise(resolve => setTimeout(resolve, 50));
      await this.renderPies(memberTx, member.name);
      this.renderBarEvolution(memberTx);

      const recent = [...memberTx].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6);
      const recentTable = document.getElementById('memberRecent');
      if (recentTable) {
        recentTable.innerHTML = recent.length ?
          `<table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th class="text-right">Valor</th></tr></thead><tbody>
            ${recent.map(t => {
              const sign = t.type === 'income' ? '+' : '-';
              return `<tr><td>${App.utils.formatDateTime(t.date)}</td><td>${t.type}</td><td>${t.description || ''}</td><td class="text-right">${sign} ${App.utils.formatCurrency(t.amount)}</td></tr>`;
            }).join('')}
          </tbody></table>` : '<p>Nenhuma transação</p>';
      }
    } catch (e) {
      console.error(e);
      App.utils.showToast('Erro ao carregar detalhes do membro.', 'error');
    }
  },

  async renderPies(cycleTx, memberName) {
    const expByCat = {}; cycleTx.filter(t => t.type === 'expense').forEach(t => { expByCat[t.category] = (expByCat[t.category] || 0) + parseFloat(t.amount); });
    const incByCat = {}; cycleTx.filter(t => t.type === 'income').forEach(t => { incByCat[t.category] = (incByCat[t.category] || 0) + parseFloat(t.amount); });
    this.drawPie('memberPieExp', expByCat, 'Despesas');
    this.drawPie('memberPieInc', incByCat, 'Receitas');
  },

  drawPie(canvasId, data, title) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';

    if (this._pies[canvasId]) this._pies[canvasId].destroy();
    this._pies[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((_, i) => App.config.COLORS[i % App.config.COLORS.length]),
          borderColor: '#1f1f1f',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#b0b0b0', padding: 8, usePointStyle: true, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${App.utils.formatCurrency(ctx.raw)}` } }
        }
      }
    });
  },

  renderBarEvolution(memberTx) {
    const canvas = document.getElementById('memberBarChart');
    if (!canvas) return;
    const cycles = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      cycles.push(App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)));
    }
    Promise.all(cycles.map(c => App.db.getTransactionsInRange(c.start, c.end, { memberId: this.currentMemberId })))
      .then(results => {
        const data = results.map((tx, i) => {
          const periodTx = tx.filter(t => t.status === 'confirmed');
          return {
            label: cycles[i].monthName.slice(0, 3),
            income: periodTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0),
            expense: periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0)
          };
        });

        if (this._memberBarChart) this._memberBarChart.destroy();
        this._memberBarChart = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: data.map(d => d.label),
            datasets: [
              { label: 'Receitas', data: data.map(d => d.income), backgroundColor: '#a3e635', borderRadius: 6 },
              { label: 'Despesas', data: data.map(d => d.expense), backgroundColor: '#f87171', borderRadius: 6 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { ticks: { color: '#888' }, grid: { color: '#1f1f1f' } },
              y: { ticks: { color: '#888', callback: v => App.utils.formatCurrency(v) }, grid: { color: '#1f1f1f' } }
            },
            plugins: {
              legend: { labels: { color: '#b0b0b0' } },
              tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${App.utils.formatCurrency(ctx.raw)}` } }
            }
          }
        });
      });
  }
};

// =======================================================================
// Painel Financeiro – otimizado
// =======================================================================
App.panel = {
  currentMonthStart: null,
  memberFilter: null,
  _panelDonutChart: null,
  _panelBarChart: null,

  async refresh() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    document.getElementById('panelCycleLabel').textContent = `Ref. ${cycle.refMonth}`;
    document.querySelector('.today-date').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const monthInput = document.getElementById('panelMonthPicker');
    if (monthInput) { const d = new Date(this.currentMonthStart + 'T12:00:00'); monthInput.value = d.toISOString().slice(0, 7); }

    const ind = App.config.INDICATORS;
    document.getElementById('panelIndicatorCards').innerHTML = `
      <div class="card"><div class="card-label">SELIC</div><div class="card-value">${ind.selic.toFixed(2)}%</div><div class="card-sub">Taxa básica</div></div>
      <div class="card"><div class="card-label">IPCA</div><div class="card-value">${ind.ipca.toFixed(2)}%</div><div class="card-sub">Inflação oficial</div></div>
      <div class="card"><div class="card-label">CDI</div><div class="card-value">${ind.cdi.toFixed(2)}%</div><div class="card-sub">Referência de mercado</div></div>
      <div class="card"><div class="card-label">Poupança</div><div class="card-value">${ind.poupanca.toFixed(2)}%</div><div class="card-sub">Rendimento anual</div></div>
    `;

    if (this.memberFilter) {
      document.getElementById('panelMemberFilter').style.display = 'flex';
      const member = await App.db.getById('members', this.memberFilter);
      if (member) {
        document.getElementById('panelMemberDot').style.background = member.color;
        document.getElementById('panelMemberName').textContent = member.name;
      }
    } else {
      document.getElementById('panelMemberFilter').style.display = 'none';
    }

    await this.renderDonutChart();
    await this.renderResume(cycle);
    await this.renderEvolutionChart();

    const periodTx = await App.db.getTransactionsInRange(cycle.start, cycle.end);
    const filteredTx = App.utils.applyGlobalMemberFilter(periodTx);
    const installments = filteredTx.filter(t => t.installments > 1);

    // Agrupa por compra (descrição base + data de compra + categoria) para unificar
    // compras divididas entre cartões – assim uma mesma compra parcelada em 2 cartões
    // é contada como 1, e não como 2.
    const gruposInstallments = {};
    installments.forEach(t => {
      const descBase = (t.description || '').split(' - Parcela')[0].trim() || t.category || 'Parcela';
      const purchaseDate = t.purchase_date || t.date.slice(0, 10);
      const catKey = t.category || 'Outros';
      const key = `${descBase}__${purchaseDate}__${catKey}`;
      if (!gruposInstallments[key]) gruposInstallments[key] = [];
      gruposInstallments[key].push(t);
    });
    const activeInstallments = Object.keys(gruposInstallments).length;
    document.getElementById('quickInstallments').textContent = activeInstallments;

    const goals = await App.db.getAll('goals');
    const achieved = goals.filter(g => (g.saved || 0) >= g.target_amount).length;
    document.getElementById('quickGoals').textContent = `${achieved}/${goals.length}`;

    const templates = await App.db.getAll('transactionTemplates');
    document.getElementById('quickTemplates').textContent = templates.length;

    if (App.achievements && App.achievements.list) {
      const achievementList = App.achievements.list;
      const unlocked = (await Promise.all(achievementList.map(a => a.check()))).filter(Boolean).length;
      document.getElementById('quickAchievements').textContent = `${unlocked}/${achievementList.length}`;
    }
  },

  setMemberFilter(memberId) {
    App.state.globalMemberFilter = memberId;
    this.memberFilter = memberId;
    this.refresh();
    App.dashboard.refresh();
    App.transactions.load();
    if (App.analytics) App.analytics.refresh();
    if (App.saldos) App.saldos.load();
    if (App.planning && App.planning.refreshIfActive) App.planning.refreshIfActive();
  },
  clearMemberFilter() {
    App.state.globalMemberFilter = null;
    this.memberFilter = null;
    this.refresh();
    App.dashboard.refresh();
    App.transactions.load();
    if (App.analytics) App.analytics.refresh();
    if (App.saldos) App.saldos.load();
    if (App.planning && App.planning.refreshIfActive) App.planning.refreshIfActive();
  },

  async renderDonutChart() {
    const canvas = document.getElementById('panelDonutChart');
    const invs = await App.db.getAll('investments');
    const groups = {};
    invs.forEach(i => { const t = i.type || 'Outros'; groups[t] = (groups[t] || 0) + (parseFloat(i.current_value) || 0); });
    const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';

    if (this._panelDonutChart) this._panelDonutChart.destroy();
    this._panelDonutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((_, i) => App.config.COLORS[i % App.config.COLORS.length]),
          borderColor: '#1f1f1f',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#b0b0b0', padding: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${App.utils.formatCurrency(ctx.raw)}` } },
          datalabels: {
            color: '#fff',
            formatter: (value, context) => {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((value / total) * 100).toFixed(0);
              return pct > 5 ? pct + '%' : '';
            },
            font: { weight: 'bold', size: 10 }
          }
        }
      },
      plugins: (App.utils.registerChartDataLabelsOnce(), App.utils.getChartDataLabelsPlugin())
    });
  },

  showProjection() { App.ui.navigateTo('projection'); },

  async renderResume(cycle) {
    const container = document.getElementById('panelResume');
    const periodTxRaw = await App.db.getTransactionsInRange(cycle.start, cycle.end);
    let periodTx = App.utils.applyGlobalMemberFilter(periodTxRaw);
    if (this.memberFilter) periodTx = periodTx.filter(t => t.member_id === this.memberFilter);
    const income = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
    let expense = 0;
    const cards = App.cache.creditCards || await App.db.getAll('creditCards');
    for (const t of periodTx) {
      if (t.type !== 'expense' || t.ignore_from_total) continue;
      let effectiveDate = t.date.slice(0,10);
      if (t.credit_card_id) {
        const card = cards.find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
            effectiveDate = period.due.slice(0,10);
          } catch (e) {}
        }
      }
      if (effectiveDate >= cycle.start && effectiveDate <= cycle.end) {
        expense += parseFloat(t.amount);
      }
    }
    const contribution = periodTx.filter(t => t.type === 'contribution').reduce((s, t) => s + parseFloat(t.amount), 0);
    const withdrawal = periodTx.filter(t => t.type === 'withdrawal').reduce((s, t) => s + parseFloat(t.amount), 0);
          const patItems = await App.db.getAll('patrimony');
      const assets = patItems.filter(p => p.type === 'asset').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
      const liabilities = patItems.filter(p => p.type === 'liability').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
      const invs = await App.db.getAll('investments');
      const totalInvestments = invs.reduce((s, inv) => s + (parseFloat(inv.current_value) || 0), 0);
      const cats = App.cache.categories || await App.db.getAll('categories');
      if (!App.cache.categories) App.cache.categories = cats;
      const livingExpenses = periodTx.filter(t => t.type === 'expense').reduce((s, t) => {
        const cat = cats.find(c => c.name === t.category);
        const cls = t.classification || cat?.classification || 'necessary';
        return (cls === 'essential' || cls === 'necessary') ? s + parseFloat(t.amount) : s;
      }, 0);

      container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;">
          <div>📥 Receitas: <strong style="color:#2e7d32;">+${App.utils.formatCurrency(income)}</strong></div>
          <div>📤 Despesas: <strong style="color:#c62828;">-${App.utils.formatCurrency(expense)}</strong></div>
          <div>💸 Aportes: <strong style="color:#c62828;">-${App.utils.formatCurrency(contribution)}</strong></div>
          <div>💰 Resgates: <strong style="color:#2e7d32;">+${App.utils.formatCurrency(withdrawal)}</strong></div>
          <div>⚖️ Balanço: <strong style="color:${(income - expense) >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(income - expense)}</strong></div>
          <div>📈 Investimentos: <strong>${App.utils.formatCurrency(totalInvestments)}</strong></div>
          <div>🏠 Patrimônio Líquido: <strong>${App.utils.formatCurrency(assets - liabilities + totalInvestments)}</strong></div>
          <div>🧾 Custo de Vida: <strong style="color:#ffa502;">${App.utils.formatCurrency(livingExpenses)}</strong></div>
        </div>
      `;
  },

  async renderEvolutionChart() {
    const canvas = document.getElementById('panelBarChart');
    if (!canvas) return;
    const cycles = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      cycles.push(App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)));
    }
    const data = [];
    for (const c of cycles) {
      const tx = await App.db.getTransactionsInRange(c.start, c.end, { memberId: App.state.globalMemberFilter || null, status: 'confirmed' });
      data.push({
        label: c.monthName.slice(0, 3),
        income: tx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0),
        expense: tx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0)
      });
    }
    const trendArrows = data.map((d, i) => {
      if (i === 0) return '';
      const prev = data[i-1];
      const currBalance = d.income - d.expense;
      const prevBalance = prev.income - prev.expense;
      return currBalance > prevBalance ? ' ▲' : currBalance < prevBalance ? ' ▼' : ' →';
    });

    if (this._panelBarChart) this._panelBarChart.destroy();
    this._panelBarChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map((d, i) => d.label + trendArrows[i]),
        datasets: [
          { label: 'Receitas', data: data.map(d => d.income), backgroundColor: '#a3e635', borderRadius: 6 },
          { label: 'Despesas', data: data.map(d => d.expense), backgroundColor: '#f87171', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: '#1f1f1f' } },
          y: { ticks: { color: '#888', callback: v => App.utils.formatCurrency(v) }, grid: { color: '#1f1f1f' } }
        },
        plugins: {
          legend: { labels: { color: '#b0b0b0' } }
        }
      }
    });
  },

  prevMonth() { const d = new Date(this.currentMonthStart + 'T12:00:00'); d.setMonth(d.getMonth() - 1); this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate; this.refresh(); },
  nextMonth() { const d = new Date(this.currentMonthStart + 'T12:00:00'); d.setMonth(d.getMonth() + 1); this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate; this.refresh(); },
  gotoMonth() { const month = document.getElementById('panelMonthPicker')?.value; if (month) { const [y, m] = month.split('-');this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate; this.refresh(); } },
  openIndicatorEditor() {
    document.getElementById('editSelic').value = App.config.INDICATORS.selic;
    document.getElementById('editIpca').value = App.config.INDICATORS.ipca;
    document.getElementById('editCdi').value = App.config.INDICATORS.cdi;
    document.getElementById('editPoupanca').value = App.config.INDICATORS.poupanca;
    App.ui.openModal('modalIndicatorEditor');
  },
  async saveIndicators() {
    const selic = parseFloat(document.getElementById('editSelic').value);
    const ipca = parseFloat(document.getElementById('editIpca').value);
    const cdi = parseFloat(document.getElementById('editCdi').value);
    const poupanca = parseFloat(document.getElementById('editPoupanca').value);
    if (isNaN(selic) || isNaN(ipca) || isNaN(cdi) || isNaN(poupanca)) { App.utils.showToast('Valores inválidos', 'error'); return; }

    // Salva os valores atuais
    App.config.INDICATORS = { selic, ipca, cdi, poupanca };
    localStorage.setItem('app_indicators', JSON.stringify(App.config.INDICATORS));

    // Grava no histórico (IndexedDB)
    try {
      const historico = {
        id: App.utils.generateId(),
        date: App.utils.todayISO(),
        selic,
        ipca,
        cdi,
        poupanca
      };
      await App.db.put('indicatorHistory', historico);
    } catch (e) {
      console.error('Erro ao salvar histórico de indicadores:', e);
    }

    App.ui.closeModal('modalIndicatorEditor');
    this.refresh();
    App.utils.showToast('Indicadores atualizados!');
  },

  async showIndicatorHistory() {
    try {
      const historico = await App.db.getAll('indicatorHistory');
      if (!historico.length) {
        App.utils.showToast('Nenhum histórico de indicadores.', 'info');
        return;
      }

      // Ordena do mais recente para o mais antigo
      historico.sort((a, b) => b.date.localeCompare(a.date));

      let html = `
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>SELIC</th>
                <th>IPCA</th>
                <th>CDI</th>
                <th>Poupança</th>
              </tr>
            </thead>
            <tbody>
      `;
      historico.forEach(h => {
        // Extrai apenas o ano da data (formato YYYY-MM-DD)
        const ano = h.date ? h.date.slice(0, 4) : '-';
        html += `
          <tr>
            <td>${ano}</td>
            <td>${h.selic.toFixed(2)}%</td>
            <td>${h.ipca.toFixed(2)}%</td>
            <td>${h.cdi.toFixed(2)}%</td>
            <td>${h.poupanca.toFixed(2)}%</td>
          </tr>
        `;
      });
      html += `
            </tbody>
          </table>
        </div>
      `;

      // Reutiliza o modal de edição para exibir o histórico
      const modal = document.getElementById('modalIndicatorEditor');
      if (modal) {
        // Guarda o conteúdo original do modal para restaurar depois
        if (!this._modalOriginalContent) {
          this._modalOriginalContent = modal.innerHTML;
        }
        modal.innerHTML = `
          <button class="close-modal" onclick="App.panel.closeIndicatorHistory()">✕</button>
          <h2>Histórico de Indicadores</h2>
          ${html}
          <div class="modal-actions">
            <button class="btn btn-primary" onclick="App.panel.closeIndicatorHistory()">Voltar</button>
          </div>
        `;
        App.ui.openModal('modalIndicatorEditor');
      }
    } catch (e) {
      console.error('Erro ao exibir histórico de indicadores:', e);
      App.utils.showToast('Erro ao carregar histórico.', 'error');
    }
  },

  closeIndicatorHistory() {
    const modal = document.getElementById('modalIndicatorEditor');
    if (modal && this._modalOriginalContent) {
      modal.innerHTML = this._modalOriginalContent;
      this._modalOriginalContent = null;
    }
    App.ui.closeModal('modalIndicatorEditor');
    this.refresh();
  }
};


// =======================================================================
// Saldos – otimizado (com cache totalBalance) + UI moderna
// =======================================================================
App.saldos = {
  _sparklineChart: null,
  _projectionChart: null,
  _projectionDays: 30,
  _memberFilter: '',
  _lastSnapshot: null,

  _isLightMode() {
    return document.body.classList.contains('light-mode');
  },

  _activeMemberId() {
    return this._memberFilter || App.state.globalMemberFilter || null;
  },

  async computeBalanceSnapshot(options = {}) {
    const showArchived = options.includeArchived ?? (document.getElementById('showArchivedAccounts')?.checked || false);
    const memberId = options.memberId !== undefined ? options.memberId : this._activeMemberId();
    const today = options.asOfDate || App.utils.todayISO();

    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    const creditCards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = creditCards;
    const invs = await App.db.getAll('investments');
    const allTx = await App.db.getAll('transactions');

    const snapshot = App.ledgerEngine.computeAccountBalances(accounts, allTx, {
      asOfDate: today,
      includeArchived: showArchived,
      memberId,
      investments: invs,
      creditCards,
      getInvoicePeriodFn: (card, dateStr) => App.cardInvoice.getInvoicePeriodForDate(card, dateStr)
    });

    App.cache.totalBalance = snapshot.totalBalance;
    return { snapshot, accounts, creditCards, invs, allTx, today, memberId, showArchived };
  },

  async getTotalBalance(memberId = undefined) {
    const { snapshot } = await this.computeBalanceSnapshot({ memberId, includeArchived: false });
    return snapshot.totalBalance;
  },

  onMemberFilterChange(val) {
    this._memberFilter = val || '';
    this.load();
  },

  setProjectionDays(days) {
    this._projectionDays = Number(days) || 30;
    this.load();
  },

  async load() {
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;
    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

    // Popula seletor de titular no cabeçalho de Saldos
    const memberSel = document.getElementById('saldosMemberFilter');
    if (memberSel) {
      const currentVal = this._memberFilter || App.state.globalMemberFilter || '';
      memberSel.innerHTML = '<option value="">Todos os titulares</option>' +
        members.map(m => `<option value="${App.math.escapeHtml(m.id)}">${App.math.escapeHtml(m.name)}</option>`).join('');
      memberSel.value = currentVal;
    }

    const { snapshot, accounts, creditCards, invs, allTx, today, memberId, showArchived } = await this.computeBalanceSnapshot();
    this._lastSnapshot = snapshot;

    const activeAccounts = accounts.filter(a => (!a.archived || showArchived) && (!memberId || !a.member_id || a.member_id === memberId));
    const totalBalance = snapshot.totalBalance;
    const liq = snapshot.liquidity;

    // Variação mensal (compara com o último dia do mês anterior usando o mesmo motor sem corte de 5 anos)
    const todayDate = new Date(today + 'T12:00:00');
    const prevMonthDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0).toISOString().slice(0, 10);
    const prevSnapshot = App.ledgerEngine.computeAccountBalances(accounts, allTx, {
      asOfDate: prevMonthDate,
      includeArchived: showArchived,
      memberId,
      investments: invs,
      creditCards,
      getInvoicePeriodFn: (card, dateStr) => App.cardInvoice.getInvoicePeriodForDate(card, dateStr)
    });
    const prevTotalBalance = prevSnapshot.totalBalance;
    const totalVariation = prevTotalBalance !== 0 ? ((totalBalance - prevTotalBalance) / Math.abs(prevTotalBalance) * 100) : 0;

    // Projeção diária de fluxo de caixa (30/60/90d) + alertas por conta
    const projection = App.ledgerEngine.buildDailyCashflowProjection(accounts, allTx, creditCards, {
      asOfDate: today,
      days: this._projectionDays,
      memberId,
      getInvoicePeriodFn: (card, dateStr) => App.cardInvoice.getInvoicePeriodForDate(card, dateStr)
    });

    // Próximas transações pendentes (agrupando cartão de crédito)
    const futureStr = App.ledgerEngine.addDaysISO(today, this._projectionDays);
    const upcomingAll = allTx.filter(t => {
      if (memberId && t.member_id && t.member_id !== memberId) return false;
      const d = (t.date || '').slice(0, 10);
      return t.status === 'pending' && !t.ignore_from_total && d >= today && d <= futureStr;
    });

    const cardGroups = {};
    const nonCardTx = [];
    for (const t of upcomingAll) {
      if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
        const card = creditCards.find(c => c.id === t.credit_card_id);
        if (!card || card.card_type === 'prepaid') continue;
        const dueDate = App.ledgerEngine.resolveInvoiceDueDate(card, t.date, (c, ds) => App.cardInvoice.getInvoicePeriodForDate(c, ds));
        if (dueDate < today || dueDate > futureStr) continue;
        const dueMonth = dueDate.slice(0, 7);
        const key = `${t.credit_card_id}|${dueMonth}`;
        if (!cardGroups[key]) {
          cardGroups[key] = { cardId: t.credit_card_id, cardName: card.name, dueDate, total: 0, count: 0 };
        }
        const amt = parseFloat(t.amount) || 0;
        cardGroups[key].total += (t.type === 'expense') ? amt : -amt;
        cardGroups[key].count++;
      } else {
        nonCardTx.push(t);
      }
    }

    const upcomingItems = [
      ...Object.values(cardGroups).map(g => ({ date: g.dueDate, isGroup: true, group: g })),
      ...nonCardTx.map(t => ({ date: (t.date || '').slice(0, 10), isGroup: false, tx: t }))
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

    const visibleInvs = invs.filter(i => {
      if (!memberId) return true;
      const acc = accounts.find(a => a.id === i.account_id);
      return !acc || !acc.member_id || acc.member_id === memberId;
    });
    const totalInv = visibleInvs.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0);
    const totalInvested = visibleInvs.reduce((s, i) => s + (parseFloat(i.amount_invested ?? i.invested_value ?? i.initial_value ?? 0) || 0), 0);
    const rendimentoInv = totalInv - totalInvested;
    const rendimentoPct = totalInvested > 0 ? (rendimentoInv / totalInvested * 100) : 0;

    let favoritos = [];
    try { favoritos = JSON.parse(localStorage.getItem('saldos_favoritos') || '[]'); } catch (e) { favoritos = []; }

    const container = document.getElementById('saldosPorTipo');
    if (!container) return;
    const esc = App.math.escapeHtml;
    let html = '';

    // 1. Hero card – Saldo Total + Visão Estratificada de Liquidez
    const variacaoClass = totalVariation >= 0 ? 'up' : 'down';
    const variacaoArrow = totalVariation >= 0 ? '▲' : '▼';
    html += `
      <div class="saldo-hero" onclick="App.saldos.showBalanceDetail()" id="saldoTotalCard">
        <div class="saldo-hero-label">
          <span class="hero-icon">💰</span> Saldo Total Consolidado
        </div>
        <div class="saldo-hero-value" id="saldoTotalValue">${App.utils.formatCurrency(totalBalance)}</div>
        <div class="saldo-hero-sub">
          <span class="variacao ${variacaoClass}">${variacaoArrow} ${Math.abs(totalVariation).toFixed(1)}%</span> vs mês anterior
          <span aria-hidden="true">·</span>
          <span>Clique para auditoria por conta</span>
        </div>
        <div class="saldo-hero-eye" onclick="event.stopPropagation();App.ui.toggleSaldoVisibility('saldoTotalValue')" title="Mostrar/Ocultar">👁️</div>
      </div>

      <div class="saldos-liquidity-grid">
        <div class="saldos-liq-card">
          <div class="saldos-liq-label">Caixa Disponível Hoje</div>
          <div class="saldos-liq-value">${App.utils.formatCurrency(liq.caixaDisponivel)}</div>
          <div class="saldos-liq-sub">Contas correntes e carteiras</div>
        </div>
        <div class="saldos-liq-card">
          <div class="saldos-liq-label">Reserva / Poupança</div>
          <div class="saldos-liq-value">${App.utils.formatCurrency(liq.reservaLiquidez)}</div>
          <div class="saldos-liq-sub">Liquidez imediata reservada</div>
        </div>
        <div class="saldos-liq-card">
          <div class="saldos-liq-label">Compromissos (30 dias)</div>
          <div class="saldos-liq-value ${liq.compromissos30d > 0 ? 'is-danger' : ''}">${App.utils.formatCurrency(liq.compromissos30d)}</div>
          <div class="saldos-liq-sub">Faturas e despesas pendentes</div>
        </div>
        <div class="saldos-liq-card">
          <div class="saldos-liq-label">Saldo Livre Real</div>
          <div class="saldos-liq-value ${liq.saldoLivreReal >= 0 ? 'is-positive' : 'is-danger'}">${App.utils.formatCurrency(liq.saldoLivreReal)}</div>
          <div class="saldos-liq-sub">Caixa + Reserva − Compromissos</div>
        </div>
      </div>`;

    // 2. Fluxo de Caixa Projetado (Gráfico 30/60/90d + Alertas de Conta Negativa + Próximos Vencimentos)
    const alertsHtml = projection.negativeAlerts.length
      ? `<div class="saldos-neg-alert">
          <strong>⚠️ Alerta de caixa negativo projetado:</strong>
          ${projection.negativeAlerts.map(al =>
            `<span><strong>${esc(al.accountName)}</strong> fica negativa em ${App.utils.formatDate(al.firstNegativeDate)} (mínimo de ${App.utils.formatCurrency(al.minBalance)})</span>`
          ).join(' · ')}
        </div>`
      : '';

    html += `
      <div class="saldos-projection-card">
        <div class="saldos-proj-header">
          <div>
            <div class="saldos-proj-title">📅 Fluxo de Caixa Projetado (${this._projectionDays} dias)</div>
            <div class="saldos-proj-sub">
              Saldo projetado ao final: <strong class="${projection.endBalance >= 0 ? 'is-positive' : 'is-danger'}">${App.utils.formatCurrency(projection.endBalance)}</strong>
              <span aria-hidden="true">·</span>
              Menor ponto: <strong>${App.utils.formatCurrency(projection.minTotal)}</strong> (${App.utils.formatDate(projection.minTotalDate)})
            </div>
          </div>
          <div class="saldos-proj-controls">
            <div class="saldos-seg-group">
              <button type="button" class="saldos-seg-btn ${this._projectionDays === 30 ? 'active' : ''}" onclick="App.saldos.setProjectionDays(30)">30d</button>
              <button type="button" class="saldos-seg-btn ${this._projectionDays === 60 ? 'active' : ''}" onclick="App.saldos.setProjectionDays(60)">60d</button>
              <button type="button" class="saldos-seg-btn ${this._projectionDays === 90 ? 'active' : ''}" onclick="App.saldos.setProjectionDays(90)">90d</button>
            </div>
            <button type="button" class="btn btn-sm btn-outline" onclick="App.saldos.showProjectedDetail(${this._projectionDays})">Ver itens futuros</button>
          </div>
        </div>
        ${alertsHtml}
        <div class="saldos-proj-chart-wrap">
          <canvas id="saldosProjectionChart"></canvas>
        </div>
        ${upcomingItems.length > 0 ? `
          <div class="saldos-upcoming-wrap">
            <div class="saldos-upcoming-title">Próximos compromissos e entradas (${upcomingItems.length})</div>
            <ul class="previsto-lista">
              ${upcomingItems.map(item => {
                if (item.isGroup) {
                  const g = item.group;
                  const sign = g.total >= 0 ? '−' : '+';
                  const colorClass = g.total >= 0 ? 'saida' : 'entrada';
                  return `<li class="previsto-item">
                    <span class="previsto-item-data">${App.utils.formatDate(g.dueDate)}</span>
                    <span class="previsto-item-desc">💳 Fatura ${esc(g.cardName)} (${g.count} compras)</span>
                    <span class="previsto-item-valor ${colorClass}">${sign} ${App.utils.formatCurrency(Math.abs(g.total))}</span>
                  </li>`;
                }
                const t = item.tx;
                const amt = parseFloat(t.amount) || 0;
                const isEntrada = t.type === 'income' || t.type === 'refund';
                return `<li class="previsto-item">
                  <span class="previsto-item-data">${App.utils.formatDate((t.date || '').slice(0, 10))}</span>
                  <span class="previsto-item-desc">${esc(t.description || t.category || 'Transação')}</span>
                  <span class="previsto-item-valor ${isEntrada ? 'entrada' : 'saida'}">${isEntrada ? '+' : '−'} ${App.utils.formatCurrency(amt)}</span>
                </li>`;
              }).join('')}
            </ul>
          </div>
        ` : `<p class="saldos-upcoming-empty">Nenhuma transação pendente prevista para os próximos ${this._projectionDays} dias.</p>`}
      </div>`;

    // 3. Seção de Investimentos com sparkline consolidado (sem serrilhado)
    if (visibleInvs.length > 0) {
      const rentClass = rendimentoInv >= 0 ? 'up' : 'down';
      const rentSinal = rendimentoInv >= 0 ? '+' : '';
      html += `<div class="investimentos-section">
        <div class="investimentos-sparkline-card" onclick="App.ui.navigateTo('investments')">
          <div class="sparkline-header">
            <div>
              <div class="sparkline-title">📈 Total em Investimentos</div>
              <div class="sparkline-value">${App.utils.formatCurrency(totalInv)}</div>
              <div class="sparkline-rentabilidade ${rentClass}">${rentSinal}${App.utils.formatCurrency(rendimentoInv)} (${rendimentoPct.toFixed(1)}%)</div>
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);">${visibleInvs.length} ativo(s) · Evolução consolidada</div>
          </div>
          <div class="sparkline-canvas">
            <canvas id="saldosSparklineChart" width="400" height="60"></canvas>
          </div>
        </div>
      </div>`;
    }

    // 4. Seções por tipo de conta
    const tipos = {
      checking: { nome: 'Contas Correntes', icon: '🏦', contas: [] },
      savings: { nome: 'Poupanças', icon: '💰', contas: [] },
      investment: { nome: 'Contas de Investimento', icon: '📈', contas: [] },
      wallet: { nome: 'Carteiras', icon: '👛', contas: [] },
      other: { nome: 'Outras Contas', icon: '📋', contas: [] },
      loan: { nome: 'Empréstimos', icon: '🤝', contas: [] }
    };
    activeAccounts.forEach(a => {
      const tipo = tipos[a.type] ? a.type : 'other';
      tipos[tipo].contas.push(a);
    });

    for (const [tipo, grupo] of Object.entries(tipos)) {
      if (grupo.contas.length === 0) continue;

      const grupoCaixaTotal = grupo.contas.reduce((s, a) => s + (snapshot.byAccount[a.id]?.balance || 0), 0);
      const grupoAtivosTotal = tipo === 'investment'
        ? grupo.contas.reduce((s, a) => s + (snapshot.byAccount[a.id]?.investmentAssets || 0), 0)
        : grupoCaixaTotal;

      const headerTotalHtml = tipo === 'investment'
        ? `Ativos: <strong>${App.utils.formatCurrency(grupoAtivosTotal)}</strong> <span aria-hidden="true">·</span> Caixa livre: <strong>${App.utils.formatCurrency(grupoCaixaTotal)}</strong>`
        : `Total: <strong>${App.utils.formatCurrency(grupoCaixaTotal)}</strong>`;

      const favoritas = grupo.contas.filter(a => favoritos.includes(a.id));
      const outras = grupo.contas.filter(a => !favoritos.includes(a.id));
      const ordenadas = [...favoritas, ...outras];

      html += `<div class="saldo-section">
        <div class="saldo-section-header">
          <span class="section-icon">${grupo.icon}</span>
          <span class="section-title">${grupo.nome}</span>
          <span class="section-badge">${grupo.contas.length} conta${grupo.contas.length > 1 ? 's' : ''}</span>
          <span class="saldo-section-total">${headerTotalHtml}</span>
        </div>
        <div class="saldo-grid">`;

      ordenadas.forEach(a => {
        const st = snapshot.byAccount[a.id] || { balance: 0, investmentAssets: 0, unreconciledCount: 0, lastReconciledDate: null };
        const prevSt = prevSnapshot.byAccount[a.id] || { balance: 0 };
        const bal = st.balance;
        const prevBal = prevSt.balance;
        const variacaoConta = prevBal !== 0 ? ((bal - prevBal) / Math.abs(prevBal) * 100) : 0;
        const valorExibido = a.type === 'investment' ? st.investmentAssets : bal;
        const baseForPct = a.type === 'investment' ? Math.max(grupoAtivosTotal, 1) : Math.max(Math.abs(totalBalance), 1);
        const pct = totalBalance !== 0 || a.type === 'investment' ? (Math.abs(valorExibido) / baseForPct * 100) : 0;
        const statusClass = valorExibido > 0 ? 'positivo' : valorExibido < 0 ? 'negativo' : 'zero';
        const isFavorito = favoritos.includes(a.id);
        const accountIconHtml = App.bankLogos
          ? App.bankLogos.renderLogoHtml(a, { fallbackIcon: grupo.icon })
          : grupo.icon;
        const varClass = variacaoConta >= 0 ? 'up' : 'down';
        const varArrow = variacaoConta >= 0 ? '▲' : '▼';

        const sublineInv = a.type === 'investment'
          ? `<div class="card-inv-cash">Caixa livre na corretora: <strong>${App.utils.formatCurrency(bal)}</strong></div>`
          : '';

        const recMeta = st.lastReconciledDate
          ? `<span class="card-reconcile-meta is-ok">✓ Conciliada em ${App.utils.formatDate(st.lastReconciledDate)}</span>`
          : (st.unreconciledCount > 0
            ? `<span class="card-reconcile-meta">${st.unreconciledCount} pendente(s) de conferência</span>`
            : `<span class="card-reconcile-meta">Sem pendências</span>`);

        html += `<div class="saldo-card ${statusClass}" onclick="App.accountDetail.load('${esc(a.id)}')">
          <div class="acoes-rapidas">
            <button class="acao-btn" onclick="event.stopPropagation();App.saldos.openReconcileModal('${esc(a.id)}')" title="Conferir / Conciliar saldo com o banco" aria-label="Conferir saldo de ${esc(a.name)}">⚖️</button>
            <button class="acao-btn" onclick="event.stopPropagation();App.ui.openTransactionModalWithType('transfer','${esc(a.id)}')" title="Transferir a partir desta conta" aria-label="Transferir de ${esc(a.name)}">💸</button>
            <button class="acao-btn" onclick="event.stopPropagation();App.accountDetail.load('${esc(a.id)}')" title="Ver detalhes da conta" aria-label="Detalhes de ${esc(a.name)}">📋</button>
            <button class="acao-btn" onclick="event.stopPropagation();App.saldos.toggleFavorito('${esc(a.id)}');" title="Favoritar" aria-label="Favoritar ${esc(a.name)}">${isFavorito ? '⭐' : '☆'}</button>
          </div>
          <div class="card-top">
            <div class="card-icon">${accountIconHtml}</div>
            <div class="card-info">
              <div class="card-name">${esc(a.name)}${a.archived ? ' <small>(Arquivada)</small>' : ''}</div>
              <div class="card-member">${esc(memberMap[a.member_id] || '')}</div>
            </div>
          </div>
          <div class="card-balance">${App.utils.formatCurrency(valorExibido)}</div>
          ${sublineInv}
          <div class="card-footer">
            <span class="variacao ${varClass}">${varArrow} ${Math.abs(variacaoConta).toFixed(1)}%</span>
            <span aria-hidden="true">·</span>
            <span>${pct.toFixed(1)}% ${a.type === 'investment' ? 'da carteira' : 'do total'}</span>
          </div>
          <div class="card-reconcile-row">${recMeta}</div>
          <div class="progresso-bar">
            <div class="progresso-fill" style="width:${Math.min(pct, 100)}%;background:${valorExibido >= 0 ? (this._isLightMode() ? '#0b5b43' : '#a3e635') : '#f87171'};"></div>
          </div>
        </div>`;
      });

      html += `</div></div>`;
    }

    container.innerHTML = html || '<div class="empty-state">🏦 Nenhuma conta ativa encontrada.</div>';

    setTimeout(() => {
      this.renderProjectionChart(projection);
      this.renderSparkline(visibleInvs);
    }, 60);
  },

  renderProjectionChart(projection) {
    const canvas = document.getElementById('saldosProjectionChart');
    if (!canvas || !projection || !projection.points?.length) return;
    if (this._projectionChart) {
      this._projectionChart.destroy();
      this._projectionChart = null;
    }

    const isLight = this._isLightMode();
    const textColor = isLight ? '#4b5563' : '#9ca3af';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.07)' : 'rgba(255, 255, 255, 0.06)';
    const lineColor = projection.minTotal < 0
      ? (isLight ? '#dc2626' : '#f87171')
      : (isLight ? '#0b5b43' : '#a3e635');
    const fillColor = projection.minTotal < 0
      ? (isLight ? 'rgba(220, 38, 38, 0.08)' : 'rgba(248, 113, 113, 0.12)')
      : (isLight ? 'rgba(11, 91, 67, 0.09)' : 'rgba(163, 230, 53, 0.12)');

    const labels = projection.points.map(p => {
      const [y, m, d] = p.date.split('-');
      return `${d}/${m}`;
    });
    const data = projection.points.map(p => p.balance);

    this._projectionChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Saldo Projetado',
          data,
          borderColor: lineColor,
          backgroundColor: fillColor,
          borderWidth: 2,
          pointRadius: projection.points.length <= 35 ? 2 : 0,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 280 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `Saldo projetado: ${App.utils.formatCurrency(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, maxTicksLimit: 8, font: { size: 11 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { size: 11 },
              callback: v => App.utils.formatCurrency(v)
            }
          }
        }
      }
    });
  },

  renderSparkline(invs) {
    const canvas = document.getElementById('saldosSparklineChart');
    if (!canvas) return;
    if (this._sparklineChart) {
      this._sparklineChart.destroy();
      this._sparklineChart = null;
    }

    App.db.getAll('investmentHistory').then(history => {
      const points = App.ledgerEngine.buildInvestmentPortfolioSeries(history, invs);
      if (!points.length) return;

      const labels = points.map(p => {
        const d = new Date(p.date + 'T12:00:00');
        return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      });
      const data = points.map(p => p.value);
      const isUp = data.length >= 2 ? data[data.length - 1] >= data[0] : true;
      const isLight = this._isLightMode();
      const lineColor = isUp ? (isLight ? '#0b5b43' : '#a3e635') : '#f87171';

      this._sparklineChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data,
            borderColor: lineColor,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
            fill: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 250 },
          plugins: { legend: { display: false }, datalabels: { display: false } },
          scales: { x: { display: false }, y: { display: false } }
        }
      });
    });
  },

  async openReconcileModal(accountId) {
    const { snapshot, accounts } = await this.computeBalanceSnapshot({ includeArchived: true });
    const acc = accounts.find(a => a.id === accountId);
    const st = snapshot.byAccount[accountId];
    if (!acc || !st) return;

    this._reconcileContext = { account: acc, stats: st };
    document.getElementById('reconcileAccId').value = acc.id;
    document.getElementById('reconcileAccountTitle').textContent = `⚖️ Conferir Saldo — ${acc.name}`;
    document.getElementById('reconcileAccountSubtitle').textContent = st.lastReconciledDate
      ? `Última conciliação em ${App.utils.formatDate(st.lastReconciledDate)} · ${st.unreconciledCount} lançamento(s) ainda não conciliado(s)`
      : `Esta conta possui ${st.unreconciledCount} lançamento(s) aguardando conferência.`;
    document.getElementById('reconcileAppBalance').textContent = App.utils.formatCurrency(st.balance);
    document.getElementById('reconcileConfirmedBalance').textContent = App.utils.formatCurrency(st.reconciledBalance);
    document.getElementById('reconcileBankBalance').value = st.balance.toFixed(2);
    document.getElementById('reconcileDate').value = App.utils.todayISO();
    document.getElementById('reconcileNote').value = `Ajuste de Conciliação (${acc.name})`;
    document.getElementById('reconcileMarkAllTx').checked = true;

    this.updateReconcileDiff();
    App.ui.openModal('modalReconcileAccount');
  },

  updateReconcileDiff() {
    if (!this._reconcileContext) return;
    const appBal = this._reconcileContext.stats.balance;
    const bankVal = parseFloat(document.getElementById('reconcileBankBalance').value);
    const box = document.getElementById('reconcileDiffBox');
    const noteGroup = document.getElementById('reconcileNoteGroup');
    const submitBtn = document.getElementById('reconcileSubmitBtn');
    if (!box) return;

    if (!Number.isFinite(bankVal)) {
      box.className = 'reconcile-diff-box';
      box.textContent = 'Informe o saldo atual exibido no extrato do banco.';
      return;
    }

    const diff = App.ledgerEngine.round2(bankVal - appBal);
    if (Math.abs(diff) < 0.01) {
      box.className = 'reconcile-diff-box is-match';
      box.innerHTML = '<strong>✓ Saldo batendo 100%!</strong> Nenhuma diferença encontrada. Ao confirmar, a conta será marcada como conciliada hoje.';
      if (noteGroup) noteGroup.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Marcar como Conciliada';
    } else {
      const tipo = diff > 0 ? 'Receita de ajuste (+)' : 'Despesa de ajuste (−)';
      box.className = 'reconcile-diff-box is-diff';
      box.innerHTML = `<strong>Diferença detectada: ${diff > 0 ? '+' : '−'} ${App.utils.formatCurrency(Math.abs(diff))}</strong><br><span>Ao confirmar, será criado um lançamento rastreável de <em>${tipo}</em> para igualar o saldo ao banco.</span>`;
      if (noteGroup) noteGroup.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Conciliar e Gerar Ajuste';
    }
  },

  async saveReconciliation(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    try {
      const accId = document.getElementById('reconcileAccId').value;
      const bankVal = parseFloat(document.getElementById('reconcileBankBalance').value);
      const recDate = document.getElementById('reconcileDate').value || App.utils.todayISO();
      const note = (document.getElementById('reconcileNote').value || 'Ajuste de Conciliação Bancária').trim();
      const markAllTx = document.getElementById('reconcileMarkAllTx').checked;

      if (!accId || !Number.isFinite(bankVal)) {
        App.utils.showToast('Informe um saldo bancário válido.', 'error');
        return false;
      }

      const { snapshot, accounts, allTx } = await this.computeBalanceSnapshot({ includeArchived: true, asOfDate: recDate });
      const acc = accounts.find(a => a.id === accId);
      const st = snapshot.byAccount[accId];
      if (!acc || !st) return false;

      const diff = App.ledgerEngine.round2(bankVal - st.balance);
      const members = App.cache.members || await App.db.getAll('members');
      const memName = members.find(m => m.id === acc.member_id)?.name || '';

      if (Math.abs(diff) >= 0.01) {
        const now = new Date();
        const hhmmss = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        await App.db.put('transactions', {
          id: App.utils.generateId(),
          type: diff > 0 ? 'income' : 'expense',
          amount: Math.abs(diff),
          category: 'Ajuste de Saldo',
          account_id: acc.id,
          account_name: acc.name,
          account_to_id: '',
          account_to_name: '',
          date: `${recDate}T${hhmmss}`,
          description: note,
          notes: `Conciliação bancária: saldo app ${App.utils.formatCurrency(st.balance)} → banco ${App.utils.formatCurrency(bankVal)}`,
          member_id: acc.member_id || '',
          member_name: memName,
          credit_card_id: null,
          installments: 1,
          installment_number: 1,
          installment_id: null,
          recurring: false,
          status: 'confirmed',
          reconciled: true,
          ignore_from_total: false,
          createdAt: now.toISOString(),
          position: Date.now()
        });
      }

      if (markAllTx) {
        const toMark = allTx.filter(t =>
          t.status === 'confirmed' &&
          !t.reconciled &&
          !t.credit_card_id &&
          !t.invoice_locked &&
          (t.date || '').slice(0, 10) <= recDate &&
          (t.account_id === acc.id || t.account_to_id === acc.id)
        );
        for (const tx of toMark) {
          tx.reconciled = true;
          await App.db.put('transactions', tx);
        }
      }

      acc.last_reconciled_at = recDate;
      acc.last_reconciled_balance = bankVal;
      await App.db.put('accounts', acc);

      App.cache.accounts = null;
      App.cache.totalBalance = null;
      App.transactions?.invalidateCache?.();
      App.ui.closeModal('modalReconcileAccount');
      App.utils.showToast(Math.abs(diff) >= 0.01 ? 'Conta conciliada com ajuste registrado!' : 'Conta conciliada com sucesso!');

      await this.load();
      if (App.ui.getCurrentPage && App.ui.getCurrentPage() === 'transactions') {
        await App.transactions.load();
      }
      App.dashboard?.refresh?.();
      App.panel?.refresh?.();
      return false;
    } catch (err) {
      console.error(err);
      App.utils.showToast('Erro ao conciliar conta.', 'error');
      return false;
    }
  },

  openProjectedTransactions() {
    document.getElementById('periodPreset').value = 'future';
    App.ui.navigateTo('transactions');
    App.transactions.load();
  },

  async showProjectedDetail(days = 30) {
    const hoje = App.utils.todayISO();
    const futureStr = App.ledgerEngine.addDaysISO(hoje, days);
    const memberId = this._activeMemberId();

    const allTx = await App.db.getAll('transactions');
    const allCards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = allCards;
    const cardMap = Object.fromEntries(allCards.map(c => [c.id, c]));

    const futuras = allTx.filter(t => {
      if (memberId && t.member_id && t.member_id !== memberId) return false;
      const d = (t.date || '').slice(0, 10);
      if (d < hoje || d > futureStr) return false;
      if (t.ignore_from_total) return false;
      return (t.status === 'pending' || (t.status === 'confirmed' && d > hoje));
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const cardTx = [];
    const otherTx = [];
    for (const t of futuras) {
      if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
        const card = cardMap[t.credit_card_id];
        if (card && card.card_type !== 'prepaid') {
          cardTx.push(t);
          continue;
        }
      }
      otherTx.push(t);
    }

    const invoiceGroups = {};
    for (const t of cardTx) {
      const card = cardMap[t.credit_card_id];
      if (!card) continue;
      const dueDate = App.ledgerEngine.resolveInvoiceDueDate(card, t.date, (c, ds) => App.cardInvoice.getInvoicePeriodForDate(c, ds));
      const dueMonth = dueDate.slice(0, 7);
      const key = `${t.credit_card_id}|${dueMonth}`;
      if (!invoiceGroups[key]) {
        invoiceGroups[key] = { cardId: t.credit_card_id, cardName: card.name, dueDate, dueMonth, items: [], totalExpense: 0, totalRefund: 0 };
      }
      invoiceGroups[key].items.push(t);
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'expense') invoiceGroups[key].totalExpense += amt;
      else invoiceGroups[key].totalRefund += amt;
    }

    let totalEntradas = 0;
    let totalSaidas = 0;
    for (const t of otherTx) {
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income' || t.type === 'refund') totalEntradas += amt;
      else if (t.type === 'expense') totalSaidas += amt;
    }
    for (const g of Object.values(invoiceGroups)) {
      totalSaidas += Math.max(0, g.totalExpense - g.totalRefund);
    }

    const saldoAtual = await this.getTotalBalance(memberId);
    const saldoProjetado = saldoAtual + totalEntradas - totalSaidas;
    const esc = App.math.escapeHtml;
    const rows = [];

    const gruposOrdenados = Object.values(invoiceGroups).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    for (const g of gruposOrdenados) {
      const liquido = g.totalExpense - g.totalRefund;
      const pendentes = g.items.filter(t => t.status === 'pending').length;
      rows.push({
        sortDate: g.dueDate,
        html: `<tr style="background:rgba(96,165,250,0.08);">
          <td><strong>${App.utils.formatDate(g.dueDate)}</strong></td>
          <td><span class="badge badge-expense">📄 Fatura</span></td>
          <td><strong>${esc(g.cardName)}</strong> · ${esc(g.dueMonth)}</td>
          <td>Cartão de Crédito</td>
          <td><strong>${g.items.length} compra${g.items.length === 1 ? '' : 's'}</strong>${pendentes > 0 ? ` · ${pendentes} pendente${pendentes === 1 ? '' : 's'}` : ''}</td>
          <td>—</td>
          <td class="text-right" style="color:#ef4444; font-weight:700;">− ${App.utils.formatCurrency(liquido)}</td>
        </tr>`
      });
    }

    const typeNames = {
      income: 'Receita', expense: 'Despesa', transfer: 'Transferência',
      contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno'
    };
    for (const t of otherTx) {
      const amt = parseFloat(t.amount) || 0;
      const isEntrada = t.type === 'income' || t.type === 'refund';
      const cor = isEntrada ? '#22c55e' : '#ef4444';
      const sinal = isEntrada ? '+' : '−';
      rows.push({
        sortDate: (t.date || '').slice(0, 10),
        html: `<tr>
          <td>${App.utils.formatDateTime(t.date)}</td>
          <td><span class="badge badge-${esc(t.type)}">${esc(typeNames[t.type] || t.type)}</span></td>
          <td>${esc(t.account_name || '')}${t.account_to_name ? ' → ' + esc(t.account_to_name) : ''}</td>
          <td>${esc(t.category || '—')}</td>
          <td>${esc(t.description || '')}</td>
          <td>${esc(t.member_name || '')}</td>
          <td class="text-right" style="color:${cor}; font-weight:600;">${sinal} ${App.utils.formatCurrency(amt)}</td>
        </tr>`
      });
    }

    rows.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

    const tbody = document.getElementById('cardDetailTableBody');
    const titleEl = document.getElementById('cardDetailTitle');
    const filterDiv = document.getElementById('cardDetailFilters');
    const totalEl = document.getElementById('cardDetailTotal');
    if (!tbody || !titleEl || !filterDiv) return;

    titleEl.innerHTML = `📅 Saldo Previsto — Próximos ${days} dias`;
    filterDiv.style.display = 'block';
    filterDiv.innerHTML = `
      <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap; justify-content:space-between;">
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-sm ${days === 30 ? 'btn-primary' : 'btn-outline'}" onclick="App.saldos.showProjectedDetail(30)">30 dias</button>
          <button class="btn btn-sm ${days === 60 ? 'btn-primary' : 'btn-outline'}" onclick="App.saldos.showProjectedDetail(60)">60 dias</button>
          <button class="btn btn-sm ${days === 90 ? 'btn-primary' : 'btn-outline'}" onclick="App.saldos.showProjectedDetail(90)">90 dias</button>
        </div>
        <div style="display:flex; gap:16px; font-size:0.85rem; flex-wrap:wrap;">
          <span>Saldo atual: <strong>${App.utils.formatCurrency(saldoAtual)}</strong></span>
          <span style="color:#22c55e;">↓ Entradas: <strong>${App.utils.formatCurrency(totalEntradas)}</strong></span>
          <span style="color:#ef4444;">↑ Saídas: <strong>${App.utils.formatCurrency(totalSaidas)}</strong></span>
          <span style="color:#60a5fa;">◎ Projetado: <strong>${App.utils.formatCurrency(saldoProjetado)}</strong></span>
        </div>
      </div>`;

    tbody.innerHTML = rows.length
      ? rows.map(r => r.html).join('')
      : '<tr><td colspan="7" style="text-align:center; color:#888; padding:24px;">Nenhuma transação futura no período.</td></tr>';

    if (totalEl) {
      totalEl.innerHTML = `Total: <strong style="color:${saldoProjetado >= 0 ? '#60a5fa' : '#ef4444'};">${App.utils.formatCurrency(saldoProjetado)}</strong> <span style="color:#888; font-weight:400; font-size:0.85rem;">(saldo projetado)</span>`;
    }

    App.ui.openModal('modalCardDetail');
  },

  toggleFavorito(accountId) {
    let favoritos = [];
    try { favoritos = JSON.parse(localStorage.getItem('saldos_favoritos') || '[]'); } catch (e) { favoritos = []; }
    const idx = favoritos.indexOf(accountId);
    if (idx > -1) favoritos.splice(idx, 1);
    else favoritos.push(accountId);
    localStorage.setItem('saldos_favoritos', JSON.stringify(favoritos));
    this.load();
  },

  isFavorito(accountId) {
    try {
      const favoritos = JSON.parse(localStorage.getItem('saldos_favoritos') || '[]');
      return favoritos.includes(accountId);
    } catch (e) { return false; }
  },

  async showBalanceDetail() {
    const { snapshot, accounts } = await this.computeBalanceSnapshot({ includeArchived: false });
    const members = App.cache.members || await App.db.getAll('members');
    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
    const esc = App.math.escapeHtml;

    const included = accounts.filter(a => !a.archived && !a.exclude_from_total && snapshot.byAccount[a.id]);

    let html = `
      <div class="table-container" style="max-height:420px; overflow-y:auto;">
        <table>
          <thead>
            <tr>
              <th>Conta</th>
              <th>Membro</th>
              <th class="text-right">Inicial</th>
              <th class="text-right">Entradas</th>
              <th class="text-right">Saídas</th>
              <th class="text-right">Transf. (−)</th>
              <th class="text-right">Transf. (+)</th>
              <th class="text-right">Conciliado</th>
              <th class="text-right">Saldo Final</th>
            </tr>
          </thead>
          <tbody>`;

    let totalGeral = 0;
    for (const acc of included) {
      const st = snapshot.byAccount[acc.id];
      const saldo = st.totalIncludedBalance;
      totalGeral = App.ledgerEngine.round2(totalGeral + saldo);
      html += `
        <tr>
          <td>${esc(acc.name)}</td>
          <td>${esc(memberMap[acc.member_id] || '—')}</td>
          <td class="text-right">${App.utils.formatCurrency(st.initial)}</td>
          <td class="text-right" style="color: var(--income);">${App.utils.formatCurrency(st.income)}</td>
          <td class="text-right" style="color: var(--expense);">${App.utils.formatCurrency(st.expense)}</td>
          <td class="text-right" style="color: var(--withdrawal);">${App.utils.formatCurrency(st.transferOut)}</td>
          <td class="text-right" style="color: var(--contribution);">${App.utils.formatCurrency(st.transferIn)}</td>
          <td class="text-right" style="color: var(--text-muted);">${App.utils.formatCurrency(st.reconciledBalance)}</td>
          <td class="text-right" style="font-weight:600;">${App.utils.formatCurrency(saldo)}</td>
        </tr>`;
    }

    html += `
          </tbody>
          <tfoot>
            <tr style="border-top: 2px solid var(--border);">
              <td colspan="8"><strong>Saldo Total Consolidado</strong></td>
              <td class="text-right" style="font-weight:700;">${App.utils.formatCurrency(totalGeral)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;

    const targetEl = document.getElementById('modalBalanceDetailContent');
    if (targetEl) targetEl.innerHTML = html;
    App.ui.openModal('modalBalanceDetail');
  }
};

// =======================================================================
// Projeção de Investimentos – sem alterações
// =======================================================================
App.projection = {
  _projChart: null,

  async load() {
    const invs = await App.db.getAll('investments');
    const total = invs.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0);
    const ind = App.config.INDICATORS;
    const idx = document.getElementById('projectionIndex')?.value || 'cdi';
    document.getElementById('projectionContent').innerHTML = `
      <p>Valor atual: <strong>${App.utils.formatCurrency(total)}</strong></p>
      <p>Com base no <strong>${idx.toUpperCase()}</strong> (${ind[idx].toFixed(2)}% a.a.), projeção:</p>
    `;
    this.updateChart();
  },
  updateChart() {
    App.db.getAll('investments').then(invs => {
      const total = invs.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0);
      const ind = App.config.INDICATORS;
      const idx = document.getElementById('projectionIndex')?.value || 'cdi';
      const annualRate = ind[idx] / 100;
      const years = parseInt(document.getElementById('projectionYears')?.value) || 1;
      const months = years * 12;
      const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
      const points = [];
      let val = total;
      for (let m = 0; m <= months; m++) {
        const date = App.utils.addMonths(App.utils.todayISO(), m);
        points.push({ month: m, value: val, date });
        val *= (1 + monthlyRate);
      }

      const canvas = document.getElementById('projectionChart');
      if (!canvas) return;

      if (this._projChart) this._projChart.destroy();
      this._projChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1).map(p => {
            return new Date(p.date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
          }),
          datasets: [{
            label: 'Valor Projetado',
            data: points.map(p => p.value),
            borderColor: '#00d4aa',
            backgroundColor: 'rgba(0,212,170,0.05)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            segment: {
              borderColor: ctx => {
                const index = ctx.p0DataIndex;
                if (index === 0) return '#00d4aa';
                return points[index].value >= points[index-1].value ? '#00d4aa' : '#ff4757';
              }
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: '#888' }, grid: { color: '#1f1f1f' } },
            y: { ticks: { color: '#888', callback: v => App.utils.formatCurrency(v) }, grid: { color: '#1f1f1f' } }
          },
          plugins: {
            legend: { labels: { color: '#b0b0b0' } },
            tooltip: { callbacks: { label: ctx => App.utils.formatCurrency(ctx.raw) } }
          }
        }
      });

      const finalValue = points[points.length - 1].value;
      document.getElementById('projectionTable').innerHTML = `
        <div class="cards-row">
          <div class="card"><div class="card-label">Valor Final</div><div class="card-value">${App.utils.formatCurrency(finalValue)}</div></div>
          <div class="card"><div class="card-label">Rendimento Total</div><div class="card-value" style="color:#2e7d32;">+${App.utils.formatCurrency(finalValue - total)}</div></div>
        </div>
      `;
    });
  }
};

// =======================================================================
// Evolução Patrimonial – otimizada
// =======================================================================
App.patrimonyEvolution = {
  _patEvoChart: null,
  async load() {
    const canvas = document.getElementById('patrimonyEvolutionChart');
    if (!canvas) return;
    const cycles = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      cycles.push(App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)));
    }
    const data = [];
    for (const c of cycles) {
      const tx = await App.db.getTransactionsInRange(c.start, c.end, { memberId: App.state.globalMemberFilter || null, status: 'confirmed' });
      data.push({
        label: c.monthName.slice(0, 3),
        balance: tx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0) -
                 tx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0)
      });
    }

    if (this._patEvoChart) this._patEvoChart.destroy();
    this._patEvoChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          label: 'Saldo',
          data: data.map(d => d.balance),
          backgroundColor: data.map(d => d.balance >= 0 ? '#a3e635' : '#f87171'),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: '#1f1f1f' } },
          y: { ticks: { color: '#888', callback: v => App.utils.formatCurrency(v) }, grid: { color: '#1f1f1f' } }
        },
        plugins: {
          legend: { labels: { color: '#b0b0b0' } },
          tooltip: { callbacks: { label: ctx => App.utils.formatCurrency(ctx.raw) } }
        }
      }
    });
  }
};

// =======================================================================
// Tabela Dinâmica – NOVO DESIGN COMPLETO
// =======================================================================
App.tabela = {
  currentTab: 'consolidado',
  currentMonthStart: null,
  currentMovMonth: null,
  _donutChart: null,
  _paretoChart: null,
  membroPage: 0,
  _memberFilter: 'all',
  _accountFilter: 'all',
  _typeFilter: 'all',
  _includeTransfers: true,

  async load() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    if (!this.currentMovMonth) this.currentMovMonth = App.utils.currentMonth().startDate;

    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const labelEl = document.getElementById('tdCurrentMonthLabel');
    if (labelEl) labelEl.textContent = `Ref. ${cycle.refMonth}`;

    document.getElementById('tdMovMonthPicker').value = new Date(this.currentMovMonth + 'T12:00:00').toISOString().slice(0, 7);
    document.getElementById('tdLastUpdate').textContent = new Date().toLocaleString('pt-BR');

    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;

    const memberSel = document.getElementById('tdMember');
    if (memberSel && memberSel.options.length <= 1) {
      memberSel.innerHTML = '<option value="all">Todos</option>' + members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    }
    const accountSel = document.getElementById('tdAccount');
    if (accountSel && accountSel.options.length <= 1) {
      accountSel.innerHTML = '<option value="all">Todas</option>' + accounts.filter(a => !a.archived).map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    const anoSelect = document.getElementById('tdAno');
    if (anoSelect) {
      // Obtém todos os anos das transações (passado, presente e futuro)
      const allTx = await App.db.getAll('transactions');
      const anosSet = new Set();
      allTx.forEach(tx => {
        if (tx.date) {
          const ano = parseInt(tx.date.slice(0,4));
          if (!isNaN(ano)) anosSet.add(ano);
        }
      });
      let anos = Array.from(anosSet).sort((a,b) => a - b);
      if (anos.length === 0) anos = [new Date().getFullYear()];
      const currentYear = new Date().getFullYear();
      anoSelect.innerHTML = anos.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
    }

    await this.showTab(this.currentTab);
  },

  onFilterChange() {
    this._memberFilter = document.getElementById('tdMember')?.value || 'all';
    this._accountFilter = document.getElementById('tdAccount')?.value || 'all';
    this._typeFilter = document.getElementById('tdType')?.value || 'all';
    this._includeTransfers = document.getElementById('tdIncludeTransfers')?.checked ?? true;
    this.load();
  },

  async showTab(tab) {
    this.currentTab = tab;
    const safeDisplay = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.style.display = value;
    };
    const safeToggle = (id, force) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', force);
    };

    safeDisplay('tdConsolidadoSection', tab === 'consolidado' ? 'grid' : 'none');
    safeDisplay('tdAnnualSection', tab === 'consolidado' ? 'block' : 'none');
    safeDisplay('tdDonutSection', tab === 'consolidado' ? 'grid' : 'none');
    safeDisplay('tdMovimentacoesSection', tab === 'movimentacoes' ? 'block' : 'none');
    safeDisplay('tdAnalisesSection', tab === 'analises' ? 'block' : 'none');
    safeDisplay('tdKPIs', tab === 'consolidado' ? 'grid' : 'none');
    safeToggle('tdTabConsolidado', tab === 'consolidado');
    safeToggle('tdTabMovimentacoes', tab === 'movimentacoes');
    safeToggle('tdTabAnalises', tab === 'analises');
    if (tab === 'consolidado') {
      // Aguarda 100ms para garantir que os elementos do DOM estejam disponíveis
      await new Promise(resolve => setTimeout(resolve, 100));
      await this.renderConsolidado();
      await this.renderConsolidadoAnual();
      await this.renderDonutChart();
    } else if (tab === 'movimentacoes') {
      await this.renderMovimentacoes();
    } else if (tab === 'analises') {
      await this.renderAnalises();
    }
  },

  _getFilteredTx(txArray) {
    let result = txArray;
    if (this._memberFilter !== 'all') result = result.filter(t => t.member_id === this._memberFilter);
    if (this._accountFilter !== 'all') result = result.filter(t => t.account_id === this._accountFilter || t.account_to_id === this._accountFilter);
    if (this._typeFilter === 'income') result = result.filter(t => t.type === 'income');
    else if (this._typeFilter === 'expense') result = result.filter(t => t.type === 'expense');
    else if (this._typeFilter === 'investment') result = result.filter(t => t.type === 'contribution' || t.type === 'withdrawal' || (t.type === 'transfer' && (t.transfer_subtype === 'aporte' || t.transfer_subtype === 'resgate')));
    else if (this._typeFilter === 'transfer') result = result.filter(t => t.type === 'transfer');
    if (!this._includeTransfers) result = result.filter(t => t.type !== 'transfer');
    return result;
  },

    async renderConsolidado() {
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const periodTxRaw = await App.db.getTransactionsInRange(cycle.start, cycle.end);
    let periodTx = periodTxRaw.filter(t => t.status === 'confirmed');

    // Aplica filtros ativos
    if (this._memberFilter !== 'all') periodTx = periodTx.filter(t => t.member_id === this._memberFilter);
    if (this._accountFilter !== 'all') periodTx = periodTx.filter(t => t.account_id === this._accountFilter || t.account_to_id === this._accountFilter);
    if (this._typeFilter === 'income') periodTx = periodTx.filter(t => t.type === 'income');
    else if (this._typeFilter === 'expense') periodTx = periodTx.filter(t => t.type === 'expense');
    else if (this._typeFilter === 'investment') periodTx = periodTx.filter(t => t.type === 'contribution' || t.type === 'withdrawal' || (t.type === 'transfer' && (t.transfer_subtype === 'aporte' || t.transfer_subtype === 'resgate')));
    else if (this._typeFilter === 'transfer') periodTx = periodTx.filter(t => t.type === 'transfer');
    if (!this._includeTransfers) periodTx = periodTx.filter(t => t.type !== 'transfer');

    const memberIds = members.map(m => m.id);
    const totalMembers = memberIds.length;
    const maxPerPage = 3;
    const totalPages = Math.ceil(totalMembers / maxPerPage);
    // Garante que a página atual é válida
    if (this.membroPage >= totalPages) this.membroPage = Math.max(0, totalPages - 1);
    const startIdx = this.membroPage * maxPerPage;
    const visibleMemberIds = memberIds.slice(startIdx, startIdx + maxPerPage);

    // Monta cabeçalho
    let headHtml = '<tr><th>Categoria</th>';
    visibleMemberIds.forEach((id, i) => {
      const mem = members.find(m => m.id === id);
      headHtml += `<th>${mem ? mem.name : 'Membro ' + (i+1)}</th>`;
    });
    // Nome dinâmico para a coluna de transações divididas
    const splitMemberIds = new Set();
    periodTx.forEach(t => {
      if (t.member_splits && t.member_splits.length > 0) {
        t.member_splits.forEach(sp => splitMemberIds.add(sp.member_id));
      }
    });
    const splitMemberNames = Array.from(splitMemberIds)
      .map(id => {
        const m = members.find(m => m.id === id);
        return m ? m.name : id;
      })
      .join(' + ');
    const conjuntoLabel = splitMemberNames || 'Conjunto';
    headHtml += `<th>${conjuntoLabel}</th><th>Total</th><th>% do Total</th><th>Descrição</th></tr>`;
    document.getElementById('tdConsolidadoHead').innerHTML = headHtml;

    const categorias = [
      { key: 'income', label: 'Entradas', cls: 'td-income', desc: 'Salários, rendimentos e outras entradas' },
      { key: 'expense', label: 'Despesas', cls: 'td-expense', desc: 'Gastos e despesas do período' },
      { key: 'contribution', label: 'Aportes (Investimentos)', cls: 'td-investment', desc: 'Dinheiro aplicado em investimentos' },
      { key: 'withdrawal', label: 'Resgates (Investimentos)', cls: 'td-withdraw', desc: 'Dinheiro retirado de investimentos' },
      { key: 'transfer', label: 'Transferências', cls: 'td-transfer', desc: 'Transferências entre contas/pessoas' }
    ];

    const rows = [];
    const catTotals = {};

    // Função auxiliar para classificar transação por categoria
    const txMatchesCat = (t, key) => {
      if (key === 'income') return t.type === 'income';
      if (key === 'expense') return t.type === 'expense';
      if (key === 'contribution') return t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte');
      if (key === 'withdrawal') return t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate');
      if (key === 'transfer') return t.type === 'transfer' && !t.transfer_subtype;
      return false;
    };

    for (const cat of categorias) {
      // Valores para os membros visíveis
      const memberValues = visibleMemberIds.map(id => {
        if (cat.key === 'income') return periodTx.filter(t => t.member_id === id && t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
        if (cat.key === 'expense') return periodTx.filter(t => t.member_id === id && t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
        if (cat.key === 'contribution') return periodTx.filter(t => t.member_id === id && (t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte'))).reduce((s, t) => s + parseFloat(t.amount), 0);
        if (cat.key === 'withdrawal') return periodTx.filter(t => t.member_id === id && (t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate'))).reduce((s, t) => s + parseFloat(t.amount), 0);
        if (cat.key === 'transfer') return periodTx.filter(t => t.member_id === id && t.type === 'transfer' && !t.transfer_subtype).reduce((s, t) => s + parseFloat(t.amount), 0);
        return 0;
      });
      // Total geral (todas as transações)
      let total;
      if (cat.key === 'income') total = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
      else if (cat.key === 'expense') total = periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
      else if (cat.key === 'contribution') total = periodTx.filter(t => t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte')).reduce((s, t) => s + parseFloat(t.amount), 0);
      else if (cat.key === 'withdrawal') total = periodTx.filter(t => t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate')).reduce((s, t) => s + parseFloat(t.amount), 0);
      else if (cat.key === 'transfer') total = periodTx.filter(t => t.type === 'transfer' && !t.transfer_subtype).reduce((s, t) => s + parseFloat(t.amount), 0);
      else total = 0;
      // Valor conjunto = soma das partes de transações divididas entre os membros visíveis
      const conjuntoValue = periodTx
        .filter(t => txMatchesCat(t, cat.key) && t.member_splits && t.member_splits.length > 0)
        .reduce((s, t) => {
          return s + t.member_splits
            .filter(sp => visibleMemberIds.includes(sp.member_id))
            .reduce((sum, sp) => sum + sp.amount, 0);
        }, 0);

      catTotals[cat.key] = { values: memberValues, total };
      const totalGeral = Object.values(catTotals).reduce((s, c) => s + c.total, 0);
      const pct = totalGeral > 0 ? ((total / totalGeral) * 100).toFixed(1) : '0.0';
      rows.push({ cat, memberValues, conjunto: conjuntoValue, total, pct });
    }

    // Cálculo de saldo (igual ao App.saldos)
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    const activeAccounts = accounts.filter(a => !a.archived && !a.exclude_from_total);
    const today = App.utils.todayISO();
    const allTx = await App.db.getAll('transactions');
    const confirmedAll = allTx.filter(t => t.status === 'confirmed' && !t.ignore_from_total && t.date.slice(0,10) <= today);
    const balanceMap = {};
    activeAccounts.forEach(a => { balanceMap[a.id] = a.initial_balance || 0; });
    confirmedAll.forEach(t => {
      if (t.invoice_locked || t.credit_card_id) return;
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
      else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
      else if (t.type === 'transfer' || t.type === 'contribution') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
      else if (t.type === 'withdrawal') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
    });
    const totalBalanceAtual = activeAccounts.reduce((s, a) => s + (balanceMap[a.id] || 0), 0);
    const periodTxConfirmed = confirmedAll.filter(t => t.date.slice(0,10) >= cycle.start && t.date.slice(0,10) <= cycle.end);
    let saldoInicial = totalBalanceAtual;
    periodTxConfirmed.forEach(t => {
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund') saldoInicial -= amt;
      else if (t.type === 'expense') saldoInicial += amt;
      else if (t.type === 'transfer' || t.type === 'contribution') { if (t.account_id) saldoInicial += amt; if (t.account_to_id) saldoInicial -= amt; }
      else if (t.type === 'withdrawal') { if (t.account_id) saldoInicial += amt; if (t.account_to_id) saldoInicial -= amt; }
    });
    const incomeTotal = catTotals['income']?.total || 0;
    const expenseTotal = catTotals['expense']?.total || 0;
    const contributionTotal = catTotals['contribution']?.total || 0;
    const withdrawalTotal = catTotals['withdrawal']?.total || 0;
    const transferTotal = catTotals['transfer']?.total || 0;
    const saldoFinal = totalBalanceAtual;

    // Saldo inicial por membro visível
    const saldoInicialPorMembro = visibleMemberIds.map(id => {
      const memberAccs = activeAccounts.filter(a => a.member_id === id);
      return memberAccs.reduce((s, a) => s + (balanceMap[a.id] || 0), 0);
    });

    // Saldo final por membro visível (igual ao inicial, pois a tabela mostra o saldo total atual)
    const saldoFinalPorMembro = visibleMemberIds.map((id, i) => {
      const memberIncome = catTotals['income']?.values[i] || 0;
      const memberExpense = catTotals['expense']?.values[i] || 0;
      const memberCont = catTotals['contribution']?.values[i] || 0;
      const memberWith = catTotals['withdrawal']?.values[i] || 0;
      const memberTrans = catTotals['transfer']?.values[i] || 0;
      return (saldoInicialPorMembro[i] || 0) + memberIncome - memberExpense + memberCont - memberWith + memberTrans;
    });

    // Monta corpo da tabela
    let html = '';
    const totalGeral = Object.values(catTotals).reduce((s, c) => s + c.total, 0);
    for (const row of rows) {
      html += `<tr>
        <td><span class="td-category ${row.cat.cls}"><span class="td-category-dot"></span>${row.cat.label}</span></td>
        ${row.memberValues.map(v => `<td>${App.utils.formatCurrency(v)}</td>`).join('')}
        <td>${App.utils.formatCurrency(row.conjunto)}</td>
        <td>${App.utils.formatCurrency(row.total)}</td>
        <td class="${row.cat.cls}">${row.pct}%</td>
        <td>${row.cat.desc}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td>Saldo Inicial</td>
      ${saldoInicialPorMembro.map(v => `<td>${App.utils.formatCurrency(v)}</td>`).join('')}
      <td>—</td>
      <td>${App.utils.formatCurrency(saldoInicial)}</td>
      <td>—</td>
      <td>Saldo do início do período</td>
    </tr>`;
       html += `<tr class="final-row">
      <td>Saldo Final</td>
      ${saldoFinalPorMembro.map(v => `<td>${App.utils.formatCurrency(v)}</td>`).join('')}
      <td>—</td>
      <td>${App.utils.formatCurrency(saldoFinal)}</td>
      <td class="td-income">${incomeTotal > 0 ? ((saldoFinal / incomeTotal) * 100).toFixed(1) : '0.0'}%</td>
      <td>Saldo disponível no final do período</td>
    </tr>`;
    document.getElementById('tdConsolidadoBody').innerHTML = html;

    // Resumo do período
    document.getElementById('tdResumo').innerHTML = `
      <div class="td-summary-line"><span>Saldo Inicial</span><strong>${App.utils.formatCurrency(saldoInicial)}</strong></div>
      <div class="td-summary-line"><span>+ Entradas</span><strong class="td-income">${App.utils.formatCurrency(incomeTotal)}</strong></div>
      <div class="td-summary-line"><span>- Despesas</span><strong class="td-expense">${App.utils.formatCurrency(expenseTotal)}</strong></div>
      <div class="td-summary-line"><span>+ Aportes</span><strong class="td-investment">${App.utils.formatCurrency(contributionTotal)}</strong></div>
      <div class="td-summary-line"><span>- Resgates</span><strong class="td-withdraw">${App.utils.formatCurrency(withdrawalTotal)}</strong></div>
      <div class="td-summary-line"><span>± Transferências</span><strong class="td-transfer">${App.utils.formatCurrency(transferTotal)}</strong></div>
      <div class="td-summary-line separator final"><span>= Saldo Final</span><strong>${App.utils.formatCurrency(saldoFinal)}</strong></div>
    `;

    // Controles de navegação de membros
    const navDiv = document.getElementById('tdMembroNav');
    if (navDiv) {
      if (totalMembers > maxPerPage) {
        navDiv.innerHTML = `
          <button class="td-btn" onclick="App.tabela.membroPage = 0; App.tabela.showTab('consolidado')" ${this.membroPage === 0 ? 'disabled' : ''}>«</button>
          <button class="td-btn" onclick="App.tabela.membroPage = Math.max(0, App.tabela.membroPage - 1); App.tabela.showTab('consolidado')" ${this.membroPage === 0 ? 'disabled' : ''}>‹</button>
          <span style="color:#cbd2d9;">Membros ${startIdx+1}-${Math.min(startIdx+maxPerPage, totalMembers)} de ${totalMembers}</span>
          <button class="td-btn" onclick="App.tabela.membroPage = Math.min(${totalPages-1}, App.tabela.membroPage + 1); App.tabela.showTab('consolidado')" ${this.membroPage >= totalPages-1 ? 'disabled' : ''}>›</button>
          <button class="td-btn" onclick="App.tabela.membroPage = ${totalPages-1}; App.tabela.showTab('consolidado')" ${this.membroPage >= totalPages-1 ? 'disabled' : ''}>»</button>
        `;
      } else {
        navDiv.innerHTML = '';
      }
    }

    // KPIs (mantidos iguais)
    const prevCycle = App.utils.monthRangeFromDate(App.utils.addMonths(cycle.start, -1));
    const prevTxRaw = await App.db.getTransactionsInRange(prevCycle.start, prevCycle.end);
    const prevTx = prevTxRaw.filter(t => t.status === 'confirmed');
    const prevIncome = prevTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
    const prevExpense = prevTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
    const prevContribution = prevTx.filter(t => t.type === 'contribution').reduce((s, t) => s + parseFloat(t.amount), 0);
    const prevSaldo = prevIncome - prevExpense;
    const taxaEconomia = incomeTotal > 0 ? ((incomeTotal - expenseTotal) / incomeTotal * 100).toFixed(1) : '0.0';
    const prevTaxa = prevIncome > 0 ? ((prevIncome - prevExpense) / prevIncome * 100).toFixed(1) : '0.0';
    const invs = await App.db.getAll('investments');
    const totalInv = invs.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0);
    const pat = await App.db.getAll('patrimony');
    const assets = pat.filter(p => p.type === 'asset').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
    const liabilities = pat.filter(p => p.type === 'liability').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
    const patrimonioTotal = totalInv + saldoFinal + assets - liabilities;
    const incomeVar = prevIncome > 0 ? ((incomeTotal - prevIncome) / prevIncome * 100) : 0;
    const expenseVar = prevExpense > 0 ? ((expenseTotal - prevExpense) / prevExpense * 100) : 0;
    const saldoVar = prevSaldo !== 0 ? ((incomeTotal - expenseTotal - prevSaldo) / Math.abs(prevSaldo) * 100) : 0;
    const contribVar = prevContribution > 0 ? ((contributionTotal - prevContribution) / prevContribution * 100) : 0;
    const kpiArrow = (v) => v >= 0 ? '↑' : '↓';
    document.getElementById('tdKPIs').innerHTML = `
      <div class="td-kpi green"><div class="td-kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></div><div class="td-kpi-content"><div class="td-kpi-label">Entradas</div><div class="td-kpi-value">${App.utils.formatCurrency(incomeTotal)}</div><div class="td-kpi-comparison"><strong>${kpiArrow(incomeVar)} ${Math.abs(incomeVar).toFixed(1)}%</strong> vs. mês anterior: ${App.utils.formatCurrency(prevIncome)}</div></div></div>
      <div class="td-kpi red"><div class="td-kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></div><div class="td-kpi-content"><div class="td-kpi-label">Despesas</div><div class="td-kpi-value">${App.utils.formatCurrency(expenseTotal)}</div><div class="td-kpi-comparison"><strong>${kpiArrow(-expenseVar)} ${Math.abs(expenseVar).toFixed(1)}%</strong> vs. mês anterior: ${App.utils.formatCurrency(prevExpense)}</div></div></div>
      <div class="td-kpi blue"><div class="td-kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div><div class="td-kpi-content"><div class="td-kpi-label">Saldo do período</div><div class="td-kpi-value">${App.utils.formatCurrency(incomeTotal - expenseTotal)}</div><div class="td-kpi-comparison"><strong>${kpiArrow(saldoVar)} ${Math.abs(saldoVar).toFixed(1)}%</strong> vs. mês anterior: ${App.utils.formatCurrency(prevSaldo)}</div></div></div>
      <div class="td-kpi purple"><div class="td-kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></div><div class="td-kpi-content"><div class="td-kpi-label">Taxa de economia</div><div class="td-kpi-value">${taxaEconomia}%</div><div class="td-kpi-comparison">vs. mês anterior: ${prevTaxa}%</div></div></div>
      <div class="td-kpi yellow"><div class="td-kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="td-kpi-content"><div class="td-kpi-label">Investido (aportes)</div><div class="td-kpi-value">${App.utils.formatCurrency(contributionTotal)}</div><div class="td-kpi-comparison"><strong>${kpiArrow(contribVar)} ${Math.abs(contribVar).toFixed(1)}%</strong> vs. mês anterior: ${App.utils.formatCurrency(prevContribution)}</div></div></div>
      <div class="td-kpi cyan"><div class="td-kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div><div class="td-kpi-content"><div class="td-kpi-label">Patrimônio total</div><div class="td-kpi-value">${App.utils.formatCurrency(patrimonioTotal)}</div><div class="td-kpi-comparison">Contas + Investimentos + Bens</div></div></div>
    `;
  },

  async renderConsolidadoAnual() {
    const ano = parseInt(document.getElementById('tdAno')?.value) || new Date().getFullYear();

    // Busca transações do ano e do ano anterior para considerar faturas que cruzam o ano
    const startDate = `${ano - 1}-12-01`;
    const endDate = `${ano}-12-31T23:59:59`;
    const allTx = await App.db.getTransactionsInRange(startDate, endDate);

    // Estrutura para armazenar valores mensais
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      income: 0,
      expense: 0,
      contribution: 0,
      withdrawal: 0,
      transfer: 0
    }));

    // Para cada transação, determina o mês de referência (vencimento para cartão, data original para as demais)
    for (const t of allTx) {
      // Considera apenas transações confirmadas ou pendentes
      if (t.status !== 'confirmed' && t.status !== 'pending') continue;

      // Determina data efetiva: vencimento da fatura para cartão, data original para os outros
      let effectiveDate = t.date.slice(0, 10);
      if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
        const card = (App.cache.creditCards || await App.db.getAll('creditCards')).find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
            effectiveDate = period.due.slice(0, 10);
          } catch (e) {
            // mantém a data original em caso de erro
          }
        }
      }

      // Verifica se a data efetiva está no ano selecionado
      const effYear = parseInt(effectiveDate.slice(0, 4));
      if (effYear !== ano) continue;

      // Aplica filtros ativos
      if (this._memberFilter !== 'all' && t.member_id !== this._memberFilter) continue;
      if (this._accountFilter !== 'all' && t.account_id !== this._accountFilter && t.account_to_id !== this._accountFilter) continue;
      if (this._typeFilter === 'income' && t.type !== 'income') continue;
      if (this._typeFilter === 'expense' && t.type !== 'expense') continue;
      if (this._typeFilter === 'investment' && !(t.type === 'contribution' || t.type === 'withdrawal' || (t.type === 'transfer' && ['aporte','resgate'].includes(t.transfer_subtype)))) continue;
      if (this._typeFilter === 'transfer' && t.type !== 'transfer') continue;
      if (!this._includeTransfers && t.type === 'transfer') continue;

      // Determina o índice do mês (0-based)
      const mesIndex = parseInt(effectiveDate.slice(5, 7)) - 1;
      if (mesIndex < 0 || mesIndex > 11) continue;

      const valor = parseFloat(t.amount) || 0;
      const monthly = monthlyData[mesIndex];

      if (t.type === 'income') monthly.income += valor;
      else if (t.type === 'expense') monthly.expense += valor;
      else if (t.type === 'contribution') monthly.contribution += valor;
      else if (t.type === 'withdrawal') monthly.withdrawal += valor;
      else if (t.type === 'transfer') monthly.transfer += valor;
    }

    // Monta a tabela anual
    const categoriasAnuais = [
      { key: 'income', label: 'Salários (Entradas)', cls: 'td-income' },
      { key: 'expense', label: 'Despesas', cls: 'td-expense' },
      { key: 'contribution', label: 'Aportes (Investimentos)', cls: 'td-investment' },
      { key: 'withdrawal', label: 'Resgates (Investimentos)', cls: 'td-withdraw' },
      { key: 'transfer', label: 'Transferências', cls: 'td-transfer' }
    ];

    let html = '';
    const totais = { income: 0, expense: 0, contribution: 0, withdrawal: 0, transfer: 0 };

    for (const cat of categoriasAnuais) {
      html += `<tr><td class="${cat.cls}">${cat.label}</td>`;
      let totalAno = 0;
      for (const m of monthlyData) {
        const val = m[cat.key] || 0;
        totalAno += val;
        html += `<td>${App.utils.formatCurrency(val)}</td>`;
      }
      totais[cat.key] = totalAno;
      html += `<td class="${cat.cls}">${App.utils.formatCurrency(totalAno)}</td><td class="${cat.cls}">${App.utils.formatCurrency(totalAno / 12)}</td></tr>`;
    }

    // Linhas de totais e saldo acumulado
    const totalEntradas = totais.income;
    const totalSaidas = totais.expense;
    html += `<tr class="summary-row"><td class="td-income">Total de Entradas</td>`;
    for (const m of monthlyData) html += `<td>${App.utils.formatCurrency(m.income)}</td>`;
    html += `<td class="td-income">${App.utils.formatCurrency(totalEntradas)}</td><td class="td-income">${App.utils.formatCurrency(totalEntradas / 12)}</td></tr>`;

    html += `<tr><td class="td-expense">Total de Saídas</td>`;
    for (const m of monthlyData) html += `<td>${App.utils.formatCurrency(m.expense)}</td>`;
    html += `<td class="td-expense">${App.utils.formatCurrency(totalSaidas)}</td><td class="td-expense">${App.utils.formatCurrency(totalSaidas / 12)}</td></tr>`;

    let saldoAcumulado = 0;
    html += `<tr><td class="td-balance">Saldo do Mês</td>`;
    for (const m of monthlyData) {
      const saldo = m.income - m.expense + m.contribution - m.withdrawal + m.transfer;
      html += `<td>${App.utils.formatCurrency(saldo)}</td>`;
    }
    html += `<td class="td-balance">${App.utils.formatCurrency(totalEntradas - totalSaidas)}</td><td class="td-balance">${App.utils.formatCurrency((totalEntradas - totalSaidas) / 12)}</td></tr>`;

    html += `<tr><td class="td-balance">Saldo Acumulado</td>`;
    for (const m of monthlyData) {
      saldoAcumulado += m.income - m.expense + m.contribution - m.withdrawal + m.transfer;
      html += `<td>${App.utils.formatCurrency(saldoAcumulado)}</td>`;
    }
    html += `<td class="td-balance">${App.utils.formatCurrency(saldoAcumulado)}</td><td>—</td></tr>`;

    document.getElementById('tdAnnualBody').innerHTML = html;
  },

  async renderDonutChart() {
    const canvas = document.getElementById('tdDonutChart');
    if (!canvas) return;
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const periodTxRaw = await App.db.getTransactionsInRange(cycle.start, cycle.end);
    const periodTx = periodTxRaw.filter(t => t.status === 'confirmed' && t.type === 'expense');

    const byCat = {};
    periodTx.forEach(t => { byCat[t.category || 'Outros'] = (byCat[t.category || 'Outros'] || 0) + parseFloat(t.amount); });
    const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const totalExpense = entries.reduce((s, [, v]) => s + v, 0);

    if (this._donutChart) this._donutChart.destroy();
    const colors = ['#58d68a', '#3f9fc4', '#9b5de5', '#e6a821', '#91bd63', '#777f87', '#e74c3c', '#3498db', '#1abc9c', '#f39c12'];
    this._donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((_, i) => colors[i % colors.length]),
          borderColor: '#0d1115',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '60%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${App.utils.formatCurrency(ctx.raw)}` } }
        }
      }
    });

    const legendEl = document.getElementById('tdLegend');
    if (legendEl) {
      legendEl.innerHTML = entries.map(([cat, val], i) => `
        <div style="display:grid;grid-template-columns:10px 1fr auto auto;gap:8px;align-items:center;min-height:25px;color:#bfc7ce;">
          <span style="width:8px;height:8px;border-radius:50%;background:${colors[i % colors.length]};"></span>
          <span>${cat}</span>
          <span style="color:#aeb7c0;">${App.utils.formatCurrency(val)}</span>
          <span style="width:42px;text-align:right;color:#aeb7c0;">${((val / totalExpense) * 100).toFixed(1)}%</span>
        </div>`).join('');
    }
  },
  async renderMovimentacoes() {
    const cycle = App.utils.monthRangeFromDate(this.currentMovMonth);
    document.getElementById('tdMovMonthLabel').textContent = cycle.refMonth;

    const periodTxRaw = await App.db.getTransactionsInRange(cycle.start, cycle.end);
    const periodTx = this._getFilteredTx(periodTxRaw).filter(t => t.status === 'confirmed' || t.status === 'pending');

    // ========== 1. TOTAIS GERAIS ==========
    const income = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
    const expense = periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
    const resultadoGeral = income - expense;

    // ========== 2. DADOS DE INVESTIMENTOS ==========
    const allAccounts = await App.db.getAll('accounts');
    const investmentAccounts = allAccounts.filter(a => a.type === 'investment' && !a.archived);
    const investmentAccountIds = new Set(investmentAccounts.map(a => a.id));

    // Saldo inicial: soma dos saldos das contas de investimento até o fim do mês anterior
    const startOfMonth = cycle.start.slice(0, 10);
    const endOfPreviousMonth = new Date(new Date(startOfMonth + 'T12:00:00') - 1).toISOString().slice(0, 10);
    const txUntilPreviousMonth = await App.db.getTransactionsInRange('2000-01-01', endOfPreviousMonth + 'T23:59:59');

    let saldoInicialInvest = 0;
    for (const acc of investmentAccounts) {
      let saldoConta = acc.initial_balance || 0;
      for (const t of txUntilPreviousMonth) {
        if (t.status !== 'confirmed' && t.status !== 'pending') continue;
        const amt = parseFloat(t.amount) || 0;
        if (t.account_id === acc.id) {
          if (t.type === 'income' || t.type === 'refund') saldoConta += amt;
          else if (t.type === 'expense') saldoConta -= amt;
          else if (t.type === 'transfer' || t.type === 'contribution') saldoConta -= amt;
        } else if (t.account_to_id === acc.id) {
          if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') saldoConta += amt;
        }
      }
      saldoInicialInvest += saldoConta;
    }

    // Aportes (entradas) do mês
    const aportes = periodTx
      .filter(t => investmentAccountIds.has(t.account_to_id) &&
             (t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte')))
      .reduce((s, t) => s + parseFloat(t.amount), 0);

    // Resgates (saídas) do mês
    const resgates = periodTx
      .filter(t => investmentAccountIds.has(t.account_id) &&
             (t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate')))
      .reduce((s, t) => s + parseFloat(t.amount), 0);

    // Rendimentos do mês
    const rendimentos = periodTx
      .filter(t => t.type === 'income' && (t.description || '').startsWith('Rendimento:'))
      .reduce((s, t) => s + parseFloat(t.amount), 0);

    const saldoFinalInvest = saldoInicialInvest + aportes - resgates + rendimentos;

    // ========== 3. OCULTAR TABELA ANTIGA ==========
    const section = document.getElementById('tdMovimentacoesSection');
    const tabelaResumoAntiga = section ? section.querySelector('table') : null;
    if (tabelaResumoAntiga) {
      tabelaResumoAntiga.style.display = 'none';
    }

    // ========== 4. MONTAR HTML SIMPLIFICADO ==========
    const html = `
      <div style="font-size:1rem; line-height:1.8;">
        <div style="display:flex; justify-content:space-between; max-width:400px;">
          <span>Entradas</span>
          <strong>${App.utils.formatCurrency(income)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; max-width:400px;">
          <span>Saídas</span>
          <strong>${App.utils.formatCurrency(expense)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; max-width:400px; font-weight:700;">
          <span>Resultado</span>
          <strong style="color:${resultadoGeral >= 0 ? 'var(--income)' : 'var(--expense)'};">${App.utils.formatCurrency(resultadoGeral)}</strong>
        </div>
        <hr style="margin:16px 0; border-color:var(--border);">
        <div style="display:flex; justify-content:space-between; max-width:400px;">
          <span>Saldo inicial</span>
          <strong>${App.utils.formatCurrency(saldoInicialInvest)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; max-width:400px;">
          <span>Entradas:</span>
          <strong>${App.utils.formatCurrency(aportes)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; max-width:400px;">
          <span>Saídas:</span>
          <strong style="color:var(--expense);">-${App.utils.formatCurrency(resgates)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; max-width:400px;">
          <span>Rendimentos:</span>
          <strong style="color:var(--income);">${App.utils.formatCurrency(rendimentos)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; max-width:400px; font-weight:700; margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
          <span>Saldo Final de investimentos:</span>
          <strong>${App.utils.formatCurrency(saldoFinalInvest)}</strong>
        </div>
      </div>
    `;

    document.getElementById('tdMovDetalhes').innerHTML = html;
  },
  prevMovMonth() {
    const d = new Date(this.currentMovMonth + 'T12:00:00'); d.setMonth(d.getMonth() - 1);
    this.currentMovMonth = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    this.renderMovimentacoes();
  },
  nextMovMonth() {
    const d = new Date(this.currentMovMonth + 'T12:00:00'); d.setMonth(d.getMonth() + 1);
    this.currentMovMonth = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    this.renderMovimentacoes();
  },
  gotoMovMonth() {
    const month = document.getElementById('tdMovMonthPicker').value;
    if (month) { const [y, m] = month.split('-'); this.currentMovMonth = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate; this.renderMovimentacoes(); }
  },

  prevMonth() {
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() - 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    this.load();
  },
  nextMonth() {
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() + 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    this.load();
  },
  goToToday() {
    this.currentMonthStart = App.utils.currentMonth().startDate;
    this.showTab(this.currentTab);
  },

  // ==================== ANÁLISES AVANÇADAS ====================

  async renderAnalises() {
    await this.renderProjecao();
    await this.renderPareto();
    await this.renderISF();
    this.populateComparacaoSelects();
    await this.renderComparacao();
  },

  // 1. Projeção de Fluxo de Caixa baseada em recorrência
  async renderProjecao() {
    const allTx = await App.db.getAll('transactions');
    const grupos = {};
    allTx.filter(t => t.status === 'confirmed').forEach(t => {
      const key = `${t.description}|${t.amount}|${t.type}`;
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(t);
    });
    const recorrentes = Object.values(grupos).filter(g => g.length >= 2);
    const hoje = new Date();
    const projecoes = [];
    for (let i = 0; i < 12; i++) {
      const mes = new Date(hoje.getFullYear(), hoje.getMonth() + i + 1, 1);
      let receita = 0, despesa = 0;
      recorrentes.forEach(g => {
        const ultimo = g.sort((a,b) => b.date.localeCompare(a.date))[0];
        if (ultimo) {
          const valor = parseFloat(ultimo.amount);
          if (ultimo.type === 'income') receita += valor;
          else if (ultimo.type === 'expense') despesa += valor;
        }
      });
      projecoes.push({
        mes: mes.toLocaleDateString('pt-BR', {month:'short',year:'numeric'}),
        receita,
        despesa,
        saldo: receita - despesa
      });
    }
    const tbody = document.getElementById('tdProjecaoBody');
    if (tbody) {
      tbody.innerHTML = projecoes.map(p =>
        `<tr>
          <td>${p.mes}</td>
          <td class="td-income">${App.utils.formatCurrency(p.receita)}</td>
          <td class="td-expense">${App.utils.formatCurrency(p.despesa)}</td>
          <td class="${p.saldo >= 0 ? 'td-income' : 'td-expense'}">${App.utils.formatCurrency(p.saldo)}</td>
        </tr>`
      ).join('');
    }
  },

  // 2. Análise de Pareto (80/20) das Despesas
  async renderPareto() {
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const periodTx = (await App.db.getTransactionsInRange(cycle.start, cycle.end))
      .filter(t => t.status === 'confirmed' && t.type === 'expense');
    const byCat = {};
    periodTx.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + parseFloat(t.amount); });
    const sorted = Object.entries(byCat).sort((a,b) => b[1] - a[1]);
    const total = sorted.reduce((s, [,v]) => s + v, 0);
    let acum = 0;
    const labels = [], valores = [], acumPcts = [], cores = [];
    const paleta = ['#58d68a','#3f9fc4','#9b5de5','#e6a821','#91bd63','#777f87','#e74c3c','#3498db','#1abc9c','#f39c12'];
    sorted.forEach(([cat, val], i) => {
      labels.push(cat);
      valores.push(val);
      acum += val;
      acumPcts.push(parseFloat(((acum / total) * 100).toFixed(1)));
      cores.push(paleta[i % paleta.length]);
    });
    const canvas = document.getElementById('tdParetoChart');
    if (canvas) {
      if (this._paretoChart) this._paretoChart.destroy();
      this._paretoChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Valor',
              data: valores,
              backgroundColor: cores,
              yAxisID: 'y',
              order: 2
            },
            {
              label: '% Acum.',
              data: acumPcts,
              type: 'line',
              borderColor: '#e8edf2',
              backgroundColor: 'rgba(0,0,0,0)',
              yAxisID: 'y1',
              tension: 0.3,
              order: 1,
              pointRadius: 3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              ticks: { color: '#888', callback: v => App.utils.formatCurrency(v) },
              grid: { color: '#1f1f1f' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              ticks: { color: '#888', callback: v => v + '%' },
              grid: { drawOnChartArea: false },
              min: 0,
              max: 100
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ctx.datasetIndex === 0
                  ? App.utils.formatCurrency(ctx.raw)
                  : ctx.raw + '%'
              }
            }
          }
        }
      });
    }
    const legendEl = document.getElementById('tdParetoLegend');
    if (legendEl) {
      const limite80 = sorted.findIndex((_, i) => (acumPcts[i] || 0) >= 80);
      legendEl.innerHTML = sorted.map(([cat, val], i) => `
        <div style="margin-bottom:4px; ${i > limite80 ? 'opacity:0.5;' : ''}">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cores[i]};margin-right:6px;"></span>
          ${cat} ${App.utils.formatCurrency(val)} (${acumPcts[i]}%)
        </div>`
      ).join('');
    }
  },

  // 3. Índice de Saúde Financeira (ISF)
  async renderISF() {
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const periodTx = (await App.db.getTransactionsInRange(cycle.start, cycle.end))
      .filter(t => t.status === 'confirmed');
    const income = periodTx.filter(t => t.type === 'income').reduce((s,t) => s + parseFloat(t.amount), 0);
    const expense = periodTx.filter(t => t.type === 'expense').reduce((s,t) => s + parseFloat(t.amount), 0);
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    const activeAccounts = accounts.filter(a => !a.archived && !a.exclude_from_total);
    const today = App.utils.todayISO();
    const allTx = await App.db.getAll('transactions');
    const confirmedAll = allTx.filter(t =>
      t.status === 'confirmed' && !t.ignore_from_total && t.date.slice(0,10) <= today
    );
    const balanceMap = {};
    activeAccounts.forEach(a => { balanceMap[a.id] = a.initial_balance || 0; });
    confirmedAll.forEach(t => {
      if (t.invoice_locked || t.credit_card_id) return;
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund')
        balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
      else if (t.type === 'expense')
        balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
      else if (t.type === 'transfer' || t.type === 'contribution') {
        balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
        balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt;
      }
      else if (t.type === 'withdrawal') {
        balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
        balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt;
      }
    });
    const saldoTotal = activeAccounts.reduce((s, a) => s + (balanceMap[a.id] || 0), 0);
    const parcelasAtivas = allTx
      .filter(t => t.installments > 1 && t.status === 'confirmed' && t.date.slice(0,10) <= today)
      .reduce((s,t) => s + parseFloat(t.amount), 0);

    const comp = income > 0 ? (expense / income) * 100 : 100;
    const reserva = expense > 0 ? saldoTotal / expense : 0;
    const endiv = income > 0 ? (parcelasAtivas / income) * 100 : 0;
    const poup = income > 0 ? ((income - expense) / income) * 100 : 0;

    const normaliza = (val, min, max, invertido = false) => {
      let score = ((val - min) / (max - min)) * 100;
      score = Math.max(0, Math.min(100, score));
      return invertido ? 100 - score : score;
    };
    const sComp = normaliza(comp, 30, 100, true);
    const sReserva = normaliza(reserva, 0, 12, false);
    const sEndiv = normaliza(endiv, 0, 50, true);
    const sPoup = normaliza(poup, 0, 50, false);
    const isf = Math.round((sComp + sReserva + sEndiv + sPoup) / 4);

    const barra = (valor, cls = '') =>
      `<div class="isf-bar"><div class="isf-fill ${cls}" style="width:${Math.min(valor, 100)}%;"></div></div>`;

    const conteudo = document.getElementById('tdISFContent');
    if (conteudo) {
      conteudo.innerHTML = `
        <div class="isf-score" style="color:${isf >= 70 ? '#63e28b' : isf >= 40 ? '#e9ae25' : '#ff5b55'}">${isf}/100</div>
        <div class="isf-detail">
          <div>Comprometimento<br><small>${comp.toFixed(1)}%</small>${barra(sComp, comp > 70 ? 'danger' : comp > 50 ? 'warning' : '')}</div>
          <div>Reserva de emergência<br><small>${reserva.toFixed(1)} meses</small>${barra(sReserva, reserva < 3 ? 'danger' : reserva < 6 ? 'warning' : '')}</div>
          <div>Endividamento<br><small>${endiv.toFixed(1)}%</small>${barra(sEndiv, endiv > 30 ? 'danger' : endiv > 15 ? 'warning' : '')}</div>
          <div>Taxa de poupança<br><small>${poup.toFixed(1)}%</small>${barra(sPoup, poup < 10 ? 'danger' : poup < 20 ? 'warning' : '')}</div>
        </div>`;
    }
  },

  // 4. Comparação entre dois períodos
  populateComparacaoSelects() {
    const hoje = new Date();
    const opcoes = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const value = d.toISOString().slice(0,7);
      const label = d.toLocaleDateString('pt-BR', {month:'long',year:'numeric'});
      opcoes.push({ value, label });
    }
    [document.getElementById('tdCompPeriodo1'), document.getElementById('tdCompPeriodo2')].forEach(sel => {
      if (sel && sel.options.length === 0) {
        sel.innerHTML = opcoes.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
      }
    });
  },

  async renderComparacao() {
    const p1 = document.getElementById('tdCompPeriodo1')?.value;
    const p2 = document.getElementById('tdCompPeriodo2')?.value;
    if (!p1 || !p2) return;
    const ciclo1 = App.utils.monthRangeFromDate(p1 + '-01');
    const ciclo2 = App.utils.monthRangeFromDate(p2 + '-01');
    const tx1 = (await App.db.getTransactionsInRange(ciclo1.start, ciclo1.end))
      .filter(t => t.status === 'confirmed');
    const tx2 = (await App.db.getTransactionsInRange(ciclo2.start, ciclo2.end))
      .filter(t => t.status === 'confirmed');
    const categorias = [...new Set([
      ...tx1.map(t => t.category),
      ...tx2.map(t => t.category)
    ])].filter(Boolean);
    const rows = categorias.map(cat => {
      const v1 = tx1.filter(t => t.category === cat && t.type === 'expense')
        .reduce((s,t) => s + parseFloat(t.amount), 0);
      const v2 = tx2.filter(t => t.category === cat && t.type === 'expense')
        .reduce((s,t) => s + parseFloat(t.amount), 0);
      const diff = v2 - v1;
      const pct = v1 > 0 ? ((diff / v1) * 100).toFixed(1) : (v2 > 0 ? '100.0' : '0.0');
      return { cat, v1, v2, diff, pct };
    }).sort((a,b) => Math.abs(b.diff) - Math.abs(a.diff));
    document.getElementById('tdCompLabel1').textContent =
      new Date(p1 + '-01').toLocaleDateString('pt-BR', {month:'long',year:'numeric'});
    document.getElementById('tdCompLabel2').textContent =
      new Date(p2 + '-01').toLocaleDateString('pt-BR', {month:'long',year:'numeric'});
    const tbody = document.getElementById('tdComparacaoBody');
    if (tbody) {
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.cat}</td>
          <td class="text-right">${App.utils.formatCurrency(r.v1)}</td>
          <td class="text-right">${App.utils.formatCurrency(r.v2)}</td>
          <td class="text-right" style="color:${r.diff > 0 ? 'var(--expense)' : 'var(--income)'};">
            ${r.diff > 0 ? '+' : ''}${App.utils.formatCurrency(r.diff)}
          </td>
          <td class="text-right" style="color:${r.diff > 0 ? 'var(--expense)' : 'var(--income)'};">
            ${r.pct}%
          </td>
        </tr>`
      ).join('');
    }
  },

  async exportData() {
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const periodTxRaw = await App.db.getTransactionsInRange(cycle.start, cycle.end);
    const periodTx = this._getFilteredTx(periodTxRaw).filter(t => t.status === 'confirmed');
    const headers = ['Data', 'Tipo', 'Categoria', 'Descrição', 'Membro', 'Valor'];
    const typeNames = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência', contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno' };
    const rows = periodTx.sort((a, b) => a.date.localeCompare(b.date)).map(t => [
      App.utils.formatDate(t.date),
      typeNames[t.type] || t.type,
      t.category || '',
      t.description || '',
      t.member_name || '',
      t.amount
    ]);
    App.utils.exportCSV('tabela_dinamica.csv', headers, rows);
    App.utils.showToast('Dados exportados!');
  }
};

// =======================================================================
// Calendário – otimizado
// =======================================================================
App.calendar = {
  currentDate: new Date(),
  currentView: 'monthly',

  async load() {
    this.currentDate = new Date();
    this.render();
  },

  changeView() {
    this.currentView = document.getElementById('calendarView').value;
    this.render();
  },

  prev() {
    if (this.currentView === 'monthly') this.currentDate.setMonth(this.currentDate.getMonth() - 1);
    else if (this.currentView === 'weekly') this.currentDate.setDate(this.currentDate.getDate() - 7);
    else this.currentDate.setFullYear(this.currentDate.getFullYear() - 1);
    this.render();
  },

  next() {
    if (this.currentView === 'monthly') this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    else if (this.currentView === 'weekly') this.currentDate.setDate(this.currentDate.getDate() + 7);
    else this.currentDate.setFullYear(this.currentDate.getFullYear() + 1);
    this.render();
  },

  async render() {
    const titleEl = document.getElementById('calendarTitle');
    const gridEl = document.getElementById('calendarGrid');
    gridEl.className = this.currentView;

    if (this.currentView === 'monthly') {
      const month = this.currentDate.getMonth();
      const year = this.currentDate.getFullYear();
      titleEl.textContent = new Date(year, month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const end = `${year}-${String(month + 1).padStart(2, '0')}-31`;
      const txAll = await App.db.getTransactionsInRange(start, end, { memberId: App.state.globalMemberFilter || null });
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let html = '<div class="calendar-cell header">Dom</div><div class="calendar-cell header">Seg</div><div class="calendar-cell header">Ter</div><div class="calendar-cell header">Qua</div><div class="calendar-cell header">Qui</div><div class="calendar-cell header">Sex</div><div class="calendar-cell header">Sáb</div>';
      for (let i = 0; i < firstDay; i++) html += '<div class="calendar-cell"></div>';
      const today = new Date();
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayTx = txAll.filter(t => t.date === dateStr && t.type === 'expense' && t.status === 'confirmed');
        const total = dayTx.reduce((s, t) => s + parseFloat(t.amount), 0);
        const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
        let cls = 'calendar-cell' + (isToday ? ' today' : '') + (dayTx.length ? ' has-transactions' : '');
        html += `<div class="${cls}" onclick="App.calendar.openDay('${dateStr}')"><div class="day-number">${d}</div>${total > 0 ? `<div class="day-total">${App.utils.formatCurrency(total)}</div>` : ''}</div>`;
      }
      gridEl.innerHTML = html;
    } else if (this.currentView === 'weekly') {
      const start = new Date(this.currentDate);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(end.getDate() + 6);
      titleEl.textContent = `${App.utils.formatDate(start.toISOString().slice(0, 10))} - ${App.utils.formatDate(end.toISOString().slice(0, 10))}`;
      const txAll = await App.db.getTransactionsInRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), { memberId: App.state.globalMemberFilter || null });
      let html = '';
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const dayTx = txAll.filter(t => t.date === dateStr && t.type === 'expense' && t.status === 'confirmed');
        const total = dayTx.reduce((s, t) => s + parseFloat(t.amount), 0);
        const isToday = new Date().toDateString() === d.toDateString();
        let cls = 'calendar-cell' + (isToday ? ' today' : '') + (dayTx.length ? ' has-transactions' : '');
        html += `<div class="${cls}" onclick="App.calendar.openDay('${dateStr}')"><div class="day-number">${d.getDate()}/${d.getMonth() + 1}</div>${total > 0 ? `<div class="day-total">${App.utils.formatCurrency(total)}</div>` : ''}</div>`;
      }
      gridEl.innerHTML = html;
    } else if (this.currentView === 'annual') {
      const year = this.currentDate.getFullYear();
      titleEl.textContent = year;
      let html = '';
      for (let m = 0; m < 12; m++) {
        const start = `${year}-${String(m + 1).padStart(2, '0')}-01`;
        const end = `${year}-${String(m + 1).padStart(2, '0')}-31`;
        const monthTx = await App.db.getTransactionsInRange(start, end, { memberId: App.state.globalMemberFilter || null });
        const total = monthTx.filter(t => t.type === 'expense' && t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);
        html += `<div class="calendar-cell" onclick="App.calendar.goToMonth(${year},${m})"><div class="day-number">${new Date(year, m).toLocaleDateString('pt-BR', { month: 'short' })}</div><div class="day-total">${App.utils.formatCurrency(total)}</div></div>`;
      }
      gridEl.innerHTML = html;
    }
  },

  openDay(dateStr) {
    App.transactions.currentMonthStart = App.utils.monthRangeFromDate(dateStr).startDate;
    App.ui.navigateTo('transactions');
    App.transactions.load();
    App.ui.closeModal('modalCalendar');
  },

  goToMonth(year, month) {
    this.currentDate = new Date(year, month);
    this.currentView = 'monthly';
    document.getElementById('calendarView').value = 'monthly';
    this.render();
  }
};