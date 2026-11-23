var App = window.App || {};

// =======================================================================
// Melhoria — Panorama Técnico de Bugs, Correções e Melhorias
// =======================================================================
App.melhoria = {
  _filter: 'all',
  _storageKey: 'contas_online_melhoria_done_v2',

  _items: [
    {
      id: 'bug-dup-ids',
      type: 'bug',
      priority: 'Alta',
      title: '11 IDs duplicados no index.html',
      files: 'index.html, js/investments.js, js/dashboard.js, js/transactions.js, js/app.js',
      detail: 'Corrigido: IDs renomeados (#catClassificationCards, #planDetailStart/End/DaysLeft/Category/Amount/Summary/TableBody, #modalBalanceDetailContent) e removidos #memberAvatarPalette e #toast duplicados.'
    },
    {
      id: 'bug-idb-worker-version',
      type: 'bug',
      priority: 'Alta',
      title: 'Conflito de versão IndexedDB nos Workers',
      files: 'js/db-schema.js, js/utils.js, js/worker.js, js/app.js',
      detail: 'Corrigido: workers alinhados para ContasOnlineDB v34 com todas as stores atuais e fallback automático caso o banco já esteja em versão superior (VersionError).'
    },
    {
      id: 'bug-dead-buttons',
      type: 'bug',
      priority: 'Média',
      title: 'Botões de interface sem eventos vinculados',
      files: 'index.html, js/investments.js',
      detail: 'Corrigido: busca rápida, notificações, ajuda, Exportar CSV, Ver insights, Ver recomendações em #page-financial-history e .cat-tip-btn ("Ver regras") vinculados a ações reais.'
    },
    {
      id: 'bug-dup-store',
      type: 'bug',
      priority: 'Baixa',
      title: 'Store duplicada na definição do banco',
      files: 'js/db-schema.js, js/db.js',
      detail: 'Corrigido: removida a duplicidade de "planosOrcamentarios" e centralizada a lista única de stores em App.dbSchema.'
    },
    {
      id: 'fix-dup-cdn',
      type: 'fix',
      priority: 'Média',
      title: 'CSS e scripts externos carregados em duplicidade',
      files: 'index.html',
      detail: 'Corrigido: removidos o <link> duplicado do FontAwesome 6.5.2 e o <script> duplicado do echarts.min.js.'
    },
    {
      id: 'fix-chart-datalabels',
      type: 'fix',
      priority: 'Média',
      title: 'Múltiplos registros de ChartDataLabels',
      files: 'js/utils.js, js/dashboard.js, js/app.js',
      detail: 'Corrigido: criado registro único App.utils.registerChartDataLabelsOnce() e getChartDataLabelsPlugin() com defaults centralizados.'
    },
    {
      id: 'fix-unused-gsi',
      type: 'fix',
      priority: 'Baixa',
      title: 'Script Google GSI ocioso e var App duplicado',
      files: 'index.html, js/db.js',
      detail: 'Corrigido: removido o script ocioso accounts.google.com/gsi/client do HTML e a declaração duplicada de "var App" no topo de js/db.js.'
    },
    {
      id: 'fix-sync-workers',
      type: 'fix',
      priority: 'Média',
      title: 'Unificar schema das 27 stores entre db.js e workers',
      files: 'js/db-schema.js, js/db.js, js/ui.js, js/worker.js, js/app.js',
      detail: 'Corrigido: js/db-schema.js agora é a fonte única de verdade para todas as 27 stores em db.js, worker.js, _importJSONWithWorker e backup/diagnóstico em ui.js.'
    },
    {
      id: 'imp-lazy-logos',
      type: 'improvement',
      priority: 'Alta',
      title: 'Catálogo gratuito e atualizado de logos bancários (substituindo 11,4 MB estáticos)',
      files: 'js/bank-logos.js, index.html, js/transactions.js, js/investments.js, js/dashboard.js, js/ui.js',
      detail: 'Implementado: substituído o arquivo estático de 11,4 MB pelo catálogo oficial gratuito Open Finance Brasil + BCB (logos-bancos-br via CDN jsDelivr + fallback BrasilAPI), com 640+ instituições, busca no modal e cache semanal automático.'
    },
    {
      id: 'imp-split-monoliths',
      type: 'improvement',
      priority: 'Alta',
      title: 'Modularizar arquivos monolíticos',
      files: 'js/db-schema.js, js/finance-math.js, js/melhoria.js, style.css',
      detail: 'Implementado: extraídos módulos desacoplados (db-schema.js, finance-math.js, melhoria.js) e corrigida a regra CSS desktop que quebrava a margem mobile de .main.'
    },
    {
      id: 'imp-xss-sanitize',
      type: 'improvement',
      priority: 'Alta',
      title: 'Padronizar sanitização contra XSS em innerHTML',
      files: 'js/finance-math.js, js/utils.js, js/transactions.js, js/investments.js, js/locais.js, js/vehicles.js, js/app.js',
      detail: 'Implementado: App.utils.escapeHtml() aplicado nas tabelas, modais, extratos, locais e veículos, além de proteção contra formula injection em exportCSV().'
    },
    {
      id: 'imp-netlify-deploy',
      type: 'improvement',
      priority: 'Média',
      title: 'Alinhar deploy GitHub/Netlify e domínios OAuth',
      files: 'netlify.toml, index.html',
      detail: 'Implementado: criado netlify.toml com cabeçalhos de segurança e fallback SPA, mantendo CDNs externos válidos no HTML para deploy estático.'
    },
    {
      id: 'imp-unit-tests',
      type: 'improvement',
      priority: 'Média',
      title: 'Adicionar testes automatizados para cálculos críticos',
      files: 'package.json, tests/app-integrity.test.mjs, js/finance-math.js',
      detail: 'Implementado: suíte node:test ("npm test") cobrindo cálculos financeiros, sanitização, schema de 27 stores, worker e ausência de IDs/scripts duplicados.'
    }
  ],

  _getDoneSet() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (raw !== null) return new Set(JSON.parse(raw));
      return new Set(this._items.map(i => i.id));
    } catch (e) {
      return new Set(this._items.map(i => i.id));
    }
  },

  _saveDoneSet(set) {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify([...set]));
    } catch (e) {}
  },

  _esc(str) {
    if (App.utils && typeof App.utils.escapeHtml === 'function') {
      return App.utils.escapeHtml(String(str || ''));
    }
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _injectStyles() {
    if (document.getElementById('melhoriaStyles')) return;
    const style = document.createElement('style');
    style.id = 'melhoriaStyles';
    style.textContent = `
      #page-melhoria .mel-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 18px;
        padding-right: 110px;
      }
      #page-melhoria .mel-kpis {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      #page-melhoria .mel-kpi {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px 16px;
        min-width: 0;
      }
      #page-melhoria .mel-kpi-label {
        font-size: 0.78rem;
        color: var(--text-muted);
        margin-bottom: 4px;
      }
      #page-melhoria .mel-kpi-value {
        font-size: 1.35rem;
        font-weight: 700;
        color: var(--text);
      }
      #page-melhoria .mel-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }
      #page-melhoria .mel-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      #page-melhoria .mel-tab {
        padding: 7px 14px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--card);
        color: var(--text-light);
        font-size: 0.84rem;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      #page-melhoria .mel-tab.active {
        background: var(--primary);
        color: var(--bg);
        border-color: var(--primary);
        font-weight: 600;
      }
      #page-melhoria .mel-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      #page-melhoria .mel-card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }
      #page-melhoria .mel-card.is-done {
        opacity: 0.6;
      }
      #page-melhoria .mel-card.is-done .mel-title {
        text-decoration: line-through;
      }
      #page-melhoria .mel-card-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
      }
      #page-melhoria .mel-badges {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      #page-melhoria .mel-badge {
        font-size: 0.72rem;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 6px;
        border: 1px solid var(--border-light);
      }
      #page-melhoria .mel-badge.bug { color: var(--expense); border-color: rgba(248, 113, 113, 0.35); background: rgba(248, 113, 113, 0.08); }
      #page-melhoria .mel-badge.fix { color: var(--withdrawal); border-color: rgba(251, 191, 36, 0.35); background: rgba(251, 191, 36, 0.08); }
      #page-melhoria .mel-badge.improvement { color: var(--contribution); border-color: rgba(96, 165, 250, 0.35); background: rgba(96, 165, 250, 0.08); }
      #page-melhoria .mel-badge.prio { color: var(--text-light); background: var(--bg-secondary); }
      #page-melhoria .mel-title {
        font-size: 0.96rem;
        font-weight: 700;
        color: var(--text);
        margin: 0;
        overflow-wrap: anywhere;
      }
      #page-melhoria .mel-files {
        font-size: 0.76rem;
        color: var(--text-muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #page-melhoria .mel-detail {
        font-size: 0.85rem;
        line-height: 1.45;
        color: var(--text-light);
        margin: 0;
        overflow-wrap: anywhere;
      }
      #page-melhoria .mel-check-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.76rem;
        color: var(--text-muted);
        cursor: pointer;
        white-space: nowrap;
      }
      @media (max-width: 900px) {
        #page-melhoria .mel-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        #page-melhoria .mel-list { grid-template-columns: 1fr; }
      }
      @media (max-width: 600px) {
        #page-melhoria .mel-header h1 { font-size: 1.25rem; }
      }
    `;
    document.head.appendChild(style);
  },

  setFilter(filter) {
    this._filter = filter;
    this.render();
  },

  toggleDone(id) {
    const done = this._getDoneSet();
    if (done.has(id)) done.delete(id);
    else done.add(id);
    this._saveDoneSet(done);
    this.render();
  },

  async copySummary() {
    const typeLabels = { bug: 'BUG', fix: 'CORREÇÃO', improvement: 'MELHORIA' };
    const lines = [
      'PANORAMA — CONTAS ONLINE',
      'Escopo: 14 módulos JS (~28 mil linhas), index.html (4.480 linhas), style.css (9.011 linhas), server.js',
      ''
    ];
    this._items.forEach((item, idx) => {
      lines.push(`${idx + 1}. [${typeLabels[item.type]} | ${item.priority}] ${item.title} (${item.files})`);
      lines.push(`   ${item.detail}`);
    });
    const text = lines.join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        if (App.utils && App.utils.showToast) App.utils.showToast('Resumo copiado para a área de transferência.');
        return;
      }
    } catch (e) {}
    if (App.utils && App.utils.showToast) App.utils.showToast('Não foi possível copiar automaticamente.', 'error');
  },

  load() {
    this._injectStyles();
    this.render();
  },

  render() {
    const root = document.getElementById('melhoriaContent');
    if (!root) return;

    const done = this._getDoneSet();
    const bugsCount = this._items.filter(i => i.type === 'bug').length;
    const fixesCount = this._items.filter(i => i.type === 'fix').length;
    const impCount = this._items.filter(i => i.type === 'improvement').length;
    const doneCount = this._items.filter(i => done.has(i.id)).length;

    const visible = this._filter === 'all'
      ? this._items
      : this._items.filter(i => i.type === this._filter);

    const typeLabel = { bug: 'Bug', fix: 'Correção', improvement: 'Melhoria' };

    root.innerHTML = `
      <div class="mel-header">
        <div>
          <h1 style="margin:0;">🛠️ Melhoria & Diagnóstico do Projeto</h1>
          <p style="margin:6px 0 0; font-size:0.86rem; color:var(--text-muted);">
            Panorama sucinto de bugs, correções e melhorias levantados nos 14 módulos JS, index.html, style.css e server.js.
          </p>
        </div>
      </div>

      <div class="mel-kpis">
        <div class="mel-kpi">
          <div class="mel-kpi-label">Bugs encontrados</div>
          <div class="mel-kpi-value" style="color:var(--expense);">${bugsCount}</div>
        </div>
        <div class="mel-kpi">
          <div class="mel-kpi-label">Correções recomendadas</div>
          <div class="mel-kpi-value" style="color:var(--withdrawal);">${fixesCount}</div>
        </div>
        <div class="mel-kpi">
          <div class="mel-kpi-label">Melhorias estruturais</div>
          <div class="mel-kpi-value" style="color:var(--contribution);">${impCount}</div>
        </div>
        <div class="mel-kpi">
          <div class="mel-kpi-label">Marcados como concluídos</div>
          <div class="mel-kpi-value" style="color:var(--income);">${doneCount}/${this._items.length}</div>
        </div>
      </div>

      <div class="mel-toolbar">
        <div class="mel-tabs" role="tablist" aria-label="Filtrar itens de melhoria">
          <button type="button" class="mel-tab ${this._filter === 'all' ? 'active' : ''}" onclick="App.melhoria.setFilter('all')">Todos (${this._items.length})</button>
          <button type="button" class="mel-tab ${this._filter === 'bug' ? 'active' : ''}" onclick="App.melhoria.setFilter('bug')">Bugs (${bugsCount})</button>
          <button type="button" class="mel-tab ${this._filter === 'fix' ? 'active' : ''}" onclick="App.melhoria.setFilter('fix')">Correções (${fixesCount})</button>
          <button type="button" class="mel-tab ${this._filter === 'improvement' ? 'active' : ''}" onclick="App.melhoria.setFilter('improvement')">Melhorias (${impCount})</button>
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="melCopyBtn" onclick="App.melhoria.copySummary()">
          📋 Copiar resumo
        </button>
      </div>

      <div class="mel-list">
        ${visible.map(item => {
          const isDone = done.has(item.id);
          return `
            <article class="mel-card ${isDone ? 'is-done' : ''}" data-item-id="${this._esc(item.id)}">
              <div class="mel-card-top">
                <div class="mel-badges">
                  <span class="mel-badge ${this._esc(item.type)}">${typeLabel[item.type]}</span>
                  <span class="mel-badge prio">Prioridade: ${this._esc(item.priority)}</span>
                </div>
                <label class="mel-check-label">
                  <input type="checkbox" ${isDone ? 'checked' : ''} onchange="App.melhoria.toggleDone('${this._esc(item.id)}')">
                  Feito
                </label>
              </div>
              <h3 class="mel-title">${this._esc(item.title)}</h3>
              <div class="mel-files">${this._esc(item.files)}</div>
              <p class="mel-detail">${this._esc(item.detail)}</p>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }
};
