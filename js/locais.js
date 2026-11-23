// =====================================================================
// ARQUIVO: locais.js
// Locais: agrupamento de despesas por empresa/comerciante
// =====================================================================
var App = window.App || {};

// =======================================================================
// Locais — Agrupamento de despesas por empresa/comerciante (versão visual)
// =======================================================================
App.locais = {
  _cache: null,
  _locaisCompilados: null,
  _filterCategoria: 'all',
  _filterPeriodo: 'all',
  _filterTipo: 'all',
  _filterBusca: '',
  _buscaTimeout: null,
  _sortMode: 'maior-gasto',
  _currentPage: 1,

  // ----------------------------------------------------------------
  // Garante que o dicionário está semeado no IndexedDB
  // ----------------------------------------------------------------
  async _ensureSeeded() {
    try {
      const locais = await App.db.getAll('locais');
      if (locais.length === 0) {
        const seedSource = (App.config && App.config.LOCAIS_SEED) ? App.config.LOCAIS_SEED : [];
        const seed = seedSource.map(l => Object.assign({}, l, {
          createdAt: new Date().toISOString()
        }));
        if (seed.length > 0) {
          await App.db.putMany('locais', seed);
        }
        return await App.db.getAll('locais');
      }
      return locais;
    } catch (e) {
      console.error('[Locais] Erro em _ensureSeeded:', e);
      return [];
    }
  },

  // ----------------------------------------------------------------
  // Compila padrões (strings/RegExp) em RegExp com flag 'i'
  // ----------------------------------------------------------------
  _compilePatterns(local) {
    return (local.padroes || []).map(p => {
      if (p instanceof RegExp) return p;
      if (typeof p === 'string') {
        const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
        if (m) {
          try { return new RegExp(m[1], m[2] || 'i'); } catch (e) { return null; }
        }
        try { return new RegExp(p, 'i'); } catch (e) { return null; }
      }
      return null;
    }).filter(Boolean);
  },

  // ----------------------------------------------------------------
  // Retorna o local correspondente à tx, ou null
  // ----------------------------------------------------------------
  match(tx, locaisCompilados) {
    if (!tx || !Array.isArray(locaisCompilados)) return null;
    const desc = String(tx.description || '');
    const acc  = String(tx.account_name || '');
    const mem  = String(tx.member_name || '');
    const haystacks = [desc, acc, mem];

    for (let i = 0; i < locaisCompilados.length; i++) {
      const local = locaisCompilados[i];
      if (!local.excluir_do_ranking) continue;
      const regs = local._compiled || [];
      for (let j = 0; j < regs.length; j++) {
        const re = regs[j];
        if (haystacks.some(h => re.test(h))) return local;
      }
    }
    for (let i = 0; i < locaisCompilados.length; i++) {
      const local = locaisCompilados[i];
      if (local.excluir_do_ranking) continue;
      const regs = local._compiled || [];
      for (let j = 0; j < regs.length; j++) {
        const re = regs[j];
        if (haystacks.some(h => re.test(h))) return local;
      }
    }
    return null;
  },

  // ----------------------------------------------------------------
  // Carregamento principal
  // ----------------------------------------------------------------
  async load() {
    const container = document.getElementById('locaisContent');
    if (!container) return;

    container.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">Carregando…</div>';

    try {
      const locais = await this._ensureSeeded();

      const locaisCompilados = locais.map(l => Object.assign({}, l, {
        _compiled: this._compilePatterns(l)
      }));
      this._locaisCompilados = locaisCompilados;

      const allTx = await App.db.getAll('transactions');
      const expenses = allTx.filter(t => t.type === 'expense' && t.status === 'confirmed');

      const filteredByPeriod = this._applyPeriodFilter(expenses);
      const previousTxs = this._applyPreviousPeriodFilter(expenses);

      const aggregation = this._aggregate(filteredByPeriod, locaisCompilados);
      const previousAggregation = this._aggregate(previousTxs, locaisCompilados);

      // Variação vs. período anterior
      const prevMap = new Map(previousAggregation.matched.map(g => [g.local.id, g.total]));
      aggregation.matched.forEach(g => {
        const prev = prevMap.get(g.local.id) || 0;
        g.previousTotal = prev;
        if (prev === 0 && g.total > 0) {
          g.variationPct = 100;
          g.variationDirection = 'up';
        } else if (prev === 0 && g.total === 0) {
          g.variationPct = 0;
          g.variationDirection = 'flat';
        } else {
          g.variationPct = ((g.total - prev) / prev) * 100;
          g.variationDirection = g.variationPct > 0.5 ? 'up' : (g.variationPct < -0.5 ? 'down' : 'flat');
        }
        g.tipoLocal = this._classifyLocalType(g.local);
      });

      const displayed = this._applyVisualFilters(aggregation);

      const monthlyBars = this._buildMonthlyBars(filteredByPeriod, locaisCompilados);
      const locaisPorTipo = this._buildLocaisPorTipo(aggregation.matched);
      const highlights = this._buildHighlights(aggregation.matched);
      const dataRange = this._computeDataRange(filteredByPeriod);

      this._cache = {
        aggregation,
        previousAggregation,
        displayed,
        locaisCompilados,
        totalTxCount: filteredByPeriod.length,
        matchedTxCount: displayed.matched.reduce((s, g) => s + g.count, 0),
        unmatchedTx: displayed.unmatched,
        monthlyBars,
        locaisPorTipo,
        highlights,
        dataRange,
        totalValue: displayed.matched.reduce((s, g) => s + g.total, 0),
        currentPage: this._currentPage || 1,
        pageSize: 10
      };

      this._render();
    } catch (e) {
      console.error('[Locais] Erro em load():', e);
      container.innerHTML = '<div style="padding:40px; text-align:center; color:var(--expense);">' +
        '<div style="font-size:2rem; margin-bottom:12px;">⚠️</div>' +
        '<div style="font-weight:600; margin-bottom:6px;">Erro ao carregar Locais</div>' +
        '<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">' +
        (e && e.message ? e.message : 'Erro desconhecido') + '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="App.locais.load()">🔄 Tentar novamente</button>' +
        '</div>';
    }
  },

  // ----------------------------------------------------------------
  // Período atual
  // ----------------------------------------------------------------
  _applyPeriodFilter(txs) {
    const p = this._filterPeriodo;
    if (p === 'all') return txs;
    const today = App.utils.todayISO();
    let startDate;
    if (p === 'currentMonth') {
      startDate = App.utils.currentMonth().startDate;
    } else if (p === 'last3') {
      startDate = App.utils.addMonths(today, -3);
    } else if (p === 'last6') {
      startDate = App.utils.addMonths(today, -6);
    } else if (p === 'last12') {
      startDate = App.utils.addMonths(today, -12);
    } else {
      return txs;
    }
    return txs.filter(t => (t.date || '').slice(0, 10) >= startDate);
  },

  // ----------------------------------------------------------------
  // Período anterior equivalente (para variação)
  // ----------------------------------------------------------------
  _applyPreviousPeriodFilter(txs) {
    const p = this._filterPeriodo;
    if (p === 'all') return [];
    const today = App.utils.todayISO();
    let startPrev, endPrev;
    if (p === 'currentMonth') {
      const cur = App.utils.currentMonth();
      const prevMonthDate = App.utils.addMonths(cur.startDate, -1);
      const prev = App.utils.monthRangeFromDate(prevMonthDate);
      startPrev = prev.startDate;
      endPrev = (prev.end || '').slice(0, 10);
    } else if (p === 'last3') {
      const startCur = App.utils.addMonths(today, -3);
      endPrev = App.utils.addMonths(startCur, -1);
      startPrev = App.utils.addMonths(endPrev, -3);
    } else if (p === 'last6') {
      const startCur = App.utils.addMonths(today, -6);
      endPrev = App.utils.addMonths(startCur, -1);
      startPrev = App.utils.addMonths(endPrev, -6);
    } else if (p === 'last12') {
      const startCur = App.utils.addMonths(today, -12);
      endPrev = App.utils.addMonths(startCur, -1);
      startPrev = App.utils.addMonths(endPrev, -12);
    } else {
      return [];
    }
    return txs.filter(t => {
      const d = (t.date || '').slice(0, 10);
      return d >= startPrev && d <= endPrev;
    });
  },

  // ----------------------------------------------------------------
  // Agregação por local
  // ----------------------------------------------------------------
  _aggregate(txs, locaisCompilados) {
    const mapMatched = new Map();
    const unmatched = [];

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const local = this.match(tx, locaisCompilados);
      if (!local) {
        unmatched.push(tx);
        continue;
      }
      if (!mapMatched.has(local.id)) {
        mapMatched.set(local.id, {
          local,
          total: 0,
          count: 0,
          txs: [],
          firstDate: tx.date,
          lastDate: tx.date,
          categorias: new Set(),
          membros: new Set(),
          meses: new Set()
        });
      }
      const g = mapMatched.get(local.id);
      const v = parseFloat(tx.amount) || 0;
      g.total += v;
      g.count += 1;
      g.txs.push(tx);
      if ((tx.date || '') < (g.firstDate || '9999')) g.firstDate = tx.date;
      if ((tx.date || '') > (g.lastDate || ''))      g.lastDate  = tx.date;
      if (tx.category) g.categorias.add(tx.category);
      if (tx.member_name) g.membros.add(tx.member_name);
      if (tx.date) g.meses.add((tx.date || '').slice(0, 7));
    }

    const matched = [...mapMatched.values()]
      .map(g => Object.assign({}, g, {
        media: g.count > 0 ? g.total / g.count : 0,
        categorias: [...g.categorias],
        membros: [...g.membros],
        meses: [...g.meses].sort()
      }))
      .sort((a, b) => b.total - a.total);

    return { matched, unmatched };
  },

  // ----------------------------------------------------------------
  // Filtros visuais (busca/categoria/tipo)
  // ----------------------------------------------------------------
  _applyVisualFilters(aggregation) {
    let matched = aggregation.matched;
    const busca = (this._filterBusca || '').toLowerCase().trim();

    if (busca) {
      matched = matched.filter(g =>
        (g.local.nome || '').toLowerCase().includes(busca) ||
        (g.local.categoria || '').toLowerCase().includes(busca)
      );
    }

    if (this._filterCategoria && this._filterCategoria !== 'all') {
      matched = matched.filter(g => g.local.categoria === this._filterCategoria);
    }

    if (this._filterTipo && this._filterTipo !== 'all') {
      matched = matched.filter(g => g.tipoLocal === this._filterTipo);
    }

    const categoriasUnicas = [...new Set(aggregation.matched.map(g => g.local.categoria).filter(Boolean))].sort();

    return { matched, unmatched: aggregation.unmatched, categoriasUnicas };
  },

  // ----------------------------------------------------------------
  // Classificação do tipo do local
  // ----------------------------------------------------------------
  _classifyLocalType(local) {
    const cat = (local.categoria || '').toLowerCase();
    const consumo = ['mercado','delivery','restaurante','sorveteria','padaria','bar','saudável','saudavel','bebidas','moda','cosméticos','cosmeticos','marketplace','pet','presentes','combustível','combustivel','cinema','tecnologia','eletro','barbearia','farmácia','farmacia','saúde','saude'];
    const servico = ['energia','internet','assinatura','telefonia','utilidades','órgão público','orgao publico','manutenção','manutencao','lava-jato','moradia'];
    const financeiro = ['transferência','transferencia','terceiros','doação','doacao'];
    if (consumo.includes(cat)) return 'consumo';
    if (servico.includes(cat)) return 'servico';
    if (financeiro.includes(cat)) return 'financeiro';
    return 'consumo';
  },

  // ----------------------------------------------------------------
  // Período dos dados (data inicial e final)
  // ----------------------------------------------------------------
  _computeDataRange(txs) {
    if (!txs.length) return { start: '—', end: '—' };
    const dates = txs.map(t => (t.date || '').slice(0, 10)).filter(Boolean).sort();
    const fmt = (d) => d ? d.split('-').reverse().join('/') : '—';
    return { start: fmt(dates[0]), end: fmt(dates[dates.length - 1]) };
  },

  // ----------------------------------------------------------------
  // Barras mensais (últimos 5 meses do período)
  // ----------------------------------------------------------------
  _buildMonthlyBars(txs, locaisCompilados) {
    const byMonth = new Map();
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const local = this.match(tx, locaisCompilados);
      if (!local) continue;
      const m = (tx.date || '').slice(0, 7);
      if (!m) continue;
      byMonth.set(m, (byMonth.get(m) || 0) + (parseFloat(tx.amount) || 0));
    }
    const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const last5 = sorted.slice(-5);
    const max = Math.max(...last5.map(([, v]) => v), 1);
    const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return last5.map(([ym, val]) => {
      const m = parseInt(ym.slice(5, 7), 10) - 1;
      return {
        label: MONTHS_PT[m] || ym,
        value: val,
        heightPct: (val / max) * 100
      };
    });
  },

  // ----------------------------------------------------------------
  // Composição por tipo de local
  // ----------------------------------------------------------------
  _buildLocaisPorTipo(matched) {
    const groups = { consumo: 0, servico: 0, financeiro: 0 };
    matched.forEach(g => {
      if (g.local.excluir_do_ranking) return;
      const t = g.tipoLocal || 'consumo';
      groups[t] = (groups[t] || 0) + g.total;
    });
    const total = groups.consumo + groups.servico + groups.financeiro;
    const entries = [
      { key: 'consumo',    label: 'Locais de consumo', color: '#467cff', value: groups.consumo },
      { key: 'servico',    label: 'Contas / Serviços', color: '#3bc7a1', value: groups.servico },
      { key: 'financeiro', label: 'Financeiro',        color: '#a267ff', value: groups.financeiro }
    ].filter(e => e.value > 0);
    return {
      total,
      entries: entries.map(e => Object.assign({}, e, {
        pct: total > 0 ? (e.value / total) * 100 : 0
      }))
    };
  },

  // ----------------------------------------------------------------
  // Destaques
  // ----------------------------------------------------------------
  _buildHighlights(matched) {
    const ranked = matched.filter(g => !g.local.excluir_do_ranking);
    if (ranked.length === 0) return null;

    let maiorCrescimento = null;
    let maiorQueda = null;
    let maisFrequente = ranked[0];

    for (let i = 0; i < ranked.length; i++) {
      const g = ranked[i];
      if (g.variationPct > 0 && (!maiorCrescimento || g.variationPct > maiorCrescimento.variationPct)) {
        maiorCrescimento = g;
      }
      if (g.variationPct < 0 && (!maiorQueda || g.variationPct < maiorQueda.variationPct)) {
        maiorQueda = g;
      }
      if (g.count > maisFrequente.count) {
        maisFrequente = g;
      }
    }

    const mesesAtivos = (g) => {
      const uniq = new Set(g.txs.map(t => (t.date || '').slice(0, 7)).filter(Boolean));
      return Math.max(1, uniq.size);
    };

    return {
      crescimento: maiorCrescimento ? {
        nome: maiorCrescimento.local.nome,
        pct: maiorCrescimento.variationPct
      } : null,
      queda: maiorQueda ? {
        nome: maiorQueda.local.nome,
        pct: maiorQueda.variationPct
      } : null,
      frequente: maisFrequente ? {
        nome: maisFrequente.local.nome,
        count: maisFrequente.count,
        porMes: (maisFrequente.count / mesesAtivos(maisFrequente)).toFixed(1)
      } : null
    };
  },

  // ----------------------------------------------------------------
  // Renderização principal
  // ----------------------------------------------------------------
  _render() {
    const container = document.getElementById('locaisContent');
    if (!container || !this._cache) return;

    const c = this._cache;
    const displayed = c.displayed;
    const locaisCompilados = c.locaisCompilados;
    const totalTxCount = c.totalTxCount;
    const matchedTxCount = c.matchedTxCount;
    const dataRange = c.dataRange;
    const monthlyBars = c.monthlyBars;
    const locaisPorTipo = c.locaisPorTipo;
    const highlights = c.highlights;

    const total = c.totalValue || 0;
    const totalTx = displayed.matched.reduce((s, g) => s + g.count, 0);
    const cobertura = totalTxCount > 0 ? (matchedTxCount / totalTxCount * 100) : 0;
    const totalDictionary = locaisCompilados.length;
    const unmatchedValue = displayed.unmatched.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const matchedPct = totalTxCount > 0 ? (matchedTxCount / totalTxCount * 100) : 0;

    // ----- Topbar -----
    const topbarHTML = `
      <header class="loc-topbar">
        <div>
          <div class="loc-title-wrap">
            <div class="loc-title-icon"><i data-lucide="map-pin"></i></div>
            <div>
              <h1 class="loc-h1">Locais</h1>
              <p class="loc-subtitle">Onde meu dinheiro fica</p>
            </div>
          </div>
          <p class="loc-description">Aqui você vê com quais empresas e estabelecimentos seu dinheiro está ficando, quanto gasta em cada um e como evolui ao longo do tempo.</p>
        </div>
        <div class="loc-top-actions">
          <div class="loc-select">
            <div class="left"><i data-lucide="calendar"></i><div>Período<small>${dataRange.start} - ${dataRange.end}</small></div></div>
            <i data-lucide="chevrons-up-down"></i>
            <select onchange="App.locais._onPeriodo(this.value)">
              <option value="all" ${this._filterPeriodo === 'all' ? 'selected' : ''}>Todo o período</option>
              <option value="currentMonth" ${this._filterPeriodo === 'currentMonth' ? 'selected' : ''}>Mês atual</option>
              <option value="last3" ${this._filterPeriodo === 'last3' ? 'selected' : ''}>Últimos 3 meses</option>
              <option value="last6" ${this._filterPeriodo === 'last6' ? 'selected' : ''}>Últimos 6 meses</option>
              <option value="last12" ${this._filterPeriodo === 'last12' ? 'selected' : ''}>Últimos 12 meses</option>
            </select>
          </div>
          <div class="loc-select">
            <div class="left"><i data-lucide="layers-3"></i><div>Categoria<small>${this._filterCategoria === 'all' ? 'Todas' : this._filterCategoria}</small></div></div>
            <i data-lucide="chevron-down"></i>
            <select onchange="App.locais._onCategoria(this.value)">
              <option value="all" ${this._filterCategoria === 'all' ? 'selected' : ''}>Todas as categorias</option>
              ${(displayed.categoriasUnicas || []).map(cat => `<option value="${cat}" ${this._filterCategoria === cat ? 'selected' : ''}>${cat}</option>`).join('')}
            </select>
          </div>
          <div class="loc-select">
            <div class="left"><i data-lucide="filter"></i><div>Tipo<small>${this._filterTipo === 'all' ? 'Todos' : (this._filterTipo === 'consumo' ? 'Consumo' : (this._filterTipo === 'servico' ? 'Serviço' : 'Financeiro'))}</small></div></div>
            <i data-lucide="chevron-down"></i>
            <select onchange="App.locais._onTipo(this.value)">
              <option value="all" ${this._filterTipo === 'all' ? 'selected' : ''}>Todos os tipos</option>
              <option value="consumo" ${this._filterTipo === 'consumo' ? 'selected' : ''}>Locais de consumo</option>
              <option value="servico" ${this._filterTipo === 'servico' ? 'selected' : ''}>Contas / Serviços</option>
              <option value="financeiro" ${this._filterTipo === 'financeiro' ? 'selected' : ''}>Financeiro</option>
            </select>
          </div>
        </div>
      </header>
    `;

    // ----- KPIs -----
    const kpisHTML = `
      <section class="loc-kpis">
        <div class="loc-kpi">
          <div class="loc-kpi-top"><div class="loc-kpi-icon green"><i data-lucide="wallet"></i></div><div>Gastos identificados</div></div>
          <div class="loc-kpi-value">${App.utils.formatCurrency(total)}</div>
          <div class="loc-kpi-sub">${totalTx} despesas • ${displayed.matched.length} locais</div>
          <div class="loc-kpi-foot"><div class="loc-progress"><i style="width:${Math.min(matchedPct, 100).toFixed(1)}%"></i></div><strong style="color:var(--income);">${matchedPct.toFixed(1)}% do total</strong></div>
        </div>
        <div class="loc-kpi">
          <div class="loc-kpi-top"><div class="loc-kpi-icon blue"><i data-lucide="map-pin"></i></div><div>Locais identificados</div></div>
          <div class="loc-kpi-value">${displayed.matched.length}</div>
          <div class="loc-kpi-sub">de ${totalDictionary} locais cadastrados</div>
          <div class="loc-kpi-foot"><strong style="color:var(--income);">↑ ${locaisCompilados.filter(l => l.padroes && l.padroes.length > 0).length} ativos</strong><span></span></div>
        </div>
        <div class="loc-kpi">
          <div class="loc-kpi-top"><div class="loc-kpi-icon purple"><i data-lucide="target"></i></div><div>Cobertura</div></div>
          <div class="loc-kpi-value">${cobertura.toFixed(1)}%</div>
          <div class="loc-kpi-sub">${matchedTxCount} de ${totalTxCount} despesas</div>
          <div class="loc-kpi-foot"><span>${displayed.unmatched.length} sem local</span><button class="loc-kpi-action" onclick="App.locais.openUnmatchedModal()">→ Corrigir</button></div>
        </div>
        <div class="loc-kpi">
          <div class="loc-kpi-top"><div class="loc-kpi-icon orange"><i data-lucide="triangle-alert"></i></div><div>Sem local</div></div>
          <div class="loc-kpi-value">${displayed.unmatched.length}</div>
          <div class="loc-kpi-sub">${App.utils.formatCurrency(unmatchedValue)} sem identificação</div>
          <div class="loc-kpi-foot">
            <button class="loc-kpi-action" onclick="App.aiAssistant && App.aiAssistant.open('tasks'); App.aiAssistant && App.aiAssistant.categorizePendingLocations({ background: false })">Categorizar com IA</button>
            <button class="loc-kpi-action orange" onclick="App.locais.openUnmatchedModal()">Ver lista</button>
          </div>
        </div>
      </section>
    `;

    // ----- Ranking (top 6) -----
    const ranking = displayed.matched.filter(g => !g.local.excluir_do_ranking).slice(0, 6);
    const rankingHTML = `
      <section class="loc-section">
        <div class="loc-section-head">
          <div class="loc-section-title">🏆 <span>Onde mais gastei</span></div>
          <div class="loc-sort">Ordenar por:
            <select onchange="App.locais._onSort(this.value)">
              <option value="maior-gasto" ${this._sortMode === 'maior-gasto' || !this._sortMode ? 'selected' : ''}>Maior gasto</option>
              <option value="mais-compras" ${this._sortMode === 'mais-compras' ? 'selected' : ''}>Mais compras</option>
              <option value="maior-media" ${this._sortMode === 'maior-media' ? 'selected' : ''}>Maior média</option>
              <option value="maior-crescimento" ${this._sortMode === 'maior-crescimento' ? 'selected' : ''}>Maior crescimento</option>
            </select>
          </div>
        </div>
        ${ranking.length === 0
          ? '<div class="loc-empty">Nenhum local identificado nos filtros atuais.</div>'
          : `<div class="loc-ranking">${ranking.map((g, i) => this._renderRankingCard(g, i, total)).join('')}</div>`}
      </section>
    `;

    // ----- Painéis do meio -----
    const donutHTML = this._renderDonut(locaisPorTipo, total);

    const barsHTML = monthlyBars.length === 0
      ? '<div class="loc-empty">Sem dados mensais.</div>'
      : `<div class="loc-chart">
          ${monthlyBars.map(b => `
            <div class="loc-bar-wrap">
              <span class="loc-bar-value">${App.utils.formatCurrency(b.value)}</span>
              <div class="loc-bar" style="height:${b.heightPct.toFixed(0)}%"></div>
              <span class="loc-month">${b.label}</span>
            </div>
          `).join('')}
        </div>`;

    const highlightsHTML = !highlights
      ? '<div class="loc-empty">Sem destaques.</div>'
      : `<div class="loc-highlights">
          ${highlights.crescimento ? `<div class="loc-highlight">
            <div class="loc-h-icon"><i data-lucide="arrow-up-right"></i></div>
            <div class="loc-highlight-main">Maior crescimento<b>${highlights.crescimento.nome}</b></div>
            <strong>+${highlights.crescimento.pct.toFixed(1)}%</strong>
          </div>` : ''}
          ${highlights.queda ? `<div class="loc-highlight">
            <div class="loc-h-icon red"><i data-lucide="arrow-down-right"></i></div>
            <div class="loc-highlight-main">Maior queda<b>${highlights.queda.nome}</b></div>
            <strong class="red">${highlights.queda.pct.toFixed(1)}%</strong>
          </div>` : ''}
          ${highlights.frequente ? `<div class="loc-highlight">
            <div class="loc-h-icon gold"><i data-lucide="star"></i></div>
            <div class="loc-highlight-main">Local mais frequente<b>${highlights.frequente.nome}</b></div>
            <strong style="color:#e7b63c">${highlights.frequente.count} compras (${highlights.frequente.porMes}/mês)</strong>
          </div>` : ''}
        </div>`;

    const middleHTML = `
      <div class="loc-middle">
        <section class="loc-panel">
          <div class="loc-panel-head"><i data-lucide="pie-chart"></i> Locais por tipo</div>
          ${donutHTML}
        </section>
        <section class="loc-panel">
          <div class="loc-panel-head"><i data-lucide="bar-chart-3"></i> Comparativo mensal <small>(gastos identificados)</small></div>
          ${barsHTML}
        </section>
        <section class="loc-panel">
          <div class="loc-panel-head"><i data-lucide="award"></i> Destaques</div>
          ${highlightsHTML}
        </section>
      </div>
    `;

    // ----- Tabela -----
    const pageSize = c.pageSize || 10;
    const currentPage = c.currentPage || 1;
    const totalPages = Math.max(1, Math.ceil(displayed.matched.length / pageSize));
    const startIdx = (currentPage - 1) * pageSize;
    const pageItems = displayed.matched.slice(startIdx, startIdx + pageSize);

    const tableRowsHTML = pageItems.length === 0
      ? '<tr><td colspan="10" style="text-align:center; padding:30px; color:var(--text-muted);">Nenhum local identificado.</td></tr>'
      : pageItems.map((g, i) => {
          const rank = startIdx + i + 1;
          const pct = total > 0 ? (g.total / total) * 100 : 0;
          const period = `${App.utils.formatDate(g.firstDate).slice(0, 5)} → ${App.utils.formatDate(g.lastDate).slice(0, 5)}`;
          const tipo = g.tipoLocal === 'servico' ? 'Serviço' : (g.tipoLocal === 'financeiro' ? 'Financeiro' : 'Consumo');
          const tipoClass = g.tipoLocal === 'consumo' ? '' : ' gray';
          return `<tr>
            <td>${rank}</td>
            <td>
              <div class="loc-local-cell" onclick="App.locais.drilldown('${g.local.id}')">
                <span class="loc-local-icon">${g.local.icone || '🏢'}</span>
                <strong>${g.local.nome}</strong>
              </div>
            </td>
            <td><span class="loc-badge${tipoClass}">${tipo}</span></td>
            <td>${g.local.categoria || '—'}</td>
            <td>${g.count}</td>
            <td><strong>${App.utils.formatCurrency(g.total)}</strong></td>
            <td><div class="loc-share-cell">${pct.toFixed(1)}%<span class="loc-mini-progress"><i style="width:${Math.min(pct * 10, 100).toFixed(0)}%"></i></span></div></td>
            <td>${App.utils.formatCurrency(g.media)}</td>
            <td>${period}</td>
            <td>
              <div class="loc-actions">
                <button title="Ver transações" onclick="App.locais.drilldown('${g.local.id}')"><i data-lucide="eye"></i></button>
                <button title="Editar local" onclick="App.locais.editLocal('${g.local.id}')"><i data-lucide="pencil"></i></button>
              </div>
            </td>
          </tr>`;
        }).join('');

    const paginationBtns = [];
    paginationBtns.push(`<button class="loc-page" ${currentPage === 1 ? 'disabled' : ''} onclick="App.locais._goPage(1)">«</button>`);
    paginationBtns.push(`<button class="loc-page" ${currentPage === 1 ? 'disabled' : ''} onclick="App.locais._goPage(${currentPage - 1})">‹</button>`);
    const startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    const endPage = Math.min(totalPages, startPage + 4);
    for (let p = startPage; p <= endPage; p++) {
      paginationBtns.push(`<button class="loc-page ${p === currentPage ? 'active' : ''}" onclick="App.locais._goPage(${p})">${p}</button>`);
    }
    if (endPage < totalPages) {
      paginationBtns.push(`<span style="color:var(--text-muted); padding:0 4px;">…</span>`);
      paginationBtns.push(`<button class="loc-page" onclick="App.locais._goPage(${totalPages})">${totalPages}</button>`);
    }
    paginationBtns.push(`<button class="loc-page" ${currentPage === totalPages ? 'disabled' : ''} onclick="App.locais._goPage(${currentPage + 1})">›</button>`);
    paginationBtns.push(`<button class="loc-page" ${currentPage === totalPages ? 'disabled' : ''} onclick="App.locais._goPage(${totalPages})">»</button>`);

    const tablePanelHTML = `
      <section class="loc-table-panel">
        <div class="loc-table-head">
          <div class="loc-section-title">🛍️ <span>Todos os locais</span></div>
          <div class="loc-table-head-right">
            <label class="loc-search"><i data-lucide="search"></i><input id="locaisBuscaInput" placeholder="Buscar local ou categoria…" value="${this._filterBusca}"></label>
            <button class="loc-btn" onclick="App.locais.openManageModal()"><i data-lucide="settings"></i> Dicionário</button>
            <button class="loc-btn" onclick="App.locais.exportCSV()"><i data-lucide="download"></i> CSV</button>
          </div>
        </div>
        <div class="loc-table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>LOCAL</th>
                <th>TIPO</th>
                <th>CATEGORIA</th>
                <th>COMPRAS</th>
                <th>TOTAL</th>
                <th>% DOS GASTOS</th>
                <th>MÉDIA/COMPRA</th>
                <th>PERÍODO</th>
                <th>AÇÕES</th>
              </tr>
            </thead>
            <tbody>${tableRowsHTML}</tbody>
          </table>
        </div>
        <div class="loc-table-foot">
          <span>Mostrando ${pageItems.length ? (startIdx + 1) : 0} de ${displayed.matched.length} locais</span>
          <div class="loc-pagination">${paginationBtns.join('')}</div>
        </div>
      </section>
    `;

    container.innerHTML = topbarHTML + kpisHTML + rankingHTML + middleHTML + tablePanelHTML;

    const buscaInput = document.getElementById('locaisBuscaInput');
    if (buscaInput) {
      buscaInput.addEventListener('input', (e) => this._onBusca(e.target.value));
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch (e) { /* silencioso */ }
    }
  },

  // ----------------------------------------------------------------
  // Card individual do ranking
  // ----------------------------------------------------------------
  _renderRankingCard(g, idx, total) {
    const pct = total > 0 ? (g.total / total * 100) : 0;
    const rank = idx + 1;
    const spark = this._renderSparkline(g.txs, g.variationDirection);
    const variationClass = g.variationDirection;
    const variationArrow = g.variationDirection === 'up' ? '↑' : (g.variationDirection === 'down' ? '↓' : '=');
    const variationText = g.variationDirection === 'flat'
      ? '= 0,0% vs. período anterior'
      : `${variationArrow} ${Math.abs(g.variationPct).toFixed(1)}% vs. período anterior`;
    return `<div class="loc-rank-card" onclick="App.locais.drilldown('${g.local.id}')" style="cursor:pointer;">
      <span class="loc-rank-num">${rank}</span>
      <div class="loc-merchant-icon">${g.local.icone || '🏢'}</div>
      <div class="loc-rank-name">${g.local.nome}</div>
      <div class="loc-rank-cat">${g.local.categoria || 'Outros'}</div>
      <div class="loc-rank-value">${App.utils.formatCurrency(g.total)}</div>
      <div class="loc-rank-meta">${g.count} compras • ${App.utils.formatCurrency(g.media)}/compra</div>
      <div class="loc-rank-change ${variationClass}">${variationText}</div>
      <div class="loc-share">${pct.toFixed(1)}% do total</div>
      ${spark}
    </div>`;
  },

  // ----------------------------------------------------------------
  // Sparkline SVG
  // ----------------------------------------------------------------
  _renderSparkline(txs, direction) {
    const byMonth = new Map();
    for (let i = 0; i < txs.length; i++) {
      const t = txs[i];
      const m = (t.date || '').slice(0, 7);
      if (!m) continue;
      byMonth.set(m, (byMonth.get(m) || 0) + (parseFloat(t.amount) || 0));
    }
    const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-10);
    if (sorted.length < 2) return '';
    const W = 82, H = 26, pad = 2;
    const values = sorted.map(([, v]) => v);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const step = (W - 2 * pad) / (values.length - 1);
    const points = values.map((v, i) => {
      const x = pad + i * step;
      const y = H - pad - ((v - min) / range) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const cls = direction === 'down' ? 'r' : (direction === 'flat' ? 'o' : 'g');
    return `<svg class="loc-spark" viewBox="0 0 ${W} ${H}"><polyline class="${cls}" points="${points}"/></svg>`;
  },

  // ----------------------------------------------------------------
  // Donut SVG (composição por tipo)
  // ----------------------------------------------------------------
  _renderDonut(locaisPorTipo, total) {
    if (!locaisPorTipo || !locaisPorTipo.entries || locaisPorTipo.entries.length === 0) {
      return '<div class="loc-empty">Sem dados para exibir.</div>';
    }
    const r = 42;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const segments = locaisPorTipo.entries.map(e => {
      const frac = e.value / locaisPorTipo.total;
      const len = frac * circ;
      const seg = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${e.color}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += len;
      return seg;
    }).join('');
    const legendRows = locaisPorTipo.entries.map(e => `
      <div class="loc-legend-row">
        <span class="loc-dot" style="background:${e.color};"></span>
        <span class="lbl">${e.label}</span>
        <span class="pct">${e.pct.toFixed(1)}%</span>
        <span class="val">${App.utils.formatCurrency(e.value)}</span>
      </div>
    `).join('');
    return `
      <div class="loc-type-content">
        <div class="loc-donut">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--bg-secondary)" stroke-width="16"/>
            ${segments}
          </svg>
          <div class="loc-donut-label">
            <div><b>${App.utils.formatCurrency(locaisPorTipo.total)}</b>gastos identificados</div>
          </div>
        </div>
        <div class="loc-legend">${legendRows}</div>
      </div>
    `;
  },

  // ----------------------------------------------------------------
  // Handlers de filtros
  // ----------------------------------------------------------------
  _onBusca(v) {
    this._filterBusca = v || '';
    clearTimeout(this._buscaTimeout);
    this._buscaTimeout = setTimeout(() => this.load(), 300);
  },
  _onPeriodo(v) {
    this._filterPeriodo = v || 'all';
    this._currentPage = 1;
    this.load();
  },
  _onCategoria(v) {
    this._filterCategoria = v || 'all';
    this._currentPage = 1;
    this.load();
  },
  _onTipo(v) {
    this._filterTipo = v || 'all';
    this._currentPage = 1;
    this.load();
  },
  _onSort(mode) {
    this._sortMode = mode || 'maior-gasto';
    if (!this._cache) return;
    const displayed = this._cache.displayed;
    const sorted = [...displayed.matched];
    if (mode === 'mais-compras') {
      sorted.sort((a, b) => b.count - a.count);
    } else if (mode === 'maior-media') {
      sorted.sort((a, b) => b.media - a.media);
    } else if (mode === 'maior-crescimento') {
      sorted.sort((a, b) => (b.variationPct || 0) - (a.variationPct || 0));
    } else {
      sorted.sort((a, b) => b.total - a.total);
    }
    this._cache.displayed = Object.assign({}, displayed, { matched: sorted });
    this._currentPage = 1;
    this._cache.currentPage = 1;
    this._render();
  },

  // ----------------------------------------------------------------
  // Paginação
  // ----------------------------------------------------------------
  _goPage(p) {
    if (!this._cache) return;
    const totalPages = Math.max(1, Math.ceil(this._cache.displayed.matched.length / (this._cache.pageSize || 10)));
    this._currentPage = Math.max(1, Math.min(p, totalPages));
    this._cache.currentPage = this._currentPage;
    this._render();
  },

  // ----------------------------------------------------------------
  // Drill-down
  // ----------------------------------------------------------------
  drilldown(localId) {
    if (!this._cache) return;
    const g = this._cache.displayed.matched.find(x => x.local.id === localId);
    if (!g) return;

    const tbody = document.getElementById('cardDetailTableBody');
    const titleEl = document.getElementById('cardDetailTitle');
    const filterDiv = document.getElementById('cardDetailFilters');
    const totalEl = document.getElementById('cardDetailTotal');
    if (!tbody || !titleEl) return;

    const esc = (v) => App.utils.escapeHtml(v);
    titleEl.textContent = `${g.local.icone || '🏢'} ${g.local.nome} — ${g.count} compras`;
    if (filterDiv) filterDiv.style.display = 'none';

    const sorted = [...g.txs].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    tbody.innerHTML = sorted.map(t => `
      <tr>
        <td>${App.utils.formatDateTime(t.date)}</td>
        <td>Despesa</td>
        <td></td>
        <td>${esc(t.category || '—')}</td>
        <td>${esc(t.description || '')}</td>
        <td>${esc(t.member_name || '')}</td>
        <td class="text-right" style="color:var(--expense);">- ${App.utils.formatCurrency(t.amount)}</td>
      </tr>
    `).join('');

    if (totalEl) totalEl.innerHTML = `Total: <strong>${App.utils.formatCurrency(g.total)}</strong>`;

    App.ui.openModal('modalCardDetail');
  },

  // ----------------------------------------------------------------
  // Modal: sem local atribuído
  // ----------------------------------------------------------------
  openUnmatchedModal() {
    if (!this._cache) return;
    const esc = (v) => App.utils.escapeHtml(v);
    const list = this._cache.displayed.unmatched;
    const tbody = document.getElementById('cardDetailTableBody');
    const titleEl = document.getElementById('cardDetailTitle');
    const filterDiv = document.getElementById('cardDetailFilters');
    const totalEl = document.getElementById('cardDetailTotal');
    if (!tbody || !titleEl) return;

    titleEl.innerHTML = `❓ Transações sem local atribuído (${list.length})
      ${list.length > 0 ? '<button class="btn btn-sm btn-primary" style="margin-left:10px;" onclick="App.ui.closeModal(\'modalCardDetail\'); App.aiAssistant && App.aiAssistant.open(\'tasks\'); App.aiAssistant && App.aiAssistant.categorizePendingLocations({ background: false })">Categorizar pendentes com IA</button>' : ''}`;
    if (filterDiv) filterDiv.style.display = 'none';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--income);">Todas as transações foram classificadas. 🎉</td></tr>';
    } else {
      const sorted = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      tbody.innerHTML = sorted.map(t => `
        <tr>
          <td>${App.utils.formatDate(t.date)}</td>
          <td>${esc((t.description || '').substring(0, 70))}</td>
          <td>${esc(t.category || '—')}</td>
          <td class="text-right" style="color:var(--expense);">${App.utils.formatCurrency(t.amount)}</td>
          <td class="text-center"><button class="btn btn-sm btn-primary" onclick="App.locais.createFromTx('${esc(t.id)}')">+ Criar local</button></td>
        </tr>
      `).join('');
    }

    if (totalEl) totalEl.innerHTML = `Total sem local: <strong>${App.utils.formatCurrency(list.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0))}</strong>`;

    App.ui.openModal('modalCardDetail');
  },

  // ----------------------------------------------------------------
  // Gerenciar dicionário
  // ----------------------------------------------------------------
  async openManageModal() {
    const esc = (v) => App.utils.escapeHtml(v);
    const locais = await App.db.getAll('locais');
    const tbody = document.getElementById('cardDetailTableBody');
    const titleEl = document.getElementById('cardDetailTitle');
    const filterDiv = document.getElementById('cardDetailFilters');
    const totalEl = document.getElementById('cardDetailTotal');
    if (!tbody || !titleEl) return;

    titleEl.innerHTML = `⚙️ Gerenciar dicionário de Locais
      <button class="btn btn-sm btn-primary" style="margin-left:12px;" onclick="App.locais.openNewLocalModal()">+ Novo local</button>`;
    if (filterDiv) filterDiv.style.display = 'none';
    if (totalEl) totalEl.textContent = '';

    tbody.innerHTML = locais.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).map(l => `
      <tr>
        <td style="font-size:1.3rem;">${esc(l.icone || '🏢')}</td>
        <td><strong>${esc(l.nome)}</strong></td>
        <td>${esc(l.categoria || '—')}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${(l.padroes || []).length} padrão(ões)</td>
        <td>${l.excluir_do_ranking ? '🚫 sim' : '✅ não'}</td>
        <td class="text-center">
          <button class="icon-btn" title="Editar" onclick="App.locais.editLocal('${esc(l.id)}')">✏️</button>
          <button class="icon-btn delete" title="Excluir" onclick="App.locais.removeLocal('${esc(l.id)}')">🗑️</button>
        </td>
      </tr>
    `).join('');

    App.ui.openModal('modalCardDetail');
  },

  openNewLocalModal() {
    App.ui.closeModal('modalCardDetail');
    this._openLocalForm(null);
  },

  async editLocal(id) {
    const l = await App.db.getById('locais', id);
    if (!l) return;
    App.ui.closeModal('modalCardDetail');
    this._openLocalForm(l);
  },

  _openLocalForm(local) {
    const isEdit = !!local;
    const padroesTexto = isEdit
      ? (local.padroes || []).map(p => {
          if (p instanceof RegExp) return p.source;
          if (typeof p === 'string') return p;
          return String(p);
        }).join('\n')
      : '';

    const html = `
      <h2>${isEdit ? '✏️ Editar' : '➕ Novo'} Local</h2>
      <div class="form-group"><label>Nome canônico</label><input type="text" id="localNome" value="${isEdit ? (local.nome || '') : ''}" placeholder="Ex.: Atacadão"></div>
      <div class="form-row">
        <div class="form-group"><label>Categoria</label><input type="text" id="localCategoria" value="${isEdit ? (local.categoria || '') : ''}" placeholder="Ex.: Mercado"></div>
        <div class="form-group"><label>Ícone (emoji)</label><input type="text" id="localIcone" value="${isEdit ? (local.icone || '🏢') : '🏢'}" maxlength="4"></div>
      </div>
      <div class="form-group">
        <label>Padrões (uma regex por linha, case-insensitive)</label>
        <textarea id="localPadroes" rows="6" style="width:100%; font-family:monospace; font-size:0.85rem;" placeholder="atacad[aã]o&#10;^assai\s+atacadista">${padroesTexto}</textarea>
        <small style="color:var(--text-muted);">Cada linha vira uma RegExp com flag <code>i</code>. Testadas em descrição, conta e membro.</small>
      </div>
      <div class="form-group">
        <label class="toggle-switch">
          <input type="checkbox" id="localExcluir" ${isEdit && local.excluir_do_ranking ? 'checked' : ''}>
          <span class="slider"></span> Excluir do ranking (aparece na lista, mas não no top 12)
        </label>
      </div>
      <div id="localTesteResultado" style="margin-top:8px; font-size:0.85rem;"></div>
      <div class="form-group">
        <label>Testar padrões com uma descrição:</label>
        <input type="text" id="localTeste" placeholder="Cole uma descrição de transação aqui…" oninput="App.locais._testPatternsLive()" style="width:100%; padding:8px;">
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="App.ui.closeModal('modalCardDetail'); App.locais.openManageModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="App.locais._saveLocalForm(${isEdit ? `'${local.id}'` : 'null'})">Salvar</button>
      </div>
    `;

    document.getElementById('cardDetailTitle').innerHTML = '';
    document.getElementById('cardDetailTableBody').innerHTML = `<tr><td colspan="7" style="padding:0; border:none;">${html}</td></tr>`;
    document.getElementById('cardDetailFilters').style.display = 'none';
    document.getElementById('cardDetailTotal').textContent = '';
    App.ui.openModal('modalCardDetail');
  },

  _testPatternsLive() {
    const desc = document.getElementById('localTeste') ? document.getElementById('localTeste').value : '';
    const linesRaw = document.getElementById('localPadroes') ? document.getElementById('localPadroes').value : '';
    const lines = linesRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const resultEl = document.getElementById('localTesteResultado');
    if (!resultEl) return;

    if (!desc) { resultEl.innerHTML = ''; return; }
    if (lines.length === 0) { resultEl.innerHTML = '<span style="color:var(--text-muted);">Nenhum padrão definido.</span>'; return; }

    const compilados = lines.map(src => {
      try { return new RegExp(src, 'i'); } catch (e) { return null; }
    });

    const resultados = compilados.map((re, i) => {
      if (!re) return { ok: false, src: lines[i], erro: true };
      return { ok: re.test(desc), src: lines[i], erro: false };
    });

    resultEl.innerHTML = resultados.map(r => `
      <div style="padding:3px 0; color:${r.erro ? 'var(--expense)' : (r.ok ? 'var(--income)' : 'var(--text-muted)')};">
        ${r.erro ? '❌' : (r.ok ? '✅' : '⚪')} <code>${r.src}</code>
      </div>
    `).join('');
  },

  async _saveLocalForm(existingId) {
    const nome = (document.getElementById('localNome') ? document.getElementById('localNome').value : '').trim();
    const categoria = (document.getElementById('localCategoria') ? document.getElementById('localCategoria').value : '').trim();
    const icone = (document.getElementById('localIcone') ? document.getElementById('localIcone').value : '🏢').trim() || '🏢';
    const padroesRaw = (document.getElementById('localPadroes') ? document.getElementById('localPadroes').value : '').split('\n').map(s => s.trim()).filter(Boolean);
    const excluir_do_ranking = !!(document.getElementById('localExcluir') && document.getElementById('localExcluir').checked);

    if (!nome) { App.utils.showToast('Informe um nome.', 'error'); return; }
    if (padroesRaw.length === 0) { App.utils.showToast('Informe pelo menos um padrão.', 'error'); return; }

    const invalidos = [];
    padroesRaw.forEach(src => {
      try { new RegExp(src, 'i'); } catch (e) { invalidos.push(src); }
    });
    if (invalidos.length > 0) {
      App.utils.showToast('Regex inválido: ' + invalidos[0], 'error');
      return;
    }

    const id = existingId || ('loc_' + nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const record = {
      id,
      nome,
      categoria,
      icone,
      padroes: padroesRaw,
      excluir_do_ranking,
      updatedAt: new Date().toISOString()
    };

    if (!existingId) {
      const existing = await App.db.getById('locais', id);
      if (existing) {
        App.utils.showToast('Já existe um local com esse nome.', 'error');
        return;
      }
      record.createdAt = new Date().toISOString();
    }

    await App.db.put('locais', record);
    App.utils.showToast(existingId ? 'Local atualizado.' : 'Local criado.');
    App.ui.closeModal('modalCardDetail');
    this.load();
  },

  async removeLocal(id) {
    const l = await App.db.getById('locais', id);
    if (!l) return;
    App.utils.confirm('Excluir o local "' + l.nome + '" do dicionário?\n\nAs transações não são afetadas, apenas deixarão de ser agrupadas.', async () => {
      await App.db.delete('locais', id);
      App.utils.showToast('Local removido.');
      App.ui.closeModal('modalCardDetail');
      this.load();
    });
  },

  async createFromTx(txId) {
    const tx = await App.db.getById('transactions', txId);
    if (!tx) return;

    const desc = String(tx.description || '').trim();
    const primeiraPalavra = desc.split(/\s+/)[0] || 'Novo Local';
    const nomeSugerido = primeiraPalavra.charAt(0).toUpperCase() + primeiraPalavra.slice(1).toLowerCase();
    const categoriaSugerida = tx.category || '';

    App.ui.closeModal('modalCardDetail');
    this._openLocalForm({
      id: null,
      nome: nomeSugerido,
      categoria: categoriaSugerida,
      icone: '🏢',
      padroes: [desc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')],
      excluir_do_ranking: false
    });
  },

  // ----------------------------------------------------------------
  // Exportação CSV
  // ----------------------------------------------------------------
  exportCSV() {
    if (!this._cache) return;
    const displayed = this._cache.displayed;
    const headers = ['Local', 'Categoria', 'Compras', 'Total', 'Média', 'Primeira', 'Última', '% do Total'];
    const totalGeral = displayed.matched.reduce((s, g) => s + g.total, 0);
    const rows = displayed.matched.map(g => [
      g.local.nome,
      g.local.categoria || '',
      g.count,
      g.total.toFixed(2),
      g.media.toFixed(2),
      g.firstDate || '',
      g.lastDate || '',
      totalGeral > 0 ? (g.total / totalGeral * 100).toFixed(2) + '%' : '0%'
    ]);
    App.utils.exportCSV('locais.csv', headers, rows);
    App.utils.showToast('CSV exportado.');
  }
};