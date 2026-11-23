var App = window.App || {};

// =======================================================================
// Gemini — Seção Teste com Calculadoras Financeiras
// =======================================================================
App.gemini = {
  _activeTab: 'compostos',
  _chart: null,

  _destroyChart() {
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  },

  _renderChart(canvasId, config) {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    this._destroyChart();

    const isLight = document.body.classList.contains('light-mode');
    const tickColor = isLight ? '#595959' : '#888';
    const gridColor = isLight ? 'rgba(0,0,0,0.08)' : '#1f1f1f';
    const legendColor = isLight ? '#181818' : '#b0b0b0';

    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    config.options.plugins = config.options.plugins || {};
    config.options.plugins.datalabels = { display: false };
    config.options.plugins.legend = config.options.plugins.legend || {};
    config.options.plugins.legend.labels = Object.assign(
      { color: legendColor },
      config.options.plugins.legend.labels || {}
    );

    if (config.options.scales) {
      if (config.options.scales.x) {
        config.options.scales.x.ticks = Object.assign({ color: tickColor }, config.options.scales.x.ticks || {});
        config.options.scales.x.grid = Object.assign({ color: gridColor }, config.options.scales.x.grid || {});
      }
      if (config.options.scales.y) {
        config.options.scales.y.ticks = Object.assign({ color: tickColor }, config.options.scales.y.ticks || {});
        config.options.scales.y.grid = Object.assign({ color: gridColor }, config.options.scales.y.grid || {});
      }
    }

    this._chart = new Chart(canvas, config);
  },

  _injectStyles() {
    if (document.getElementById('geminiStyles')) return;
    const style = document.createElement('style');
    style.id = 'geminiStyles';
    style.textContent = `
      #page-gemini .gem-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 20px;
      }
      #page-gemini .gem-tab {
        padding: 10px 18px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--card);
        color: var(--text-light);
        cursor: pointer;
        font-family: var(--font);
        font-size: 0.85rem;
        font-weight: 500;
        transition: all 0.2s ease;
      }
      #page-gemini .gem-tab:hover {
        background: var(--card-hover);
        color: var(--text);
        border-color: var(--border-light);
      }
      #page-gemini .gem-tab.active {
        background: var(--primary);
        color: var(--bg);
        border-color: var(--primary);
        font-weight: 600;
      }
      #page-gemini .gem-grid {
        display: grid;
        grid-template-columns: 380px 1fr;
        gap: 20px;
        align-items: start;
      }
      #page-gemini .gem-panel {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
      }
      #page-gemini .gem-panel h3 {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--text);
        margin-bottom: 16px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #page-gemini .gem-shortcuts {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      #page-gemini .gem-chip {
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--border-light);
        background: var(--bg-secondary);
        color: var(--text-light);
        font-size: 0.72rem;
        cursor: pointer;
        font-family: var(--font);
        transition: all 0.15s ease;
      }
      #page-gemini .gem-chip:hover {
        border-color: var(--primary);
        color: var(--text);
      }
      #page-gemini .gem-verdict {
        padding: 16px 20px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        background: var(--bg-secondary);
        margin-bottom: 20px;
        font-size: 0.92rem;
        line-height: 1.5;
      }
      #page-gemini .gem-verdict.good {
        border-left: 4px solid var(--income);
      }
      #page-gemini .gem-verdict.warn {
        border-left: 4px solid var(--contribution);
      }
      @media (max-width: 960px) {
        #page-gemini .gem-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  },

  _getIndicators() {
    const ind = (App.config && App.config.INDICATORS) ? App.config.INDICATORS : {};
    return {
      selic: Number.isFinite(parseFloat(ind.selic)) ? parseFloat(ind.selic) : 13.75,
      ipca: Number.isFinite(parseFloat(ind.ipca)) ? parseFloat(ind.ipca) : 4.87,
      cdi: Number.isFinite(parseFloat(ind.cdi)) ? parseFloat(ind.cdi) : 13.65,
      poupanca: Number.isFinite(parseFloat(ind.poupanca)) ? parseFloat(ind.poupanca) : 6.17
    };
  },

  _num(id, fallback = 0) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const parsed = App.utils && typeof App.utils.parseFloatLocale === 'function'
      ? App.utils.parseFloatLocale(String(el.value || ''))
      : parseFloat(String(el.value || '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  },

  _fmt(val) {
    const safe = Number.isFinite(val) ? val : 0;
    return App.utils && typeof App.utils.formatCurrency === 'function'
      ? App.utils.formatCurrency(safe)
      : 'R$ ' + safe.toFixed(2);
  },

  load() {
    this._injectStyles();
    const container = document.getElementById('geminiContent');
    if (!container) return;

    if (!document.getElementById('geminiRoot')) {
      container.innerHTML = `
        <div id="geminiRoot">
          <div class="page-header">
            <div>
              <h1>🧪 Gemini · Calculadoras</h1>
              <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">Seção de testes com calculadoras financeiras integradas aos indicadores do sistema</div>
            </div>
          </div>

          <div class="gem-tabs">
            <button type="button" class="gem-tab" data-gem-tab="compostos" onclick="App.gemini.switchTab('compostos')">📈 Juros Compostos</button>
            <button type="button" class="gem-tab" data-gem-tab="financiamento" onclick="App.gemini.switchTab('financiamento')">🏦 Financiamento (Price / SAC)</button>
            <button type="button" class="gem-tab" data-gem-tab="avista" onclick="App.gemini.switchTab('avista')">💳 À Vista vs Parcelado</button>
            <button type="button" class="gem-tab" data-gem-tab="reserva" onclick="App.gemini.switchTab('reserva')">🛡️ Reserva de Emergência</button>
          </div>

          <div id="geminiTabBody"></div>
        </div>
      `;
    }

    this.switchTab(this._activeTab);
  },

  switchTab(tab) {
    this._destroyChart();
    this._activeTab = tab || 'compostos';
    document.querySelectorAll('#page-gemini .gem-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.gemTab === this._activeTab);
    });

    if (this._activeTab === 'compostos') this.renderCompostos();
    else if (this._activeTab === 'financiamento') this.renderFinanciamento();
    else if (this._activeTab === 'avista') this.renderAvista();
    else if (this._activeTab === 'reserva') this.renderReserva();
  },

  // -------------------------------------------------------------------
  // 1. Juros Compostos
  // -------------------------------------------------------------------
  renderCompostos() {
    const body = document.getElementById('geminiTabBody');
    if (!body) return;
    const ind = this._getIndicators();

    body.innerHTML = `
      <div class="gem-grid">
        <div class="gem-panel">
          <h3>Parâmetros</h3>
          <div class="form-group">
            <label>Valor Inicial (R$)</label>
            <input type="number" id="geminiJcInicial" min="0" step="0.01" value="1000" oninput="App.gemini.calcCompostos()">
          </div>
          <div class="form-group">
            <label>Aporte Mensal (R$)</label>
            <input type="number" id="geminiJcAporte" min="0" step="0.01" value="500" oninput="App.gemini.calcCompostos()">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Taxa (%)</label>
              <input type="number" id="geminiJcTaxa" min="0" step="0.01" value="${ind.cdi.toFixed(2)}" oninput="App.gemini.calcCompostos()">
            </div>
            <div class="form-group">
              <label>Tipo de Taxa</label>
              <select id="geminiJcTipoTaxa" onchange="App.gemini.calcCompostos()">
                <option value="anual" selected>Ao ano (% a.a.)</option>
                <option value="mensal">Ao mês (% a.m.)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Atalhos dos Indicadores Atuais</label>
            <div class="gem-shortcuts">
              <button type="button" class="gem-chip" onclick="App.gemini.setCompostosRate(${ind.cdi})">CDI ${ind.cdi.toFixed(2)}%</button>
              <button type="button" class="gem-chip" onclick="App.gemini.setCompostosRate(${ind.selic})">SELIC ${ind.selic.toFixed(2)}%</button>
              <button type="button" class="gem-chip" onclick="App.gemini.setCompostosRate(${ind.poupanca})">Poupança ${ind.poupanca.toFixed(2)}%</button>
              <button type="button" class="gem-chip" onclick="App.gemini.setCompostosRate(${ind.ipca})">IPCA ${ind.ipca.toFixed(2)}%</button>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Período</label>
              <input type="number" id="geminiJcPeriodo" min="1" max="600" step="1" value="24" oninput="App.gemini.calcCompostos()">
            </div>
            <div class="form-group">
              <label>Unidade</label>
              <select id="geminiJcUnidade" onchange="App.gemini.calcCompostos()">
                <option value="meses" selected>Meses</option>
                <option value="anos">Anos</option>
              </select>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" style="width:100%; justify-content:center;" onclick="App.gemini.calcCompostos()">Calcular</button>
        </div>

        <div>
          <div class="cards-row" id="geminiJcCards"></div>
          <div class="chart-container" id="geminiJcChartWrap" style="margin-bottom:20px;">
            <h3>📈 Evolução Patrimonial</h3>
            <div style="height:240px; position:relative;"><canvas id="geminiJcChart"></canvas></div>
          </div>
          <div class="table-container" style="max-height:420px; overflow-y:auto;">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th class="text-right">Aporte</th>
                  <th class="text-right">Juros do Mês</th>
                  <th class="text-right">Total Investido</th>
                  <th class="text-right">Total Juros</th>
                  <th class="text-right">Saldo Acumulado</th>
                </tr>
              </thead>
              <tbody id="geminiJcTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    this.calcCompostos();
  },

  setCompostosRate(rate) {
    const taxaEl = document.getElementById('geminiJcTaxa');
    const tipoEl = document.getElementById('geminiJcTipoTaxa');
    if (taxaEl) taxaEl.value = Number(rate).toFixed(2);
    if (tipoEl) tipoEl.value = 'anual';
    this.calcCompostos();
  },

  calcCompostos() {
    const inicial = Math.max(0, this._num('geminiJcInicial', 0));
    const aporte = Math.max(0, this._num('geminiJcAporte', 0));
    const taxa = Math.max(0, this._num('geminiJcTaxa', 0));
    const tipoTaxa = document.getElementById('geminiJcTipoTaxa')?.value || 'anual';
    const periodoRaw = Math.max(1, Math.floor(this._num('geminiJcPeriodo', 1)));
    const unidade = document.getElementById('geminiJcUnidade')?.value || 'meses';

    const totalMeses = Math.min(600, unidade === 'anos' ? periodoRaw * 12 : periodoRaw);
    const i = tipoTaxa === 'anual'
      ? Math.pow(1 + taxa / 100, 1 / 12) - 1
      : taxa / 100;

    let saldo = inicial;
    let totalInvestido = inicial;
    let totalJuros = 0;
    const rows = [];

    for (let m = 1; m <= totalMeses; m++) {
      const jurosMes = saldo * i;
      saldo += jurosMes + aporte;
      totalInvestido += aporte;
      totalJuros += jurosMes;
      rows.push({
        mes: m,
        aporte,
        jurosMes,
        totalInvestido,
        totalJuros,
        saldo
      });
    }

    const rentPct = totalInvestido > 0 ? (totalJuros / totalInvestido) * 100 : 0;

    const cardsEl = document.getElementById('geminiJcCards');
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div class="card">
          <div class="card-label">Montante Final</div>
          <div class="card-value" style="color:var(--income);">${this._fmt(saldo)}</div>
          <div class="card-sub">${totalMeses} meses (${(i * 100).toFixed(2)}% a.m.)</div>
        </div>
        <div class="card">
          <div class="card-label">Total Investido</div>
          <div class="card-value">${this._fmt(totalInvestido)}</div>
          <div class="card-sub">Inicial + aportes</div>
        </div>
        <div class="card">
          <div class="card-label">Total em Juros</div>
          <div class="card-value" style="color:var(--contribution);">${this._fmt(totalJuros)}</div>
          <div class="card-sub">+${rentPct.toFixed(1)}% sobre o investido</div>
        </div>
      `;
    }

    this._renderChart('geminiJcChart', {
      type: 'line',
      data: {
        labels: rows.map(r => `M${r.mes}`),
        datasets: [
          {
            label: 'Saldo Acumulado',
            data: rows.map(r => r.saldo),
            borderColor: '#a3e635',
            backgroundColor: 'rgba(163, 230, 53, 0.14)',
            borderWidth: 2,
            pointRadius: rows.length > 36 ? 0 : 2,
            tension: 0.25,
            fill: true
          },
          {
            label: 'Total Investido',
            data: rows.map(r => r.totalInvestido),
            borderColor: '#60a5fa',
            backgroundColor: 'rgba(96, 165, 250, 0.10)',
            borderWidth: 2,
            pointRadius: rows.length > 36 ? 0 : 2,
            tension: 0.25,
            fill: true
          }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { autoSkip: true, maxRotation: 0 } },
          y: { ticks: { callback: v => this._fmt(v) } }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${this._fmt(ctx.raw)}`
            }
          }
        }
      }
    });

    const tbody = document.getElementById('geminiJcTableBody');
    if (tbody) {
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.mes}</td>
          <td class="text-right">${this._fmt(r.aporte)}</td>
          <td class="text-right" style="color:var(--income);">+${this._fmt(r.jurosMes)}</td>
          <td class="text-right">${this._fmt(r.totalInvestido)}</td>
          <td class="text-right" style="color:var(--contribution);">${this._fmt(r.totalJuros)}</td>
          <td class="text-right" style="font-weight:600;">${this._fmt(r.saldo)}</td>
        </tr>
      `).join('');
    }
  },

  // -------------------------------------------------------------------
  // 2. Financiamento / Empréstimo (Price / SAC)
  // -------------------------------------------------------------------
  renderFinanciamento() {
    const body = document.getElementById('geminiTabBody');
    if (!body) return;

    body.innerHTML = `
      <div class="gem-grid">
        <div class="gem-panel">
          <h3>Parâmetros</h3>
          <div class="form-group">
            <label>Valor do Bem / Empréstimo (R$)</label>
            <input type="number" id="geminiFinValor" min="0" step="0.01" value="50000" oninput="App.gemini.calcFinanciamento()">
          </div>
          <div class="form-group">
            <label>Entrada (R$)</label>
            <input type="number" id="geminiFinEntrada" min="0" step="0.01" value="10000" oninput="App.gemini.calcFinanciamento()">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Taxa de Juros (%)</label>
              <input type="number" id="geminiFinTaxa" min="0" step="0.01" value="1.50" oninput="App.gemini.calcFinanciamento()">
            </div>
            <div class="form-group">
              <label>Periodicidade</label>
              <select id="geminiFinTipoTaxa" onchange="App.gemini.calcFinanciamento()">
                <option value="mensal" selected>Ao mês (% a.m.)</option>
                <option value="anual">Ao ano (% a.a.)</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Prazo (meses)</label>
              <input type="number" id="geminiFinPrazo" min="1" max="600" step="1" value="36" oninput="App.gemini.calcFinanciamento()">
            </div>
            <div class="form-group">
              <label>Sistema</label>
              <select id="geminiFinSistema" onchange="App.gemini.calcFinanciamento()">
                <option value="price" selected>Price (Parcelas fixas)</option>
                <option value="sac">SAC (Amortização fixa)</option>
              </select>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" style="width:100%; justify-content:center;" onclick="App.gemini.calcFinanciamento()">Calcular</button>
        </div>

        <div>
          <div class="cards-row" id="geminiFinCards"></div>
          <div class="chart-container" id="geminiFinChartWrap" style="margin-bottom:20px;">
            <h3>📊 Composição das Parcelas (Amortização vs Juros)</h3>
            <div style="height:240px; position:relative;"><canvas id="geminiFinChart"></canvas></div>
          </div>
          <div class="table-container" style="max-height:420px; overflow-y:auto;">
            <table>
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th class="text-right">Valor Parcela</th>
                  <th class="text-right">Juros</th>
                  <th class="text-right">Amortização</th>
                  <th class="text-right">Saldo Devedor</th>
                </tr>
              </thead>
              <tbody id="geminiFinTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    this.calcFinanciamento();
  },

  calcFinanciamento() {
    const valorTotal = Math.max(0, this._num('geminiFinValor', 0));
    const entrada = Math.max(0, this._num('geminiFinEntrada', 0));
    const principal = Math.max(0, valorTotal - entrada);
    const taxa = Math.max(0, this._num('geminiFinTaxa', 0));
    const tipoTaxa = document.getElementById('geminiFinTipoTaxa')?.value || 'mensal';
    const prazo = Math.min(600, Math.max(1, Math.floor(this._num('geminiFinPrazo', 1))));
    const sistema = document.getElementById('geminiFinSistema')?.value || 'price';

    const i = tipoTaxa === 'anual'
      ? Math.pow(1 + taxa / 100, 1 / 12) - 1
      : taxa / 100;

    let saldo = principal;
    let totalJuros = 0;
    let totalPago = 0;
    const rows = [];

    if (principal > 0) {
      if (sistema === 'price') {
        const parcelaFixa = i === 0
          ? principal / prazo
          : principal * (i * Math.pow(1 + i, prazo)) / (Math.pow(1 + i, prazo) - 1);

        for (let m = 1; m <= prazo; m++) {
          const juros = saldo * i;
          let amortizacao = parcelaFixa - juros;
          let parcela = parcelaFixa;
          if (m === prazo) {
            amortizacao = saldo;
            parcela = amortizacao + juros;
            saldo = 0;
          } else {
            saldo = Math.max(0, saldo - amortizacao);
          }
          totalJuros += juros;
          totalPago += parcela;
          rows.push({ mes: m, parcela, juros, amortizacao, saldo });
        }
      } else {
        const amortizacaoFixa = principal / prazo;
        for (let m = 1; m <= prazo; m++) {
          const juros = saldo * i;
          const amortizacao = m === prazo ? saldo : amortizacaoFixa;
          const parcela = amortizacao + juros;
          saldo = m === prazo ? 0 : Math.max(0, saldo - amortizacao);
          totalJuros += juros;
          totalPago += parcela;
          rows.push({ mes: m, parcela, juros, amortizacao, saldo });
        }
      }
    }

    const primeira = rows.length ? rows[0].parcela : 0;
    const ultima = rows.length ? rows[rows.length - 1].parcela : 0;

    const cardsEl = document.getElementById('geminiFinCards');
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div class="card">
          <div class="card-label">Valor Financiado</div>
          <div class="card-value">${this._fmt(principal)}</div>
          <div class="card-sub">${prazo}x (${(i * 100).toFixed(2)}% a.m.)</div>
        </div>
        <div class="card">
          <div class="card-label">${sistema === 'price' ? 'Parcela Mensal' : '1ª / Última Parcela'}</div>
          <div class="card-value" style="color:var(--withdrawal);">${sistema === 'price' ? this._fmt(primeira) : `${this._fmt(primeira)}`}</div>
          <div class="card-sub">${sistema === 'price' ? 'Fixa durante todo o prazo' : `Última: ${this._fmt(ultima)}`}</div>
        </div>
        <div class="card">
          <div class="card-label">Total de Juros</div>
          <div class="card-value" style="color:var(--expense);">${this._fmt(totalJuros)}</div>
          <div class="card-sub">Total pago: ${this._fmt(totalPago)}</div>
        </div>
      `;
    }

    const chartWrap = document.getElementById('geminiFinChartWrap');
    if (rows.length > 0) {
      if (chartWrap) chartWrap.style.display = 'block';
      this._renderChart('geminiFinChart', {
        type: 'bar',
        data: {
          labels: rows.map(r => `${r.mes}`),
          datasets: [
            {
              label: 'Amortização',
              data: rows.map(r => r.amortizacao),
              backgroundColor: 'rgba(163, 230, 53, 0.8)',
              borderRadius: 3,
              stack: 'parcela'
            },
            {
              label: 'Juros',
              data: rows.map(r => r.juros),
              backgroundColor: 'rgba(248, 113, 113, 0.8)',
              borderRadius: 3,
              stack: 'parcela'
            }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { stacked: true, ticks: { autoSkip: true, maxRotation: 0 } },
            y: { stacked: true, ticks: { callback: v => this._fmt(v) } }
          },
          plugins: {
            tooltip: {
              callbacks: {
                title: items => items.length ? `Parcela ${items[0].label}/${prazo}` : '',
                label: ctx => `${ctx.dataset.label}: ${this._fmt(ctx.raw)}`
              }
            }
          }
        }
      });
    } else {
      this._destroyChart();
      if (chartWrap) chartWrap.style.display = 'none';
    }

    const tbody = document.getElementById('geminiFinTableBody');
    if (tbody) {
      tbody.innerHTML = rows.length
        ? rows.map(r => `
            <tr>
              <td>${r.mes}/${prazo}</td>
              <td class="text-right" style="font-weight:600;">${this._fmt(r.parcela)}</td>
              <td class="text-right" style="color:var(--expense);">${this._fmt(r.juros)}</td>
              <td class="text-right" style="color:var(--income);">${this._fmt(r.amortizacao)}</td>
              <td class="text-right">${this._fmt(r.saldo)}</td>
            </tr>
          `).join('')
        : '<tr><td colspan="5" class="text-center" style="padding:20px;">Informe um valor financiado maior que zero.</td></tr>';
    }
  },

  // -------------------------------------------------------------------
  // 3. À Vista vs Parcelado
  // -------------------------------------------------------------------
  renderArenderAvista() {
    const body = document.getElementById('geminiTabBody');
    if (!body) return;
    const ind = this._getIndicators();
    const cdiMensal = (Math.pow(1 + ind.cdi / 100, 1 / 12) - 1) * 100;

    body.innerHTML = `
      <div class="gem-grid">
        <div class="gem-panel">
          <h3>Parâmetros</h3>
          <div class="form-group">
            <label>Valor Total Parcelado (R$)</label>
            <input type="number" id="geminiAvPreco" min="0" step="0.01" value="3000" oninput="App.gemini.calcAvista()">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Desconto à Vista (%)</label>
              <input type="number" id="geminiAvDesconto" min="0" max="99.99" step="0.01" value="5" oninput="App.gemini.calcAvista()">
            </div>
            <div class="form-group">
              <label>Nº Parcelas</label>
              <input type="number" id="geminiAvParcelas" min="1" max="120" step="1" value="10" oninput="App.gemini.calcAvista()">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Rendimento (% ao mês)</label>
              <input type="number" id="geminiAvRendimento" min="0" step="0.01" value="${cdiMensal.toFixed(2)}" oninput="App.gemini.calcAvista()">
            </div>
            <div class="form-group">
              <label>1ª Parcela</label>
              <select id="geminiAvInicio" onchange="App.gemini.calcAvista()">
                <option value="30" selected>Em 30 dias</option>
                <option value="0">No ato (hoje)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <div class="gem-shortcuts">
              <button type="button" class="gem-chip" onclick="App.gemini.setAvistaRate(${cdiMensal.toFixed(2)})">CDI Mensal ${cdiMensal.toFixed(2)}%</button>
              <button type="button" class="gem-chip" onclick="App.gemini.setAvistaRate(0.50)">Poupança ~0.50%</button>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" style="width:100%; justify-content:center;" onclick="App.gemini.calcAvista()">Comparar</button>
        </div>

        <div>
          <div id="geminiAvVerdict" class="gem-verdict"></div>
          <div class="cards-row" id="geminiAvCards"></div>
          <div class="chart-container" id="geminiAvChartWrap" style="margin-bottom:20px;">
            <h3>💧 Evolução do Saldo Aplicado ao Parcelar</h3>
            <div style="height:220px; position:relative;"><canvas id="geminiAvChart"></canvas></div>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th class="text-right">Saldo Aplicado (antes)</th>
                  <th class="text-right">Rendimento</th>
                  <th class="text-right">Parcela Paga</th>
                  <th class="text-right">Saldo Restante</th>
                </tr>
              </thead>
              <tbody id="geminiAvTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    this.calcAvista();
  },

  setAvistaRate(rate) {
    const el = document.getElementById('geminiAvRendimento');
    if (el) el.value = Number(rate).toFixed(2);
    this.calcAvista();
  },

  calcAvista() {
    const precoParcelado = Math.max(0, this._num('geminiAvPreco', 0));
    const descontoPct = Math.min(99.99, Math.max(0, this._num('geminiAvDesconto', 0)));
    const parcelas = Math.min(120, Math.max(1, Math.floor(this._num('geminiAvParcelas', 1))));
    const rendMensal = Math.max(0, this._num('geminiAvRendimento', 0)) / 100;
    const primeiraEm30 = (document.getElementById('geminiAvInicio')?.value || '30') === '30';

    const valorAvista = precoParcelado * (1 - descontoPct / 100);
    const valorParcela = precoParcelado / parcelas;

    let pvParcelado = 0;
    for (let k = 1; k <= parcelas; k++) {
      const exp = primeiraEm30 ? k : (k - 1);
      pvParcelado += valorParcela / Math.pow(1 + rendMensal, exp);
    }

    let saldoSimulado = valorAvista;
    const rows = [];

    if (!primeiraEm30) {
      const antes = saldoSimulado;
      saldoSimulado -= valorParcela;
      rows.push({ mes: 0, antes, rend: 0, parcela: valorParcela, depois: saldoSimulado });
    }

    const mesesSim = primeiraEm30 ? parcelas : parcelas - 1;
    for (let m = 1; m <= mesesSim; m++) {
      const antes = saldoSimulado;
      const rend = antes * rendMensal;
      saldoSimulado = antes + rend - valorParcela;
      rows.push({ mes: m, antes, rend, parcela: valorParcela, depois: saldoSimulado });
    }

    const compensaParcelar = pvParcelado < valorAvista - 0.01;
    const compensaAvista = valorAvista < pvParcelado - 0.01;
    const diferencaVp = Math.abs(valorAvista - pvParcelado);

    const verdictEl = document.getElementById('geminiAvVerdict');
    if (verdictEl) {
      if (compensaParcelar) {
        verdictEl.className = 'gem-verdict warn';
        verdictEl.innerHTML = `💳 <strong>Vale mais a pena PARCELAR</strong>. Mantendo o valor à vista (${this._fmt(valorAvista)}) aplicado a ${(rendMensal * 100).toFixed(2)}% a.m., você termina os ${parcelas} meses com <strong>${this._fmt(saldoSimulado)}</strong> sobrando (economia presente de <strong>${this._fmt(diferencaVp)}</strong>).`;
      } else if (compensaAvista) {
        verdictEl.className = 'gem-verdict good';
        verdictEl.innerHTML = `💵 <strong>Vale mais a pena PAGAR À VISTA</strong>. O desconto de ${descontoPct.toFixed(2)}% gera uma economia real a valor presente de <strong>${this._fmt(diferencaVp)}</strong> em relação ao parcelamento.`;
      } else {
        verdictEl.className = 'gem-verdict';
        verdictEl.innerHTML = `⚖️ <strong>Empate técnico</strong>. O valor presente do parcelamento e o pagamento à vista são equivalentes.`;
      }
    }

    const cardsEl = document.getElementById('geminiAvCards');
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div class="card">
          <div class="card-label">Valor à Vista</div>
          <div class="card-value" style="color:var(--income);">${this._fmt(valorAvista)}</div>
          <div class="card-sub">Desconto de ${this._fmt(precoParcelado - valorAvista)}</div>
        </div>
        <div class="card">
          <div class="card-label">Valor Presente (Parcelado)</div>
          <div class="card-value" style="color:var(--contribution);">${this._fmt(pvParcelado)}</div>
          <div class="card-sub">${parcelas}x de ${this._fmt(valorParcela)}</div>
        </div>
        <div class="card">
          <div class="card-label">Saldo Final Simulado</div>
          <div class="card-value" style="color:${saldoSimulado >= 0 ? 'var(--income)' : 'var(--expense)'};">${this._fmt(saldoSimulado)}</div>
          <div class="card-sub">Ao quitar a última parcela</div>
        </div>
      `;
    }

    const chartWrap = document.getElementById('geminiAvChartWrap');
    if (rows.length > 0) {
      if (chartWrap) chartWrap.style.display = 'block';
      const lineColor = saldoSimulado >= 0 ? '#60a5fa' : '#f87171';
      const fillColor = saldoSimulado >= 0 ? 'rgba(96, 165, 250, 0.14)' : 'rgba(248, 113, 113, 0.14)';
      this._renderChart('geminiAvChart', {
        type: 'line',
        data: {
          labels: rows.map(r => r.mes === 0 ? 'Ato' : `M${r.mes}`),
          datasets: [
            {
              label: 'Saldo Restante',
              data: rows.map(r => r.depois),
              borderColor: lineColor,
              backgroundColor: fillColor,
              borderWidth: 2,
              pointRadius: rows.length > 24 ? 0 : 3,
              tension: 0.25,
              fill: true
            },
            {
              label: 'Ponto de Equilíbrio (R$ 0)',
              data: rows.map(() => 0),
              borderColor: '#888',
              borderWidth: 1,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { ticks: { autoSkip: true, maxRotation: 0 } },
            y: { ticks: { callback: v => this._fmt(v) } }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${this._fmt(ctx.raw)}`
              }
            }
          }
        }
      });
    } else {
      this._destroyChart();
      if (chartWrap) chartWrap.style.display = 'none';
    }

    const tbody = document.getElementById('geminiAvTableBody');
    if (tbody) {
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.mes === 0 ? 'Ato' : r.mes}</td>
          <td class="text-right">${this._fmt(r.antes)}</td>
          <td class="text-right" style="color:var(--income);">+${this._fmt(r.rend)}</td>
          <td class="text-right" style="color:var(--expense);">-${this._fmt(r.parcela)}</td>
          <td class="text-right" style="font-weight:600; color:${r.depois >= 0 ? 'var(--text)' : 'var(--expense)'};">${this._fmt(r.depois)}</td>
        </tr>
      `).join('');
    }
  },vista() {
    const body = document.getElementById('geminiTabBody');
    if (!body) return;
    const ind = this._getIndicators();
    const cdiMensal = (Math.pow(1 + ind.cdi / 100, 1 / 12) - 1) * 100;

    body.innerHTML = `
      <div class="gem-grid">
        <div class="gem-panel">
          <h3>Parâmetros</h3>
          <div class="form-group">
            <label>Valor Total Parcelado (R$)</label>
            <input type="number" id="geminiAvPreco" min="0" step="0.01" value="3000" oninput="App.gemini.calcAvista()">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Desconto à Vista (%)</label>
              <input type="number" id="geminiAvDesconto" min="0" max="99.99" step="0.01" value="5" oninput="App.gemini.calcAvista()">
            </div>
            <div class="form-group">
              <label>Nº Parcelas</label>
              <input type="number" id="geminiAvParcelas" min="1" max="120" step="1" value="10" oninput="App.gemini.calcAvista()">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Rendimento (% ao mês)</label>
              <input type="number" id="geminiAvRendimento" min="0" step="0.01" value="${cdiMensal.toFixed(2)}" oninput="App.gemini.calcAvista()">
            </div>
            <div class="form-group">
              <label>1ª Parcela</label>
              <select id="geminiAvInicio" onchange="App.gemini.calcAvista()">
                <option value="30" selected>Em 30 dias</option>
                <option value="0">No ato (hoje)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <div class="gem-shortcuts">
              <button type="button" class="gem-chip" onclick="App.gemini.setAvistaRate(${cdiMensal.toFixed(2)})">CDI Mensal ${cdiMensal.toFixed(2)}%</button>
              <button type="button" class="gem-chip" onclick="App.gemini.setAvistaRate(0.50)">Poupança ~0.50%</button>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" style="width:100%; justify-content:center;" onclick="App.gemini.calcAvista()">Comparar</button>
        </div>

        <div>
          <div id="geminiAvVerdict" class="gem-verdict"></div>
          <div class="cards-row" id="geminiAvCards"></div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th class="text-right">Saldo Aplicado (antes)</th>
                  <th class="text-right">Rendimento</th>
                  <th class="text-right">Parcela Paga</th>
                  <th class="text-right">Saldo Restante</th>
                </tr>
              </thead>
              <tbody id="geminiAvTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    this.calcAvista();
  },

  setAvistaRate(rate) {
    const el = document.getElementById('geminiAvRendimento');
    if (el) el.value = Number(rate).toFixed(2);
    this.calcAvista();
  },

  calcAvista() {
    const precoParcelado = Math.max(0, this._num('geminiAvPreco', 0));
    const descontoPct = Math.min(99.99, Math.max(0, this._num('geminiAvDesconto', 0)));
    const parcelas = Math.min(120, Math.max(1, Math.floor(this._num('geminiAvParcelas', 1))));
    const rendMensal = Math.max(0, this._num('geminiAvRendimento', 0)) / 100;
    const primeiraEm30 = (document.getElementById('geminiAvInicio')?.value || '30') === '30';

    const valorAvista = precoParcelado * (1 - descontoPct / 100);
    const valorParcela = precoParcelado / parcelas;

    let pvParcelado = 0;
    for (let k = 1; k <= parcelas; k++) {
      const exp = primeiraEm30 ? k : (k - 1);
      pvParcelado += valorParcela / Math.pow(1 + rendMensal, exp);
    }

    let saldoSimulado = valorAvista;
    const rows = [];

    if (!primeiraEm30) {
      const antes = saldoSimulado;
      saldoSimulado -= valorParcela;
      rows.push({ mes: 0, antes, rend: 0, parcela: valorParcela, depois: saldoSimulado });
    }

    const mesesSim = primeiraEm30 ? parcelas : parcelas - 1;
    for (let m = 1; m <= mesesSim; m++) {
      const antes = saldoSimulado;
      const rend = antes * rendMensal;
      saldoSimulado = antes + rend - valorParcela;
      rows.push({ mes: m, antes, rend, parcela: valorParcela, depois: saldoSimulado });
    }

    const compensaParcelar = pvParcelado < valorAvista - 0.01;
    const compensaAvista = valorAvista < pvParcelado - 0.01;
    const diferencaVp = Math.abs(valorAvista - pvParcelado);

    const verdictEl = document.getElementById('geminiAvVerdict');
    if (verdictEl) {
      if (compensaParcelar) {
        verdictEl.className = 'gem-verdict warn';
        verdictEl.innerHTML = `💳 <strong>Vale mais a pena PARCELAR</strong>. Mantendo o valor à vista (${this._fmt(valorAvista)}) aplicado a ${(rendMensal * 100).toFixed(2)}% a.m., você termina os ${parcelas} meses com <strong>${this._fmt(saldoSimulado)}</strong> sobrando (economia presente de <strong>${this._fmt(diferencaVp)}</strong>).`;
      } else if (compensaAvista) {
        verdictEl.className = 'gem-verdict good';
        verdictEl.innerHTML = `💵 <strong>Vale mais a pena PAGAR À VISTA</strong>. O desconto de ${descontoPct.toFixed(2)}% gera uma economia real a valor presente de <strong>${this._fmt(diferencaVp)}</strong> em relação ao parcelamento.`;
      } else {
        verdictEl.className = 'gem-verdict';
        verdictEl.innerHTML = `⚖️ <strong>Empate técnico</strong>. O valor presente do parcelamento e o pagamento à vista são equivalentes.`;
      }
    }

    const cardsEl = document.getElementById('geminiAvCards');
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div class="card">
          <div class="card-label">Valor à Vista</div>
          <div class="card-value" style="color:var(--income);">${this._fmt(valorAvista)}</div>
          <div class="card-sub">Desconto de ${this._fmt(precoParcelado - valorAvista)}</div>
        </div>
        <div class="card">
          <div class="card-label">Valor Presente (Parcelado)</div>
          <div class="card-value" style="color:var(--contribution);">${this._fmt(pvParcelado)}</div>
          <div class="card-sub">${parcelas}x de ${this._fmt(valorParcela)}</div>
        </div>
        <div class="card">
          <div class="card-label">Saldo Final Simulado</div>
          <div class="card-value" style="color:${saldoSimulado >= 0 ? 'var(--income)' : 'var(--expense)'};">${this._fmt(saldoSimulado)}</div>
          <div class="card-sub">Ao quitar a última parcela</div>
        </div>
      `;
    }

    const tbody = document.getElementById('geminiAvTableBody');
    if (tbody) {
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.mes === 0 ? 'Ato' : r.mes}</td>
          <td class="text-right">${this._fmt(r.antes)}</td>
          <td class="text-right" style="color:var(--income);">+${this._fmt(r.rend)}</td>
          <td class="text-right" style="color:var(--expense);">-${this._fmt(r.parcela)}</td>
          <td class="text-right" style="font-weight:600; color:${r.depois >= 0 ? 'var(--text)' : 'var(--expense)'};">${this._fmt(r.depois)}</td>
        </tr>
      `).join('');
    }
  },

  // -------------------------------------------------------------------
  // 4. Reserva de Emergência & Meta
  // -------------------------------------------------------------------
  renderReserva() {
    const body = document.getElementById('geminiTabBody');
    if (!body) return;
    const ind = this._getIndicators();
    const cdiMensal = (Math.pow(1 + ind.cdi / 100, 1 / 12) - 1) * 100;

    body.innerHTML = `
      <div class="gem-grid">
        <div class="gem-panel">
          <h3>Parâmetros</h3>
          <div class="form-group">
            <label>Custo de Vida Mensal (R$)</label>
            <input type="number" id="geminiResCusto" min="0" step="0.01" value="3500" oninput="App.gemini.calcReserva()">
            <div class="gem-shortcuts">
              <button type="button" class="gem-chip" onclick="App.gemini.puxarCustoDoApp()">📥 Puxar média dos últimos 3 meses</button>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Meses de Cobertura</label>
              <input type="number" id="geminiResMeses" min="1" max="120" step="1" value="6" oninput="App.gemini.calcReserva()">
            </div>
            <div class="form-group">
              <label>Reserva Atual (R$)</label>
              <input type="number" id="geminiResAtual" min="0" step="0.01" value="5000" oninput="App.gemini.calcReserva()">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Aporte Mensal (R$)</label>
              <input type="number" id="geminiResAporte" min="0" step="0.01" value="1000" oninput="App.gemini.calcReserva()">
            </div>
            <div class="form-group">
              <label>Rendimento (% a.m.)</label>
              <input type="number" id="geminiResRend" min="0" step="0.01" value="${cdiMensal.toFixed(2)}" oninput="App.gemini.calcReserva()">
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" style="width:100%; justify-content:center;" onclick="App.gemini.calcReserva()">Calcular</button>
        </div>

        <div>
          <div class="cards-row" id="geminiResCards"></div>
          <div class="gem-panel" style="margin-bottom:20px;">
            <h3>Progresso da Reserva</h3>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:6px;">
              <span id="geminiResProgressText">0%</span>
              <span id="geminiResTimeText"></span>
            </div>
            <div class="progress-bar-bg" style="height:12px;">
              <div class="progress-bar-fill" id="geminiResProgressBar" style="width:0%;"></div>
            </div>
          </div>
          <div class="chart-container" id="geminiResChartWrap">
            <h3>🛡️ Projeção até a Meta</h3>
            <div style="height:240px; position:relative;"><canvas id="geminiResChart"></canvas></div>
          </div>
        </div>
      </div>
    `;
    this.calcReserva();
  },

  async puxarCustoDoApp() {
    try {
      if (!App.db || typeof App.db.getAll !== 'function') return;
      const today = App.utils.todayISO();
      const start = App.utils.addMonths(today, -3);
      const txAll = await App.db.getTransactionsInRange(start, today, { status: 'confirmed' });
      const despesas = txAll.filter(t =>
        t.type === 'expense' &&
        !t.ignore_from_total &&
        (t.category || '').trim() !== 'Pagamento Fatura'
      );
      if (!despesas.length) {
        App.utils.showToast('Nenhuma despesa confirmada nos últimos 3 meses.', 'error');
        return;
      }
      const mesesSet = new Set(despesas.map(t => (t.date || '').slice(0, 7)).filter(Boolean));
      const total = despesas.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
      const media = total / Math.max(1, mesesSet.size);
      const input = document.getElementById('geminiResCusto');
      if (input) {
        input.value = media.toFixed(2);
        this.calcReserva();
        App.utils.showToast(`Média mensal carregada (${mesesSet.size} mês(es)).`);
      }
    } catch (e) {
      console.error('Erro ao puxar custo de vida:', e);
      App.utils.showToast('Não foi possível consultar as despesas.', 'error');
    }
  },

  calcReserva() {
    const custo = Math.max(0, this._num('geminiResCusto', 0));
    const mesesCob = Math.max(1, Math.floor(this._num('geminiResMeses', 6)));
    const atual = Math.max(0, this._num('geminiResAtual', 0));
    const aporte = Math.max(0, this._num('geminiResAporte', 0));
    const rend = Math.max(0, this._num('geminiResRend', 0)) / 100;

    const meta = custo * mesesCob;
    const falta = Math.max(0, meta - atual);
    const pct = meta > 0 ? Math.min(100, (atual / meta) * 100) : 100;

    let tempoTexto = '';
    const pontos = [{ mes: 0, saldo: atual }];
    if (falta <= 0) {
      tempoTexto = 'Meta já atingida!';
      pontos.push({ mes: 1, saldo: atual * (1 + rend) + aporte });
    } else if (aporte <= 0 && (atual * rend) <= 0) {
      tempoTexto = 'Informe um aporte ou rendimento';
    } else {
      let saldo = atual;
      let meses = 0;
      const limite = 1200;
      while (saldo < meta && meses < limite) {
        saldo = saldo * (1 + rend) + aporte;
        meses++;
        pontos.push({ mes: meses, saldo });
      }
      if (meses >= limite) {
        tempoTexto = 'Mais de 100 anos';
      } else {
        const anos = Math.floor(meses / 12);
        const rem = meses % 12;
        tempoTexto = anos > 0
          ? `${meses} meses (${anos}a${rem > 0 ? ' e ' + rem + 'm' : ''})`
          : `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
      }
    }

    const cardsEl = document.getElementById('geminiResCards');
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div class="card">
          <div class="card-label">Meta da Reserva</div>
          <div class="card-value" style="color:var(--primary);">${this._fmt(meta)}</div>
          <div class="card-sub">${mesesCob} meses de cobertura</div>
        </div>
        <div class="card">
          <div class="card-label">Falta Acumular</div>
          <div class="card-value" style="color:${falta > 0 ? 'var(--withdrawal)' : 'var(--income)'};">${this._fmt(falta)}</div>
          <div class="card-sub">Atual: ${this._fmt(atual)}</div>
        </div>
        <div class="card">
          <div class="card-label">Prazo Estimado</div>
          <div class="card-value" style="color:var(--contribution); font-size:1.25rem;">${tempoTexto}</div>
          <div class="card-sub">Com aporte de ${this._fmt(aporte)}/mês</div>
        </div>
      `;
    }

    const chartWrap = document.getElementById('geminiResChartWrap');
    if (pontos.length >= 2) {
      if (chartWrap) chartWrap.style.display = 'block';
      this._renderChart('geminiResChart', {
        type: 'line',
        data: {
          labels: pontos.map(p => `M${p.mes}`),
          datasets: [
            {
              label: 'Reserva Acumulada',
              data: pontos.map(p => p.saldo),
              borderColor: '#a3e635',
              backgroundColor: 'rgba(163, 230, 53, 0.14)',
              borderWidth: 2,
              pointRadius: pontos.length > 24 ? 0 : 3,
              tension: 0.25,
              fill: true
            },
            {
              label: 'Meta da Reserva',
              data: pontos.map(() => meta),
              borderColor: '#fbbf24',
              borderWidth: 2,
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { ticks: { autoSkip: true, maxRotation: 0 } },
            y: { ticks: { callback: v => this._fmt(v) } }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${this._fmt(ctx.raw)}`
              }
            }
          }
        }
      });
    } else {
      this._destroyChart();
      if (chartWrap) chartWrap.style.display = 'none';
    }

    const progText = document.getElementById('geminiResProgressText');
    const timeText = document.getElementById('geminiResTimeText');
    const progBar = document.getElementById('geminiResProgressBar');
    if (progText) progText.textContent = `${pct.toFixed(1)}% concluído`;
    if (timeText) timeText.textContent = tempoTexto;
    if (progBar) progBar.style.width = `${pct.toFixed(1)}%`;
  }
};