// =====================================================================
// ARQUIVO: ai-assistant.js
// Botão flutuante global de IA, Chat integrado ao projeto,
// categorização automática de Locais de Compras e classificação
// automática de gastos (Categoria + Essencial/Necessário/Supérfluo).
// =====================================================================
var App = window.App || {};

App.aiAssistant = {
  _initialized: false,
  _isOpen: false,
  _activeTab: 'chat',
  _isCategorizing: false,
  _isClassifyingExpenses: false,
  _isSendingChat: false,
  _suppressTxHook: false,
  _apiConfigured: null,
  _apiAuthInvalid: false,
  _health: null,
  _pendingQueue: [],
  _pendingExpenseQueue: [],
  _queueTimer: null,
  _expenseQueueTimer: null,
  _lastScan: null,
  _lastExpenseScan: null,
  _chatHistory: [],
  _activityLog: [],

  STORAGE_KEYS: {
    AUTO_NEW: 'contas_ai_auto_categorize_new',
    AUTO_EXPENSES: 'contas_ai_auto_classify_expenses',
    AUTO_PENDING: 'contas_ai_auto_sweep_pending',
    PROVIDER: 'contas_ai_provider_v1',
    CHAT: 'contas_ai_chat_history_v1',
    LOG: 'contas_ai_activity_log_v1'
  },

  getSelectedProvider() {
    const v = localStorage.getItem(this.STORAGE_KEYS.PROVIDER);
    if (v === 'deepseek' || v === 'gemini' || v === 'auto') return v;
    return 'auto';
  },

  setSelectedProvider(provider) {
    const normalized = (provider === 'deepseek' || provider === 'gemini') ? provider : 'auto';
    localStorage.setItem(this.STORAGE_KEYS.PROVIDER, normalized);
    this._apiAuthInvalid = false;
    this._syncToggleInputs();
    this._updateHealthBanner();
  },

  isAutoCategorizeEnabled() {
    const v = localStorage.getItem(this.STORAGE_KEYS.AUTO_NEW);
    return v === null ? true : v === 'true';
  },

  setAutoCategorizeEnabled(enabled) {
    localStorage.setItem(this.STORAGE_KEYS.AUTO_NEW, enabled ? 'true' : 'false');
    this._syncToggleInputs();
    App.utils?.showToast?.(
      enabled
        ? 'Organização automática de locais ativada.'
        : 'Organização automática de locais pausada.'
    );
  },

  isAutoClassifyExpensesEnabled() {
    const v = localStorage.getItem(this.STORAGE_KEYS.AUTO_EXPENSES);
    return v === null ? true : v === 'true';
  },

  setAutoClassifyExpensesEnabled(enabled) {
    localStorage.setItem(this.STORAGE_KEYS.AUTO_EXPENSES, enabled ? 'true' : 'false');
    this._syncToggleInputs();
    App.utils?.showToast?.(
      enabled
        ? 'Categorização e classificação automática de novos gastos ativada.'
        : 'Categorização automática de gastos pausada.'
    );
  },

  isAutoSweepEnabled() {
    const v = localStorage.getItem(this.STORAGE_KEYS.AUTO_PENDING);
    return v === null ? true : v === 'true';
  },

  setAutoSweepEnabled(enabled) {
    localStorage.setItem(this.STORAGE_KEYS.AUTO_PENDING, enabled ? 'true' : 'false');
    this._syncToggleInputs();
  },

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    this._loadPersistedState();
    this._bindEvents();
    this._syncToggleInputs();
    this._renderChatMessages();
    this._renderActivityLog();

    await this.refreshPendingStats();

    // Verifica disponibilidade dos provedores (DeepSeek / Gemini) sem bloquear a UI
    try {
      const health = await this._checkHealth();
      this._health = health;
      this._apiConfigured = Boolean(health?.configured);
      this._updateHealthBanner();

      // Organiza automaticamente pendências (gastos + locais) ao abrir se alguma IA estiver configurada
      if (
        this._isSelectedProviderConfigured() &&
        this.isAutoSweepEnabled() &&
        !sessionStorage.getItem('contas_ai_initial_sweep_done')
      ) {
        const hasPendingLocais = this._lastScan && this._lastScan.uniqueMerchantsCount > 0;
        const hasPendingExpenses = this._lastExpenseScan && this._lastExpenseScan.totalPending > 0;
        if (hasPendingLocais || hasPendingExpenses) {
          sessionStorage.setItem('contas_ai_initial_sweep_done', '1');
          setTimeout(async () => {
            if (hasPendingExpenses) {
              await this.categorizePendingExpenses({ background: true, silentIfEmpty: true }).catch(() => {});
            }
            if (hasPendingLocais && !this._apiAuthInvalid) {
              await this.categorizePendingLocations({ background: true, silentIfEmpty: true }).catch(() => {});
            }
          }, 1200);
        }
      }
    } catch (_) {
      this._health = null;
      this._apiConfigured = false;
      this._updateHealthBanner();
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (_) {}
    }
  },

  _loadPersistedState() {
    try {
      const savedChat = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.CHAT) || '[]');
      if (Array.isArray(savedChat)) this._chatHistory = savedChat.slice(-30);
    } catch (_) {
      this._chatHistory = [];
    }
    try {
      const savedLog = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.LOG) || '[]');
      if (Array.isArray(savedLog)) this._activityLog = savedLog.slice(0, 40);
    } catch (_) {
      this._activityLog = [];
    }
  },

  _saveChatHistory() {
    try {
      localStorage.setItem(this.STORAGE_KEYS.CHAT, JSON.stringify(this._chatHistory.slice(-30)));
    } catch (_) {}
  },

  _saveActivityLog() {
    try {
      localStorage.setItem(this.STORAGE_KEYS.LOG, JSON.stringify(this._activityLog.slice(0, 40)));
    } catch (_) {}
  },

  _bindEvents() {
    const fab = document.getElementById('aiFloatingBtn');
    const closeBtn = document.getElementById('aiDrawerCloseBtn');
    const backdrop = document.getElementById('aiDrawerBackdrop');
    const form = document.getElementById('aiChatForm');
    const input = document.getElementById('aiChatInput');
    const clearBtn = document.getElementById('aiClearChatBtn');
    const runBtn = document.getElementById('aiRunCategorizeBtn');
    const runExpensesBtn = document.getElementById('aiRunClassifyExpensesBtn');
    const autoNewToggle = document.getElementById('aiAutoNewToggle');
    const autoExpensesToggle = document.getElementById('aiAutoClassifyExpensesToggle');
    const autoPendingToggle = document.getElementById('aiAutoPendingToggle');
    const providerSelect = document.getElementById('aiProviderSelect');

    if (fab) fab.addEventListener('click', () => this.toggle());
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (backdrop) backdrop.addEventListener('click', () => this.close());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearChat());
    if (runBtn) runBtn.addEventListener('click', () => this.categorizePendingLocations({ background: false }));
    if (runExpensesBtn) runExpensesBtn.addEventListener('click', () => this.categorizePendingExpenses({ background: false }));

    if (autoNewToggle) {
      autoNewToggle.addEventListener('change', (e) => this.setAutoCategorizeEnabled(Boolean(e.target.checked)));
    }
    if (autoExpensesToggle) {
      autoExpensesToggle.addEventListener('change', (e) => this.setAutoClassifyExpensesEnabled(Boolean(e.target.checked)));
    }
    if (autoPendingToggle) {
      autoPendingToggle.addEventListener('change', (e) => this.setAutoSweepEnabled(Boolean(e.target.checked)));
    }
    if (providerSelect) {
      providerSelect.addEventListener('change', (e) => this.setSelectedProvider(e.target.value));
    }

    document.querySelectorAll('[data-ai-tab]').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.getAttribute('data-ai-tab')));
    });

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendChatFromInput();
      });
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatFromInput();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen) {
        this.close();
      }
    });
  },

  _syncToggleInputs() {
    const autoNew = document.getElementById('aiAutoNewToggle');
    const autoExpenses = document.getElementById('aiAutoClassifyExpensesToggle');
    const autoPending = document.getElementById('aiAutoPendingToggle');
    const providerSelect = document.getElementById('aiProviderSelect');
    if (autoNew) autoNew.checked = this.isAutoCategorizeEnabled();
    if (autoExpenses) autoExpenses.checked = this.isAutoClassifyExpensesEnabled();
    if (autoPending) autoPending.checked = this.isAutoSweepEnabled();
    if (providerSelect) providerSelect.value = this.getSelectedProvider();
  },

  async _checkHealth() {
    const res = await fetch('/api/ai/health', { method: 'GET' });
    if (!res.ok) return { configured: false, providers: {} };
    return res.json();
  },

  _isSelectedProviderConfigured() {
    const selected = this.getSelectedProvider();
    const providers = this._health?.providers || {};
    if (selected === 'deepseek') return Boolean(providers.deepseek?.configured);
    if (selected === 'gemini') return Boolean(providers.gemini?.configured);
    return Boolean(this._health?.configured);
  },

  _updateHealthBanner() {
    const banner = document.getElementById('aiApiStatusBanner');
    const stateEl = document.getElementById('aiProviderState');
    const selected = this.getSelectedProvider();
    const activeConfigured = this._isSelectedProviderConfigured();

    if (stateEl) {
      if (this._apiAuthInvalid) {
        stateEl.textContent = 'Chave inválida';
        stateEl.className = 'ai-provider-state is-warn';
      } else if (activeConfigured) {
        const activeLabel = selected === 'deepseek'
          ? 'DeepSeek ativo'
          : (selected === 'gemini' ? 'Gemini ativo' : (this._health?.defaultProvider === 'deepseek' ? 'DeepSeek ativo' : 'Gemini ativo'));
        stateEl.textContent = activeLabel;
        stateEl.className = 'ai-provider-state is-ok';
      } else {
        stateEl.textContent = 'Sem chave';
        stateEl.className = 'ai-provider-state is-warn';
      }
    }

    if (!banner) return;
    if (!activeConfigured || this._apiAuthInvalid) {
      banner.style.display = 'flex';
      if (selected === 'deepseek') {
        const title = this._apiAuthInvalid ? 'Chave DeepSeek inválida:' : 'DeepSeek não configurada:';
        banner.innerHTML = `
          <span class="ai-status-banner-icon" aria-hidden="true">!</span>
          <span><strong>${title}</strong> adicione <code>CONTA_ONLINE_DEEPSEEKCO</code> em <em>Settings &gt; Secrets</em> (use sublinhados, sem espaços).</span>
        `;
      } else if (selected === 'gemini') {
        const title = this._apiAuthInvalid ? 'Chave Gemini inválida:' : 'Gemini não configurada:';
        banner.innerHTML = `
          <span class="ai-status-banner-icon" aria-hidden="true">!</span>
          <span><strong>${title}</strong> adicione <code>GEMINI_API_KEY2</code> em <em>Settings &gt; Secrets</em>.</span>
        `;
      } else {
        const title = this._apiAuthInvalid ? 'Chave de IA inválida:' : 'Nenhuma API configurada:';
        banner.innerHTML = `
          <span class="ai-status-banner-icon" aria-hidden="true">!</span>
          <span><strong>${title}</strong> configure <code>CONTA_ONLINE_DEEPSEEKCO</code> (DeepSeek) ou <code>GEMINI_API_KEY2</code> (Gemini) em <em>Settings &gt; Secrets</em>.</span>
        `;
      }
    } else {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  },

  open(tab = null) {
    if (tab) this.switchTab(tab);
    this._isOpen = true;
    const drawer = document.getElementById('aiAssistantDrawer');
    const backdrop = document.getElementById('aiDrawerBackdrop');
    const fab = document.getElementById('aiFloatingBtn');
    if (drawer) drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    this.refreshPendingStats();
    this._checkHealth().then(h => {
      this._health = h;
      this._apiConfigured = Boolean(h?.configured);
      this._updateHealthBanner();
    }).catch(() => {});

    if (this._activeTab === 'chat') {
      setTimeout(() => {
        const input = document.getElementById('aiChatInput');
        if (input) input.focus();
      }, 150);
    }
  },

  close() {
    this._isOpen = false;
    const drawer = document.getElementById('aiAssistantDrawer');
    const backdrop = document.getElementById('aiDrawerBackdrop');
    const fab = document.getElementById('aiFloatingBtn');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (fab) fab.setAttribute('aria-expanded', 'false');
  },

  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  },

  switchTab(tab) {
    this._activeTab = tab === 'tasks' ? 'tasks' : 'chat';
    document.querySelectorAll('[data-ai-tab]').forEach(btn => {
      const isSelected = btn.getAttribute('data-ai-tab') === this._activeTab;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
    const chatPanel = document.getElementById('aiTabPanelChat');
    const tasksPanel = document.getElementById('aiTabPanelTasks');
    if (chatPanel) chatPanel.classList.toggle('active', this._activeTab === 'chat');
    if (tasksPanel) tasksPanel.classList.toggle('active', this._activeTab === 'tasks');
    if (this._activeTab === 'tasks') {
      this.refreshPendingStats();
      this._renderActivityLog();
    }
  },

  // ------------------------------------------------------------------
  // Hook automático disparado por App.db.put / putMany em 'transactions'
  // ------------------------------------------------------------------
  onTransactionsSaved(items) {
    if (!this._initialized || this._suppressTxHook) return;
    const list = Array.isArray(items) ? items : (items ? [items] : []);

    // Atualiza contadores imediatamente
    this.refreshPendingStats().catch(() => {});

    if (!App.aiLocaisEngine || this._apiAuthInvalid || !this._isSelectedProviderConfigured()) return;

    // 1. Fila automática de Locais de Compras
    if (this.isAutoCategorizeEnabled()) {
      const eligibleLocais = list.filter(tx => App.aiLocaisEngine.isEligiblePurchase(tx));
      if (eligibleLocais.length > 0) {
        this._pendingQueue.push(...eligibleLocais);
        clearTimeout(this._queueTimer);
        this._queueTimer = setTimeout(() => {
          this._flushAutoQueue().catch(() => {});
        }, 850);
      }
    }

    // 2. Fila automática de Categoria + Classificação 50/30/20
    if (this.isAutoClassifyExpensesEnabled()) {
      const eligibleExpenses = list.filter(tx => App.aiLocaisEngine.needsExpenseCategorization(tx).eligible);
      if (eligibleExpenses.length > 0) {
        this._pendingExpenseQueue.push(...eligibleExpenses);
        clearTimeout(this._expenseQueueTimer);
        this._expenseQueueTimer = setTimeout(() => {
          this._flushAutoExpenseQueue().catch(() => {});
        }, 1100);
      }
    }
  },

  async _flushAutoQueue() {
    if (this._isCategorizing || this._pendingQueue.length === 0 || this._apiAuthInvalid) return;
    const queued = this._pendingQueue.splice(0, this._pendingQueue.length);

    if (!App.aiLocaisEngine || !App.db || !App.db._db) return;

    const locais = await this._ensureLocaisLoaded();
    const scan = App.aiLocaisEngine.extractUnmatchedMerchants(queued, locais);
    if (scan.groups.length === 0) return;

    await this._executeCategorizationBatches(scan.groups, locais, {
      background: true,
      sourceLabel: 'Automático (nova compra)'
    });
  },

  async _flushAutoExpenseQueue() {
    if (this._isClassifyingExpenses || this._pendingExpenseQueue.length === 0 || this._apiAuthInvalid) return;
    const queued = this._pendingExpenseQueue.splice(0, this._pendingExpenseQueue.length);

    if (!App.aiLocaisEngine || !App.db || !App.db._db) return;

    // Deduplica por id e relê estado atual do IndexedDB
    const uniqueIds = Array.from(new Set(queued.map(t => t && t.id).filter(Boolean)));
    const freshTxs = (await Promise.all(uniqueIds.map(id => App.db.getById('transactions', id).catch(() => null)))).filter(Boolean);
    const scan = App.aiLocaisEngine.extractPendingExpensesForAI(freshTxs);
    if (scan.pendingTransactions.length === 0) return;

    const categories = await App.db.getAll('categories');
    await this._executeExpenseClassificationBatches(scan.pendingTransactions, categories, {
      background: true,
      sourceLabel: 'Automático (novo gasto)'
    });
  },

  async _ensureLocaisLoaded() {
    if (App.locais && typeof App.locais._ensureSeeded === 'function') {
      return App.locais._ensureSeeded();
    }
    return App.db.getAll('locais');
  },

  async refreshPendingStats() {
    if (!App.aiLocaisEngine || !App.db || !App.db._db) return null;
    try {
      const [locais, transactions] = await Promise.all([
        this._ensureLocaisLoaded(),
        App.db.getAll('transactions')
      ]);

      const eligibleTotal = transactions.filter(t => App.aiLocaisEngine.isEligiblePurchase(t)).length;
      const scan = App.aiLocaisEngine.extractUnmatchedMerchants(transactions, locais);
      const matchedCount = Math.max(0, eligibleTotal - scan.totalUnmatchedTx);
      const coveragePct = eligibleTotal > 0 ? (matchedCount / eligibleTotal) * 100 : 100;

      const expenseScan = App.aiLocaisEngine.extractPendingExpensesForAI(transactions);

      // Total único de transações que precisam de atenção da IA (local OU categoria/classificação)
      const attentionIds = new Set();
      scan.unmatchedTransactions.forEach(t => { if (t?.id) attentionIds.add(t.id); });
      expenseScan.pendingTransactions.forEach(item => { if (item?.tx?.id) attentionIds.add(item.tx.id); });

      this._lastScan = {
        ...scan,
        eligibleTotal,
        matchedCount,
        coveragePct,
        totalLocais: locais.length,
        totalAttentionTx: attentionIds.size
      };
      this._lastExpenseScan = expenseScan;

      this._renderStatsUI();
      return { locais: this._lastScan, expenses: this._lastExpenseScan };
    } catch (err) {
      console.error('[AI Assistant] Erro ao atualizar estatísticas:', err);
      return null;
    }
  },

  _renderStatsUI() {
    const s = this._lastScan;
    const e = this._lastExpenseScan;
    if (!s || !e) return;

    const totalAttention = s.totalAttentionTx || 0;

    const badge = document.getElementById('aiFloatingBadge');
    if (badge) {
      if (totalAttention > 0) {
        badge.textContent = totalAttention > 99 ? '99+' : String(totalAttention);
        badge.style.display = 'flex';
      } else {
        badge.textContent = '';
        badge.style.display = 'none';
      }
    }

    const subtitle = document.getElementById('aiDrawerSubtitle');
    if (subtitle) {
      if (this._isClassifyingExpenses) {
        subtitle.textContent = 'Categorizando e classificando gastos com IA...';
      } else if (this._isCategorizing) {
        subtitle.textContent = 'Organizando locais de compras com IA...';
      } else if (e.totalPending > 0 && s.totalUnmatchedTx > 0) {
        subtitle.textContent = `${e.totalPending} gasto(s) e ${s.totalUnmatchedTx} local(is) pendentes`;
      } else if (e.totalPending > 0) {
        subtitle.textContent = `${e.totalPending} gasto(s) aguardando categoria/classificação`;
      } else if (s.totalUnmatchedTx > 0) {
        subtitle.textContent = `${s.totalUnmatchedTx} compra(s) sem local identificado`;
      } else {
        subtitle.textContent = `${s.totalLocais} locais • gastos e locais organizados`;
      }
    }

    const elPendingExpenses = document.getElementById('aiStatPendingExpenses');
    const elPendingLocais = document.getElementById('aiStatPendingTx');
    const elCoverage = document.getElementById('aiStatCoverage');
    if (elPendingExpenses) elPendingExpenses.textContent = String(e.totalPending);
    if (elPendingLocais) elPendingLocais.textContent = String(s.totalUnmatchedTx);
    if (elCoverage) elCoverage.textContent = `${s.coveragePct.toFixed(0)}%`;

    const esc = (v) => App.utils ? App.utils.escapeHtml(v) : String(v || '');

    // Prévia de gastos pendentes (categoria / classificação 50/30/20)
    const expPreview = document.getElementById('aiPendingExpensesPreviewList');
    if (expPreview) {
      if (e.pendingTransactions.length === 0) {
        expPreview.innerHTML = '<div class="ai-empty-note">Todos os gastos já estão categorizados e classificados.</div>';
      } else {
        const rows = e.pendingTransactions.slice(0, 6).map(item => {
          const tag = item.needsCategory && item.needsClassification
            ? 'Cat. + Classif.'
            : (item.needsCategory ? 'Categoria' : 'Classif.');
          return `
            <div class="ai-pending-row">
              <span class="ai-pending-desc" title="${esc(item.tx.description)}">${esc(item.tx.description)}</span>
              <span class="ai-pending-meta">${tag}</span>
            </div>
          `;
        }).join('');
        const extra = e.pendingTransactions.length > 6
          ? `<div class="ai-pending-more">+ ${e.pendingTransactions.length - 6} outro(s) gasto(s) pendente(s)</div>`
          : '';
        expPreview.innerHTML = rows + extra;
      }
    }

    // Prévia de locais pendentes
    const previewBox = document.getElementById('aiPendingPreviewList');
    if (previewBox) {
      if (s.groups.length === 0) {
        previewBox.innerHTML = '<div class="ai-empty-note">Todas as compras já possuem local identificado.</div>';
      } else {
        const itemsHtml = s.groups.slice(0, 6).map(g => `
          <div class="ai-pending-row">
            <span class="ai-pending-desc" title="${esc(g.description)}">${esc(g.description)}</span>
            <span class="ai-pending-meta">${g.count}x</span>
          </div>
        `).join('');
        const extra = s.groups.length > 6
          ? `<div class="ai-pending-more">+ ${s.groups.length - 6} outro(s) estabelecimento(s) aguardando</div>`
          : '';
        previewBox.innerHTML = itemsHtml + extra;
      }
    }

    const runExpBtn = document.getElementById('aiRunClassifyExpensesBtn');
    if (runExpBtn && !this._isClassifyingExpenses) {
      runExpBtn.disabled = e.totalPending === 0;
      runExpBtn.textContent = e.totalPending > 0
        ? `Categorizar e Classificar ${e.totalPending} Gasto(s) com IA`
        : 'Todos os Gastos Classificados';
    }

    const runBtn = document.getElementById('aiRunCategorizeBtn');
    if (runBtn && !this._isCategorizing) {
      runBtn.disabled = s.uniqueMerchantsCount === 0;
      runBtn.textContent = s.uniqueMerchantsCount > 0
        ? `Categorizar ${s.uniqueMerchantsCount} Local(is) Pendente(s) com IA`
        : 'Todos os Locais Organizados';
    }

    if (this._chatHistory.length === 0) {
      this._renderChatMessages();
    }
  },

  // ------------------------------------------------------------------
  // Tarefa 1: Categorização & Classificação 50/30/20 de Gastos
  // ------------------------------------------------------------------
  async categorizePendingExpenses(options = {}) {
    const { background = false, silentIfEmpty = false } = options;
    if (this._isClassifyingExpenses) {
      if (!background) App.utils?.showToast?.('Classificação de gastos com IA já está em andamento.');
      return { ok: false, busy: true };
    }

    const [transactions, categories] = await Promise.all([
      App.db.getAll('transactions'),
      App.db.getAll('categories')
    ]);
    const scan = App.aiLocaisEngine.extractPendingExpensesForAI(transactions);

    if (scan.pendingTransactions.length === 0) {
      await this.refreshPendingStats();
      if (!silentIfEmpty && !background) {
        App.utils?.showToast?.('Todos os gastos já estão categorizados e classificados.');
      }
      return {
        ok: true,
        categorizedCount: 0,
        classifiedCount: 0,
        countsByClassification: { essential: 0, necessary: 0, superfluous: 0 },
        summaryItems: []
      };
    }

    return this._executeExpenseClassificationBatches(scan.pendingTransactions, categories, {
      background,
      sourceLabel: background ? 'Varredura automática' : 'Classificação manual'
    });
  },

  async _executeExpenseClassificationBatches(pendingItems, categories, { background = false, sourceLabel = 'IA' } = {}) {
    this._isClassifyingExpenses = true;
    const runBtn = document.getElementById('aiRunClassifyExpensesBtn');
    const progressEl = document.getElementById('aiClassifyExpensesProgress');
    const fab = document.getElementById('aiFloatingBtn');
    if (fab) fab.classList.add('is-busy');
    this._renderStatsUI();

    const BATCH_SIZE = 25;
    const activeExpenseCategories = (categories || [])
      .filter(c => c && c.type === 'expense' && !c.archived && c.name)
      .map(c => ({ name: c.name, classification: c.classification || '' }));

    let totalCategorized = 0;
    let totalClassified = 0;
    const totalByClass = { essential: 0, necessary: 0, superfluous: 0 };
    const allSummaryItems = [];

    try {
      const totalBatches = Math.ceil(pendingItems.length / BATCH_SIZE);

      for (let b = 0; b < totalBatches; b++) {
        const batch = pendingItems.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        const statusMsg = totalBatches > 1
          ? `Classificando lote ${b + 1} de ${totalBatches} (${batch.length} gastos)...`
          : `Classificando ${batch.length} gasto(s) com IA...`;

        if (runBtn) {
          runBtn.disabled = true;
          runBtn.textContent = statusMsg;
        }
        if (progressEl) {
          progressEl.style.display = 'block';
          progressEl.textContent = statusMsg;
        }

        const response = await fetch('/api/ai/categorize-expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: this.getSelectedProvider(),
            items: batch.map(entry => ({
              id: entry.tx.id,
              description: entry.tx.description,
              amount: entry.tx.amount,
              date: entry.tx.date,
              currentCategory: entry.tx.category || '',
              currentClassification: entry.tx.classification || ''
            })),
            categories: activeExpenseCategories
          })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (payload.code === 'API_KEY_MISSING') {
            this._apiConfigured = false;
            this._updateHealthBanner();
          } else if (payload.code === 'AUTH_ERROR') {
            this._apiAuthInvalid = true;
            this._updateHealthBanner();
          }
          throw new Error(payload.error || `Erro HTTP ${response.status} ao classificar gastos.`);
        }

        this._apiConfigured = true;
        this._apiAuthInvalid = false;
        this._updateHealthBanner();

        const applied = App.aiLocaisEngine.applyExpenseCategorizations(
          batch.map(entry => entry.tx),
          payload.items || [],
          categories,
          { provider: payload.provider || 'ai' }
        );

        if (applied.updatedTransactions.length > 0) {
          this._suppressTxHook = true;
          try {
            await App.db.putMany('transactions', applied.updatedTransactions);
          } finally {
            this._suppressTxHook = false;
          }
        }

        totalCategorized += applied.categorizedCount;
        totalClassified += applied.classifiedCount;
        totalByClass.essential += applied.countsByClassification.essential || 0;
        totalByClass.necessary += applied.countsByClassification.necessary || 0;
        totalByClass.superfluous += applied.countsByClassification.superfluous || 0;
        allSummaryItems.push(...applied.summaryItems);
      }

      if (allSummaryItems.length > 0) {
        const now = new Date().toISOString();
        const logEntries = allSummaryItems.map(item => ({
          ...item,
          source: sourceLabel,
          timestamp: now
        }));
        this._activityLog = [...logEntries, ...this._activityLog].slice(0, 40);
        this._saveActivityLog();
        this._renderActivityLog();
        this._refreshFinanceViewsAfterExpenseUpdate();
      }

      await this.refreshPendingStats();

      if (allSummaryItems.length > 0) {
        const msg = allSummaryItems.length === 1
          ? `IA classificou: ${allSummaryItems[0].description} → ${allSummaryItems[0].category} (${allSummaryItems[0].classificationLabel})`
          : `IA organizou ${allSummaryItems.length} gasto(s): ${totalByClass.essential} Essencial, ${totalByClass.necessary} Necessário, ${totalByClass.superfluous} Supérfluo.`;
        App.utils?.showToast?.(msg);
      }

      return {
        ok: true,
        categorizedCount: totalCategorized,
        classifiedCount: totalClassified,
        countsByClassification: totalByClass,
        summaryItems: allSummaryItems
      };
    } catch (err) {
      console.error('[AI Assistant] Erro ao classificar gastos:', err);
      const errMsg = err?.message || 'Não foi possível classificar os gastos agora.';
      if (!background) {
        App.utils?.showToast?.(errMsg, 'error');
      }
      if (progressEl) {
        progressEl.style.display = 'block';
        progressEl.innerHTML = `<span class="ai-inline-error">${App.utils ? App.utils.escapeHtml(errMsg) : errMsg}</span>`;
      }
      return { ok: false, error: errMsg };
    } finally {
      this._isClassifyingExpenses = false;
      if (fab && !this._isCategorizing) fab.classList.remove('is-busy');
      if (progressEl && !progressEl.querySelector('.ai-inline-error')) {
        progressEl.style.display = 'none';
        progressEl.textContent = '';
      }
      await this.refreshPendingStats();
    }
  },

  _refreshFinanceViewsAfterExpenseUpdate() {
    try {
      if (App.transactions?.invalidateCache) App.transactions.invalidateCache();
      const activePage = document.querySelector('.page.active')?.id || '';
      if (activePage === 'page-transactions' && App.transactions?.load) App.transactions.load();
      if (activePage === 'page-classifications' && App.classification?.load) App.classification.load();
      if (activePage === 'page-dashboard' && App.dashboard?.refresh) App.dashboard.refresh();
      if (activePage === 'page-panel' && App.panel?.refresh) App.panel.refresh();
      if (activePage === 'page-planning' && App.planning?.refreshIfActive) App.planning.refreshIfActive();
    } catch (_) {}
  },

  // ------------------------------------------------------------------
  // Tarefa 2: Categorização de Locais de Compras
  // ------------------------------------------------------------------
  async categorizePendingLocations(options = {}) {
    const { background = false, silentIfEmpty = false } = options;
    if (this._isCategorizing) {
      if (!background) App.utils?.showToast?.('Categorização de locais com IA já está em andamento.');
      return { ok: false, busy: true };
    }

    const locais = await this._ensureLocaisLoaded();
    const transactions = await App.db.getAll('transactions');
    const scan = App.aiLocaisEngine.extractUnmatchedMerchants(transactions, locais);

    if (scan.groups.length === 0) {
      await this.refreshPendingStats();
      if (!silentIfEmpty && !background) {
        App.utils?.showToast?.('Todas as compras já estão com locais categorizados.');
      }
      return { ok: true, createdCount: 0, updatedCount: 0, organizedTxCount: 0, summaryItems: [] };
    }

    return this._executeCategorizationBatches(scan.groups, locais, {
      background,
      sourceLabel: background ? 'Varredura automática' : 'Categorização manual'
    });
  },

  async _executeCategorizationBatches(groups, initialLocais, { background = false, sourceLabel = 'IA' } = {}) {
    this._isCategorizing = true;
    const runBtn = document.getElementById('aiRunCategorizeBtn');
    const progressEl = document.getElementById('aiCategorizeProgress');
    const fab = document.getElementById('aiFloatingBtn');
    if (fab) fab.classList.add('is-busy');
    this._renderStatsUI();

    const BATCH_SIZE = 25;
    let workingLocais = [...initialLocais];
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalOrganizedTx = 0;
    const allSummaryItems = [];

    try {
      const totalBatches = Math.ceil(groups.length / BATCH_SIZE);

      for (let b = 0; b < totalBatches; b++) {
        const batch = groups.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        const statusMsg = totalBatches > 1
          ? `Categorizando lote ${b + 1} de ${totalBatches} (${batch.length} locais)...`
          : `Categorizando ${batch.length} local(is) com IA...`;

        if (runBtn) {
          runBtn.disabled = true;
          runBtn.textContent = statusMsg;
        }
        if (progressEl) {
          progressEl.style.display = 'block';
          progressEl.textContent = statusMsg;
        }

        const response = await fetch('/api/ai/categorize-locais', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: this.getSelectedProvider(),
            items: batch.map(g => ({
              description: g.description,
              category: g.category,
              amount: g.amount,
              count: g.count
            })),
            existingLocais: workingLocais.map(l => ({
              nome: l.nome,
              categoria: l.categoria || '',
              icone: l.icone || '🏪'
            }))
          })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (payload.code === 'API_KEY_MISSING') {
            this._apiConfigured = false;
            this._updateHealthBanner();
          } else if (payload.code === 'AUTH_ERROR') {
            this._apiAuthInvalid = true;
            this._updateHealthBanner();
          }
          throw new Error(payload.error || `Erro HTTP ${response.status} ao categorizar locais.`);
        }

        this._apiConfigured = true;
        this._apiAuthInvalid = false;
        this._updateHealthBanner();

        const merged = App.aiLocaisEngine.mergeCategorizationsIntoLocais(
          workingLocais,
          payload.categorizations || [],
          batch
        );

        if (merged.updatedRecords.length > 0) {
          await App.db.putMany('locais', merged.updatedRecords);
          const byId = new Map(workingLocais.map(l => [l.id, l]));
          merged.updatedRecords.forEach(rec => byId.set(rec.id, rec));
          workingLocais = Array.from(byId.values());
        }

        totalCreated += merged.createdCount;
        totalUpdated += merged.updatedCount;
        totalOrganizedTx += merged.organizedTxCount;
        allSummaryItems.push(...merged.summaryItems);
      }

      if (allSummaryItems.length > 0) {
        const now = new Date().toISOString();
        const logEntries = allSummaryItems.map(item => ({
          kind: 'local',
          ...item,
          source: sourceLabel,
          timestamp: now
        }));
        this._activityLog = [...logEntries, ...this._activityLog].slice(0, 40);
        this._saveActivityLog();
        this._renderActivityLog();
      }

      if (App.locais && typeof App.locais.load === 'function') {
        const locaisPage = document.getElementById('page-locais');
        if (locaisPage && locaisPage.classList.contains('active')) {
          App.locais.load();
        }
      }

      await this.refreshPendingStats();

      if (allSummaryItems.length > 0) {
        const msg = allSummaryItems.length === 1
          ? `IA organizou: ${allSummaryItems[0].icone} ${allSummaryItems[0].nome} (${allSummaryItems[0].categoria})`
          : `IA organizou ${totalOrganizedTx} compra(s) em ${totalCreated} novo(s) e ${totalUpdated} local(is) existente(s).`;
        App.utils?.showToast?.(msg);
      }

      return {
        ok: true,
        createdCount: totalCreated,
        updatedCount: totalUpdated,
        organizedTxCount: totalOrganizedTx,
        summaryItems: allSummaryItems
      };
    } catch (err) {
      console.error('[AI Assistant] Erro ao categorizar locais:', err);
      const errMsg = err?.message || 'Não foi possível categorizar os locais agora.';
      if (!background) {
        App.utils?.showToast?.(errMsg, 'error');
      }
      if (progressEl) {
        progressEl.style.display = 'block';
        progressEl.innerHTML = `<span class="ai-inline-error">${App.utils ? App.utils.escapeHtml(errMsg) : errMsg}</span>`;
      }
      return { ok: false, error: errMsg };
    } finally {
      this._isCategorizing = false;
      if (fab && !this._isClassifyingExpenses) fab.classList.remove('is-busy');
      if (progressEl && !progressEl.querySelector('.ai-inline-error')) {
        progressEl.style.display = 'none';
        progressEl.textContent = '';
      }
      await this.refreshPendingStats();
    }
  },

  _renderActivityLog() {
    const container = document.getElementById('aiActivityLogList');
    if (!container) return;
    if (!this._activityLog || this._activityLog.length === 0) {
      container.innerHTML = '<div class="ai-empty-note">Nenhuma categorização executada ainda.</div>';
      return;
    }

    const esc = (v) => App.utils ? App.utils.escapeHtml(v) : String(v || '');
    container.innerHTML = this._activityLog.slice(0, 15).map(entry => {
      if (entry.kind === 'expense') {
        const clsCode = entry.classification || 'necessary';
        const badgeCls = clsCode === 'essential' ? 'is-ess' : (clsCode === 'superfluous' ? 'is-sup' : 'is-nec');
        const label = entry.classificationLabel || App.aiLocaisEngine?.formatClassificationLabel?.(clsCode) || 'Necessário';
        return `
          <div class="ai-log-item" onclick="App.aiAssistant.goToClassifications()">
            <span class="ai-log-icon">🏷️</span>
            <div class="ai-log-main">
              <div class="ai-log-title">
                <strong>${esc(entry.description || 'Gasto')}</strong>
                <span class="ai-log-badge ${badgeCls}">${esc(label)}</span>
              </div>
              <div class="ai-log-sub">${esc(entry.category || 'Outros')}</div>
            </div>
          </div>
        `;
      }

      const badgeText = entry.action === 'created' ? 'Novo' : 'Atualizado';
      const badgeCls = entry.action === 'created' ? 'is-new' : 'is-upd';
      return `
        <div class="ai-log-item" onclick="App.aiAssistant.goToLocais()">
          <span class="ai-log-icon">${esc(entry.icone || '🏪')}</span>
          <div class="ai-log-main">
            <div class="ai-log-title">
              <strong>${esc(entry.nome)}</strong>
              <span class="ai-log-badge ${badgeCls}">${badgeText}</span>
            </div>
            <div class="ai-log-sub">${esc(entry.categoria || 'Outros')} • ${entry.txCount || 1} compra(s) • ${esc(entry.description || '')}</div>
          </div>
        </div>
      `;
    }).join('');
  },

  goToLocais() {
    this.close();
    if (App.ui && typeof App.ui.navigateTo === 'function') {
      App.ui.navigateTo('locais');
    }
  },

  goToClassifications() {
    this.close();
    if (App.ui && typeof App.ui.navigateTo === 'function') {
      App.ui.navigateTo('classifications');
    }
  },

  // ------------------------------------------------------------------
  // Chat integrado com IA + execução de tarefas no projeto
  // ------------------------------------------------------------------
  async buildCurrentProjectContext() {
    const activePageEl = document.querySelector('.page.active');
    const currentPage = activePageEl ? activePageEl.id.replace('page-', '') : 'panel';

    const [accounts, transactions, locais, investments, plans] = await Promise.all([
      App.db.getAll('accounts').catch(() => []),
      App.db.getAll('transactions').catch(() => []),
      this._ensureLocaisLoaded().catch(() => []),
      App.db.getAll('investments').catch(() => []),
      App.db.getAll('planosOrcamentarios').catch(() => [])
    ]);

    return App.aiLocaisEngine.buildProjectContextSnapshot({
      accounts,
      transactions,
      locais,
      investments,
      plans,
      currentPage
    });
  },

  sendQuickPrompt(text) {
    this.open('chat');
    const input = document.getElementById('aiChatInput');
    if (input) input.value = text;
    this.sendChatFromInput();
  },

  async sendChatFromInput() {
    if (this._isSendingChat) return;
    const input = document.getElementById('aiChatInput');
    if (!input) return;
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    this._appendChatMessage({ role: 'user', text: message });

    this._isSendingChat = true;
    this._setChatLoading(true);

    try {
      const context = await this.buildCurrentProjectContext();
      const historyToSend = this._chatHistory
        .slice(0, -1)
        .filter(m => !m.isError)
        .slice(-12)
        .map(m => ({ role: m.role, text: m.text }));

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.getSelectedProvider(),
          message,
          history: historyToSend,
          context
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === 'API_KEY_MISSING') {
          this._apiConfigured = false;
          this._updateHealthBanner();
        } else if (data.code === 'AUTH_ERROR') {
          this._apiAuthInvalid = true;
          this._updateHealthBanner();
        }
        throw new Error(data.error || `Erro HTTP ${response.status} ao conversar com a IA.`);
      }

      this._apiConfigured = true;
      this._apiAuthInvalid = false;
      this._updateHealthBanner();

      const replyText = data.reply || 'Não recebi uma resposta textual da IA.';
      this._appendChatMessage({ role: 'model', text: replyText });

      // Executa ação solicitada pela IA diretamente no projeto
      await this._handleChatAction(data.action);
    } catch (err) {
      const errMsg = err?.message || 'Erro de comunicação com o servidor de IA.';
      this._appendChatMessage({ role: 'model', text: errMsg, isError: true });
    } finally {
      this._isSendingChat = false;
      this._setChatLoading(false);
    }
  },

  async _handleChatAction(action) {
    if (!action || action === 'none') return;

    if (action === 'categorize_expenses' || action === 'categorize_all') {
      const expRes = await this.categorizePendingExpenses({ background: false, silentIfEmpty: true });
      if (expRes.ok) {
        if (expRes.summaryItems && expRes.summaryItems.length > 0) {
          const preview = expRes.summaryItems
            .slice(0, 6)
            .map(i => `• **${i.description}** → ${i.category} (${i.classificationLabel})`)
            .join('\n');
          const more = expRes.summaryItems.length > 6
            ? `\n• ... e mais ${expRes.summaryItems.length - 6} gasto(s).`
            : '';
          const c = expRes.countsByClassification || {};
          this._appendChatMessage({
            role: 'model',
            text: `Gastos organizados: ${expRes.summaryItems.length} despesa(s) (${c.essential || 0} Essencial, ${c.necessary || 0} Necessário, ${c.superfluous || 0} Supérfluo).\n\n${preview}${more}`
          });
        } else if (action === 'categorize_expenses') {
          this._appendChatMessage({
            role: 'model',
            text: 'Verifiquei suas despesas e todos os gastos elegíveis já estão categorizados e classificados.'
          });
        }
      } else if (expRes.error) {
        this._appendChatMessage({ role: 'model', text: expRes.error, isError: true });
      }
      if (action === 'categorize_expenses') return;
    }

    if (action === 'categorize_locais' || action === 'categorize_all') {
      const result = await this.categorizePendingLocations({ background: false, silentIfEmpty: true });
      if (result.ok) {
        if (result.summaryItems && result.summaryItems.length > 0) {
          const preview = result.summaryItems
            .slice(0, 6)
            .map(i => `• ${i.icone} **${i.nome}** (${i.categoria}) — ${i.txCount} compra(s)`)
            .join('\n');
          const more = result.summaryItems.length > 6
            ? `\n• ... e mais ${result.summaryItems.length - 6} local(is).`
            : '';
          this._appendChatMessage({
            role: 'model',
            text: `Locais organizados: ${result.organizedTxCount} compra(s) (${result.createdCount} novo(s), ${result.updatedCount} atualizado(s)).\n\n${preview}${more}`
          });
        } else {
          this._appendChatMessage({
            role: 'model',
            text: 'Todos os locais de compras elegíveis já estão identificados.'
          });
        }
      } else if (result.error) {
        this._appendChatMessage({ role: 'model', text: result.error, isError: true });
      }
      return;
    }

    if (action === 'open_locais' && App.ui?.navigateTo) {
      App.ui.navigateTo('locais');
    } else if (action === 'open_saldos' && App.ui?.navigateTo) {
      App.ui.navigateTo('saldos');
    } else if (action === 'open_planning' && App.ui?.navigateTo) {
      App.ui.navigateTo('planning');
    }
  },

  _appendChatMessage(msg) {
    this._chatHistory.push({
      role: msg.role === 'user' ? 'user' : 'model',
      text: String(msg.text || ''),
      isError: Boolean(msg.isError),
      timestamp: new Date().toISOString()
    });
    if (this._chatHistory.length > 30) {
      this._chatHistory = this._chatHistory.slice(-30);
    }
    this._saveChatHistory();
    this._renderChatMessages();
  },

  clearChat() {
    this._chatHistory = [];
    this._saveChatHistory();
    this._renderChatMessages();
  },

  _setChatLoading(isLoading) {
    const sendBtn = document.getElementById('aiChatSendBtn');
    const input = document.getElementById('aiChatInput');
    const typingEl = document.getElementById('aiChatTyping');
    if (sendBtn) sendBtn.disabled = isLoading;
    if (input) input.disabled = isLoading;
    if (typingEl) typingEl.style.display = isLoading ? 'flex' : 'none';
    if (isLoading) this._scrollChatToBottom();
  },

  _formatChatTextSafe(rawText) {
    const esc = (v) => App.utils
      ? App.utils.escapeHtml(v)
      : String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(rawText)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  },

  _renderChatMessages() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;

    if (this._chatHistory.length === 0) {
      const pendingLoc = this._lastScan ? this._lastScan.totalUnmatchedTx : 0;
      const pendingExp = this._lastExpenseScan ? this._lastExpenseScan.totalPending : 0;
      let hint = 'Pergunte sobre seus saldos, despesas do mês ou peça para eu categorizar gastos e locais.';
      if (pendingExp > 0 && pendingLoc > 0) {
        hint = `Encontrei ${pendingExp} gasto(s) sem categoria/classificação e ${pendingLoc} compra(s) sem local. Posso organizar tudo agora.`;
      } else if (pendingExp > 0) {
        hint = `Encontrei ${pendingExp} gasto(s) aguardando categoria ou classificação (Essencial / Necessário / Supérfluo).`;
      } else if (pendingLoc > 0) {
        hint = `Encontrei ${pendingLoc} compra(s) sem local identificado. Posso categorizá-las agora.`;
      }
      container.innerHTML = `
        <div class="ai-chat-welcome">
          <div class="ai-welcome-title">Como posso ajudar no seu financeiro hoje?</div>
          <p class="ai-welcome-desc">${hint}</p>
          <div class="ai-quick-prompts">
            <button type="button" class="ai-quick-btn" onclick="App.aiAssistant.sendQuickPrompt('Categorize meus gastos pendentes e classifique em Essencial, Necessário e Supérfluo')">Categorizar e classificar gastos</button>
            <button type="button" class="ai-quick-btn" onclick="App.aiAssistant.sendQuickPrompt('Categorize todos os meus locais de compras pendentes agora')">Categorizar locais pendentes</button>
            <button type="button" class="ai-quick-btn" onclick="App.aiAssistant.sendQuickPrompt('Onde mais gastei considerando meus locais e categorias?')">Onde mais gastei?</button>
            <button type="button" class="ai-quick-btn" onclick="App.aiAssistant.sendQuickPrompt('Faça um resumo dos meus saldos e resultado do mês atual')">Resumo dos saldos</button>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = this._chatHistory.map(m => {
      const cls = m.role === 'user'
        ? 'ai-msg ai-msg-user'
        : (m.isError ? 'ai-msg ai-msg-assistant ai-msg-error' : 'ai-msg ai-msg-assistant');
      return `<div class="${cls}"><div class="ai-msg-bubble">${this._formatChatTextSafe(m.text)}</div></div>`;
    }).join('');

    this._scrollChatToBottom();
  },

  _scrollChatToBottom() {
    const container = document.getElementById('aiChatMessages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }
};
