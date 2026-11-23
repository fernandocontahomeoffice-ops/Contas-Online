// =====================================================================
// ARQUIVO: app.js
// Módulo principal: analytics, importExport, templates, cashflow,
// achievements, annual, reports, fontesPagadoras, search, etc.
// =====================================================================
var App = window.App || {};

// =======================================================================
// Analytics – otimizado com getTransactionsInRange
// =======================================================================
App.analytics = {
  currentMonthStart: null,
  _lineChart: null,
  _donutChart: null,
  _budgetChart: null,
  _projChart: null,
  _paymentChart: null,

  async refresh() {
    const period = document.getElementById('analyticsPeriod').value;
    if (period) {
      const [y, m] = period.split('-');
      this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate;
    } else if (!this.currentMonthStart) {
      this.currentMonthStart = App.utils.currentMonth().startDate;
    }
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const memberId = document.getElementById('analyticsMember').value;
    const accountId = document.getElementById('analyticsAccount').value;
    const periodInput = document.getElementById('analyticsPeriod');
    if (periodInput) { const d = new Date(this.currentMonthStart + 'T12:00:00'); periodInput.value = d.toISOString().slice(0, 7); }

    const extendedStart = App.utils.addMonths(cycle.start, -2);
    let txAll = await App.db.getTransactionsInRange(extendedStart, cycle.end);
    txAll = App.utils.applyGlobalMemberFilter(txAll);
    if (memberId !== 'all') txAll = txAll.filter(t => t.member_id === memberId);
    if (accountId !== 'all') txAll = txAll.filter(t => t.account_id === accountId || t.account_to_id === accountId);

    const periodTx = txAll.filter(t => t.status === 'confirmed');
    const periodTxAll = txAll;
    const prevCycle = App.utils.monthRangeFromDate(App.utils.addMonths(cycle.start, -1));
    const prevTxAll = await App.db.getTransactionsInRange(prevCycle.start, prevCycle.end);
    const prevTx = App.utils.applyGlobalMemberFilter(prevTxAll).filter(t => t.status === 'confirmed');

    await this.renderKPIs(periodTx, prevTx, periodTxAll);
    await this.renderLineChart(cycle.start);
    await this.renderDonut(periodTx);
    await this.renderBudgetComparison(cycle.start, cycle.end);
    await this.refreshProjection();
    await this.renderPaymentMethods(periodTx);
    await this.renderTopCategories(periodTx, prevTx);
    await this.renderAlerts(periodTx);
    await this.renderGoals();


    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;
    const memSel = document.getElementById('analyticsMember');
    if (memSel.options.length <= 1) memSel.innerHTML = '<option value="all">Todos membros</option>' + members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    const accSel = document.getElementById('analyticsAccount');
    if (accSel.options.length <= 1) accSel.innerHTML = '<option value="all">Todas contas</option>' + accounts.filter(a => !a.archived).map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  },
  prevMonth() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() - 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    const periodInput = document.getElementById('analyticsPeriod');
    if (periodInput) {
      const x = new Date(this.currentMonthStart + 'T12:00:00');
      periodInput.value = x.toISOString().slice(0, 7);
    }
    this.refresh();
  },
  nextMonth() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() + 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    const periodInput = document.getElementById('analyticsPeriod');
    if (periodInput) {
      const x = new Date(this.currentMonthStart + 'T12:00:00');
      periodInput.value = x.toISOString().slice(0, 7);
    }
    this.refresh();
  },

  async renderKPIs(periodTx, prevTx, periodTxAll = null) {
    const income = periodTx
      .filter(t => t.type === 'income' && !t.ignore_from_total)
      .filter(t => {
        const d = t.date.slice(0, 10);
        return d >= this.currentMonthStart.slice(0, 10) && d <= App.utils.monthRangeFromDate(this.currentMonthStart).end.slice(0, 10);
      })
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const prevIncome = prevTx.filter(t => t.type === 'income' && !t.ignore_from_total).reduce((s, t) => s + parseFloat(t.amount), 0);
    const allAccounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = allAccounts;
    const cards = App.cache.creditCards || await App.db.getAll('creditCards');
    const cats = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = cats;
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const prevCycle = App.utils.monthRangeFromDate(App.utils.addMonths(this.currentMonthStart, -1));

    // Usa todas as transações disponíveis para despesas (inclui pendentes)
    const allPeriod = periodTxAll || periodTx;

    // Despesas com vencimento de cartão
    // NOTA: "Pagamento Fatura" é quitação de dívida do cartão — o consumo real
    // já foi contabilizado quando as compras caíram no ciclo de vencimento.
    // Sem este filtro, a mesma fatura é contada duas vezes no KPI de Despesas.
    let expense = 0;
    for (const t of allPeriod) {
      if ((t.type !== 'expense' && t.type !== 'refund') || t.ignore_from_total) continue;
      if (t.category === 'Pagamento Fatura') continue;
      if (t.invoice_locked) continue;
      let eff = t.date.slice(0,10);
      if (t.credit_card_id) {
        const card = cards.find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, eff);
            eff = period.due.slice(0,10);
          } catch (e) {}
        }
      }
      if (eff >= cycle.start.slice(0,10) && eff <= cycle.end.slice(0,10)) {
        if (t.type === 'refund') expense -= parseFloat(t.amount);
        else expense += parseFloat(t.amount);
      }
    }

    let prevExpense = 0;
    for (const t of prevTx) {
      if (t.type !== 'expense' || t.ignore_from_total) continue;
      if (t.category === 'Pagamento Fatura') continue;
      let eff = t.date.slice(0,10);
      if (t.credit_card_id) {
        const card = cards.find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, eff);
            eff = period.due.slice(0,10);
          } catch (e) {}
        }
      }
      if (eff >= prevCycle.start.slice(0,10) && eff <= prevCycle.end.slice(0,10)) {
        prevExpense += parseFloat(t.amount);
      }
    }

    const balance = income - expense;
    const prevBalance = prevIncome - prevExpense;

    // Saldo Total consolidado (cache)
    const totalBalance = App.cache.totalBalance ?? App.utils.calculateBalance(allAccounts.filter(a => !a.archived), await App.db.getAll('transactions'));

    const pat = await App.db.getAll('patrimony');
    const assets = pat.filter(p => p.type === 'asset').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
    const liabilities = pat.filter(p => p.type === 'liability').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
    const invs = await App.db.getAll('investments');
    const totalInvestments = invs.reduce((s, inv) => s + (parseFloat(inv.current_value) || 0), 0);
    const netWorth = assets - liabilities + totalInvestments;

      // Custo de vida = despesas essenciais + necessárias, excluindo:
    //   - Transações travadas por pagamento de fatura (já contabilizadas no cartão)
    //   - Pagamentos de fatura (transferência de dívida, não consumo)
    //   - Saldo Inicial e Ajuste de Saldo (lançamentos técnicos)
    //   - Estornos são subtraídos quando a categoria-alvo entra no cálculo
    const CATEGORIAS_EXCLUIDAS_CUSTO_VIDA = new Set([
      'Pagamento Fatura',
      'Saldo Inicial',
      'Ajuste de Saldo'
    ]);

    let livingExpenses = 0;
    for (const t of allPeriod) {
      if ((t.type !== 'expense' && t.type !== 'refund') || t.ignore_from_total) continue;
      if (t.invoice_locked) continue;
      const categoriaTx = (t.category || '').trim();
      if (CATEGORIAS_EXCLUIDAS_CUSTO_VIDA.has(categoriaTx)) continue;

      let eff = t.date.slice(0, 10);
      if (t.credit_card_id) {
        const card = cards.find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, eff);
            eff = period.due.slice(0, 10);
          } catch (e) {}
        }
      }
      if (eff >= cycle.start.slice(0, 10) && eff <= cycle.end.slice(0, 10)) {
        const cat = cats.find(c => c.name === t.category);
        const cls = t.classification || cat?.classification || 'necessary';
        if (cls === 'essential' || cls === 'necessary') {
          if (t.type === 'refund') livingExpenses -= parseFloat(t.amount);
          else livingExpenses += parseFloat(t.amount);
        }
      }
    }

    const kpis = [
      { label: 'Saldo Total', value: totalBalance, prev: null, isCurrency: true, page: 'balance-detail' },
      { label: 'Receitas', value: income, prev: prevIncome, isCurrency: true, page: 'income-detail' },
      { label: 'Despesas', value: expense, prev: prevExpense, isCurrency: true, invert: true, page: 'expense-detail' },
      { label: 'Saldo Líquido', value: balance, prev: prevBalance, isCurrency: true, page: null },
      { label: 'Custo de Vida', value: livingExpenses, prev: null, isCurrency: true, page: 'costofliving-detail' },
      { label: 'Patrimônio Líquido', value: netWorth, prev: null, isCurrency: true, page: 'patrimony-evolution' }
    ];

    const container = document.getElementById('analyticsKPIs');
    container.innerHTML = kpis.map(k => {
      const trend = k.prev && k.prev !== 0 ? ((k.value - k.prev) / k.prev * 100).toFixed(1) : null;
      const trendClass = trend > 0 ? (k.invert ? 'down' : 'up') : (trend < 0 ? (k.invert ? 'up' : 'down') : '');
      const arrow = trend > 0 ? '↑' : (trend < 0 ? '↓' : '→');
      const kpiKeyMap = {
        'Saldo Total': 'totalBalance',
        'Receitas': 'income',
        'Despesas': 'expense',
        'Saldo Líquido': 'balance',
        'Custo de Vida': 'livingExpenses',
        'Patrimônio Líquido': 'netWorth'
      };
      const kpiKey = kpiKeyMap[k.label] || 'all';
      return `<div class="analytics-kpi" onclick="App.analyticsDetail.open('${kpiKey}')" style="cursor:pointer;" title="Clique para ver o detalhamento mensal">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.isCurrency ? App.utils.formatCurrency(k.value) : k.value}</div>
        ${trend !== null ? `<div class="kpi-trend ${trendClass}">${arrow} ${Math.abs(trend)}% vs anterior</div>` : ''}
      </div>`;
    }).join('');
  },

    async renderLineChart(cycleStart) {
    const canvas = document.getElementById('analyticsLineChart');
    if (!canvas) return;

    const periodo = document.getElementById('analyticsLineChartPeriod')?.value || 'all';

    let cycles = [];

    if (periodo === 'all') {
      const allTx = await App.db.getAll('transactions');
      if (allTx.length > 0) {
        const dates = allTx.map(t => new Date(t.date.slice(0, 10) + 'T12:00:00'));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
        while (cursor <= end) {
          cycles.push(App.utils.monthRangeFromDate(cursor.toISOString().slice(0, 10)));
          cursor.setMonth(cursor.getMonth() + 1);
        }
      }
    } else {
      const monthsBack = periodo === '3m' ? 3 : (periodo === '12m' ? 12 : 6);
      for (let i = monthsBack - 1; i >= 0; i--) {
        cycles.push(App.utils.monthRangeFromDate(App.utils.addMonths(cycleStart, -i)));
      }
    }

    if (cycles.length === 0) {
      const cur = App.utils.monthRangeFromDate(cycleStart);
      cycles.push(cur);
    }

    const data = [];
    for (const c of cycles) {
      const tx = await App.db.getTransactionsInRange(c.start, c.end, { memberId: App.state.globalMemberFilter || null, status: 'confirmed' });
      const d = new Date(c.start + 'T12:00:00');
      const mesAbrev = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      const anoCurto = String(d.getFullYear()).slice(2);
      data.push({
        label: `${mesAbrev}/${anoCurto}`,
        income: tx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0),
        expense: tx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0)
      });
    }

    if (this._lineChart) this._lineChart.destroy();
    this._lineChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'Receitas',
            data: data.map(d => d.income),
            // "Cortina": sólido no pico (onde estaria a linha), desvanecendo
            // até o eixo zero. O gradiente é calculado POR BARRA (usa o
            // pixel do valor real via `parsed.y`), então cada barra tem sua
            // própria cortina, mesmo as mais curtas.
            backgroundColor: (context) => {
              const chart = context.chart;
              const parsed = context.parsed;
              const ctx = chart?.ctx;
              if (!chart?.scales?.y || !parsed || !ctx) return 'rgba(0,212,170,0.85)';
              const yScale = chart.scales.y;
              const baseY = yScale.getPixelForValue(0);
              const peakY = yScale.getPixelForValue(parsed.y);
              if (!isFinite(baseY) || !isFinite(peakY) || baseY === peakY) return 'rgba(0,212,170,0.85)';
              const g = ctx.createLinearGradient(0, baseY, 0, peakY);
              g.addColorStop(0, 'rgba(0,212,170,0.04)');   // base (eixo) = transparente
              g.addColorStop(0.55, 'rgba(0,212,170,0.52)'); // meio = translúcido
              g.addColorStop(1, 'rgba(0,212,170,0.95)');   // pico (linha) = sólido
              return g;
            },
            borderWidth: 0,
            borderRadius: 4,
            stack: 'fluxo',
            barPercentage: 0.5,
            categoryPercentage: 0.6,
            maxBarThickness: 28
          },
          {
            label: 'Despesas',
            data: data.map(d => -d.expense),
            // Mesma lógica. Como despesas são negativas, o "pico" fica abaixo
            // do eixo; a inversão do gradiente é automática porque a base é
            // sempre getPixelForValue(0) e o pico é getPixelForValue(parsed.y).
            backgroundColor: (context) => {
              const chart = context.chart;
              const parsed = context.parsed;
              const ctx = chart?.ctx;
              if (!chart?.scales?.y || !parsed || !ctx) return 'rgba(255,71,87,0.85)';
              const yScale = chart.scales.y;
              const baseY = yScale.getPixelForValue(0);
              const peakY = yScale.getPixelForValue(parsed.y);
              if (!isFinite(baseY) || !isFinite(peakY) || baseY === peakY) return 'rgba(255,71,87,0.85)';
              const g = ctx.createLinearGradient(0, baseY, 0, peakY);
              g.addColorStop(0, 'rgba(255,71,87,0.04)');
              g.addColorStop(0.55, 'rgba(255,71,87,0.52)');
              g.addColorStop(1, 'rgba(255,71,87,0.95)');
              return g;
            },
            borderWidth: 0,
            borderRadius: 4,
            stack: 'fluxo',
            barPercentage: 0.5,
            categoryPercentage: 0.6,
            maxBarThickness: 28
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: {
            ticks: { color: '#888', autoSkip: true, maxRotation: 0, autoSkipPadding: 12 },
            grid: { color: '#1f1f1f' }
          },
          y: {
            stacked: false,
            ticks: {
              color: '#888',
              callback: v => App.utils.formatCurrency(Math.abs(v))
            },
            grid: { color: '#1f1f1f' }
          }
        },
        plugins: {
          legend: { labels: { color: '#b0b0b0' } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${App.utils.formatCurrency(Math.abs(ctx.raw))}`
            }
          }
        }
      }
    });
  },

  refreshLineChart() {
    const start = this.currentMonthStart || App.utils.currentMonth().startDate;
    this.renderLineChart(start);
  },

  async renderDonut(periodTx) {
    const canvas = document.getElementById('analyticsDonutChart');
    if (!canvas) return;

    // Filtro robusto: exclui "Pagamento Fatura" e QUALQUER variação
    // ("Pagamento de Fatura", "Pagamento da Fatura", "Pagamento Fatura Nubank",
    // minúsculas, espaços extras, com/sem acento).
    // "Pagamento Fatura" é quitação de dívida do cartão — o consumo real já foi
    // contabilizado quando as compras caíram no ciclo de vencimento da fatura.
    const _isFaturaPayment = (cat) => {
      if (!cat) return false;
      const norm = String(cat)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      return norm.startsWith('pagamento') && norm.includes('fatura');
    };

    const groups = {};
    periodTx
      .filter(t => t.type === 'expense' && !_isFaturaPayment(t.category))
      .forEach(t => { groups[t.category || 'Outros'] = (groups[t.category || 'Outros'] || 0) + parseFloat(t.amount); });

    let entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);

    // Se houver muitas categorias, agrupa as menores em "Outros (N)" para
    // evitar poluição visual e sobreposição de labels externos.
    const MAX_SLICES = 10;
    if (entries.length > MAX_SLICES) {
      const top = entries.slice(0, MAX_SLICES - 1);
      const rest = entries.slice(MAX_SLICES - 1);
      const restSum = rest.reduce((s, [, v]) => s + v, 0);
      top.push([`Outros (${rest.length})`, restSum]);
      entries = top;
    }

    if (!entries.length) { canvas.style.display = 'none'; return; }
    canvas.style.display = 'block';

    if (this._donutChart) this._donutChart.destroy();

    const isLight = document.body.classList.contains('light-mode');
    const borderColor = isLight ? '#ffffff' : '#0a0a0a';

    // Plugin: desenha labels externos com linhas de conexão (leader lines)
    // saindo de cada segmento do donut até a legenda posicionada à esquerda
    // ou à direita. Distribui verticalmente para evitar sobreposição.
    const outerLabelsPlugin = {
      id: 'outerLabels',
      afterDraw(chart) {
        const { ctx, chartArea, data } = chart;
        if (!chartArea) return;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || !meta.data.length) return;

        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top + chartArea.bottom) / 2;
        const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
        if (total <= 0) return;

        const isLightChart = document.body.classList.contains('light-mode');
        const textColor = isLightChart ? '#181818' : '#e5e7eb';
        const subTextColor = isLightChart ? '#737373' : '#9ca3af';
        const lineColor = isLightChart ? 'rgba(24,24,24,0.25)' : 'rgba(229,231,235,0.32)';
        const colors = App.config.COLORS;

        const items = [];
        data.labels.forEach((label, i) => {
          const arc = meta.data[i];
          if (!arc) return;
          const midAngle = (arc.startAngle + arc.endAngle) / 2;
          const x = cx + Math.cos(midAngle) * arc.outerRadius;
          const y = cy + Math.sin(midAngle) * arc.outerRadius;
          const isRight = Math.cos(midAngle) >= 0;
          const value = data.datasets[0].data[i];
          const pct = (value / total) * 100;
          items.push({
            label, value, pct, x, y, isRight, midAngle,
            color: colors[i % colors.length]
          });
        });

        const right = items.filter(i => i.isRight).sort((a, b) => a.y - b.y);
        const left = items.filter(i => !i.isRight).sort((a, b) => a.y - b.y);

        const minGap = 34;
        const topBound = chartArea.top + 16;
        const bottomBound = chartArea.bottom - 16;

        const adjustY = (arr) => {
          if (!arr.length) return arr;
          for (let i = 1; i < arr.length; i++) {
            if (arr[i].y - arr[i - 1].y < minGap) arr[i].y = arr[i - 1].y + minGap;
          }
          const overflow = arr[arr.length - 1].y - bottomBound;
          if (overflow > 0) {
            arr[arr.length - 1].y -= overflow;
            for (let i = arr.length - 2; i >= 0; i--) {
              if (arr[i].y > arr[i + 1].y - minGap) arr[i].y = arr[i + 1].y - minGap;
            }
          }
          if (arr[0].y < topBound) {
            const offset = topBound - arr[0].y;
            arr.forEach(it => { it.y += offset; });
          }
          return arr;
        };

        adjustY(right);
        adjustY(left);

        ctx.save();
        ctx.textBaseline = 'middle';

        const labelPad = 12;
        const canvasW = chart.width;

        const drawLabel = (item, isRightSide) => {
          const elbowX = isRightSide ? chartArea.right + 18 : chartArea.left - 18;
          const labelX = isRightSide ? canvasW - labelPad : labelPad;
          const textX = isRightSide ? labelX : labelX;

          // Linha de conexão (donut → cotovelo → horizontal até o texto)
          ctx.beginPath();
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 1.2;
          ctx.moveTo(item.x, item.y);
          ctx.lineTo(elbowX, item.y);
          ctx.lineTo(textX, item.y);
          ctx.stroke();

          // Ponto na borda do donut (marcador colorido)
          ctx.beginPath();
          ctx.fillStyle = item.color;
          ctx.arc(item.x, item.y, 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Texto alinhado conforme o lado
          ctx.textAlign = isRightSide ? 'right' : 'left';
          const finalTextX = isRightSide ? labelX : labelX;

          const safeLabel = item.label.length > 22 ? item.label.slice(0, 20) + '…' : item.label;

          // Linha 1 — nome da categoria
          ctx.font = "600 12px 'Manrope', 'Inter', sans-serif";
          ctx.fillStyle = textColor;
          ctx.fillText(safeLabel, finalTextX, item.y - 8);

          // Linha 2 — percentual + valor
          ctx.font = "500 11px 'Manrope', 'Inter', sans-serif";
          ctx.fillStyle = subTextColor;
          const pctStr = item.pct.toFixed(1) + '%';
          const valStr = App.utils.formatCurrency(item.value);
          ctx.fillText(`${pctStr} · ${valStr}`, finalTextX, item.y + 8);
        };

        right.forEach(it => drawLabel(it, true));
        left.forEach(it => drawLabel(it, false));

        ctx.restore();
      }
    };

    this._donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((_, i) => App.config.COLORS[i % App.config.COLORS.length]),
          borderColor,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        layout: {
          // Reserva espaço nas laterais para os labels externos.
          padding: { top: 20, bottom: 20, left: 170, right: 170 }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${App.utils.formatCurrency(ctx.raw)}` } },
          datalabels: {
            // Mostra a porcentagem DENTRO de cada fatia, mas apenas quando ela
            // for grande o suficiente (>= 4%) para o texto caber sem espremer.
            display: (ctx) => {
              const value = ctx.dataset.data[ctx.dataIndex];
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return total > 0 && (value / total) >= 0.04;
            },
            formatter: (value, ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return total > 0 ? ((value / total) * 100).toFixed(0) + '%' : '';
            },
            color: '#ffffff',
            textStrokeColor: 'rgba(0,0,0,0.65)',
            textStrokeWidth: 3,
            font: { weight: '700', size: 13, family: "'Manrope','Inter',sans-serif" },
            anchor: 'center',
            align: 'center'
          }
        }
      },
      plugins: [outerLabelsPlugin, ...(App.utils.registerChartDataLabelsOnce(), App.utils.getChartDataLabelsPlugin())]
    });
  },

  async renderPaymentMethods(periodTx) {
    const canvas = document.getElementById('analyticsPaymentChart');
    if (!canvas) return;

    // Filtro robusto de "Pagamento Fatura" (mesma lógica do renderDonut):
    // quitação de dívida do cartão não é consumo e não deve inflar o gráfico.
    const _isFaturaPayment = (cat) => {
      if (!cat) return false;
      const norm = String(cat)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      return norm.startsWith('pagamento') && norm.includes('fatura');
    };

    const methodLabels = {
      pix: 'Pix',
      credit_card: 'Crédito',
      debit_card: 'Débito',
      cash: 'Dinheiro',
      transfer: 'Transferência',
      boleto: 'Boleto',
      vale_alimentacao: 'Vale Alimentação'
    };

    const groups = {};
    periodTx
      .filter(t => t.type === 'expense' && !_isFaturaPayment(t.category))
      .forEach(t => {
        let method = (t.payment_method || '').trim();
        // Compras de cartão de crédito são sempre "Crédito", independente do
        // payment_method gravado (que pode estar vazio em importações antigas).
        if (t.credit_card_id) method = 'credit_card';
        if (!method) method = 'nao_informado';
        const label = methodLabels[method] || (method === 'nao_informado' ? 'Não informado' : method);
        groups[label] = (groups[label] || 0) + parseFloat(t.amount || 0);
      });

    const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { canvas.style.display = 'none'; return; }
    canvas.style.display = 'block';

    const total = entries.reduce((s, [, v]) => s + v, 0);

    // Paleta dedicada por método — cores previsíveis para o usuário
    // reconhecer visualmente cada forma de pagamento.
    const palette = {
      'Crédito': '#60a5fa',
      'Pix': '#a3e635',
      'Débito': '#f59e0b',
      'Dinheiro': '#a78bfa',
      'Transferência': '#34d399',
      'Boleto': '#f87171',
      'Vale Alimentação': '#fb923c',
      'Não informado': '#6b7280'
    };
    const fallbackColors = App.config.COLORS;

    const isLight = document.body.classList.contains('light-mode');
    const axisColor = isLight ? '#595959' : '#888';
    const labelColor = isLight ? '#181818' : '#b0b0b0';
    const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';

    if (this._paymentChart) this._paymentChart.destroy();
    this._paymentChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((e, i) => palette[e[0]] || fallbackColors[i % fallbackColors.length]),
          borderRadius: 6,
          barThickness: 30
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 60 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : '0.0';
                return `${pct}% · ${App.utils.formatCurrency(ctx.raw)}`;
              }
            }
          },
          datalabels: {
            anchor: 'end',
            align: 'right',
            offset: 6,
            formatter: (value) => {
              return total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '';
            },
            color: labelColor,
            font: { weight: '600', size: 11, family: "'Manrope','Inter',sans-serif" }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: axisColor, callback: v => App.utils.formatCurrency(v) },
            grid: { color: gridColor }
          },
          y: {
            ticks: { color: axisColor, font: { size: 12, weight: '600' } },
            grid: { display: false }
          }
        }
      },
      plugins: (App.utils.registerChartDataLabelsOnce(), App.utils.getChartDataLabelsPlugin())
    });
  },

  async renderBudgetComparison(cycleStart, cycleEnd) {
    const canvas = document.getElementById('analyticsBudgetChart');
    if (!canvas) return;
    const isLight = document.body.classList.contains('light-mode');
    const tickColor = isLight ? '#555555' : '#888888';
    const gridColor = isLight ? '#eaeaea' : '#1f1f1f';
    const legendColor = isLight ? '#333333' : '#b0b0b0';

    const [planos, budgets, transactions, categories, cards] = await Promise.all([
      App.db.getAll('planosOrcamentarios'),
      App.db.getAll('budgets'),
      App.db.getAll('transactions'),
      App.cache.categories ? Promise.resolve(App.cache.categories) : App.db.getAll('categories'),
      App.cache.creditCards ? Promise.resolve(App.cache.creditCards) : App.db.getAll('creditCards')
    ]);
    if (!App.cache.categories) App.cache.categories = categories;
    if (!App.cache.creditCards) App.cache.creditCards = cards;

    let labels = [];
    let planned = [];
    let realized = [];

    if (App.planningEngine && planos.length > 0) {
      const targetYm = App.planningEngine.normalizeMonthKey(cycleStart) || App.planningEngine.currentMonthKey();
      const activePlan = App.planningEngine.findActivePlanForMonth(planos, targetYm) || planos[0];
      const cardsMap = {};
      cards.forEach(c => { cardsMap[c.id] = c; });
      const getInvoiceDueFn = (card, dateStr) => {
        if (App.cardInvoice && typeof App.cardInvoice.getInvoicePeriodForDate === 'function') {
          const p = App.cardInvoice.getInvoicePeriodForDate(card, dateStr);
          return p && p.due ? p.due.slice(0, 10) : dateStr;
        }
        return dateStr;
      };
      const evalData = App.planningEngine.computePlanEvaluation({
        plan: activePlan,
        budgets,
        transactions,
        categories,
        scope: 'month',
        targetMonth: targetYm,
        memberId: App.state.globalMemberFilter || null,
        cardsMap,
        getInvoiceDueFn,
        refDateOrMonth: targetYm
      });
      const activeRows = evalData.categories.filter(r => r.planned > 0 || r.realized > 0).slice(0, 12);
      labels = activeRows.map(r => r.name);
      planned = activeRows.map(r => r.planned);
      realized = activeRows.map(r => r.realized);
    } else {
      const cycleBudgets = budgets.filter(b => b.cycle_start === cycleStart && b.cycle_end === cycleEnd);
      const periodTx = await App.db.getTransactionsInRange(cycleStart, cycleEnd, { memberId: App.state.globalMemberFilter || null, status: 'confirmed' });
      const cats = categories.filter(c => c.type === 'expense');
      labels = cats.map(c => c.name);
      planned = cats.map(cat => {
        const bud = cycleBudgets.find(b => b.category === cat.name);
        return bud ? parseFloat(bud.amount) : 0;
      });
      realized = cats.map(cat => periodTx.filter(t => t.category === cat.name && t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
    }

    if (this._budgetChart) this._budgetChart.destroy();
    this._budgetChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Sem dados'],
        datasets: [
          { label: 'Orçado', data: planned.length ? planned : [0], backgroundColor: isLight ? '#cbd5e1' : '#4a5568', borderRadius: 6 },
          { label: 'Realizado', data: realized.length ? realized : [0], backgroundColor: isLight ? '#0e6854' : '#a3e635', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: tickColor, maxRotation: 45 }, grid: { color: gridColor } },
          y: { ticks: { color: tickColor, callback: v => App.utils.formatCurrency(v) }, grid: { color: gridColor } }
        },
        plugins: {
          legend: { labels: { color: legendColor } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${App.utils.formatCurrency(ctx.raw)}` } }
        }
      }
    });
  },

  async refreshProjection() {
    const days = parseInt(document.getElementById('projectionDays')?.value) || 60;
    const accounts = (App.cache.accounts || await App.db.getAll('accounts')).filter(a => !a.archived);
    if (!App.cache.accounts) App.cache.accounts = await App.db.getAll('accounts');
    const today = App.utils.todayISO();
    const endDate = new Date(today + 'T12:00:00');
    endDate.setDate(endDate.getDate() + days);
    const futureStr = endDate.toISOString().slice(0, 10);
    const txAll = await App.db.getTransactionsInRange('2000-01-01', futureStr, { memberId: App.state.globalMemberFilter || null });
    const balanceMap = {};
    accounts.forEach(a => { balanceMap[a.id] = a.initial_balance || 0; });
    txAll.forEach(t => {
      if (t.date > today || t.ignore_from_total) return;
      if (t.status !== 'confirmed' && t.status !== 'pending') return;
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
      else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
      else if (t.type === 'transfer' || t.type === 'contribution') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
      else if (t.type === 'withdrawal') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
    });
    let currentBalance = accounts.reduce((s, a) => s + (balanceMap[a.id] || 0), 0);
    const futureTx = txAll.filter(t => t.date > today && t.date <= futureStr && !t.ignore_from_total && (t.status === 'confirmed' || t.status === 'pending')).sort((a, b) => a.date.localeCompare(b.date));
    let balance = currentBalance, points = [];
    for (let d = new Date(today + 'T12:00:00'); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayTx = futureTx.filter(t => t.date === dateStr);
      let impact = 0;
      dayTx.forEach(t => {
        const amt = parseFloat(t.amount);
        if (t.type === 'income' || t.type === 'refund') impact += amt;
        else if (t.type === 'expense') impact -= amt;
        else if (t.type === 'transfer' || t.type === 'contribution') { if (t.account_id) impact -= amt; if (t.account_to_id) impact += amt; }
        else if (t.type === 'withdrawal') { if (t.account_id) impact -= amt; if (t.account_to_id) impact += amt; }
      });
      balance += impact; points.push({ date: dateStr, balance });
    }
    const canvas = document.getElementById('analyticsProjectionChart');
    if (!canvas) return;
    if (this._projChart) this._projChart.destroy();
    this._projChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map(p => App.utils.formatDateTime(p.date).slice(0, 5)),
        datasets: [{
          data: points.map(p => p.balance),
          borderColor: '#00d4aa',
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: '#1f1f1f' } },
          y: { ticks: { color: '#888', callback: v => App.utils.formatCurrency(v) }, grid: { color: '#1f1f1f' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  },

  async renderTopCategories(periodTx, prevTx) {
    const now = {}, prev = {};
    periodTx
      .filter(t => t.type === 'expense' && t.category !== 'Pagamento Fatura')
      .forEach(t => { now[t.category] = (now[t.category] || 0) + parseFloat(t.amount); });
    prevTx
      .filter(t => t.type === 'expense' && t.category !== 'Pagamento Fatura')
      .forEach(t => { prev[t.category] = (prev[t.category] || 0) + parseFloat(t.amount); });
    const sorted = Object.entries(now).map(([cat, val]) => ({ cat, val, prev: prev[cat] || 0, change: prev[cat] ? ((val - prev[cat]) / prev[cat] * 100).toFixed(1) : 100 })).sort((a, b) => b.change - a.change).slice(0, 5);
    document.getElementById('analyticsTopCategories').innerHTML = sorted.map(c => `<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>${c.cat}</span><span style="color:${c.change > 0 ? 'var(--income)' : 'var(--expense)'};">${c.change > 0 ? '+' : ''}${c.change}%</span></div>`).join('') || '<p>Sem dados</p>';
  },

  async renderAlerts(periodTx) {
    const averages = {};
    periodTx
      .filter(t => t.type === 'expense' && t.category !== 'Pagamento Fatura')
      .forEach(t => {
        if (!averages[t.category]) averages[t.category] = { sum: 0, count: 0 };
        averages[t.category].sum += parseFloat(t.amount);
        averages[t.category].count += 1;
      });
    const alerts = [];
    periodTx.forEach(t => {
      if (t.type !== 'expense') return;
      if (t.category === 'Pagamento Fatura') return;
      const avg = averages[t.category] ? averages[t.category].sum / averages[t.category].count : 0;
      if (parseFloat(t.amount) > avg * 2 && avg > 0) {
        alerts.push(`${t.description || t.category}: ${App.utils.formatCurrency(t.amount)} (média: ${App.utils.formatCurrency(avg)})`);
        App.utils.addAlert(`⚠️ Gasto atípico: ${t.description || t.category} — ${App.utils.formatCurrency(t.amount)} (média: ${App.utils.formatCurrency(avg)})`, 'warning');
      }
    });
    document.getElementById('analyticsAlerts').innerHTML = alerts.length ? alerts.map(a => `<div>⚠️ ${a}</div>`).join('') : '<p>Nenhum gasto atípico</p>';
  },

  async renderGoals() {
    const goals = await App.db.getAll('goals');
    const today = new Date();
    const upcoming = goals.filter(g => g.deadline && new Date(g.deadline) <= new Date(today.getTime() + 30 * 86400000));
    document.getElementById('analyticsGoals').innerHTML = upcoming.length ? upcoming.map(g => {
      const saved = g.saved || 0;
      const progress = Math.min((saved / g.target_amount) * 100, 100);
      const daysLeft = Math.ceil((new Date(g.deadline + 'T12:00:00') - today) / 86400000);
      return `<div style="margin-bottom:8px;"><strong>${g.name}</strong> (${daysLeft}d)<div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${progress}%"></div></div></div>`;
    }).join('') : '<p>Nenhuma meta próxima</p>';
  }
};

// =======================================================================
// Import/Export (com otimizações de performance, Blob Worker e barra de progresso)
// =======================================================================
App.importExport = {
  _importCancelled: false,
  _worker: null,

  async exportCSV() {
    const tx = await App.db.getAll('transactions');
    const headers = ['type','amount','category','description','date','account','member','status','reconciled'];
    const data = tx.map(t => [t.type, t.amount, t.category, t.description||'', t.date, t.account_name||'', t.member_name||'', t.status||'confirmed', t.reconciled?'true':'false']);
    App.utils.exportCSV('transactions.csv', headers, data);
  },

  async exportJSON() {
    const data = {
      transactions: await App.db.getAll('transactions'),
      accounts: await App.db.getAll('accounts'),
      members: await App.db.getAll('members'),
      creditCards: await App.db.getAll('creditCards'),
      investments: await App.db.getAll('investments'),
      investmentHistory: await App.db.getAll('investmentHistory'),
      patrimony: await App.db.getAll('patrimony'),
      goals: await App.db.getAll('goals'),
      wishes: await App.db.getAll('wishes'),
      receipts: await App.db.getAll('receipts'),
      budgets: await App.db.getAll('budgets'),
      loans: await App.db.getAll('loans'),
      transactionTemplates: await App.db.getAll('transactionTemplates'),
      receiptFolders: await App.db.getAll('receiptFolders'),
      vehicles: await App.db.getAll('vehicles'),
      vehicleExpenses: await App.db.getAll('vehicleExpenses'),
      previdencia: await App.db.getAll('previdencia'),
      categories: await App.db.getAll('categories'),
      manualIncomes: await App.db.getAll('manualIncomes'),
      fontesPagadoras: await App.db.getAll('fontesPagadoras'),
      planosOrcamentarios: await App.db.getAll('planosOrcamentarios'),
      indicatorHistory: await App.db.getAll('indicatorHistory'),
      app_indicators: App.config.INDICATORS
    };
    const jsonString = JSON.stringify(data, null, 2);
    await this._downloadCompressed(jsonString, 'backup_contasonline.json');
    localStorage.setItem('last_backup_date', new Date().toISOString());
  },

  async exportOFX() {
    const tx = await App.db.getAll('transactions');
    const now = new Date().toISOString().slice(0, 10);
    let ofx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n<SIGNONMSGSRSV1>\n<SONRS>\n<STATUS>\n<CODE>0\n<SEVERITY>INFO\n</STATUS>\n<DTSERVER>${now}000000\n<LANGUAGE>POR\n</SONRS>\n</SIGNONMSGSRSV1>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<STMTRS>\n<CURDEF>BRL\n<BANKACCTFROM>\n<ACCTID>99999\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>\n<BANKTRANLIST>\n`;
    tx.forEach(t => {
      ofx += `<STMTTRN>\n<TRNTYPE>${t.type==='income'?'CREDIT':'DEBIT'}\n<DTPOSTED>${t.date}000000\n<TRNAMT>${t.type==='expense'?'-':''}${t.amount}\n<MEMO>${t.description||t.category||''}\n</STMTTRN>\n`;
    });
    ofx += `</BANKTRANLIST>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n`;
    this._download(ofx, 'extrato.ofx');
    App.utils.showToast('Arquivo OFX exportado!');
  },

  async exportFull() {
    const data = {
      transactions: await App.db.getAll('transactions'),
      accounts: await App.db.getAll('accounts'),
      members: await App.db.getAll('members'),
      creditCards: await App.db.getAll('creditCards'),
      investments: await App.db.getAll('investments'),
      investmentHistory: await App.db.getAll('investmentHistory'),
      accountHistory: await App.db.getAll('accountHistory'),
      creditLimitHistory: await App.db.getAll('creditLimitHistory'),
      patrimony: await App.db.getAll('patrimony'),
      goals: await App.db.getAll('goals'),
      wishes: await App.db.getAll('wishes'),
      receipts: await App.db.getAll('receipts'),
      budgets: await App.db.getAll('budgets'),
      loans: await App.db.getAll('loans'),
      transactionTemplates: await App.db.getAll('transactionTemplates'),
      receiptFolders: await App.db.getAll('receiptFolders'),
      vehicles: await App.db.getAll('vehicles'),
      vehicleExpenses: await App.db.getAll('vehicleExpenses'),
      previdencia: await App.db.getAll('previdencia'),
      categories: await App.db.getAll('categories'),
      manualIncomes: await App.db.getAll('manualIncomes'),
      notifications: await App.db.getAll('notifications'),
      fontesPagadoras: await App.db.getAll('fontesPagadoras'),
      planosOrcamentarios: await App.db.getAll('planosOrcamentarios'),
      indicatorHistory: await App.db.getAll('indicatorHistory'),
      app_indicators: App.config.INDICATORS
    };
    const jsonString = JSON.stringify(data, null, 2);
    await this._downloadCompressed(jsonString, 'backup_contasonline_completo.json');
    localStorage.setItem('last_backup_date', new Date().toISOString());
    App.utils.showToast('Backup completo exportado!');
  },

  // 1. Backup apenas de operações (sem veículos/imagens/receipts)
  async exportOperacoes() {
    const data = {
      transactions: await App.db.getAll('transactions'),
      accounts: await App.db.getAll('accounts'),
      members: await App.db.getAll('members'),
      creditCards: await App.db.getAll('creditCards'),
      investments: await App.db.getAll('investments'),
      investmentHistory: await App.db.getAll('investmentHistory'),
      patrimony: await App.db.getAll('patrimony'),
      goals: await App.db.getAll('goals'),
      wishes: await App.db.getAll('wishes'),
      budgets: await App.db.getAll('budgets'),
      loans: await App.db.getAll('loans'),
      transactionTemplates: await App.db.getAll('transactionTemplates'),
      categories: await App.db.getAll('categories'),
      manualIncomes: await App.db.getAll('manualIncomes'),
      fontesPagadoras: await App.db.getAll('fontesPagadoras'),
      planosOrcamentarios: await App.db.getAll('planosOrcamentarios'),
      indicatorHistory: await App.db.getAll('indicatorHistory'),
      app_indicators: App.config.INDICATORS
    };
    this._download(JSON.stringify(data, null, 2), 'backup_operacoes.json');
    App.utils.showToast('Backup de operações exportado (sem imagens/veículos)');
    localStorage.setItem('last_backup_date', new Date().toISOString());
  },

  // 2. Backup completo com imagens (inclui vehicles, vehicleExpenses, receipts, etc.)
  async exportCompletoComImagens() {
    const data = {
      transactions: await App.db.getAll('transactions'),
      accounts: await App.db.getAll('accounts'),
      members: await App.db.getAll('members'),
      creditCards: await App.db.getAll('creditCards'),
      investments: await App.db.getAll('investments'),
      investmentHistory: await App.db.getAll('investmentHistory'),
      patrimony: await App.db.getAll('patrimony'),
      goals: await App.db.getAll('goals'),
      wishes: await App.db.getAll('wishes'),
      receipts: await App.db.getAll('receipts'),
      budgets: await App.db.getAll('budgets'),
      loans: await App.db.getAll('loans'),
      transactionTemplates: await App.db.getAll('transactionTemplates'),
      receiptFolders: await App.db.getAll('receiptFolders'),
      vehicles: await App.db.getAll('vehicles'),
      vehicleExpenses: await App.db.getAll('vehicleExpenses'),
      previdencia: await App.db.getAll('previdencia'),
      categories: await App.db.getAll('categories'),
      manualIncomes: await App.db.getAll('manualIncomes'),
      fontesPagadoras: await App.db.getAll('fontesPagadoras'),
      planosOrcamentarios: await App.db.getAll('planosOrcamentarios'),
      indicatorHistory: await App.db.getAll('indicatorHistory'),
      app_indicators: App.config.INDICATORS
    };
    this._download(JSON.stringify(data, null, 2), 'backup_completo_imagens.json');
    App.utils.showToast('Backup completo com imagens exportado');
    localStorage.setItem('last_backup_date', new Date().toISOString());
  },

  // 3. Backup completo comprimido (GZIP) – inclui tudo: notifications, categories, etc.
  async exportCompletoComprimido() {
    const data = {
      transactions: await App.db.getAll('transactions'),
      accounts: await App.db.getAll('accounts'),
      members: await App.db.getAll('members'),
      creditCards: await App.db.getAll('creditCards'),
      investments: await App.db.getAll('investments'),
      investmentHistory: await App.db.getAll('investmentHistory'),
      accountHistory: await App.db.getAll('accountHistory'),
      creditLimitHistory: await App.db.getAll('creditLimitHistory'),
      patrimony: await App.db.getAll('patrimony'),
      goals: await App.db.getAll('goals'),
      wishes: await App.db.getAll('wishes'),
      receipts: await App.db.getAll('receipts'),
      budgets: await App.db.getAll('budgets'),
      loans: await App.db.getAll('loans'),
      transactionTemplates: await App.db.getAll('transactionTemplates'),
      receiptFolders: await App.db.getAll('receiptFolders'),
      vehicles: await App.db.getAll('vehicles'),
      vehicleExpenses: await App.db.getAll('vehicleExpenses'),
      previdencia: await App.db.getAll('previdencia'),
      categories: await App.db.getAll('categories'),
      manualIncomes: await App.db.getAll('manualIncomes'),
      notifications: await App.db.getAll('notifications'),
      fontesPagadoras: await App.db.getAll('fontesPagadoras'),
      planosOrcamentarios: await App.db.getAll('planosOrcamentarios'),
      indicatorHistory: await App.db.getAll('indicatorHistory'),
      app_indicators: App.config.INDICATORS
    };
    const jsonString = JSON.stringify(data, null, 2);
    await this._downloadCompressed(jsonString, 'backup_completo_comprimido.json.gz');
    App.utils.showToast('Backup comprimido exportado (GZIP)');
    localStorage.setItem('last_backup_date', new Date().toISOString());
  },

  async handleImport(e) {
    const file = e.target.files[0]; if (!file) return;
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      await this._importCSV(text);
    } else if (file.name.endsWith('.json') || file.name.endsWith('.json.gz')) {
      const buffer = await file.arrayBuffer();
      const jsonText = await this._decompressIfNeeded(buffer);
      await this._importJSON(jsonText);
    } else if (file.name.endsWith('.xlsx')) {
      await this._importXLSX(file);
    } else if (file.name.endsWith('.ofx')) {
      const text = await file.text();
      await this._importOFX(text);
    }
    e.target.value = '';
  },

  async _importCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(','); if (vals.length < 3) continue;
      const obj = {}; headers.forEach((h, idx) => obj[h] = vals[idx]?.trim() || '');
      if (!['income','expense','transfer','contribution','withdrawal','refund'].includes(obj.type)) continue;
      await App.db.put('transactions', {
        id: App.utils.generateId(), type: obj.type, amount: parseFloat(obj.amount), category: obj.category,
        description: obj.description, date: obj.date, account_name: obj.account, member_name: obj.member,
        classification:'', payment_method:'', receipt_url:'', investment_id:null, purchase_date:'',
        installment_id:null, installments:1, installment_number:1, recurring:false, vacation:false,
        credit_card_id:null, account_to_id:null, account_to_name:null,
        status: obj.status || 'confirmed', reconciled: obj.reconciled === 'true', ignore_from_total: false, createdAt: new Date().toISOString()
      });
      count++;
    }
    App.utils.showToast(`${count} importadas`); App.transactions.load(); App.dashboard.refresh(); App.panel.refresh(); App.saldos.load();
  },

  async _importJSON(text) {
    const data = JSON.parse(text);
    App.db._suppressAutoBackup = true;
    try {
    const existingMembers = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = existingMembers;
    const memberNames = new Set(existingMembers.map(m => m.name.toLowerCase()));
    const jsonMembers = data['members'] || [];
    const allMemberNames = new Set(memberNames);

    // Importação padrão para members, accounts e creditCards (sem categorias –
    // estas têm tratamento especial logo abaixo).
    for (const store of ['members', 'accounts', 'creditCards']) {
      if (data[store] && data[store].length) {
        const itemsToPut = [];
        for (const item of data[store]) {
          if (!item.id) item.id = App.utils.generateId();
          if (store === 'members') {
            if (allMemberNames.has(item.name.toLowerCase())) continue;
            allMemberNames.add(item.name.toLowerCase());
          }
          if (store === 'accounts') {
            const existingAccounts = App.cache.accounts || await App.db.getAll('accounts');
            if (!App.cache.accounts) App.cache.accounts = existingAccounts;
            if (existingAccounts.some(a => a.name.toLowerCase() === item.name.toLowerCase())) continue;
          }
          itemsToPut.push(item);
        }
        if (itemsToPut.length) await App.db.putMany(store, itemsToPut);
      }
    }

    // ===== IMPORTAÇÃO ESPECIAL DE CATEGORIAS =====
    // Preserva a hierarquia (parent_id) mesmo quando os ids do backup são
    // diferentes dos ids já existentes no banco. O casamento é feito por NOME
    // (case-insensitive), então a transformação "Carro - Manutenção em
    // subcategoria de Transporte" é restaurada corretamente mesmo que o
    // seedIfEmpty tenha recriado essas categorias com ids novos.
    if (data['categories'] && data['categories'].length) {
      const existingCats = await App.db.getAll('categories');

      // Mapa nome-normalizado → id existente no banco
      // Casa por NOME + TIPO. Permite que "Outros" (expense) e "Outros" (income)
      // coexistam sem um sobrescrever o outro.
      const existingByName = new Map();
      existingCats.forEach(c => {
        if (c && c.name) {
          const key = `${c.name.toLowerCase().trim()}|||${c.type || 'expense'}`;
          existingByName.set(key, c.id);
        }
      });

      // Mapa id_do_backup → id_final (existente reaproveitado ou novo)
      const idMap = new Map();

      // 1ª passada: garantir que cada categoria do backup exista no banco,
      // atualizando os campos descritivos (tipo, classificação, cor, ícone,
      // arquivada). O parent_id é tratado na 2ª passada.
      for (const item of data['categories']) {
        if (!item || !item.name) continue;
        const nameKey = `${item.name.toLowerCase().trim()}|||${item.type || 'expense'}`;
        const existingId = existingByName.get(nameKey);

        if (existingId) {
          // Já existe uma categoria com este nome → atualiza os campos,
          // preservando o id atual (que pode estar referenciado em transações).
          const current = await App.db.getById('categories', existingId);
          if (current) {
            const merged = {
              ...current,
              type: item.type || current.type,
              classification: item.classification || current.classification || 'necessary',
              color: item.color || current.color,
              icon: item.icon || current.icon,
              description: item.description !== undefined ? item.description : current.description,
              archived: typeof item.archived === 'boolean' ? item.archived : current.archived
            };
            await App.db.put('categories', merged);
          }
          idMap.set(item.id || nameKey, existingId);
        } else {
          // Categoria nova: insere com o id do backup
          const newId = item.id || App.utils.generateId();
          await App.db.put('categories', { ...item, id: newId });
          idMap.set(item.id || nameKey, newId);
          existingByName.set(nameKey, newId);
        }
      }

      // 2ª passada: ajustar parent_id para apontar para o id final correto.
      for (const item of data['categories']) {
        if (!item || !item.name) continue;
        const nameKey = `${item.name.toLowerCase().trim()}|||${item.type || 'expense'}`;
        const finalId = idMap.get(item.id || nameKey);
        if (!finalId) continue;
        const current = await App.db.getById('categories', finalId);
        if (!current) continue;

        let newParentId = null;
        if (item.parent_id) {
          // Tenta remapear o parent_id antigo para o id final correspondente
          newParentId = idMap.get(item.parent_id) || item.parent_id || null;
          // Confirma que o parent realmente existe no banco
          const parentExists = await App.db.getById('categories', newParentId);
          if (!parentExists) newParentId = null;
        }

        if (current.parent_id !== newParentId) {
          current.parent_id = newParentId;
          await App.db.put('categories', current);
        }
      }

      App.cache.categories = null;
    }
    // ===== FIM DA IMPORTAÇÃO ESPECIAL DE CATEGORIAS =====

        this._importCancelled = false;
    if (data['transactions'] && data['transactions'].length) {
      const totalTransactions = data['transactions'].length;

      // Normaliza account_id para todas as transações antes de processar
      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      if (!App.cache.accounts) App.cache.accounts = accounts;
      const defaultAccount = accounts.length ? accounts[0] : null;
      const transactions = data['transactions'].map(item => {
        if (!item.account_id && defaultAccount) {
          item.account_id = defaultAccount.id;
          item.account_name = defaultAccount.name;
        }
        return item;
      });

      // Sempre usa método direto para garantir verificação de duplicatas
      await this._importJSONDirect(transactions);
    }

    const otherStores = ['investments', 'investmentHistory', 'accountHistory', 'creditLimitHistory', 'patrimony', 'goals', 'wishes', 'receipts', 'budgets', 'loans', 'transactionTemplates', 'receiptFolders', 'vehicles', 'vehicleExpenses', 'previdencia', 'manualIncomes', 'fontesPagadoras', 'indicatorHistory'];
    for (const store of otherStores) {
      if (data[store] && data[store].length) {
        // Garantir que cada item tenha um id
        for (const item of data[store]) {
          if (!item.id) item.id = App.utils.generateId();
          try {
            await App.db.put(store, item);
          } catch (e) {
            console.warn(`Erro ao importar item na tabela ${store}:`, e);
          }
        }
      }
    }

    // Restaura os indicadores atuais (cards do Painel Financeiro)
    if (data.app_indicators) {
      try {
        App.config.INDICATORS = data.app_indicators;
        localStorage.setItem('app_indicators', JSON.stringify(App.config.INDICATORS));
        console.log('Indicadores atuais restaurados do backup.');
      } catch (e) {
        console.warn('Não foi possível restaurar os indicadores atuais:', e);
      }
    }

    // Restaura planos orçamentários (se existirem no backup)
    if (data['planosOrcamentarios'] && data['planosOrcamentarios'].length) {
      await App.db.putMany('planosOrcamentarios', data['planosOrcamentarios']);
      // Remove planos duplicados pelo nome (mantém o primeiro)
      const planos = await App.db.getAll('planosOrcamentarios');
      const seen = new Set();
      const toDelete = [];
      for (const p of planos) {
        if (seen.has(p.nome)) {
          toDelete.push(p.id);
        } else {
          seen.add(p.nome);
        }
      }
      for (const id of toDelete) {
        await App.db.delete('planosOrcamentarios', id);
      }
    }

    // Garante que os budgets importados tenham um plano válido
    const planos = await App.db.getAll('planosOrcamentarios');
    if (planos.length > 0) {
      const allBudgets = await App.db.getAll('budgets');
      let migrated = false;
      for (const b of allBudgets) {
        if (!b.plano_id || !planos.some(p => p.id === b.plano_id)) {
          b.plano_id = planos[0].id;
          await App.db.put('budgets', b);
          migrated = true;
        }
      }
      if (migrated) {
        console.log('Budgets órfãos vinculados ao plano padrão.');
      }
    }

    App.cache.accounts = null; App.cache.members = null; App.cache.categories = null; App.cache.creditCards = null;
    // Força atualização completa dos saldos
    await App.saldos.load();
    if (!this._importCancelled) {
      App.utils.showToast('Dados importados');
      App.transactions.load(); App.dashboard.refresh(); App.panel.refresh();
    }
    } finally {
      App.db._suppressAutoBackup = false;
    }
    if (!this._importCancelled && App.driveBackup && typeof App.driveBackup.scheduleAutoBackup === 'function') {
      App.driveBackup.scheduleAutoBackup('import', 'json');
    }
  },

  async _importJSONDirect(transactions) {
    const batchSize = 1000;
    const totalTransactions = transactions.length;

    const modal = document.getElementById('modalImportProgress');
    const progressBar = document.getElementById('importProgressBar');
    const progressText = document.getElementById('importProgressText');
    if (modal) {
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    // Carrega transações existentes para verificação de duplicatas
    const existingTx = await App.db.getAll('transactions');
    const existingKeys = new Set();
    for (const t of existingTx) {
      const key = `${t.date || ''}|${t.amount || 0}|${t.description || ''}|${t.account_id || ''}|${t.type || ''}`;
      existingKeys.add(key);
    }
    // Também usaremos um Set local para evitar duplicatas dentro do próprio arquivo
    const importedKeys = new Set();

    try {
      for (let i = 0; i < totalTransactions && !this._importCancelled; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize);
        const filteredBatch = [];
        // Garante que a lista de contas esteja atualizada para validação
        const accounts = App.cache.accounts || await App.db.getAll('accounts');
        if (!App.cache.accounts) App.cache.accounts = accounts;
        const validAccountIds = new Set(accounts.map(a => a.id));
        const defaultAcc = accounts.length ? accounts[0] : null;

        for (const item of batch) {
          if (!item.id) item.id = App.utils.generateId();
          if (item.ignore_from_total === undefined) item.ignore_from_total = false;
          if (!item.credit_card_id) item.credit_card_id = null;
          if (!item.account_to_id) item.account_to_id = null;
          if (!item.account_to_name) item.account_to_name = null;
          if (item.installments === undefined) item.installments = 1;
          if (item.installment_number === undefined) item.installment_number = 1;
          if (item.recurring === undefined) item.recurring = false;
          if (item.vacation === undefined) item.vacation = false;
          if (item.status === undefined) item.status = 'confirmed';
          if (item.reconciled === undefined) item.reconciled = false;
          // Corrige account_id inválido ou ausente usando a primeira conta como fallback
          if (!item.account_id || !validAccountIds.has(item.account_id)) {
            if (defaultAcc) {
              item.account_id = defaultAcc.id;
              item.account_name = defaultAcc.name;
            }
          }

          const key = `${item.date || ''}|${item.amount || 0}|${item.description || ''}|${item.account_id || ''}|${item.type || ''}`;
          if (!existingKeys.has(key) && !importedKeys.has(key)) {
            filteredBatch.push(item);
            importedKeys.add(key);
          }
        }

        if (filteredBatch.length > 0) {
          await App.db.putMany('transactions', filteredBatch);
        }

        const progress = Math.round(((i + batch.length) / totalTransactions) * 100);
        if (progressBar) progressBar.style.width = progress + '%';
        if (progressText) progressText.textContent = `Importando... ${Math.min(i + batch.length, totalTransactions)} de ${totalTransactions} (${progress}%)`;

        if (i + batchSize < totalTransactions) {
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      }
    } finally {
      if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
      }
    }
  },

  async _importJSONWithWorker(transactions) {
    return new Promise((resolve, reject) => {
      try {
        var schemaCfg = App.dbSchema || {
          DB_NAME: App.config.DB_NAME || 'ContasOnlineDB',
          DB_VERSION: App.config.DB_VERSION || 34,
          TRANSACTION_INDEXES: ['date','type','account_id','account_to_id','member_id','credit_card_id','installment_id','status','reconciled','ignore_from_total'],
          STORES: App.config.DB_STORES || []
        };
        var workerCode = [
          "var DB_NAME = " + JSON.stringify(schemaCfg.DB_NAME) + ";",
          "var DB_VERSION = " + Number(schemaCfg.DB_VERSION || 34) + ";",
          "var TX_INDEXES = " + JSON.stringify(schemaCfg.TRANSACTION_INDEXES || []) + ";",
          "var EXTRA_STORES = " + JSON.stringify(schemaCfg.STORES || []) + ";",
          "",
          "function openDB() {",
          "  return new Promise(function(resolve, reject) {",
          "    var req = indexedDB.open(DB_NAME, DB_VERSION);",
          "    req.onupgradeneeded = function(e) {",
          "      var db = e.target.result;",
          "      var txStore;",
          "      if (!db.objectStoreNames.contains('transactions')) {",
          "        txStore = db.createObjectStore('transactions', { keyPath: 'id' });",
          "      } else {",
          "        txStore = e.target.transaction.objectStore('transactions');",
          "      }",
          "      TX_INDEXES.forEach(function(idx) {",
          "        if (!txStore.indexNames.contains(idx)) txStore.createIndex(idx, idx, { unique: false });",
          "      });",
          "      EXTRA_STORES.forEach(function(s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });",
          "    };",
          "    req.onsuccess = function(e) { resolve(e.target.result); };",
          "    req.onerror = function(e) {",
          "      var err = e.target && e.target.error;",
          "      if (err && err.name === 'VersionError') {",
          "        var fallbackReq = indexedDB.open(DB_NAME);",
          "        fallbackReq.onsuccess = function(ev) { resolve(ev.target.result); };",
          "        fallbackReq.onerror = function(ev) { reject(ev.target.error); };",
          "        return;",
          "      }",
          "      reject(err);",
          "    };",
          "  });",
          "}",
          "",
          "function putMany(db, storeName, items) {",
          "  return new Promise(function(resolve, reject) {",
          "    var tx = db.transaction(storeName, 'readwrite');",
          "    var store = tx.objectStore(storeName);",
          "    var count = 0;",
          "    for (var i = 0; i < items.length; i++) { store.put(items[i]); count++; }",
          "    tx.oncomplete = function() { resolve(count); };",
          "    tx.onerror = function(e) { reject(e.target.error); };",
          "  });",
          "}",
          "",
          "var db = null;",
          "var cancelled = false;",
          "var totalBatches = 0;",
          "var processedBatches = 0;",
          "var totalTrans = 0;",
          "var processedTrans = 0;",
          "",
          "self.onmessage = function(e) {",
          "  var msg = e.data;",
          "  if (msg.type === 'importBatch') {",
          "    if (!db) {",
          "      openDB().then(function(database) {",
          "        db = database;",
          "        process(msg);",
          "      }).catch(function(err) {",
          "        self.postMessage({ type: 'error', error: err.message });",
          "      });",
          "      return;",
          "    }",
          "    process(msg);",
          "  } else if (msg.type === 'cancel') {",
          "    cancelled = true;",
          "    self.postMessage({ type: 'cancelled' });",
          "  }",
          "};",
          "",
          "function process(msg) {",
          "  if (cancelled) return;",
          "  try {",
          "    var batch = msg.batch;",
          "    if (msg.batchIndex === 0) {",
          "      cancelled = false;",
          "      totalBatches = msg.totalBatches;",
          "      totalTrans = msg.totalTransactions;",
          "      processedBatches = 0;",
          "      processedTrans = 0;",
          "    }",
          "    for (var i = 0; i < batch.length; i++) {",
          "      var item = batch[i];",
          "      if (!item.id) item.id = 'blob_' + Date.now() + '_' + Math.random().toString(36).slice(2,10);",
          "      if (item.ignore_from_total === undefined) item.ignore_from_total = false;",
          "      if (!item.credit_card_id) item.credit_card_id = null;",
          "      if (!item.account_to_id) item.account_to_id = null;",
          "      if (!item.account_to_name) item.account_to_name = null;",
          "      if (item.installments === undefined) item.installments = 1;",
          "      if (item.installment_number === undefined) item.installment_number = 1;",
          "      if (item.recurring === undefined) item.recurring = false;",
          "      if (item.vacation === undefined) item.vacation = false;",
          "      if (item.status === undefined) item.status = 'confirmed';",
          "      if (!item.account_id) {",
          "        item.account_id = 'default';",   // será substituído por valor real via postMessage
          "        item.account_name = '';",
          "      }",
          "      if (item.reconciled === undefined) item.reconciled = false;",
          "    }",
          "    putMany(db, 'transactions', batch).then(function() {",
          "      processedTrans += batch.length;",
          "      processedBatches++;",
          "      self.postMessage({ type: 'progress', current: processedTrans, total: totalTrans, batchIndex: msg.batchIndex });",
          "      if (processedBatches >= totalBatches) {",
          "        self.postMessage({ type: 'complete' });",
          "      }",
          "    }).catch(function(err) {",
          "      self.postMessage({ type: 'error', error: err.message });",
          "    });",
          "  } catch (err) {",
          "    self.postMessage({ type: 'error', error: err.message });",
          "  }",
          "}",
        ].join('\n');

        var blob = new Blob([workerCode], { type: 'application/javascript' });
        var workerUrl = URL.createObjectURL(blob);
        var worker = new Worker(workerUrl);

        var totalTransactions = transactions.length;
        var modal = document.getElementById('modalImportProgress');
        var progressBar = document.getElementById('importProgressBar');
        var progressText = document.getElementById('importProgressText');
        if (modal) {
          modal.classList.add('open');
          document.body.style.overflow = 'hidden';
        }

        worker.onmessage = function(e) {
          var msg = e.data;
          if (msg.type === 'progress') {
            var progress = Math.round((msg.current / msg.total) * 100);
            if (progressBar) progressBar.style.width = progress + '%';
            if (progressText) progressText.textContent = 'Importando via Worker... ' + msg.current + ' de ' + msg.total + ' (' + progress + '%)';
          } else if (msg.type === 'complete') {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
            resolve();
          } else if (msg.type === 'error') {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
            App.utils.showToast('Erro na importação via Worker.', 'error');
            reject(new Error(msg.error));
          }
        };

        worker.onerror = function(err) {
          URL.revokeObjectURL(workerUrl);
          if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
          App.utils.showToast('Erro no Worker de importação.', 'error');
          reject(err);
        };

        var batchSize = 1000;
        for (var i = 0; i < totalTransactions && !this._importCancelled; i += batchSize) {
          worker.postMessage({
            type: 'importBatch',
            batch: transactions.slice(i, i + batchSize),
            batchIndex: i / batchSize,
            totalBatches: Math.ceil(totalTransactions / batchSize),
            totalTransactions: totalTransactions
          });
        }
      } catch (e) {
        console.warn('Worker indisponível. Usando fallback direto.', e);
        this._importJSONDirect(transactions).then(() => resolve()).catch(reject);
      }
    });
  },

  cancelImport() {
    this._importCancelled = true;
    if (this._worker) {
      this._worker.postMessage({ type: 'cancel' });
    }
    const modal = document.getElementById('modalImportProgress');
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
    App.utils.showToast('Importação cancelada pelo usuário.');
  },

  async _importXLSX(file) {
    try {
      const reader = new FileReader();
      reader.onload = async function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        if (rows.length < 2) { App.utils.showToast('Arquivo vazio ou inválido', 'error'); return; }
        const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
        let count = 0;
        // Carrega cartões para mapeamento por nome ou ID
        const cards = await App.db.getAll('creditCards');
        for (let i = 1; i < rows.length; i++) {
          const vals = rows[i]; if (!vals || vals.length < 3) continue;
          const obj = {}; headers.forEach((h, idx) => obj[h] = vals[idx] != null ? String(vals[idx]).trim() : '');
          if (!['income','expense','transfer','contribution','withdrawal','refund'].includes(obj.type || obj.tipo)) continue;

          // Processa cartão de crédito (aceita ID ou nome)
          let creditCardId = null;
          const rawCard = obj.credit_card_id || obj.cartao || obj.credit_card || '';
          if (rawCard) {
            const card = cards.find(c => c.id === rawCard || c.name.toLowerCase() === rawCard.toLowerCase());
            if (card) creditCardId = card.id;
          }

          await App.db.put('transactions', {
            id: App.utils.generateId(), type: obj.type || obj.tipo || 'expense',
            amount: parseFloat(obj.amount || obj.valor) || 0,
            category: obj.category || obj.categoria || 'Outros',
            description: obj.description || obj.descricao || obj.desc || '',
            date: obj.date || obj.data || App.utils.todayISO(),
            account_name: obj.account || obj.conta || obj.account_name || '',
            member_name: obj.member || obj.membro || obj.member_name || '',
            classification:'', payment_method: obj.payment_method || '', receipt_url:'', investment_id:null, purchase_date:'',
            installment_id:null, installments:1, installment_number:1, recurring:false, vacation:false,
            credit_card_id: creditCardId, account_to_id:null, account_to_name:null,
            status: obj.status || 'confirmed', reconciled: false, ignore_from_total: false, createdAt: new Date().toISOString()
          });
          count++;
        }
        App.utils.showToast(`${count} importadas via XLSX`); App.transactions.load(); App.dashboard.refresh(); App.panel.refresh(); App.saldos.load();
      };
      reader.readAsArrayBuffer(file);
    } catch (e) { console.error('Erro ao importar XLSX:', e); App.utils.showToast('Erro ao processar arquivo XLSX.', 'error'); }
  },

  async _importOFX(text) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text.replace(/<OFX>/g, '<OFX xmlns="http://ofx.net/">'), 'text/xml');
    const transactions = xmlDoc.querySelectorAll('STMTTRN');
    let count = 0;
    for (const trn of transactions) {
      const type = trn.querySelector('TRNTYPE')?.textContent === 'CREDIT' ? 'income' : 'expense';
      const amount = Math.abs(parseFloat(trn.querySelector('TRNAMT')?.textContent || '0'));
      const date = (trn.querySelector('DTPOSTED')?.textContent || '').slice(0, 8);
      const dateFormatted = date ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : App.utils.todayISO();
      const memo = trn.querySelector('MEMO')?.textContent || '';
      if (amount > 0) {
        await App.db.put('transactions', {
          id: App.utils.generateId(), type, amount, category: 'Outros', description: memo,
          date: dateFormatted, account_name:'', member_name:'', classification:'', payment_method:'',
          receipt_url:'', investment_id:null, purchase_date:'', installment_id:null,
          installments:1, installment_number:1, recurring:false, vacation:false,
          credit_card_id:null, account_to_id:null, account_to_name:null,
          status:'confirmed', reconciled:false, ignore_from_total: false, createdAt:new Date().toISOString()
        });
        count++;
      }
    }
    App.utils.showToast(`${count} importadas via OFX`); App.transactions.load(); App.dashboard.refresh(); App.panel.refresh(); App.saldos.load();
  },

  async clearAllData() {
    App.utils.confirm(
      'Apagar TODOS os dados financeiros? Contas, Membros, Categorias, Metas e Planejamentos serão preservados.',
      async () => {
        // Mostra a barra de progresso
        const modal = document.getElementById('modalImportProgress');
        const progressBar = document.getElementById('importProgressBar');
        const progressText = document.getElementById('importProgressText');
        if (modal) {
          modal.classList.add('open');
          document.body.style.overflow = 'hidden';
        }
        if (progressText) progressText.textContent = 'Limpando dados...';

        const tablesToClear = [
          'transactions', 'creditCards', 'investments', 'patrimony',
          'wishes', 'receipts', 'loans', 'transactionTemplates',
          'investmentHistory', 'accountHistory', 'creditLimitHistory',
          'notifications', 'receiptFolders'
        ];

        App.db._suppressAutoBackup = true;
        try {
          for (let i = 0; i < tablesToClear.length; i++) {
            await App.db.clear(tablesToClear[i]);
            const progress = Math.round(((i + 1) / tablesToClear.length) * 100);
            if (progressBar) progressBar.style.width = progress + '%';
            if (progressText) progressText.textContent = 'Limpando... ' + progress + '%';
            // Pequena pausa para a UI respirar
            await new Promise(r => setTimeout(r, 50));
          }
          await App.db.seedIfEmpty();
          App.utils.showToast('Dados limpos (contas/membros/categorias/metas/planejamentos mantidos)');
          App.ui.navigateTo('dashboard');
        } catch (e) {
          console.error(e);
          App.utils.showToast('Erro ao limpar dados.', 'error');
        } finally {
          App.db._suppressAutoBackup = false;
          if (modal) {
            modal.classList.remove('open');
            document.body.style.overflow = '';
          }
          if (App.driveBackup && typeof App.driveBackup.scheduleAutoBackup === 'function') {
            App.driveBackup.scheduleAutoBackup('all', 'clear');
          }
        }
      }
    );
  },

  async _downloadCompressed(jsonString, filename) {
    try {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const compressedStream = blob.stream().pipeThrough(new CompressionStream('gzip'));
      const compressedBlob = await new Response(compressedStream).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(compressedBlob);
      a.download = filename; // mantém extensão .json, mas o conteúdo é gzip
      a.click();
      App.utils.showToast('Backup comprimido exportado com sucesso!');
    } catch (e) {
      console.error('Compressão falhou, salvando sem compressão:', e);
      this._download(jsonString, filename);
    }
  },

  _download(content, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content]));
    a.download = name;
    a.click();
  },

  async _decompressIfNeeded(arrayBuffer) {
    // Verifica magic number do gzip: 0x1F 0x8B
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) {
      const decompressedStream = new Blob([arrayBuffer])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
      const decompressedBlob = await new Response(decompressedStream).blob();
      return await decompressedBlob.text();
    }
    // Se não for gzip, assume que é texto puro
    const decoder = new TextDecoder();
    return decoder.decode(arrayBuffer);
  }
};

// =======================================================================
// Templates – sem alterações
// =======================================================================
App.templates = {
  async load() {
    const temps = await App.db.getAll('transactionTemplates');
    document.getElementById('templatesTableBody').innerHTML = temps.map(t => `<tr><td>${t.name}</td><td>${t.type}</td><td>${t.category}</td><td>${App.utils.formatCurrency(t.amount)}</td><td>${t.description||''}</td><td class="text-center actions-cell"><button class="icon-btn" onclick="App.templates.use('${t.id}')">▶️</button><button class="icon-btn" onclick="App.templates.edit('${t.id}')">✏️</button><button class="icon-btn delete" onclick="App.templates.remove('${t.id}')">🗑️</button></td></tr>`).join('') || '<tr><td colspan="6">Nenhum template</td></tr>';
  },
  async use(id) { const t = await App.db.getById('transactionTemplates', id); if (t) App.ui.openTransactionModal(t, t.type, false); },
  openNew() {
    const name = prompt('Nome do template:');
    if (!name) return;
    const template = {
      id: App.utils.generateId(), name,
      type: document.getElementById('txType').value,
      category: document.getElementById('txCategory').value,
      amount: parseFloat(document.getElementById('txAmount').value) || 0,
      description: document.getElementById('txDescription').value,
      account_id: document.getElementById('txAccount').value,
      member_id: document.getElementById('txMember').value,
      payment_method: document.getElementById('txPaymentMethod').value,
      installments: parseInt(document.getElementById('txInstallments').value) || 1,
      status: document.getElementById('txStatus')?.value || 'confirmed'
    };
    App.db.put('transactionTemplates', template); App.utils.showToast('Template salvo!'); this.load();
  },
  async edit(id) { const t = await App.db.getById('transactionTemplates', id); if (t) App.ui.openTransactionModal(t, t.type, false); },
  async remove(id) { App.utils.confirm('Excluir template?', async () => { await App.db.delete('transactionTemplates', id); this.load(); }); }
};

// =======================================================================
// Fluxo de Caixa Projetado – otimizado
// =======================================================================
App.cashflow = {
  _cashflowChart: null,
  async load() {
    const accounts = (App.cache.accounts || await App.db.getAll('accounts')).filter(a => !a.archived);
    if (!App.cache.accounts) App.cache.accounts = await App.db.getAll('accounts');
    const today = App.utils.todayISO();
    const endDate = new Date(today + 'T12:00:00');
    endDate.setDate(endDate.getDate() + 60);
    const futureStr = endDate.toISOString().slice(0, 10);
    const txAll = await App.db.getTransactionsInRange('2000-01-01', futureStr, { memberId: App.state.globalMemberFilter || null });
    const balanceMap = {};
    accounts.forEach(a => { balanceMap[a.id] = a.initial_balance || 0; });
    txAll.forEach(t => {
      if (t.date > today || t.ignore_from_total) return;
      if (t.status !== 'confirmed' && t.status !== 'pending') return;
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
      else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
      else if (t.type === 'transfer' || t.type === 'contribution') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
      else if (t.type === 'withdrawal') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
    });
    let currentBalance = accounts.reduce((s, a) => s + (balanceMap[a.id] || 0), 0);
    const futureTx = txAll.filter(t => t.date > today && t.date <= futureStr && !t.ignore_from_total && (t.status === 'confirmed' || t.status === 'pending')).sort((a, b) => a.date.localeCompare(b.date));
    const projections = [];
    let balance = currentBalance;
    for (let d = new Date(today + 'T12:00:00'); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayTx = futureTx.filter(t => t.date === dateStr);
      let impact = 0;
      dayTx.forEach(t => {
        const amt = parseFloat(t.amount);
        if (t.type === 'income' || t.type === 'refund') impact += amt;
        else if (t.type === 'expense') impact -= amt;
        else if (t.type === 'transfer' || t.type === 'contribution') { if (t.account_id) impact -= amt; if (t.account_to_id) impact += amt; }
        else if (t.type === 'withdrawal') { if (t.account_id) impact -= amt; if (t.account_to_id) impact += amt; }
      });
      balance += impact;
      projections.push({ date: dateStr, impact, balance });
    }
    const canvas = document.getElementById('cashflowChart');
    if (canvas) {
      if (this._cashflowChart) this._cashflowChart.destroy();
      this._cashflowChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: projections.filter((_, i) => i % 2 === 0).map(p => App.utils.formatDateTime(p.date).slice(0, 5)),
          datasets: [{
            data: projections.filter((_, i) => i % 2 === 0).map(p => p.balance),
            backgroundColor: projections.filter((_, i) => i % 2 === 0).map(p => p.balance >= 0 ? '#a3e635' : '#f87171'),
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
          plugins: { legend: { display: false } }
        }
      });
    }
    const tbody = document.getElementById('cashflowTableBody');
    tbody.innerHTML = projections.map(p => `<tr><td>${App.utils.formatDateTime(p.date)}</td><td>${p.impact !== 0 ? (p.impact > 0 ? 'Entrada' : 'Saída') : ''}</td><td class="text-right">${p.impact !== 0 ? App.utils.formatCurrency(p.impact) : ''}</td><td class="text-right" style="color:${p.balance >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(p.balance)}</td></tr>`).join('');
  }
};

// =======================================================================
// Conquistas – sem alterações
// =======================================================================
App.achievements = {
  list: [
    { id: 'first_goal', name: 'Primeira Meta Batida', icon: '🎯', desc: 'Atingir 100% de uma meta', check: async () => { const goals = await App.db.getAll('goals'); const tx = await App.db.getAll('transactions'); for (let g of goals) { const saved = g.category_id ? tx.filter(t => t.category === g.category_id && t.type === 'income' && t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0) : (g.saved || 0); if (saved >= g.target_amount) return true; } return false; } },
    { id: 'saver_1000', name: 'Poupança Mil', icon: '💰', desc: 'Acumular R$ 1.000 em investimentos', check: async () => { const inv = await App.db.getAll('investments'); return inv.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0) >= 1000; } },
    { id: 'no_debt', name: 'Sem Dívidas', icon: '🕊️', desc: 'Quitar todas as dívidas do patrimônio', check: async () => { const pat = await App.db.getAll('patrimony'); return pat.filter(p => p.type === 'liability').reduce((s, p) => s + (parseFloat(p.value) || 0), 0) === 0; } },
    { id: 'super_saver', name: 'Super Poupança', icon: '🏦', desc: 'Acumular R$ 10.000 em investimentos', check: async () => { const inv = await App.db.getAll('investments'); return inv.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0) >= 10000; } },
    { id: 'first_budget', name: 'Primeiro Orçamento', icon: '📏', desc: 'Criar o primeiro orçamento', check: async () => { const budgets = await App.db.getAll('budgets'); return budgets.length > 0; } },
    { id: 'first_investment', name: 'Primeiro Investimento', icon: '📈', desc: 'Registrar o primeiro investimento', check: async () => { const invs = await App.db.getAll('investments'); return invs.length > 0; } },
    { id: 'no_superfluous', name: 'Mês Essencial', icon: '💪', desc: 'Passar um mês sem gastos supérfluos', check: async () => { const cycle = App.utils.currentMonth(); const txAll = await App.db.getTransactionsInRange(cycle.start, cycle.end, { memberId: App.state.globalMemberFilter || null, status: 'confirmed' }); const cats = App.cache.categories || await App.db.getAll('categories'); if (!App.cache.categories) App.cache.categories = cats; const monthTx = txAll.filter(t => t.type === 'expense'); const superfluous = monthTx.filter(t => { const cat = cats.find(c => c.name === t.category); const cls = t.classification || cat?.classification || 'necessary'; return cls === 'superfluous'; }); return superfluous.length === 0 && monthTx.length > 0; } }
  ],
  async load() {
    const container = document.getElementById('achievementsContainer');
    const results = await Promise.all(this.list.map(async a => ({ ...a, achieved: await a.check() })));
    container.innerHTML = results.map(a => `<div class="achievement-card ${a.achieved ? '' : 'achievement-locked'}"><div class="achievement-icon">${a.icon}</div><div class="achievement-title">${a.name}</div><div class="achievement-sub">${a.desc}</div>${a.achieved ? '<span style="color:var(--income); font-weight:700;">✅ Conquistado</span>' : '<span style="color:var(--text-muted);">🔒 Bloqueado</span>'}</div>`).join('');
  }
};

// =======================================================================
// Resumo Anual – otimizado
// =======================================================================
App.annual = {
  _annualChart: null,
  async load() {
    const multi = document.getElementById('annualMultiYear')?.checked || false;
    const selectEl = document.getElementById('annualYear');
    let years = [];
    if (multi) {
      for (let opt of selectEl.selectedOptions) years.push(parseInt(opt.value));
      if (years.length === 0) years = [new Date().getFullYear()];
    } else {
      years = [parseInt(selectEl.value) || new Date().getFullYear()];
    }
    years.sort((a, b) => b - a);
    let allCardsHtml = '';
    let totalIncomeAll = 0, totalExpenseAll = 0;

    for (let year of years) {
      const months = Array.from({ length: 12 }, (_, i) => {
        const start = `${year}-${String(i + 1).padStart(2, '0')}-01`;
        const end = `${year}-${String(i + 1).padStart(2, '0')}-31`;
        return { label: new Date(year, i).toLocaleDateString('pt-BR', { month: 'short' }) + '/' + year.toString().slice(2), start, end };
      });
      let yearIncome = 0, yearExpense = 0;
      for (const month of months) {
        const monthTx = await App.db.getTransactionsInRange(month.start, month.end, { memberId: App.state.globalMemberFilter || null, status: 'confirmed' });
        yearIncome += monthTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
        yearExpense += monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
      }
      totalIncomeAll += yearIncome;
      totalExpenseAll += yearExpense;
      allCardsHtml += `<div class="card"><div class="card-label">📅 ${year}</div><div class="card-value">Receitas: ${App.utils.formatCurrency(yearIncome)}</div><div class="card-sub">Despesas: ${App.utils.formatCurrency(yearExpense)} | Resultado: ${App.utils.formatCurrency(yearIncome - yearExpense)}</div></div>`;
    }

    document.getElementById('annualCards').innerHTML = allCardsHtml + `
      <div class="card"><div class="card-label">📥 Receitas Totais</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(totalIncomeAll)}</div></div>
      <div class="card"><div class="card-label">📤 Despesas Totais</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(totalExpenseAll)}</div></div>
      <div class="card"><div class="card-label">⚖️ Resultado Total</div><div class="card-value" style="color:${totalIncomeAll - totalExpenseAll >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(totalIncomeAll - totalExpenseAll)}</div></div>`;

    if (years.length > 0) {
      const year = years[0];
      const monthsForChart = Array.from({ length: 12 }, (_, i) => {
        const start = `${year}-${String(i + 1).padStart(2, '0')}-01`;
        const end = `${year}-${String(i + 1).padStart(2, '0')}-31`;
        return { label: new Date(year, i).toLocaleDateString('pt-BR', { month: 'short' }), start, end };
      });
      const chartData = [];
      for (const month of monthsForChart) {
        const monthTx = await App.db.getTransactionsInRange(month.start, month.end, { memberId: App.state.globalMemberFilter || null, status: 'confirmed' });
        chartData.push({
          label: month.label,
          income: monthTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0),
          expense: monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0)
        });
      }

      const canvas = document.getElementById('annualBarChart');
      if (canvas) {
        if (this._annualChart) this._annualChart.destroy();
        this._annualChart = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: chartData.map(d => d.label),
            datasets: [
              { label: 'Receitas', data: chartData.map(d => d.income), backgroundColor: '#a3e635', borderRadius: 6 },
              { label: 'Despesas', data: chartData.map(d => d.expense), backgroundColor: '#f87171', borderRadius: 6 }
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
      }
    }

    if (selectEl && selectEl.options.length === 0) {
      const currentYear = new Date().getFullYear();
      for (let y = currentYear; y >= currentYear - 5; y--) selectEl.innerHTML += `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`;
    }
  }
};// =======================================================================
// Detalhes de Saldos – otimizado
// =======================================================================
App.balanceDetail = {
  async load() {
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    const today = App.utils.todayISO();
    const startDate = App.utils.addMonths(today, -240);
    const txAll = await App.db.getTransactionsInRange(startDate, today, {
      memberId: App.state.globalMemberFilter || null
    });
    const activeAccounts = accounts.filter(a => !a.archived);
    const balanceMap = {};
    activeAccounts.forEach(a => { balanceMap[a.id] = a.initial_balance || 0; });
    txAll.forEach(t => {
      if (t.status !== 'confirmed') return;
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
      else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
      else if (t.type === 'transfer' || t.type === 'contribution') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
      else if (t.type === 'withdrawal') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
    });
    const totalBalance = activeAccounts.reduce((s, a) => s + (balanceMap[a.id] || 0), 0);
    document.getElementById('balanceDetailContent').innerHTML = `
      <div class="cards-row">
        <div class="card"><div class="card-label">Saldo Total</div><div class="card-value">${App.utils.formatCurrency(totalBalance)}</div></div>
        <div class="card"><div class="card-label">Contas Ativas</div><div class="card-value">${activeAccounts.length}</div></div>
      </div>
      <div class="table-container"><table><thead><tr><th>Conta</th><th>Tipo</th><th class="text-right">Saldo</th><th>% do Total</th></tr></thead><tbody>
      ${activeAccounts.map(a => { const bal = balanceMap[a.id] || 0; const pct = totalBalance !== 0 ? ((bal / totalBalance) * 100).toFixed(1) : 0; return `<tr><td>${App.utils.escapeHtml(a.name)}</td><td>${App.utils.escapeHtml(a.type)}</td><td class="text-right">${App.utils.formatCurrency(bal)}</td><td>${pct}%</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
};

// =======================================================================
// Detalhes de Receitas – otimizado
// =======================================================================
App.incomeDetail = {
  async load() {
    const currentMonth = App.utils.currentMonth();
    const txAll = await App.db.getTransactionsInRange(currentMonth.start, currentMonth.end, {
      memberId: App.state.globalMemberFilter || null,
      status: 'confirmed'
    });
    const incomes = txAll.filter(t => t.type === 'income');
    const totalIncome = incomes.reduce((s, t) => s + parseFloat(t.amount), 0);
    const byCategory = {};
    incomes.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + parseFloat(t.amount); });
    const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    document.getElementById('incomeDetailContent').innerHTML = `
      <div class="cards-row">
        <div class="card"><div class="card-label">Receitas do Mês</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(totalIncome)}</div></div>
        <div class="card"><div class="card-label">Lançamentos</div><div class="card-value">${incomes.length}</div></div>
      </div>
      <h3>📊 Por Categoria</h3>
      <div class="table-container"><table><thead><tr><th>Categoria</th><th class="text-right">Valor</th><th>%</th></tr></thead><tbody>
      ${sorted.map(([cat, val]) => `<tr><td>${cat}</td><td class="text-right">${App.utils.formatCurrency(val)}</td><td>${((val / totalIncome) * 100).toFixed(1)}%</td></tr>`).join('')}
      </tbody></table></div>`;
  }
};

// =======================================================================
// Detalhes de Despesas – otimizado
// =======================================================================
App.expenseDetail = {
  async load() {
    const currentMonth = App.utils.currentMonth();
    const extendedStart = App.utils.addMonths(currentMonth.start, -2);
    const txAll = await App.db.getTransactionsInRange(extendedStart, currentMonth.end, {
      memberId: App.state.globalMemberFilter || null
    });
    const cards = App.cache.creditCards || await App.db.getAll('creditCards');
    const expenses = [];
    for (const t of txAll) {
      if (t.type !== 'expense' || t.ignore_from_total) continue;
      let effectiveDate = t.date.slice(0, 10);
      if (t.credit_card_id) {
        const card = cards.find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
            effectiveDate = period.due.slice(0, 10);
          } catch (e) {}
        }
      }
      if (effectiveDate >= currentMonth.start.slice(0, 10) && effectiveDate <= currentMonth.end.slice(0, 10)) {
        expenses.push(t);
      }
    }
    const totalExpense = expenses.reduce((s, t) => s + parseFloat(t.amount), 0);
    const byCategory = {};
    expenses.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + parseFloat(t.amount); });
    const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    document.getElementById('expenseDetailContent').innerHTML = `
      <div class="cards-row">
        <div class="card"><div class="card-label">Despesas do Mês</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(totalExpense)}</div></div>
        <div class="card"><div class="card-label">Lançamentos</div><div class="card-value">${expenses.length}</div></div>
      </div>
      <h3>📊 Por Categoria</h3>
      <div class="table-container"><table><thead><tr><th>Categoria</th><th class="text-right">Valor</th><th>%</th></tr></thead><tbody>
      ${sorted.map(([cat, val]) => `<tr><td>${cat}</td><td class="text-right">${App.utils.formatCurrency(val)}</td><td>${((val / totalExpense) * 100).toFixed(1)}%</td></tr>`).join('')}
      </tbody></table></div>`;
  }
};

// =======================================================================
// Custo de Vida – otimizado
// =======================================================================
App.costoflivingDetail = {
  async load() {
    const cats = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = cats;
    const today = App.utils.todayISO();
    const sixMonthsAgo = App.utils.addMonths(today, -6);
    const allTx = await App.db.getTransactionsInRange(sixMonthsAgo, today, {
      memberId: App.state.globalMemberFilter || null,
      status: 'confirmed'
    });
    const expenseTx = allTx.filter(t => t.type === 'expense');
    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const cycle = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10));
      const periodTx = expenseTx.filter(t => t.date >= cycle.start && t.date <= cycle.end);
      const living = periodTx.reduce((s, t) => {
        const cat = cats.find(c => c.name === t.category);
        const cls = t.classification || cat?.classification || 'necessary';
        return (cls === 'essential' || cls === 'necessary') ? s + parseFloat(t.amount) : s;
      }, 0);
      months.unshift({ label: cycle.monthName.slice(0, 3), value: living });
    }
    const values = months.map(m => m.value);
    const max = Math.max(...values, 1);
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const currentCycle = App.utils.currentMonth();
    const currentTx = expenseTx.filter(t => t.date >= currentCycle.start && t.date <= currentCycle.end);
    const livingByCategory = {};
    currentTx.forEach(t => {
      const cat = cats.find(c => c.name === t.category);
      const cls = t.classification || cat?.classification || 'necessary';
      if (cls === 'essential' || cls === 'necessary') livingByCategory[t.category] = (livingByCategory[t.category] || 0) + parseFloat(t.amount);
    });
    const sortedCategories = Object.entries(livingByCategory).sort((a, b) => b[1] - a[1]);
    const totalCurrent = currentTx.reduce((s, t) => s + parseFloat(t.amount), 0);
    document.getElementById('costoflivingDetailContent').innerHTML = `
      <div class="cards-row">
        <div class="card"><div class="card-label">Média do Período</div><div class="card-value">${App.utils.formatCurrency(avg)}</div></div>
        <div class="card"><div class="card-label">Maior Gasto</div><div class="card-value">${App.utils.formatCurrency(max)}</div></div>
      </div>
      <h3>📈 Média Móvel (6 meses)</h3>
      <div class="bar-chart" style="height:200px;">
        ${months.map(m => { const h = (m.value / max) * 150; return `<div class="bar-col"><div class="bar-fill expense-bar" style="height:${h}px"></div><span class="bar-label">${m.label}</span></div>`; }).join('')}
      </div>
      <h3>📊 Categorias do Mês Atual</h3>
      <div class="table-container"><table><thead><tr><th>Categoria</th><th class="text-right">Valor</th><th>%</th></tr></thead><tbody>
      ${sortedCategories.map(([cat, val]) => `<tr><td>${cat}</td><td class="text-right">${App.utils.formatCurrency(val)}</td><td>${totalCurrent ? ((val / totalCurrent) * 100).toFixed(1) : 0}%</td></tr>`).join('')}
      </tbody></table></div>`;
  }
};

// =======================================================================
// Conciliação Bancária – otimizado
// =======================================================================
App.reconciliation = {
  async load() {
    const accounts = (App.cache.accounts || await App.db.getAll('accounts')).filter(a => !a.archived);
    if (!App.cache.accounts) App.cache.accounts = await App.db.getAll('accounts');
    const today = App.utils.todayISO();
    const startDate = App.utils.addMonths(today, -240);
    const txAll = await App.db.getTransactionsInRange(startDate, today, {
      memberId: App.state.globalMemberFilter || null
    });
    const totalBal = App.utils.calculateBalance(accounts, txAll);
    document.getElementById('calculatedBalance').textContent = App.utils.formatCurrency(totalBal);

    const unreconciled = txAll.filter(t => !t.reconciled && t.status === 'confirmed');
    const recentReconciled = txAll.filter(t => t.reconciled && t.date >= App.utils.addMonths(today, -1) && t.status === 'confirmed');
    const allDisplay = [...unreconciled, ...recentReconciled].sort((a, b) => b.date.localeCompare(a.date));

    document.getElementById('unreconciledTable').innerHTML = allDisplay.length ? allDisplay.map(t => {
      const sign = t.type === 'income' || t.type === 'refund' ? '+' : '-';
      return `<tr><td>${App.utils.formatDateTime(t.date)}</td><td>${t.description || t.category || ''}</td><td class="text-right">${sign} ${App.utils.formatCurrency(t.amount)}</td><td class="text-center">${!t.reconciled ? `<button class="btn btn-sm btn-outline" onclick="App.reconciliation.toggleReconciled('${t.id}')">✅ Conciliar</button>` : `<button class="btn btn-sm btn-ghost" onclick="App.reconciliation.toggleReconciled('${t.id}')">↩️ Desmarcar</button>`}</td></tr>`;
    }).join('') : '<tr><td colspan="4">Todas as transações estão conciliadas</td></tr>';
  },
  compare() {
    App.db.getAll('accounts').then(async accounts => {
      const active = accounts.filter(a => !a.archived);
      const txAll = await App.db.getAll('transactions');
      const calc = App.utils.calculateBalance(active, txAll);
      const informed = parseFloat(document.getElementById('informedBalance').value);
      if (isNaN(informed)) { App.utils.showToast('Informe um valor válido', 'error'); return; }
      const diff = calc - informed;
      const diffEl = document.getElementById('balanceDifference');
      if (Math.abs(diff) < 0.01) { diffEl.innerHTML = '✅ Saldo confere!'; diffEl.style.color = 'var(--income)'; }
      else {
        diffEl.innerHTML = `⚠️ Diferença: ${App.utils.formatCurrency(Math.abs(diff))} (${diff > 0 ? 'Sistema tem a mais' : 'Sistema tem a menos'})`;
        diffEl.style.color = 'var(--expense)';
        App.utils.addAlert(`🔁 Conciliação bancária: diferença de ${App.utils.formatCurrency(Math.abs(diff))} encontrada.`, 'danger');
      }
    });
  },
  async toggleReconciled(id) {
    const tx = await App.db.getById('transactions', id);
    if (tx) { tx.reconciled = !tx.reconciled; await App.db.put('transactions', tx); this.load(); App.utils.showToast(tx.reconciled ? 'Transação conciliada!' : 'Conciliação desfeita.'); }
  }
};

// =======================================================================
// Relatórios – otimizado
// =======================================================================
App.reports = {
  async init() { document.getElementById('reportContent').style.display = 'none'; },
  async generate(type) { const container = document.getElementById('reportContent'); container.style.display = 'block'; await this._renderReport(type, container); },
  async generateSelected() {
    const container = document.getElementById('reportContent'); container.style.display = 'block';
    let html = '';
    if (document.getElementById('reportSelectGeneral')?.checked) html += await this._renderReportContent('general');
    if (document.getElementById('reportSelectMember')?.checked) html += await this._renderReportContent('member');
    if (document.getElementById('reportSelectCategory')?.checked) html += await this._renderReportContent('category');
    container.innerHTML = html || '<p>Selecione ao menos um tipo de relatório.</p>';
  },
  async exportExtractPDF() {
    const txAll = await App.db.getAll('transactions');
    const filtered = App.utils.applyGlobalMemberFilter(txAll);
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    const active = accounts.filter(a => !a.archived);
    const totalBal = App.utils.calculateBalance(active, filtered);
    let html = `<html><head><link rel="stylesheet" href="style.css"></head><body><div style="font-family:sans-serif; padding:20px;"><h2>Extrato Financeiro</h2><p>Gerado em ${new Date().toLocaleDateString('pt-BR')}</p><table border="1" cellpadding="5" style="border-collapse:collapse; width:100%;"><tr><th>Data</th><th>Histórico</th><th>Valor</th><th>Saldo</th></tr>`;
    let balance = 0;
    const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach(t => {
      const amt = parseFloat(t.amount);
      const sign = (t.type === 'income' || t.type === 'refund') ? 1 : -1;
      balance += amt * sign;
      html += `<tr><td>${App.utils.formatDateTime(t.date)}</td><td>${t.description || t.type}</td><td>${App.utils.formatCurrency(amt)}</td><td>${App.utils.formatCurrency(balance)}</td></tr>`;
    });
    html += `<tr style="font-weight:bold;"><td colspan="3">Saldo Final</td><td>${App.utils.formatCurrency(totalBal)}</td></tr></table></div></body></html>`;
    const win = window.open('', '_blank', 'width=800,height=600');
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  },
  async exportFullReportPDF() {
    let html = '<html><head><link rel="stylesheet" href="style.css"></head><body>';
    if (document.getElementById('reportSelectGeneral')?.checked) html += await this._renderReportContent('general');
    if (document.getElementById('reportSelectMember')?.checked) html += await this._renderReportContent('member');
    if (document.getElementById('reportSelectCategory')?.checked) html += await this._renderReportContent('category');
    html += '</body></html>';
    const win = window.open('', '_blank', 'width=800,height=600');
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  },
  async _renderReport(type, container) { container.innerHTML = await this._renderReportContent(type); },
  async _renderReportContent(type) {
    const currentMonth = App.utils.currentMonth();
    const logoHTML = '<div style="text-align:center;margin-bottom:20px;"><span style="font-size:2rem;">💳</span> <strong>Contas Online</strong><br><small>Relatório Gerado em ' + new Date().toLocaleDateString('pt-BR') + '</small></div>';
    if (type === 'general') {
      const periodTx = await App.db.getTransactionsInRange(currentMonth.start, currentMonth.end, {
        memberId: App.state.globalMemberFilter || null,
        status: 'confirmed'
      });
      const income = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
      const expense = periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      if (!App.cache.accounts) App.cache.accounts = accounts;
      const bal = App.utils.calculateBalance(accounts.filter(a => !a.archived), periodTx);
      return `${logoHTML}<h3>📊 Relatório Geral — ${currentMonth.refMonth}</h3><div class="cards-row"><div class="card"><div class="card-label">Saldo Atual</div><div class="card-value">${App.utils.formatCurrency(bal)}</div></div><div class="card"><div class="card-label">Receitas</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(income)}</div></div><div class="card"><div class="card-label">Despesas</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(expense)}</div></div><div class="card"><div class="card-label">Resultado</div><div class="card-value" style="color:${income - expense >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(income - expense)}</div></div></div>`;
    } else if (type === 'member') {
      const members = App.cache.members || await App.db.getAll('members');
      if (!App.cache.members) App.cache.members = members;
      let memberHtml = '';
      for (const m of members) {
        const memberTx = await App.db.getTransactionsInRange(currentMonth.start, currentMonth.end, {
          memberId: m.id,
          status: 'confirmed'
        });
        const inc = memberTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
        const exp = memberTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
        memberHtml += `<div class="card"><div class="card-label">${m.name}</div><div class="card-value" style="color:${inc - exp >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(inc - exp)}</div><div class="card-sub">Receitas: ${App.utils.formatCurrency(inc)} | Despesas: ${App.utils.formatCurrency(exp)}</div></div>`;
      }
      return `${logoHTML}<h3>👤 Relatório por Membro</h3><div class="cards-row">${memberHtml}</div>`;
    } else if (type === 'category') {
      const cats = (App.cache.categories || await App.db.getAll('categories')).filter(c => c.type === 'expense');
      if (!App.cache.categories) App.cache.categories = await App.db.getAll('categories');
      const expenses = await App.db.getTransactionsInRange(currentMonth.start, currentMonth.end, {
        memberId: App.state.globalMemberFilter || null,
        status: 'confirmed'
      });
      const expenseTx = expenses.filter(t => t.type === 'expense');
      const byCat = {};
      expenseTx.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + parseFloat(t.amount); });
      const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((s, [, v]) => s + v, 0);
      return `${logoHTML}<h3>🏷️ Gastos por Categoria — ${currentMonth.refMonth}</h3><div class="table-container"><table><thead><tr><th>Categoria</th><th class="text-right">Valor</th><th>%</th></tr></thead><tbody>${sorted.map(([cat, val]) => `<tr><td>${cat}</td><td class="text-right">${App.utils.formatCurrency(val)}</td><td>${((val / total) * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`;
    }
    return '';
  }
};

// =======================================================================
// Comprovantes (com pastas) – sem alterações
// =======================================================================
App.receipts = {
  currentFolderId: null,
  async load() {
    const search = (document.getElementById('receiptSearch')?.value || '').toLowerCase();
    const typeFilter = document.getElementById('receiptFilterType')?.value || '';
    let receipts = await App.db.getAll('receipts');
    let filtered = receipts.filter(r => (this.currentFolderId ? r.folder_id === this.currentFolderId : !r.folder_id));
    if (search) filtered = filtered.filter(r => (r.description || '').toLowerCase().includes(search) || (r.type || '').toLowerCase().includes(search));
    if (typeFilter) filtered = filtered.filter(r => r.type === typeFilter);
    filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    document.getElementById('receiptsTableBody').innerHTML = filtered.length ? filtered.map(r => `<tr><td>${App.utils.formatDate(r.date || r.created_at)}</td><td>${r.type || ''}</td><td>${r.description || ''}</td><td>${r.classification || ''}</td><td><a class="receipt-link" href="${r.url}" target="_blank">Abrir</a></td><td class="text-center"><button class="icon-btn delete" onclick="App.receipts.remove('${r.id}')">🗑️</button></td></tr>`).join('') : '<tr><td colspan="6">Nenhum comprovante</td></tr>';
    await this.renderFolders();
    this.renderBreadcrumb();
    const typeSel = document.getElementById('receiptFilterType');
    if (typeSel && typeSel.options.length <= 1) {
      const types = [...new Set(receipts.map(r => r.type).filter(Boolean))];
      typeSel.innerHTML = '<option value="">Todos os tipos</option>' + types.map(t => `<option value="${t}">${t}</option>`).join('');
    }
  },
  async renderFolders() {
    const folders = await App.db.getAll('receiptFolders');
    const container = document.getElementById('receiptFolders');
    if (!this.currentFolderId) {
      container.innerHTML = folders.map(f => `<div class="card clickable" style="display:flex;align-items:center;gap:12px;padding:20px 24px;" onclick="App.receipts.openFolder('${f.id}')">
        <span style="font-size:2rem;">📁</span>
        <div style="flex:1"><div style="font-weight:600;">${f.name}</div><div style="font-size:0.75rem;color:#888;">${f.description||''}</div></div>
        <button class="icon-btn" onclick="event.stopPropagation();App.receipts.editFolder('${f.id}')">✏️</button>
        <button class="icon-btn delete" onclick="event.stopPropagation();App.receipts.removeFolder('${f.id}')">🗑️</button>
      </div>`).join('');
    } else container.innerHTML = '';
  },
  renderBreadcrumb() {
    const bc = document.getElementById('receiptFolderBreadcrumb');
    if (this.currentFolderId) {
      App.db.getById('receiptFolders', this.currentFolderId).then(folder => {
        bc.innerHTML = `<a href="#" onclick="App.receipts.goToRoot()">🧾 Comprovantes</a> > ${folder?.name || 'Pasta'}`;
      });
    } else bc.innerHTML = '';
  },
  openFolder(folderId) { this.currentFolderId = folderId; this.load(); },
  goToRoot() { this.currentFolderId = null; this.load(); },
  openAddModal() {
    document.getElementById('receiptId').value = '';
    document.getElementById('receiptUrl').value = '';
    document.getElementById('receiptDesc').value = '';
    document.getElementById('receiptDate').value = App.utils.todayISO();
    document.getElementById('receiptType').value = 'credit_card';
    document.getElementById('receiptNewType').value = '';
    App.ui.populateReceiptFolders(document.getElementById('receiptFolder'));
    if (this.currentFolderId) document.getElementById('receiptFolder').value = this.currentFolderId;
    App.ui.openModal('modalReceipt');
  },
  async save(e) {
    e.preventDefault();
    const id = document.getElementById('receiptId').value;
    const url = document.getElementById('receiptUrl').value.trim();
    const type = document.getElementById('receiptType').value;
    const description = document.getElementById('receiptDesc').value.trim();
    const date = document.getElementById('receiptDate').value || App.utils.todayISO();
    const newType = document.getElementById('receiptNewType').value.trim();
    const folder_id = document.getElementById('receiptFolder').value || null;
    if (!url) { App.utils.showToast('URL obrigatória', 'error'); return false; }
    const finalType = newType || type;
    await App.db.put('receipts', { id: id || App.utils.generateId(), url, type: finalType, description, date, folder_id, created_at: new Date().toISOString() });
    App.ui.closeModal('modalReceipt'); App.utils.showToast('Comprovante salvo!'); this.load(); return false;
  },
  async createFolder() {
    App.utils.prompt('Nome da pasta:', '', async (name) => {
      if (!name) return;
      App.utils.prompt('Descrição (opcional):', '', async (desc) => {
        await App.db.put('receiptFolders', { id: App.utils.generateId(), name, description: desc || '' });
        this.load();
        App.utils.showToast('Pasta criada!');
      });
    });
  },
  async editFolder(folderId) {
    const folder = await App.db.getById('receiptFolders', folderId);
    if (!folder) return;
    App.utils.prompt('Novo nome:', folder.name, async (name) => {
      if (!name) return;
      folder.name = name;
      await App.db.put('receiptFolders', folder);
      this.load();
    });
  },
  async removeFolder(folderId) {
    App.utils.confirm('Excluir pasta? Os comprovantes voltarão para a raiz.', async () => {
      const receipts = await App.db.getAll('receipts');
      for (const r of receipts.filter(r => r.folder_id === folderId)) {
        r.folder_id = null;
        await App.db.put('receipts', r);
      }
      await App.db.delete('receiptFolders', folderId);
      this.load();
    });
  },
  async remove(id) { App.utils.confirm('Excluir comprovante?', async () => { await App.db.delete('receipts', id); this.load(); }); }
};

// =======================================================================
// Notificações (Inbox) – sem alterações
// =======================================================================
App.notifications = {
  currentFilter: 'all',
  async load() {
    try {
      const all = await App.db.getAll('notifications');
      all.sort((a, b) => b.date.localeCompare(a.date));
      this.display(all);
    } catch (e) { document.getElementById('notificationsList').innerHTML = '<p>Nenhuma notificação.</p>'; }
  },
  async filter(filter) {
    this.currentFilter = filter;
    const all = await App.db.getAll('notifications');
    all.sort((a, b) => b.date.localeCompare(a.date));
    let filtered = all;
    if (filter === 'unread') filtered = all.filter(a => !a.read);
    else if (filter === 'week') { const lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7); filtered = all.filter(a => new Date(a.date) >= lastWeek); }
    this.display(filtered);
  },
  display(notifications) {
    const container = document.getElementById('notificationsList');
    if (!notifications.length) { container.innerHTML = '<div class="empty-state">Nenhuma notificação no momento.</div>'; return; }
    let html = '<table><tbody>';
    notifications.forEach(n => {
      const icon = n.type === 'danger' ? '🔴' : n.type === 'warning' ? '🟡' : '🔵';
      html += `<tr class="notification-row${!n.read ? ' unread' : ''}"><td style="width:30px;">${icon}</td><td>${n.message}</td><td style="font-size:0.75rem; color:var(--text-muted);">${new Date(n.date).toLocaleString('pt-BR')}</td><td class="notification-actions">${!n.read ? `<button class="btn btn-sm btn-ghost" onclick="App.notifications.markRead('${n.id}')">✔️</button>` : ''}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },
  async markRead(id) {
    const n = await App.db.getById('notifications', id);
    if (n) { n.read = true; await App.db.put('notifications', n); }
    const alert = App.utils._alerts.find(a => a.id === id);
    if (alert) alert.read = true;
    App.utils.updateAlertBell();
    this.filter(this.currentFilter);
  },
  async markAllRead() {
    const all = await App.db.getAll('notifications');
    for (const n of all) { n.read = true; await App.db.put('notifications', n); }
    App.utils._alerts.forEach(a => a.read = true);
    App.utils.updateAlertBell();
    this.filter(this.currentFilter);
    App.utils.showToast('Todas as notificações foram marcadas como lidas.');
  },
  async clearAll() {
    App.utils.confirm('Apagar todas as notificações?', async () => {
      await App.db.clear('notifications');
      App.utils._alerts = [];
      App.utils.updateAlertBell();
      this.load();
      App.utils.showToast('Notificações limpas.');
    });
  }
};

// =======================================================================
// Autenticação – sem alterações
// =======================================================================
App.auth = {
  async checkPassword() {
    const storedHash = localStorage.getItem('app_password_hash');
    if (!storedHash) return true;
    if (sessionStorage.getItem('auth_ok') === 'true') return true;
    return new Promise((resolve) => {
      App.utils.prompt('Digite a senha de acesso:', '', (pwd) => {
        const hash = this.hash(pwd);
        if (hash === storedHash) { sessionStorage.setItem('auth_ok', 'true'); resolve(true); }
        else { App.utils.showToast('Senha incorreta.', 'error'); resolve(false); }
      }, () => resolve(false));
    });
  },
  setPassword(pwd) { localStorage.setItem('app_password_hash', this.hash(pwd)); },
  hash(str) { let hash = 0; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; } return hash.toString(16); }
};

// =============================================
// Inicialização da aplicação
// =============================================
App.init = async function() {
  setupUI();

    const start = App.utils.currentMonth().startDate;
  App.dashboard.currentMonthStart = start;
  App.transactions.currentMonthStart = start;
  App.panel.currentMonthStart = start;
  App.creditCards.currentMonthStart = start;
  App.investments.currentMonthStart = start;
  App.patrimony.currentMonthStart = start;
  App.planning.currentMonthStart = start;

  try {
    const access = await App.auth.checkPassword();
    if (!access) {
      document.getElementById('panelResume').innerHTML = '<div style="color:var(--expense); padding:20px;">🔒 Acesso restrito. Recarregue a página.</div>';
      App.ui.navigateTo('panel');
      return;
    }
    await App.db.open();
    await App.db.preloadCache();
    App.db._suppressAutoBackup = true;
    try {
      await App.db.seedIfEmpty();
    } finally {
      App.db._suppressAutoBackup = false;
    }
    if (App.metrics && typeof App.metrics.checkHealth === 'function') {
      App.metrics.checkHealth();
    }
    App.sidebar.init();
    App.sidebar.loadOrder();
    App.utils.registerChartDataLabelsOnce();
    if (App.aiAssistant && typeof App.aiAssistant.init === 'function') {
      App.aiAssistant.init().catch(() => {});
    }
    if (App.creditCards && typeof App.creditCards.ensureExtendedLogos === 'function') {
      const scheduleIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
      scheduleIdle(() => { App.creditCards.ensureExtendedLogos().catch(() => {}); });
    }
    const savedPage = sessionStorage.getItem('lastPage');
    if (savedPage) {
      App.ui.navigateTo(savedPage);
    } else {
      await App.panel.refresh();
      App.ui.navigateTo('panel');
    }
  } catch (error) {
    console.error(error);
    document.getElementById('panelResume').innerHTML = '<div style="color:var(--expense); padding:20px;">⚠️ Erro ao carregar dados.</div>';
    App.ui.navigateTo('panel');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

// ===== Função de alternância de tema =====
function toggleTheme() {
  const body = document.body;
  body.classList.toggle('light-mode');
  const isLight = body.classList.contains('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = isLight ? '☀️' : '🌙';
  if (window.App && App.planning && typeof App.planning.refreshIfActive === 'function') {
    App.planning.refreshIfActive();
  }
  if (window.App && App.ui && App.ui.getCurrentPage && App.ui.getCurrentPage() === 'saldos' && App.saldos) {
    App.saldos.load();
  }
}

// ===== Carregar tema salvo =====
(function() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = '☀️';
  }
})();

// =======================================================================
// Extrato de Desassociação de Membros
// =======================================================================
App.desassociacao = {
  async load() {
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;
    const select = document.getElementById('desassociacaoMembros');
    if (select) {
      select.innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    }
    const resumo = document.getElementById('desassociacaoResumo');
    const detalhes = document.getElementById('desassociacaoDetalhes');
    if (resumo) resumo.innerHTML = '';
    if (detalhes) detalhes.innerHTML = '';
  },

  async gerarExtrato() {
    const select = document.getElementById('desassociacaoMembros');
    if (!select) return;
    const selectedIds = Array.from(select.selectedOptions).map(o => o.value);
    if (selectedIds.length === 0) {
      App.utils.showToast('Selecione ao menos um membro.', 'error');
      return;
    }

    const allMembers = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = allMembers;
    const selectedMembers = allMembers.filter(m => selectedIds.includes(m.id));
    const membroMap = Object.fromEntries(allMembers.map(m => [m.id, m.name]));
    const divisor = selectedIds.length || 1;

    // Coleta todos os dados do banco
    const [transactions, accounts, creditCards, investments, patrimony, loans, vehicles, vehicleExpenses, previdencia, goals, wishes, budgets] = await Promise.all([
      App.db.getAll('transactions'),
      App.db.getAll('accounts'),
      App.db.getAll('creditCards'),
      App.db.getAll('investments'),
      App.db.getAll('patrimony'),
      App.db.getAll('loans'),
      App.db.getAll('vehicles'),
      App.db.getAll('vehicleExpenses'),
      App.db.getAll('previdencia'),
      App.db.getAll('goals'),
      App.db.getAll('wishes'),
      App.db.getAll('budgets')
    ]);

    // ----- FILTROS -----
    // Transações: member_id direto ou member_splits contendo algum membro
    const txFiltered = transactions.filter(t => {
      if (t.member_id && selectedIds.includes(t.member_id)) return true;
      if (t.member_splits && t.member_splits.some(sp => selectedIds.includes(sp.member_id))) return true;
      return false;
    });

    const accountsFiltered = accounts.filter(a => a.member_id && selectedIds.includes(a.member_id));
    const cardsFiltered = creditCards.filter(c => c.member_id && selectedIds.includes(c.member_id));
    const investmentsFiltered = investments.filter(inv => {
      const acc = accounts.find(a => a.id === inv.account_id);
      return acc && acc.member_id && selectedIds.includes(acc.member_id);
    });

    // Patrimônio e veículos: bens do casal, dividir igualmente
    const patrimonioDividido = patrimony.map(p => {
      const valor = parseFloat(p.value) || 0;
      return { ...p, valor_original: valor, valor_dividido: valor / divisor };
    });
    const veiculosDivididos = vehicles.map(v => {
      const valor = parseFloat(v.valor || v.value || 0) || 0;
      return { ...v, valor_original: valor, valor_dividido: valor / divisor };
    });
    const veiculosGastos = vehicleExpenses.filter(ve => {
      if (!ve.member_id) return false; // se não tem dono, não incluir
      return selectedIds.includes(ve.member_id);
    });

    // Empréstimos: associa pelo nome da pessoa
    const loanFiltered = loans.filter(l => {
      return selectedMembers.some(m => l.person && l.person.toLowerCase().includes(m.name.toLowerCase()));
    });

    // Previdência, metas, desejos: sem member_id, incluir se tiverem relação? Por ora, não incluir.
    // (poderá ser aprimorado futuramente)

    // ----- CÁLCULO DE TOTAIS -----
    const totalReceitas = txFiltered.filter(t => t.type === 'income' && t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalDespesas = txFiltered.filter(t => t.type === 'expense' && t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalInvest = investmentsFiltered.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0);
    const totalPatrimonio = patrimonioDividido.reduce((s, p) => s + p.valor_dividido, 0);
    const totalVeiculos = veiculosDivididos.reduce((s, v) => s + v.valor_dividido, 0);
    const totalContas = accountsFiltered.reduce((s, a) => s + (parseFloat(a.initial_balance) || 0), 0);
    const totalEmprestimos = loanFiltered.reduce((s, l) => s + parseFloat(l.amount), 0);

    // ----- RENDERIZAÇÃO -----
    const resumoEl = document.getElementById('desassociacaoResumo');
    const detalhesEl = document.getElementById('desassociacaoDetalhes');

    let resumoHTML = `
      <div class="cards-row">
        <div class="card"><div class="card-label">Receitas</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(totalReceitas)}</div></div>
        <div class="card"><div class="card-label">Despesas</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(totalDespesas)}</div></div>
        <div class="card"><div class="card-label">Investimentos</div><div class="card-value">${App.utils.formatCurrency(totalInvest)}</div></div>
        <div class="card"><div class="card-label">Patrimônio (por pessoa)</div><div class="card-value">${App.utils.formatCurrency(totalPatrimonio)}</div></div>
        <div class="card"><div class="card-label">Veículos (por pessoa)</div><div class="card-value">${App.utils.formatCurrency(totalVeiculos)}</div></div>
        <div class="card"><div class="card-label">Contas</div><div class="card-value">${App.utils.formatCurrency(totalContas)}</div></div>
        <div class="card"><div class="card-label">Empréstimos</div><div class="card-value">${App.utils.formatCurrency(totalEmprestimos)}</div></div>
      </div>`;
    resumoEl.innerHTML = resumoHTML;

    let detalhesHTML = '';

    // Transações
    detalhesHTML += `<h3>📊 Transações (${txFiltered.length})</h3>`;
    if (txFiltered.length > 0) {
      detalhesHTML += `<div class="table-container"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Membro</th><th class="text-right">Valor</th></tr></thead><tbody>`;
      txFiltered.forEach(t => {
        const sign = (t.type === 'income' || t.type === 'refund') ? '+' : '-';
        const membroNome = t.member_name || (t.member_id ? (membroMap[t.member_id] || '') : (t.member_splits && t.member_splits.length ? t.member_splits.map(sp => membroMap[sp.member_id] || sp.member_id).join(' + ') : ''));
        detalhesHTML += `<tr><td>${App.utils.formatDateTime(t.date)}</td><td>${t.type}</td><td>${t.description || ''}</td><td>${t.category || ''}</td><td>${membroNome}</td><td class="text-right">${sign} ${App.utils.formatCurrency(t.amount)}</td></tr>`;
      });
      detalhesHTML += `</tbody></table></div>`;
    } else {
      detalhesHTML += `<p>Nenhuma transação encontrada.</p>`;
    }

    // Contas
    detalhesHTML += `<h3>🏦 Contas (${accountsFiltered.length})</h3>`;
    if (accountsFiltered.length > 0) {
      detalhesHTML += `<div class="table-container"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Membro</th><th class="text-right">Saldo Inicial</th></tr></thead><tbody>`;
      accountsFiltered.forEach(a => {
        detalhesHTML += `<tr><td>${a.name}</td><td>${a.type}</td><td>${membroMap[a.member_id] || ''}</td><td class="text-right">${App.utils.formatCurrency(a.initial_balance || 0)}</td></tr>`;
      });
      detalhesHTML += `</tbody></table></div>`;
    } else {
      detalhesHTML += `<p>Nenhuma conta encontrada.</p>`;
    }

    // Cartões
    detalhesHTML += `<h3>💳 Cartões (${cardsFiltered.length})</h3>`;
    if (cardsFiltered.length > 0) {
      detalhesHTML += `<div class="table-container"><table><thead><tr><th>Nome</th><th>Limite</th><th>Membro</th></tr></thead><tbody>`;
      cardsFiltered.forEach(c => {
        detalhesHTML += `<tr><td>${c.name}</td><td>${App.utils.formatCurrency(c.limit || 0)}</td><td>${membroMap[c.member_id] || ''}</td></tr>`;
      });
      detalhesHTML += `</tbody></table></div>`;
    } else {
      detalhesHTML += `<p>Nenhum cartão encontrado.</p>`;
    }

    // Investimentos
    detalhesHTML += `<h3>📈 Investimentos (${investmentsFiltered.length})</h3>`;
    if (investmentsFiltered.length > 0) {
      detalhesHTML += `<div class="table-container"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Valor Atual</th></tr></thead><tbody>`;
      investmentsFiltered.forEach(i => {
        detalhesHTML += `<tr><td>${i.name}</td><td>${i.type}</td><td class="text-right">${App.utils.formatCurrency(i.current_value || 0)}</td></tr>`;
      });
      detalhesHTML += `</tbody></table></div>`;
    } else {
      detalhesHTML += `<p>Nenhum investimento encontrado.</p>`;
    }

    // Patrimônio (dividido)
    detalhesHTML += `<h3>🏠 Patrimônio dividido (${patrimonioDividido.length}) — cada item dividido por ${divisor}</h3>`;
    if (patrimonioDividido.length > 0) {
      detalhesHTML += `<div class="table-container"><table><thead><tr><th>Nome</th><th>Tipo</th><th class="text-right">Valor Original</th><th class="text-right">Valor por Pessoa</th></tr></thead><tbody>`;
      patrimonioDividido.forEach(p => {
        detalhesHTML += `<tr><td>${p.name}</td><td>${p.type === 'asset' ? 'Bem' : 'Dívida'}</td><td class="text-right">${App.utils.formatCurrency(p.valor_original)}</td><td class="text-right">${App.utils.formatCurrency(p.valor_dividido)}</td></tr>`;
      });
      detalhesHTML += `</tbody></table></div>`;
    } else {
      detalhesHTML += `<p>Nenhum item de patrimônio.</p>`;
    }

    // Veículos (dividido)
    detalhesHTML += `<h3>🚗 Veículos divididos (${veiculosDivididos.length}) — cada veículo dividido por ${divisor}</h3>`;
    if (veiculosDivididos.length > 0) {
      detalhesHTML += `<div class="table-container"><table><thead><tr><th>Modelo</th><th>Placa</th><th>KM</th><th class="text-right">Valor Original</th><th class="text-right">Valor por Pessoa</th></tr></thead><tbody>`;
      veiculosDivididos.forEach(v => {
        detalhesHTML += `<tr><td>${v.modelo || v.model || v.name || ''}</td><td>${v.placa || v.plate || ''}</td><td>${v.km || v.km_atual || ''}</td><td class="text-right">${App.utils.formatCurrency(v.valor_original)}</td><td class="text-right">${App.utils.formatCurrency(v.valor_dividido)}</td></tr>`;
      });
      detalhesHTML += `</tbody></table></div>`;
    } else {
      detalhesHTML += `<p>Nenhum veículo.</p>`;
    }

    // Empréstimos
    detalhesHTML += `<h3>🤝 Empréstimos (${loanFiltered.length})</h3>`;
    if (loanFiltered.length > 0) {
      detalhesHTML += `<div class="table-container"><table><thead><tr><th>Pessoa</th><th>Valor</th><th>Data</th><th>Situação</th></tr></thead><tbody>`;
      loanFiltered.forEach(l => {
        detalhesHTML += `<tr><td>${l.person}</td><td>${App.utils.formatCurrency(l.amount)}</td><td>${App.utils.formatDate(l.date)}</td><td>${l.status === 'paid' ? 'Pago' : 'Pendente'}</td></tr>`;
      });
      detalhesHTML += `</tbody></table></div>`;
    } else {
      detalhesHTML += `<p>Nenhum empréstimo.</p>`;
    }

    detalhesEl.innerHTML = detalhesHTML;

    // Guarda os dados para exportação
    this._extratoData = {
      membros: selectedMembers.map(m => m.name),
      divisor,
      transactions: txFiltered,
      accounts: accountsFiltered,
      cards: cardsFiltered,
      investments: investmentsFiltered,
      patrimonio: patrimonioDividido,
      vehicles: veiculosDivididos,
      loans: loanFiltered
    };
  },

  async exportarXLSX() {
    if (!this._extratoData) {
      App.utils.showToast('Gere o extrato antes de exportar.', 'error');
      return;
    }
    const data = this._extratoData;
    const wb = XLSX.utils.book_new();

    // Aba Transações
    const txSheet = XLSX.utils.json_to_sheet(data.transactions.map(t => ({
      Data: t.date,
      Tipo: t.type,
      Descrição: t.description || '',
      Categoria: t.category || '',
      Membro: t.member_name || '',
      Valor: parseFloat(t.amount)
    })));
    XLSX.utils.book_append_sheet(wb, txSheet, 'Transações');

    // Aba Contas
    const accountsSheet = XLSX.utils.json_to_sheet(data.accounts.map(a => ({
      Nome: a.name,
      Tipo: a.type,
      Membro: a.member_id ? (App.cache.members?.find(m => m.id === a.member_id)?.name || '') : '',
      SaldoInicial: parseFloat(a.initial_balance || 0)
    })));
    XLSX.utils.book_append_sheet(wb, accountsSheet, 'Contas');

    // Aba Cartões
    const cardsSheet = XLSX.utils.json_to_sheet(data.cards.map(c => ({
      Nome: c.name,
      Limite: parseFloat(c.limit || 0),
      Membro: c.member_id ? (App.cache.members?.find(m => m.id === c.member_id)?.name || '') : ''
    })));
    XLSX.utils.book_append_sheet(wb, cardsSheet, 'Cartões');

    // Aba Investimentos
    const invSheet = XLSX.utils.json_to_sheet(data.investments.map(i => ({
      Nome: i.name,
      Tipo: i.type,
      ValorAtual: parseFloat(i.current_value || 0)
    })));
    XLSX.utils.book_append_sheet(wb, invSheet, 'Investimentos');

    // Aba Patrimônio
    const patSheet = XLSX.utils.json_to_sheet(data.patrimonio.map(p => ({
      Nome: p.name,
      Tipo: p.type === 'asset' ? 'Bem' : 'Dívida',
      ValorOriginal: p.valor_original,
      ValorPorPessoa: p.valor_dividido
    })));
    XLSX.utils.book_append_sheet(wb, patSheet, 'Patrimônio');

    // Aba Veículos
    const vehSheet = XLSX.utils.json_to_sheet(data.vehicles.map(v => ({
      Modelo: v.modelo || v.model || v.name || '',
      Placa: v.placa || v.plate || '',
      KM: v.km || v.km_atual || '',
      ValorOriginal: v.valor_original,
      ValorPorPessoa: v.valor_dividido
    })));
    XLSX.utils.book_append_sheet(wb, vehSheet, 'Veículos');

    // Aba Empréstimos
    const loansSheet = XLSX.utils.json_to_sheet(data.loans.map(l => ({
      Pessoa: l.person,
      Valor: parseFloat(l.amount),
      Data: l.date,
      Situacao: l.status === 'paid' ? 'Pago' : 'Pendente'
    })));
    XLSX.utils.book_append_sheet(wb, loansSheet, 'Empréstimos');

    const membrosStr = data.membros.join('_');
    XLSX.writeFile(wb, `extrato_desassociacao_${membrosStr}.xlsx`);
    App.utils.showToast('Extrato XLSX exportado!');
  }
};

// =======================================================================
// Classificações 50/30/20 – página dedicada
// =======================================================================
App.classification = {
  currentMonthStart: null,

  async load() {
    try {
      if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
      const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);

      const cycleLabel = document.getElementById('classificationCycleLabel');
      if (cycleLabel) cycleLabel.textContent = `Ref. ${cycle.refMonth}`;

      const monthInput = document.getElementById('classificationMonthPicker');
      if (monthInput) {
        const d = new Date(this.currentMonthStart + 'T12:00:00');
        monthInput.value = d.toISOString().slice(0, 7);
      }

      const memberSelect = document.getElementById('classificationMemberFilter');
      if (memberSelect && memberSelect.options.length <= 1) {
        const members = App.cache.members || await App.db.getAll('members');
        if (!App.cache.members) App.cache.members = members;
        memberSelect.innerHTML = '<option value="all">Todos os membros</option>' +
          members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
      }

      const memberId = document.getElementById('classificationMemberFilter')?.value || 'all';

      const categorias = App.cache.categories || await App.db.getAll('categories');
      if (!App.cache.categories) App.cache.categories = categorias;
      const mapClass = {};
      categorias.forEach(c => { mapClass[c.name] = c.classification || 'necessary'; });

      const cards = App.cache.creditCards || await App.db.getAll('creditCards');
      if (!App.cache.creditCards) App.cache.creditCards = cards;

      // Range estendido: uma compra no cartão pode ter data de compra anterior
      // ao mês do vencimento da fatura. Buscamos até 3 meses antes do início
      // do ciclo para capturar todas as parcelas que vencem no mês em análise.
      const cycleStartOnly = cycle.start.slice(0, 10);
      const cycleEndOnly = cycle.end.slice(0, 10);
      const extendedStart = App.utils.addMonths(cycle.start, -3);

      const periodTxRaw = await App.db.getTransactionsInRange(extendedStart, cycle.end);
      let periodTx = periodTxRaw;
      if (memberId !== 'all') periodTx = periodTx.filter(t => t.member_id === memberId);

      let income = periodTx
        .filter(t => t.type === 'income' && t.status === 'confirmed' && !t.ignore_from_total && !t.ignore_from_classification)
        .filter(t => {
          const d = t.date.slice(0, 10);
          return d >= cycleStartOnly && d <= cycleEndOnly;
        })
        .reduce((s, t) => s + parseFloat(t.amount), 0);

      // Renda manual — usada apenas quando NÃO há receitas confirmadas no mês
      // (típico de meses futuros ou de meses sem lançamentos).
      this._usingManualIncome = false;
      this._manualIncomeValue = 0;
      if (income === 0) {
        const manual = await this._getManualIncome(cycle.start.slice(0, 7));
        if (manual && parseFloat(manual.amount) > 0) {
          income = parseFloat(manual.amount);
          this._usingManualIncome = true;
          this._manualIncomeValue = income;
        }
      }

      const gastos = { essential: 0, necessary: 0, superfluous: 0 };
      const itensPorClasse = { essential: [], necessary: [], superfluous: [] };

      for (const t of periodTx) {
        if (t.type !== 'expense' || t.ignore_from_total || t.ignore_from_classification) continue;
        let effectiveDate = t.date.slice(0, 10);
        if (t.credit_card_id) {
          const card = cards.find(c => c.id === t.credit_card_id);
          if (card) {
            try {
              const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
              effectiveDate = period.due.slice(0, 10);
            } catch (e) {}
          }
        }
        if (effectiveDate < cycle.start.slice(0, 10) || effectiveDate > cycle.end.slice(0, 10)) continue;
        const cls = t.classification || mapClass[t.category] || 'necessary';
        gastos[cls] += parseFloat(t.amount);
        itensPorClasse[cls].push(t);
      }

      const totalGasto = gastos.essential + gastos.necessary + gastos.superfluous;
      const sobra = income - totalGasto;
      const comprometimento = income > 0 ? (totalGasto / income) * 100 : 0;

      // Investimentos no período (aportes - resgates)
      let investContrib = 0;
      let investWithdraw = 0;
      const investTxList = [];
      for (const t of periodTx) {
        if (t.ignore_from_total || t.ignore_from_classification) continue;
        const isContrib = t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte');
        const isWithdraw = t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate');
        if (!isContrib && !isWithdraw) continue;
        const eff = t.date.slice(0, 10);
        if (eff < cycle.start.slice(0, 10) || eff > cycle.end.slice(0, 10)) continue;
        if (isContrib) investContrib += parseFloat(t.amount);
        else investWithdraw += parseFloat(t.amount);
        investTxList.push(t);
      }
      const investNet = investContrib - investWithdraw;

      const ideal = {
        essential: income * 0.50,
        necessary: income * 0.30,
        superfluous: income * 0.20
      };
      const idealInvest = income * 0.20;

      const kpiContainer = document.getElementById('classificationKPIs');
      if (kpiContainer) {
        kpiContainer.innerHTML = `
          <div class="card clickable" onclick="App.classification.showIncomeDetails()" style="cursor:pointer;" title="Clique para ver e ajustar a renda utilizável">
            <div class="card-label">💰 Renda do Mês${this._usingManualIncome ? ' <span style="font-size:0.68rem; color:#fbbf24; font-weight:500;">(manual)</span>' : ''}</div>
            <div class="card-value">${App.utils.formatCurrency(income)}</div>
            <div class="card-sub">${this._usingManualIncome ? 'Renda manual registrada para o mês' : 'Clique para ajustar renda utilizável'}</div>
          </div>
          <div class="card">
            <div class="card-label">📤 Total Gasto</div>
            <div class="card-value" style="color:#f87171;">${App.utils.formatCurrency(totalGasto)}</div>
            <div class="card-sub">${comprometimento.toFixed(1)}% da renda</div>
          </div>
          <div class="card">
            <div class="card-label">⚖️ Sobra</div>
            <div class="card-value" style="color:${sobra >= 0 ? '#a3e635' : '#f87171'};">${App.utils.formatCurrency(sobra)}</div>
            <div class="card-sub">${income > 0 ? ((sobra / income) * 100).toFixed(1) : '0.0'}% da renda</div>
          </div>
          <div class="card">
            <div class="card-label">🎯 Comprometimento</div>
            <div class="card-value">${comprometimento.toFixed(1)}%</div>
            <div class="card-sub">Meta: até 100% da renda</div>
          </div>
        `;
      }

      this._lastItensPorClasse = itensPorClasse;
      this._lastInvestTxList = investTxList;

      const cardsContainer = document.querySelector('#page-classifications #classificationCards');
      if (cardsContainer) {
        const nomes = { essential: '🏠 Essencial', necessary: '🛒 Necessário', superfluous: '🎉 Supérfluo' };
        const metas = { essential: '50%', necessary: '30%', superfluous: '20%' };
        const cores = { essential: '#a3e635', necessary: '#fbbf24', superfluous: '#f87171' };
        const backgrounds = { essential: 'rgba(163,230,53,0.06)', necessary: 'rgba(251,191,36,0.06)', superfluous: 'rgba(248,113,113,0.06)' };

        const investingCardHtml = (() => {
          const meta = idealInvest;
          const dif = investNet - meta;
          const difPct = meta > 0 ? (dif / meta) * 100 : 0;
          const pct = income > 0 ? (investNet / income) * 100 : 0;
          const progresso = Math.min((investNet / (meta || 1)) * 100, 100);
          const dvSinal = dif > 0 ? '▲' : (dif < 0 ? '▼' : '=');
          const dvCor = dif >= 0 ? '#60a5fa' : '#fbbf24';
          return `
            <div class="card clickable" onclick="App.classification.showClassDetails('investment')" style="background:rgba(96,165,250,0.06); border-left: 3px solid #60a5fa; cursor:pointer;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <div style="font-size:1rem; font-weight:600; color:#60a5fa;">💸 Investimentos</div>
                <div style="font-size:0.72rem; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:20px; padding:3px 10px; color:#888;">Meta 20%</div>
              </div>
              <div style="font-size:1.8rem; font-weight:700; margin-bottom:4px;">${App.utils.formatCurrency(investNet)}</div>
              <div style="font-size:0.78rem; color:#888; margin-bottom:14px;">Ideal: ${App.utils.formatCurrency(meta)}</div>
              <div style="background:#1a1a1a; height:8px; border-radius:4px; overflow:hidden; margin-bottom:12px;">
                <div style="width:${progresso}%; height:100%; background:#60a5fa; border-radius:4px;"></div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.78rem;">
                <span style="color:#888;">${pct.toFixed(1)}% da renda</span>
                <span style="color:${dvCor}; font-weight:600;">${dvSinal} ${App.utils.formatCurrency(Math.abs(dif))} (${Math.abs(difPct).toFixed(1)}%)</span>
              </div>
            </div>
          `;
        })();

        cardsContainer.innerHTML = ['essential', 'necessary', 'superfluous'].map(cls => {
          const real = gastos[cls];
          const meta = ideal[cls];
          const dif = real - meta;
          const difPct = meta > 0 ? (dif / meta) * 100 : 0;
          const pct = income > 0 ? (real / income) * 100 : 0;
          const progresso = Math.min((real / (meta || 1)) * 100, 100);
          const dvSinal = dif > 0 ? '▲' : (dif < 0 ? '▼' : '=');
          const dvCor = dif > 0 ? '#f87171' : '#a3e635';

          return `
            <div class="card clickable" onclick="App.classification.showClassDetails('${cls}')" style="background:${backgrounds[cls]}; border-left: 3px solid ${cores[cls]}; cursor:pointer;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <div style="font-size:1rem; font-weight:600; color:${cores[cls]};">${nomes[cls]}</div>
                <div style="font-size:0.72rem; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:20px; padding:3px 10px; color:#888;">Meta ${metas[cls]}</div>
              </div>
              <div style="font-size:1.8rem; font-weight:700; margin-bottom:4px;">${App.utils.formatCurrency(real)}</div>
              <div style="font-size:0.78rem; color:#888; margin-bottom:14px;">Ideal: ${App.utils.formatCurrency(meta)}</div>
              <div style="background:#1a1a1a; height:8px; border-radius:4px; overflow:hidden; margin-bottom:12px;">
                <div style="width:${progresso}%; height:100%; background:${cores[cls]}; border-radius:4px;"></div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.78rem;">
                <span style="color:#888;">${pct.toFixed(1)}% da renda</span>
                <span style="color:${dvCor}; font-weight:600;">${dvSinal} ${App.utils.formatCurrency(Math.abs(dif))} (${Math.abs(difPct).toFixed(1)}%)</span>
              </div>
            </div>
          `;
        }).join('') + investingCardHtml;
      }

      this.renderTransactionsTable(itensPorClasse);

    } catch (e) {
      console.error('Erro ao carregar Classificações:', e);
      App.utils.showToast('Erro ao carregar Classificações.', 'error');
    }
  },

  renderCategoriesTable(categorias, itensPorClasse) {
    const tbody = document.getElementById('classificationCategoriesBody');
    if (!tbody) return;

    const grupos = { essential: [], necessary: [], superfluous: [] };
    categorias.filter(c => c.type === 'expense' && !c.parent_id).forEach(c => {
      const cls = c.classification || 'necessary';
      if (grupos[cls]) grupos[cls].push(c);
    });

    const nomes = { essential: '🏠 Essencial', necessary: '🛒 Necessário', superfluous: '🎉 Supérfluo' };
    const cores = { essential: '#a3e635', necessary: '#fbbf24', superfluous: '#f87171' };

    let html = '';
    ['essential', 'necessary', 'superfluous'].forEach(cls => {
      const totalCls = itensPorClasse[cls].reduce((s, t) => s + parseFloat(t.amount), 0);
      html += `<tr style="background:var(--bg-secondary);">
        <td colspan="3"><strong style="color:${cores[cls]};">${nomes[cls]}</strong>
          <span style="color:#888; font-size:0.8rem; margin-left:8px;">${grupos[cls].length} categorias · Total: ${App.utils.formatCurrency(totalCls)}</span>
        </td>
      </tr>`;
      grupos[cls].sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(c => {
        const totalCat = itensPorClasse[cls]
          .filter(t => t.category === c.name)
          .reduce((s, t) => s + parseFloat(t.amount), 0);
        const countCat = itensPorClasse[cls].filter(t => t.category === c.name).length;
        html += `<tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${c.color || '#888'};"></span>
              <span>${c.name}</span>
            </div>
          </td>
          <td class="text-center" style="color:#888;">${countCat}</td>
          <td class="text-right" style="font-weight:600;">${App.utils.formatCurrency(totalCat)}</td>
        </tr>`;
      });
    });

    tbody.innerHTML = html;
  },

  _selectedTxIds: [],

  renderTransactionsTable(itensPorClasse) {
    const tbody = document.getElementById('classificationTransactionsBody');
    if (!tbody) return;

    const all = [
      ...itensPorClasse.essential.map(t => ({ ...t, _cls: 'essential' })),
      ...itensPorClasse.necessary.map(t => ({ ...t, _cls: 'necessary' })),
      ...itensPorClasse.superfluous.map(t => ({ ...t, _cls: 'superfluous' }))
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Reseta seleção a cada render
    this._selectedTxIds = [];
    const bulkBar = document.getElementById('classificationBulkActions');
    const bulkCount = document.getElementById('classificationBulkCount');
    const selectAllCheckbox = document.getElementById('classificationSelectAll');
    const bulkValue = document.getElementById('classificationBulkValue');
    if (bulkBar) bulkBar.style.display = 'none';
    if (bulkCount) bulkCount.textContent = '0';
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    if (bulkValue) bulkValue.value = '';

    if (!all.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#666; padding:24px;">Nenhuma transação no período.</td></tr>';
      return;
    }

    const nomes = { essential: 'Essencial', necessary: 'Necessário', superfluous: 'Supérfluo' };
    const cores = { essential: '#a3e635', necessary: '#fbbf24', superfluous: '#f87171' };

    // Buscar cartões para nome + cálculo do mês de vencimento
    const creditCards = App.cache.creditCards || [];
    const cardById = Object.fromEntries(creditCards.map(c => [c.id, c]));

    // Separar transações de cartão (agrupáveis) das demais
    const cardTx = [];
    const otherTx = [];
    for (const t of all) {
      if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund') && cardById[t.credit_card_id]) {
        cardTx.push(t);
      } else {
        otherTx.push(t);
      }
    }

    // Agrupar transações de cartão por (card_id + due_month)
    const invoiceGroups = {};
    for (const t of cardTx) {
      const card = cardById[t.credit_card_id];
      let dueDate = t.date.slice(0, 10);
      let dueMonth = dueDate.slice(0, 7);
      try {
        const period = App.cardInvoice.getInvoicePeriodForDate(card, t.date.slice(0, 10));
        dueDate = period.due.slice(0, 10);
        dueMonth = dueDate.slice(0, 7);
      } catch (e) {}
      const key = `${t.credit_card_id}|${dueMonth}`;
      if (!invoiceGroups[key]) {
        invoiceGroups[key] = {
          cardId: t.credit_card_id,
          cardName: card.name,
          dueDate,
          dueMonth,
          items: []
        };
      }
      invoiceGroups[key].items.push(t);
    }

    // Montar linhas: faturas agrupadas + transações não-cartão
    const rows = [];

    for (const key of Object.keys(invoiceGroups)) {
      const g = invoiceGroups[key];
      const total = g.items.reduce((s, t) => s + parseFloat(t.amount), 0);
      const count = g.items.length;
      const classesUsadas = [...new Set(g.items.map(t => t._cls))];
      const hasPending = g.items.some(t => t.status === 'pending');
      const statusCell = hasPending
        ? `<span style="color:#fbbf24; font-weight:600; font-size:0.78rem;">⏳ Pendente</span>`
        : `<span style="color:#a3e635; font-weight:600; font-size:0.78rem;">✓ Efetivada</span>`;

      let classificationCell;
      if (classesUsadas.length === 1) {
        const cls = classesUsadas[0];
        classificationCell = `<span style="color:${cores[cls]}; font-weight:600; font-size:0.82rem;">${nomes[cls]} 🔒</span>`;
      } else {
        classificationCell = `<span style="color:#888; font-weight:600; font-size:0.82rem;" title="Contém compras de múltiplas classificações.">Múltiplas 🔒</span>`;
      }

      rows.push({
        sortDate: g.dueDate,
        html: `
        <tr>
          <td></td>
          <td>${App.utils.formatDate(g.dueDate)}</td>
          <td><span style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="App.classification._openInvoiceForCard('${g.cardId}', '${g.dueMonth}')">Fatura ${g.cardName} ${g.dueMonth}</span> <span style="color:var(--text-muted); font-size:0.78rem;">(${count} ${count === 1 ? 'compra' : 'compras'})</span></td>
          <td>Fatura Cartão</td>
          <td>${classificationCell}</td>
          <td>${statusCell}</td>
          <td class="text-right" style="font-weight:600; color:#f87171;">- ${App.utils.formatCurrency(total)}</td>
        </tr>`
      });
    }

    for (const t of otherTx) {
      const isCardRelated = App.classification._isCreditCardRelated(t);
      const classificationCell = isCardRelated
        ? `<span
              style="color:${cores[t._cls]}; font-weight:600; font-size:0.82rem; cursor:help; opacity:0.85;"
              title="Transação de cartão de crédito. Edite pela seção Cartão de Crédito."
              onclick="App.classification.editSingleClassification('${t.id}')">
              ${nomes[t._cls]} 🔒
            </span>`
        : `<span
              style="color:${cores[t._cls]}; font-weight:600; font-size:0.82rem; cursor:pointer; text-decoration:underline dotted;"
              title="Clique para alterar a classificação"
              onclick="App.classification.editSingleClassification('${t.id}')">
              ${nomes[t._cls]} ✎
            </span>`;

      const isPending = t.status === 'pending';
      const statusCell = isPending
        ? `<span style="color:#fbbf24; font-weight:600; font-size:0.78rem;">⏳ Pendente</span>`
        : `<span style="color:#a3e635; font-weight:600; font-size:0.78rem;">✓ Efetivada</span>`;

      rows.push({
        sortDate: t.date.slice(0, 10),
        html: `
        <tr>
          <td><input type="checkbox" class="classificationCheck" value="${t.id}" onchange="App.classification.onTxCheckboxChange()"></td>
          <td>${App.utils.formatDateTime(t.date)}</td>
          <td>${(t.description || t.category || '').substring(0, 50)}</td>
          <td>${t.category || '-'}</td>
          <td>${classificationCell}</td>
          <td>${statusCell}</td>
          <td class="text-right" style="font-weight:600;">${App.utils.formatCurrency(t.amount)}</td>
        </tr>`
      });
    }

    rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate));

    tbody.innerHTML = rows.map(r => r.html).join('');
  },

  // Abre a fatura do cartão no mês de vencimento específico
  _openInvoiceForCard(cardId, dueMonth) {
    const card = (App.cache.creditCards || []).find(c => c.id === cardId);
    if (!card) return;
    const period = App.cardInvoice.getInvoicePeriodForMonth(card, dueMonth);
    App.cardInvoice.open(cardId, { start: period.start, end: period.end, due: period.due });
  },

  // Heurística: identifica transações que pertencem ao fluxo de cartão de crédito
  // e que, portanto, NÃO devem ser reclassificadas por esta tela.
  _isCreditCardRelated(tx) {
    if (!tx) return false;
    if (tx.credit_card_id) return true;                      // compra individual no cartão
    if (tx.invoice_locked === true) return true;             // parcela travada por pagamento de fatura
    if (tx.category === 'Pagamento Fatura') return true;     // registro de pagamento de fatura
    if (typeof tx.description === 'string' &&
        /^Pagamento Fatura\b/i.test(tx.description)) return true; // fallback por descrição
    return false;
  },

  toggleSelectAllTx() {
    const selectAll = document.getElementById('classificationSelectAll');
    if (!selectAll) return;
    const checked = selectAll.checked;
    document.querySelectorAll('.classificationCheck').forEach(cb => { cb.checked = checked; });
    this.onTxCheckboxChange();
  },

  onTxCheckboxChange() {
    const checkboxes = document.querySelectorAll('.classificationCheck');
    this._selectedTxIds = [];
    checkboxes.forEach(cb => { if (cb.checked) this._selectedTxIds.push(cb.value); });
    const selectAll = document.getElementById('classificationSelectAll');
    if (selectAll) {
      selectAll.checked = (checkboxes.length > 0 && this._selectedTxIds.length === checkboxes.length);
    }
    this._updateBulkBar();
  },

  _updateBulkBar() {
    const bar = document.getElementById('classificationBulkActions');
    const countEl = document.getElementById('classificationBulkCount');
    const n = this._selectedTxIds.length;
    if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = n;
  },

  clearTxSelection() {
    this._selectedTxIds = [];
    document.querySelectorAll('.classificationCheck').forEach(cb => { cb.checked = false; });
    const selectAll = document.getElementById('classificationSelectAll');
    if (selectAll) selectAll.checked = false;
    const bulkValue = document.getElementById('classificationBulkValue');
    if (bulkValue) bulkValue.value = '';
    this._updateBulkBar();
  },

  async applyBulkClassification() {
    if (!this._selectedTxIds.length) {
      App.utils.showToast('Nenhuma transação selecionada.', 'error');
      return;
    }
    const newClass = document.getElementById('classificationBulkValue')?.value || '';
    if (!newClass || !['essential', 'necessary', 'superfluous'].includes(newClass)) {
      App.utils.showToast('Escolha uma classificação para aplicar.', 'error');
      return;
    }

    const total = this._selectedTxIds.length;
    App.utils.confirm(
      `Aplicar a classificação em ${total} transação(ões)?`,
      async () => {
        try {
          let updated = 0;
          for (const id of this._selectedTxIds) {
            const tx = await App.db.getById('transactions', id);
            if (!tx) continue;
            if (tx.classification === newClass) continue;
            tx.classification = newClass;
            tx.updatedAt = new Date().toISOString();
            await App.db.put('transactions', tx);
            updated++;
          }

          // Invalida caches globais
          if (App.transactions && App.transactions.invalidateCache) App.transactions.invalidateCache();
          App.cache.totalBalance = null;

          // Recarrega a própria página (recalcula KPIs, cards e tabela)
          await this.load();

          // Sincroniza todas as seções dependentes de `classification`
          App.dashboard.refresh();
          App.panel.refresh();
          App.transactions.load();
          if (App.categorization) App.categorization.load();
          if (App.analytics) App.analytics.refresh();

          App.utils.showToast(`${updated} transação(ões) atualizada(s)!`);
        } catch (e) {
          console.error('Erro ao aplicar classificação em massa:', e);
          App.utils.showToast('Erro ao aplicar classificação em massa.', 'error');
        }
      }
    );
  },

  async editSingleClassification(txId) {
    const tx = await App.db.getById('transactions', txId);
    if (!tx) return;

    // Reutiliza o modal de classificação já existente na aplicação
    App.transactions._pendingClassifyId = txId;
    const descEl = document.getElementById('classifyDesc');
    if (descEl) {
      descEl.innerHTML = `Transação: <strong>${(tx.description || tx.category || '').substring(0, 60)}</strong><br>Valor: ${App.utils.formatCurrency(tx.amount)}`;
    }
    App.ui.openModal('modalClassification');
  },

  // -------------------------------------------------------------------
  // Modal de detalhes ao clicar em um card de classificação ou do card
  // de Investimentos. Reaproveita o modal #modalCardDetail da tela de
  // transações (mesmo título, tabela e total).
  // -------------------------------------------------------------------
  async showClassDetails(cls) {
    const titulos = {
      essential: '🏠 Essencial',
      necessary: '🛒 Necessário',
      superfluous: '🎉 Supérfluo',
      investment: '💸 Investimentos'
    };
    const typeNames = {
      income: 'Receita',
      expense: 'Despesa',
      transfer: 'Transferência',
      contribution: 'Aporte',
      withdrawal: 'Resgate',
      refund: 'Estorno'
    };

    let lista;
    if (cls === 'investment') {
      lista = (this._lastInvestTxList || []).slice();
    } else {
      lista = (this._lastItensPorClasse && this._lastItensPorClasse[cls])
        ? this._lastItensPorClasse[cls].slice()
        : [];
    }

    lista.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const titleEl = document.getElementById('cardDetailTitle');
    const filterDiv = document.getElementById('cardDetailFilters');
    const tbody = document.getElementById('cardDetailTableBody');
    const totalEl = document.getElementById('cardDetailTotal');
    if (!titleEl || !tbody || !totalEl) return;

    titleEl.textContent = titulos[cls] || 'Detalhes';

    if (filterDiv) {
      filterDiv.style.display = 'none';
      filterDiv.innerHTML = '';
    }

    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">Nenhuma transação nesta classificação no período.</td></tr>';
      totalEl.innerHTML = 'Total: <strong>' + App.utils.formatCurrency(0) + '</strong>';
      App.ui.openModal('modalCardDetail');
      return;
    }

    let html = '';
    let total = 0;

    for (const t of lista) {
      const amt = parseFloat(t.amount) || 0;
      const isEntrada = t.type === 'income' || t.type === 'refund' || t.type === 'withdrawal';
      const cor = isEntrada ? 'var(--income)' : 'var(--expense)';
      const sinal = isEntrada ? '+' : '-';
      const tipoNome = typeNames[t.type] || t.type;
      const dataFmt = App.utils.formatDateTime(t.date);

      total += isEntrada ? amt : -amt;

      html += `<tr>
        <td>${dataFmt}</td>
        <td>${tipoNome}</td>
        <td></td>
        <td>${t.category || '-'}</td>
        <td>${t.description || ''}</td>
        <td>${t.member_name || ''}</td>
        <td class="text-right" style="color:${cor};">${sinal} ${App.utils.formatCurrency(amt)}</td>
      </tr>`;
    }

    tbody.innerHTML = html;
    totalEl.innerHTML = 'Total: <strong>' + App.utils.formatCurrency(Math.abs(total)) + '</strong>';

    App.ui.openModal('modalCardDetail');
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

  gotoMonth() {
    const month = document.getElementById('classificationMonthPicker')?.value;
    if (month) {
      const [y, m] = month.split('-');
      this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate;
      this.load();
    }
  },

  // -------------------------------------------------------------------
  // Detalhes da Renda — modal com toggles de ignore_from_total
  // -------------------------------------------------------------------
  _incomeList: [],
  _incomeCycle: null,

  async showIncomeDetails() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    const memberId = document.getElementById('classificationMemberFilter')?.value || 'all';

    const periodTxRaw = await App.db.getTransactionsInRange(cycle.start, cycle.end);
    let periodTx = periodTxRaw;
    if (memberId !== 'all') periodTx = periodTx.filter(t => t.member_id === memberId);

    const incomes = periodTx.filter(t => t.type === 'income' && t.status === 'confirmed');

    this._incomeCycle = cycle;
    this._incomeList = incomes;
    this._manualIncomeRecord = await this._getManualIncome(cycle.start.slice(0, 7));

    this.renderIncomeDetails();
    App.ui.openModal('modalIncomeDetail');
  },

  renderIncomeDetails() {
    const container = document.getElementById('incomeDetailModalContent');
    if (!container) return;

    const list = this._incomeList || [];
    const cycle = this._incomeCycle;
    const manual = this._manualIncomeRecord;

    // -------------------------------------------------------------------
    // Bloco 1: Renda Manual do Mês
    // -------------------------------------------------------------------
    let manualBlock = `
      <div style="margin-bottom:16px; padding:14px 16px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px;">
        <div style="font-size:0.85rem; font-weight:600; margin-bottom:6px;">📝 Renda Manual do Mês</div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:10px;">
          Use para registrar uma renda prevista em meses futuros ou em meses sem receitas lançadas.
          Esta renda é usada no cálculo 50/30/20 enquanto não houver receitas confirmadas no mês.
        </div>
        ${manual ? `
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <div style="flex:1; min-width:180px;">
              <div style="font-size:0.72rem; color:#888; text-transform:uppercase; letter-spacing:0.05em;">Valor registrado</div>
              <div style="font-size:1.2rem; font-weight:600; color:#fbbf24;">${App.utils.formatCurrency(manual.amount)}</div>
              ${manual.note ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">${manual.note}</div>` : ''}
            </div>
            <button type="button" class="btn btn-sm btn-outline" onclick="App.classification.editManualIncomeFromModal()">✏️ Editar</button>
            <button type="button" class="btn btn-sm btn-danger" onclick="App.classification.removeManualIncomeFromModal()">🗑️ Remover</button>
          </div>
        ` : `
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
            <div style="flex:1; min-width:150px;">
              <label style="font-size:0.72rem; color:#888; display:block; margin-bottom:4px;">Valor (R$)</label>
              <input type="number" id="manualIncomeAmount" step="0.01" min="0" placeholder="0,00" style="width:100%; padding:8px 10px; background:#0f0f0f; color:var(--text); border:1px solid var(--border); border-radius:6px;">
            </div>
            <div style="flex:2; min-width:200px;">
              <label style="font-size:0.72rem; color:#888; display:block; margin-bottom:4px;">Observação (opcional)</label>
              <input type="text" id="manualIncomeNote" placeholder="Ex.: Salário previsto" style="width:100%; padding:8px 10px; background:#0f0f0f; color:var(--text); border:1px solid var(--border); border-radius:6px;">
            </div>
            <button type="button" class="btn btn-sm btn-primary" onclick="App.classification.saveManualIncomeFromModal()">💾 Salvar</button>
          </div>
        `}
      </div>
    `;

    // -------------------------------------------------------------------
    // Bloco 2: Lista de Receitas do Período
    // -------------------------------------------------------------------
    let listBlock = '';
    if (!list.length) {
      listBlock = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.85rem;">Nenhuma receita confirmada em ${cycle ? cycle.refMonth : ''}.</div>`;
    } else {
      list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const totalUtil = list.filter(t => !t.ignore_from_total && !t.ignore_from_classification).reduce((s, t) => s + parseFloat(t.amount), 0);
      const totalIgnorado = list.filter(t => t.ignore_from_total || t.ignore_from_classification).reduce((s, t) => s + parseFloat(t.amount), 0);

      listBlock = `
        <div style="display:flex; gap:12px; margin-bottom:14px;">
          <div style="flex:1; padding:12px 16px; background:var(--bg-secondary); border-radius:8px;">
            <div style="font-size:0.72rem; color:#888; text-transform:uppercase; letter-spacing:0.05em;">Renda Utilizável</div>
            <div style="font-size:1.2rem; font-weight:600; color:#a3e635;">${App.utils.formatCurrency(totalUtil)}</div>
          </div>
          <div style="flex:1; padding:12px 16px; background:var(--bg-secondary); border-radius:8px;">
            <div style="font-size:0.72rem; color:#888; text-transform:uppercase; letter-spacing:0.05em;">Ignorada</div>
            <div style="font-size:1.2rem; font-weight:600; color:#f87171;">${App.utils.formatCurrency(totalIgnorado)}</div>
          </div>
          <div style="flex:1; padding:12px 16px; background:var(--bg-secondary); border-radius:8px;">
            <div style="font-size:0.72rem; color:#888; text-transform:uppercase; letter-spacing:0.05em;">Total</div>
            <div style="font-size:1.2rem; font-weight:600;">${App.utils.formatCurrency(totalUtil + totalIgnorado)}</div>
          </div>
        </div>
        <div class="table-container" style="max-height:45vh; overflow-y:auto;">
          <table>
            <thead>
              <tr>
                <th style="width:60px;">Ignorar</th>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Membro</th>
                <th class="text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(t => {
                const ignored = !!t.ignore_from_total || !!t.ignore_from_classification;
                return `
                  <tr style="${ignored ? 'opacity:0.5;' : ''}">
                    <td><input type="checkbox" ${ignored ? 'checked' : ''} onchange="App.classification.toggleIncomeIgnore('${t.id}')"></td>
                    <td>${App.utils.formatDateTime(t.date)}</td>
                    <td>${t.description || t.category || ''}</td>
                    <td>${t.category || '-'}</td>
                    <td>${t.member_name || '-'}</td>
                    <td class="text-right" style="font-weight:600; color:${ignored ? '#888' : '#a3e635'};">${App.utils.formatCurrency(t.amount)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    container.innerHTML = manualBlock + listBlock;
  },

  async toggleIncomeIgnore(txId) {
    const t = await App.db.getById('transactions', txId);
    if (!t) return;

    const eraIgnorada = !!t.ignore_from_total || !!t.ignore_from_classification;

    if (eraIgnorada) {
      // Desmarcando: libera a receita para uso no 50/30/20.
      // Também limpa ignore_from_total caso a marcação tenha vindo
      // de um clique anterior feito antes desta correção.
      t.ignore_from_total = false;
      t.ignore_from_classification = false;
    } else {
      // Marcando: só afeta o 50/30/20. Não interfere em saldo,
      // dashboard, extratos, relatórios nem analytics.
      t.ignore_from_classification = true;
    }

    t.updatedAt = new Date().toISOString();
    await App.db.put('transactions', t);

    const idx = (this._incomeList || []).findIndex(x => x.id === txId);
    if (idx >= 0) this._incomeList[idx] = t;

    this.renderIncomeDetails();

    App.transactions.invalidateCache?.();
    await this.load();

    App.utils.showToast(eraIgnorada ? 'Receita reativada no 50/30/20.' : 'Receita ignorada apenas no 50/30/20.');
  },

  // -------------------------------------------------------------------
  // Renda Manual — persistida no store 'manualIncomes' por mês (YYYY-MM)
  // -------------------------------------------------------------------
  _manualIncomeRecord: null,

  async _getManualIncome(monthKey) {
    const all = await App.db.getAll('manualIncomes');
    return all.find(m => m.month === monthKey) || null;
  },

  async _saveManualIncome(monthKey, amount, note) {
    const existing = await this._getManualIncome(monthKey);
    const record = {
      id: existing ? existing.id : App.utils.generateId(),
      month: monthKey,
      amount: parseFloat(amount) || 0,
      note: note || '',
      updatedAt: new Date().toISOString()
    };
    await App.db.put('manualIncomes', record);
    return record;
  },

  async _removeManualIncome(monthKey) {
    const existing = await this._getManualIncome(monthKey);
    if (existing) await App.db.delete('manualIncomes', existing.id);
  },

  async saveManualIncomeFromModal() {
    const cycle = this._incomeCycle;
    if (!cycle) return;
    const monthKey = cycle.start.slice(0, 7);
    const input = document.getElementById('manualIncomeAmount');
    const noteInput = document.getElementById('manualIncomeNote');
    const value = parseFloat((input?.value || '').replace(',', '.'));
    if (!value || value <= 0 || isNaN(value)) {
      App.utils.showToast('Informe um valor válido para a renda manual.', 'error');
      return;
    }
    await this._saveManualIncome(monthKey, value, noteInput?.value || '');
    App.utils.showToast('Renda manual registrada.');
    this._manualIncomeRecord = await this._getManualIncome(monthKey);
    this.renderIncomeDetails();
    await this.load();
    App.dashboard.refresh();
    App.panel.refresh();
  },

  async editManualIncomeFromModal() {
    const cycle = this._incomeCycle;
    if (!cycle) return;
    const monthKey = cycle.start.slice(0, 7);
    const manual = this._manualIncomeRecord;
    if (!manual) return;
    App.utils.prompt('Novo valor da renda manual (R$):', String(manual.amount), async (val) => {
      const num = parseFloat((val || '').replace(',', '.'));
      if (isNaN(num) || num <= 0) {
        App.utils.showToast('Valor inválido.', 'error');
        return;
      }
      await this._saveManualIncome(monthKey, num, manual.note || '');
      App.utils.showToast('Renda manual atualizada.');
      this._manualIncomeRecord = await this._getManualIncome(monthKey);
      this.renderIncomeDetails();
      await this.load();
      App.dashboard.refresh();
      App.panel.refresh();
    });
  },

  async removeManualIncomeFromModal() {
    const cycle = this._incomeCycle;
    if (!cycle) return;
    const monthKey = cycle.start.slice(0, 7);
    await this._removeManualIncome(monthKey);
    App.utils.showToast('Renda manual removida.');
    this._manualIncomeRecord = null;
    this.renderIncomeDetails();
    await this.load();
    App.dashboard.refresh();
    App.panel.refresh();
  }
};