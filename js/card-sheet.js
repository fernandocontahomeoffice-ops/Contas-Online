// =====================================================================
// ARQUIVO: card-sheet.js
// Planilha Online de Cartão de Crédito (testecartao.xlsx) com
// sincronização automática em tempo real para o IndexedDB e Faturas.
// =====================================================================
var App = window.App || {};

App.cardSheet = {
  STORAGE_KEY: 'contas_online_card_sheet_v1',
  selectedCardId: null,
  autoSync: true,
  convention: 'excel_signed', // 'excel_signed' (- despesa / + estorno) | 'positive_expense'
  fileName: 'testecartao.xlsx',
  githubUrl: '',
  filterSearch: '',
  filterStatus: 'all',
  rowsByCard: {},
  _syncTimers: {},
  _rowSyncLocks: {},
  _isSyncing: false,
  _splitRowId: null,
  _cards: [],
  _members: [],
  _categories: [],
  _accounts: [],
  _recentDescriptions: [],
  _dragBound: false,

  _engine() {
    return App.cardSheetEngine;
  },

  _esc(str) {
    if (App.math && App.math.escapeHtml) return App.math.escapeHtml(str);
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _loadPersistedState() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.autoSync === 'boolean') this.autoSync = parsed.autoSync;
        if (parsed.convention === 'excel_signed' || parsed.convention === 'positive_expense') {
          this.convention = parsed.convention;
        }
        if (typeof parsed.fileName === 'string' && parsed.fileName.trim()) {
          this.fileName = parsed.fileName.trim();
        }
        if (typeof parsed.githubUrl === 'string') {
          this.githubUrl = parsed.githubUrl;
        }
        if (parsed.selectedCardId && !this.selectedCardId) {
          this.selectedCardId = parsed.selectedCardId;
        }
        if (parsed.rowsByCard && typeof parsed.rowsByCard === 'object') {
          this.rowsByCard = parsed.rowsByCard;
        }
      }
    } catch (e) {
      console.warn('Falha ao restaurar rascunho da planilha do cartão:', e);
    }
  },

  _savePersistedState() {
    try {
      const payload = {
        selectedCardId: this.selectedCardId,
        autoSync: this.autoSync,
        convention: this.convention,
        fileName: this.fileName,
        githubUrl: this.githubUrl,
        rowsByCard: this.rowsByCard
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('Falha ao salvar estado da planilha do cartão:', e);
    }
  },

  _getRows(cardId = this.selectedCardId) {
    const engine = this._engine();
    if (!cardId) return [];
    if (!Array.isArray(this.rowsByCard[cardId])) {
      const today = App.utils?.todayISO?.() || new Date().toISOString().slice(0, 10);
      this.rowsByCard[cardId] = [
        engine.createEmptyRow({ date: today }),
        engine.createEmptyRow({ date: '' }),
        engine.createEmptyRow({ date: '' })
      ];
    }
    return this.rowsByCard[cardId];
  },

  _setRows(cardId, rows) {
    if (!cardId) return;
    this.rowsByCard[cardId] = rows;
    this._savePersistedState();
  },

  openForCard(cardId) {
    if (cardId) {
      this.selectedCardId = cardId;
      this._savePersistedState();
    }
    App.ui.navigateTo('card-sheet');
  },

  async load() {
    this._loadPersistedState();
    const [cards, members, categories, accounts, allTx] = await Promise.all([
      App.db.getAll('creditCards'),
      App.db.getAll('members'),
      App.db.getAll('categories'),
      App.db.getAll('accounts'),
      App.db.getAll('transactions')
    ]);

    this._cards = (cards || []).filter(c => c.card_type !== 'prepaid');
    this._members = members || [];
    this._categories = (categories || []).filter(c => !c.archived && (c.type === 'expense' || !c.type));
    this._accounts = accounts || [];

    App.cache.creditCards = cards || [];
    App.cache.members = members || [];
    App.cache.categories = categories || [];
    App.cache.accounts = accounts || [];

    // Recent descriptions for autocomplete
    const descSet = new Set();
    (allTx || [])
      .filter(t => t && t.credit_card_id && t.description && t.category !== 'Pagamento Fatura')
      .slice(-200)
      .forEach(t => descSet.add(t.description.trim()));
    this._recentDescriptions = [...descSet].slice(0, 120);

    // Ensure valid selected card
    if (!this._cards.some(c => c.id === this.selectedCardId)) {
      this.selectedCardId = this._cards.length ? this._cards[0].id : null;
    }

    // Reconcile syncedTxIds with current IndexedDB transactions
    if (this.selectedCardId) {
      const txIdSet = new Set((allTx || []).map(t => t.id));
      const rows = this._getRows(this.selectedCardId);
      let changed = false;
      for (const row of rows) {
        if (Array.isArray(row.syncedTxIds) && row.syncedTxIds.length > 0) {
          const alive = row.syncedTxIds.filter(id => txIdSet.has(id));
          if (alive.length !== row.syncedTxIds.length) {
            row.syncedTxIds = alive;
            if (alive.length === 0 && row.syncState === 'synced') {
              row.syncState = 'pending';
              row.syncMessage = 'Removido da fatura';
              row.lastSyncedHash = '';
            }
            changed = true;
          }
        }
      }
      if (changed) this._savePersistedState();
    }

    this._bindDragDrop();
    this.render();
  },

  _bindDragDrop() {
    if (this._dragBound) return;
    const dropZone = document.getElementById('cardSheetDropZone');
    if (!dropZone) return;
    this._dragBound = true;

    const onDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('cs-drop-active');
    };
    const onLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('cs-drop-active');
    };
    dropZone.addEventListener('dragenter', onDrag);
    dropZone.addEventListener('dragover', onDrag);
    dropZone.addEventListener('dragleave', onLeave);
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('cs-drop-active');
      const file = e.dataTransfer?.files?.[0];
      if (file) this._importLocalFile(file);
    });
  },

  render() {
    this._renderHeaderControls();
    this._renderDatalists();
    this._renderSummary();
    this._renderGrid();
  },

  _renderHeaderControls() {
    const cardSel = document.getElementById('cardSheetCardSelect');
    const noCardBanner = document.getElementById('cardSheetNoCardBanner');
    const workspace = document.getElementById('cardSheetWorkspace');
    const cardMeta = document.getElementById('cardSheetCardMeta');
    const fileLabel = document.getElementById('cardSheetFileNameLabel');
    const autoToggle = document.getElementById('cardSheetAutoSyncToggle');
    const convSelect = document.getElementById('cardSheetConventionSelect');
    const openInvBtn = document.getElementById('cardSheetOpenInvoiceBtn');
    const syncStatePill = document.getElementById('cardSheetLiveSyncPill');

    if (fileLabel) fileLabel.textContent = this.fileName || 'testecartao.xlsx';
    if (autoToggle) autoToggle.checked = this.autoSync;
    if (convSelect) convSelect.value = this.convention;

    if (cardSel) {
      if (this._cards.length === 0) {
        cardSel.innerHTML = '<option value="">Nenhum cartão cadastrado</option>';
        cardSel.disabled = true;
      } else {
        cardSel.disabled = false;
        cardSel.innerHTML = this._cards.map(c =>
          `<option value="${this._esc(c.id)}" ${c.id === this.selectedCardId ? 'selected' : ''}>${this._esc(c.name)}</option>`
        ).join('');
      }
    }

    const card = this._cards.find(c => c.id === this.selectedCardId);
    if (noCardBanner) noCardBanner.style.display = card ? 'none' : 'flex';
    if (workspace) workspace.style.display = card ? 'block' : 'none';
    if (openInvBtn) openInvBtn.disabled = !card;

    if (cardMeta) {
      if (card) {
        const closeDay = card.close_day || (card.due_day - 10 > 0 ? card.due_day - 10 : 1);
        const dueDay = card.due_day || 10;
        const limitTxt = card.limit ? App.utils.formatCurrency(card.limit) : '—';
        cardMeta.innerHTML = `Fecha dia <strong>${closeDay}</strong> · Vence dia <strong>${dueDay}</strong> · Limite <strong>${this._esc(limitTxt)}</strong>`;
      } else {
        cardMeta.textContent = '';
      }
    }

    if (syncStatePill) {
      const totals = this._engine().computeSheetTotals(this._getRows(), this.convention);
      if (this._isSyncing) {
        syncStatePill.className = 'cs-live-pill cs-live-syncing';
        syncStatePill.textContent = 'Sincronizando...';
      } else if (totals.errorCount > 0 || totals.duplicateCount > 0) {
        syncStatePill.className = 'cs-live-pill cs-live-warn';
        syncStatePill.textContent = `${totals.errorCount + totals.duplicateCount} aviso(s)`;
      } else if (totals.pendingCount > 0) {
        syncStatePill.className = 'cs-live-pill cs-live-pending';
        syncStatePill.textContent = `${totals.pendingCount} pendente(s)`;
      } else if (totals.syncedCount > 0) {
        syncStatePill.className = 'cs-live-pill cs-live-ok';
        syncStatePill.textContent = `Sincronizado (${totals.syncedCount})`;
      } else {
        syncStatePill.className = 'cs-live-pill cs-live-idle';
        syncStatePill.textContent = this.autoSync ? 'Auto-sync ativo' : 'Sync manual';
      }
    }
  },

  _renderDatalists() {
    const catList = document.getElementById('cardSheetCategoriesList');
    if (catList) {
      const uniqueCats = [...new Set(this._categories.map(c => c.name))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      catList.innerHTML = uniqueCats.map(name => `<option value="${this._esc(name)}"></option>`).join('');
    }
    const descList = document.getElementById('cardSheetDescriptionsList');
    if (descList) {
      descList.innerHTML = this._recentDescriptions.map(d => `<option value="${this._esc(d)}"></option>`).join('');
    }
  },

  _renderSummary() {
    const el = document.getElementById('cardSheetSummary');
    if (!el) return;
    const rows = this._getRows();
    const totals = this._engine().computeSheetTotals(rows, this.convention);
    const fmt = (v) => App.utils?.formatCurrency ? App.utils.formatCurrency(v) : `R$ ${Number(v || 0).toFixed(2)}`;

    el.innerHTML = `
      <div class="cs-kpi-card">
        <span class="cs-kpi-label">Despesas na Planilha</span>
        <strong class="cs-kpi-value cs-val-expense">${fmt(totals.expenses)}</strong>
      </div>
      <div class="cs-kpi-card">
        <span class="cs-kpi-label">Estornos / Créditos</span>
        <strong class="cs-kpi-value cs-val-refund">${fmt(totals.refunds)}</strong>
      </div>
      <div class="cs-kpi-card">
        <span class="cs-kpi-label">Líquido na Fatura</span>
        <strong class="cs-kpi-value">${fmt(totals.net)}</strong>
      </div>
      <div class="cs-kpi-card">
        <span class="cs-kpi-label">Linhas Sincronizadas</span>
        <strong class="cs-kpi-value cs-val-ok">${totals.syncedCount} / ${totals.filledCount}</strong>
      </div>
      <div class="cs-kpi-card">
        <span class="cs-kpi-label">Pendentes / Avisos</span>
        <strong class="cs-kpi-value ${(totals.errorCount + totals.duplicateCount) > 0 ? 'cs-val-warn' : ''}">${totals.pendingCount + totals.errorCount + totals.duplicateCount}</strong>
      </div>
    `;
  },

  _getVisibleRows() {
    const rows = this._getRows();
    const q = String(this.filterSearch || '').trim().toLowerCase();
    const st = this.filterStatus || 'all';
    const engine = this._engine();

    return rows.filter(row => {
      if (st !== 'all') {
        if (st === 'issues') {
          if (row.syncState !== 'error' && row.syncState !== 'duplicate') return false;
        } else if (st === 'pending') {
          if (engine.isRowBlank(row) || row.syncState === 'synced') return false;
        } else if (row.syncState !== st) {
          return false;
        }
      }
      if (q) {
        const hay = `${row.description || ''} ${row.category || ''} ${row.member || ''} ${row.date || ''} ${row.amount || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  },

  _renderGrid() {
    const tbody = document.getElementById('cardSheetTableBody');
    if (!tbody) return;
    const engine = this._engine();
    const allRows = this._getRows();
    const visible = this._getVisibleRows();

    const memberOptionsBase = [
      '<option value="">Titular / Padrão</option>',
      ...this._members.map(m => `<option value="${this._esc(m.name)}">${this._esc(m.name)}</option>`),
      '<option value="Compra dividida">🔀 Compra dividida</option>'
    ];

    if (visible.length === 0) {
      tbody.innerHTML = `
        <tr class="cs-empty-row">
          <td colspan="10">Nenhuma linha corresponde ao filtro atual. <button type="button" class="btn btn-outline btn-sm" onclick="App.cardSheet.clearFilters()">Limpar filtros</button></td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = visible.map((row) => {
      const realIndex = allRows.indexOf(row);
      const isBlank = engine.isRowBlank(row);
      const amtInfo = engine.resolveTxTypeAndAmount(row.amount, this.convention);
      const amtClass = amtInfo.valid ? (amtInfo.txType === 'expense' ? 'cs-amt-expense' : 'cs-amt-refund') : '';
      const amtBadge = amtInfo.valid
        ? (amtInfo.txType === 'expense'
          ? '<span class="cs-type-tag cs-tag-exp" title="Despesa">Desp</span>'
          : '<span class="cs-type-tag cs-tag-ref" title="Estorno / Crédito">Est</span>')
        : '';

      const inst = engine.parseInstallments(row.installments);
      const instHint = (amtInfo.valid && inst > 1)
        ? `${inst}x ${App.utils.formatCurrency(amtInfo.amount / inst)}`
        : '';

      const isSplit = engine.isSplitMemberLabel(row.member);
      const memberKnown = !row.member || isSplit || this._members.some(m => m.name.toLowerCase() === String(row.member).toLowerCase());
      const memberSelectHtml = memberOptionsBase.join('') +
        (!memberKnown ? `<option value="${this._esc(row.member)}" selected>${this._esc(row.member)} (não cadastrado)</option>` : '');

      let statusHtml = '';
      if (isBlank) {
        statusHtml = '<span class="cs-status-badge cs-st-blank">Vazia</span>';
      } else if (row.syncState === 'synced') {
        const countTag = (row.syncedTxIds && row.syncedTxIds.length > 1) ? ` (${row.syncedTxIds.length}x)` : '';
        statusHtml = `<span class="cs-status-badge cs-st-synced" title="Sincronizado com o cartão">✓ Sincronizado${countTag}</span>`;
      } else if (row.syncState === 'duplicate') {
        statusHtml = `
          <span class="cs-status-badge cs-st-dup" title="${this._esc(row.syncMessage || 'Lançamento semelhante já existe no cartão')}">⚠ Duplicado</span>
          <button type="button" class="cs-mini-btn cs-mini-force" onclick="App.cardSheet.forceSyncRow('${this._esc(row.rowId)}')" title="Importar mesmo sendo semelhante">Forçar</button>
        `;
      } else if (row.syncState === 'error') {
        statusHtml = `<span class="cs-status-badge cs-st-error" title="${this._esc(row.syncMessage || 'Revise os campos da linha')}">✕ ${this._esc(row.syncMessage || 'Erro')}</span>`;
      } else {
        statusHtml = `<span class="cs-status-badge cs-st-pending" title="Aguardando sincronização">● Pendente</span>`;
      }

      const splitBtnHtml = isSplit
        ? `<button type="button" class="cs-mini-btn" onclick="App.cardSheet.openSplitModal('${this._esc(row.rowId)}')" title="Definir divisão por membro">Dividir</button>`
        : '';

      const currentMemberVal = isSplit ? 'Compra dividida' : (row.member || '');

      return `
        <tr class="cs-row cs-row-${this._esc(isBlank ? 'blank' : row.syncState)}" data-row-id="${this._esc(row.rowId)}">
          <td class="cs-col-num">${realIndex + 1}</td>
          <td class="cs-col-date">
            <input type="date" class="cs-cell-input" data-field="date" data-row-id="${this._esc(row.rowId)}"
              aria-label="Data linha ${realIndex + 1}"
              value="${this._esc(row.date || '')}"
              oninput="App.cardSheet.onCellInput('${this._esc(row.rowId)}', 'date', this.value)"
              onblur="App.cardSheet.onCellBlur('${this._esc(row.rowId)}')"
              onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'date')"
              onpaste="App.cardSheet.onCellPaste(event, '${this._esc(row.rowId)}', 'date')">
          </td>
          <td class="cs-col-time">
            <input type="text" inputmode="numeric" maxlength="5" placeholder="HH:MM" class="cs-cell-input cs-time-input" data-field="time" data-row-id="${this._esc(row.rowId)}"
              aria-label="Hora linha ${realIndex + 1}"
              value="${this._esc(row.time || '')}"
              oninput="App.cardSheet.onCellInput('${this._esc(row.rowId)}', 'time', this.value)"
              onblur="App.cardSheet.onTimeBlur('${this._esc(row.rowId)}')"
              onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'time')"
              onpaste="App.cardSheet.onCellPaste(event, '${this._esc(row.rowId)}', 'time')">
          </td>
          <td class="cs-col-desc">
            <input type="text" class="cs-cell-input" list="cardSheetDescriptionsList" data-field="description" data-row-id="${this._esc(row.rowId)}"
              aria-label="Descrição linha ${realIndex + 1}"
              placeholder="Ex: Supermercado, iFood, Uber..."
              value="${this._esc(row.description || '')}"
              oninput="App.cardSheet.onCellInput('${this._esc(row.rowId)}', 'description', this.value)"
              onblur="App.cardSheet.onCellBlur('${this._esc(row.rowId)}')"
              onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'description')"
              onpaste="App.cardSheet.onCellPaste(event, '${this._esc(row.rowId)}', 'description')">
          </td>
          <td class="cs-col-cat">
            <input type="text" class="cs-cell-input" list="cardSheetCategoriesList" data-field="category" data-row-id="${this._esc(row.rowId)}"
              aria-label="Categoria linha ${realIndex + 1}"
              placeholder="Categoria"
              value="${this._esc(row.category || '')}"
              oninput="App.cardSheet.onCellInput('${this._esc(row.rowId)}', 'category', this.value)"
              onblur="App.cardSheet.onCellBlur('${this._esc(row.rowId)}')"
              onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'category')"
              onpaste="App.cardSheet.onCellPaste(event, '${this._esc(row.rowId)}', 'category')">
          </td>
          <td class="cs-col-class">
            <select class="cs-cell-select" data-field="classification" data-row-id="${this._esc(row.rowId)}"
              aria-label="Classificação linha ${realIndex + 1}"
              onchange="App.cardSheet.onCellInput('${this._esc(row.rowId)}', 'classification', this.value, true)"
              onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'classification')">
              <option value="" ${!row.classification ? 'selected' : ''}>—</option>
              <option value="essential" ${row.classification === 'essential' ? 'selected' : ''}>Essencial</option>
              <option value="necessary" ${row.classification === 'necessary' ? 'selected' : ''}>Necessário</option>
              <option value="superfluous" ${row.classification === 'superfluous' ? 'selected' : ''}>Supérfluo</option>
            </select>
          </td>
          <td class="cs-col-member">
            <div class="cs-member-wrap">
              <select class="cs-cell-select" data-field="member" data-row-id="${this._esc(row.rowId)}"
                aria-label="Membro linha ${realIndex + 1}"
                onchange="App.cardSheet.onMemberChange('${this._esc(row.rowId)}', this.value)"
                onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'member')">
                ${memberSelectHtml.replace(`value="${this._esc(currentMemberVal)}"`, `value="${this._esc(currentMemberVal)}" selected`)}
              </select>
              ${splitBtnHtml}
            </div>
          </td>
          <td class="cs-col-inst">
            <input type="number" min="1" max="48" step="1" class="cs-cell-input cs-num-input" data-field="installments" data-row-id="${this._esc(row.rowId)}"
              aria-label="Parcelas linha ${realIndex + 1}"
              title="${this._esc(instHint || 'Número de parcelas')}"
              value="${inst}"
              oninput="App.cardSheet.onCellInput('${this._esc(row.rowId)}', 'installments', this.value)"
              onblur="App.cardSheet.onCellBlur('${this._esc(row.rowId)}')"
              onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'installments')">
          </td>
          <td class="cs-col-amount">
            <div class="cs-amount-wrap">
              ${amtBadge}
              <input type="text" inputmode="decimal" class="cs-cell-input cs-amount-input ${amtClass}" data-field="amount" data-row-id="${this._esc(row.rowId)}"
                aria-label="Valor linha ${realIndex + 1}"
                placeholder="${this.convention === 'excel_signed' ? '-0,00' : '0,00'}"
                value="${this._esc(row.amount || '')}"
                oninput="App.cardSheet.onCellInput('${this._esc(row.rowId)}', 'amount', this.value)"
                onblur="App.cardSheet.onAmountBlur('${this._esc(row.rowId)}')"
                onkeydown="App.cardSheet.onCellKeyDown(event, '${this._esc(row.rowId)}', 'amount')"
                onpaste="App.cardSheet.onCellPaste(event, '${this._esc(row.rowId)}', 'amount')">
            </div>
          </td>
          <td class="cs-col-status">
            <div class="cs-status-cell">
              <div class="cs-status-pill-wrap">${statusHtml}</div>
              <div class="cs-row-actions">
                <button type="button" class="cs-icon-btn" onclick="App.cardSheet.duplicateRow('${this._esc(row.rowId)}')" aria-label="Duplicar linha ${realIndex + 1}" title="Duplicar linha">⧉</button>
                <button type="button" class="cs-icon-btn cs-icon-del" onclick="App.cardSheet.removeRow('${this._esc(row.rowId)}')" aria-label="Remover linha ${realIndex + 1}" title="Remover linha">✕</button>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  _updateRowVisual(rowId) {
    const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
    const rows = this._getRows();
    const row = rows.find(r => r.rowId === rowId);
    if (!tr || !row) {
      this._renderSummary();
      this._renderHeaderControls();
      return;
    }
    const engine = this._engine();
    const isBlank = engine.isRowBlank(row);
    tr.className = `cs-row cs-row-${isBlank ? 'blank' : row.syncState}`;

    const amtInfo = engine.resolveTxTypeAndAmount(row.amount, this.convention);
    const amtInput = tr.querySelector('input[data-field="amount"]');
    if (amtInput) {
      amtInput.classList.toggle('cs-amt-expense', amtInfo.valid && amtInfo.txType === 'expense');
      amtInput.classList.toggle('cs-amt-refund', amtInfo.valid && amtInfo.txType === 'refund');
    }
    const amtWrap = tr.querySelector('.cs-amount-wrap');
    if (amtWrap) {
      const oldTag = amtWrap.querySelector('.cs-type-tag');
      if (oldTag) oldTag.remove();
      if (amtInfo.valid) {
        const tag = document.createElement('span');
        tag.className = amtInfo.txType === 'expense' ? 'cs-type-tag cs-tag-exp' : 'cs-type-tag cs-tag-ref';
        tag.textContent = amtInfo.txType === 'expense' ? 'Desp' : 'Est';
        tag.title = amtInfo.txType === 'expense' ? 'Despesa' : 'Estorno / Crédito';
        amtWrap.prepend(tag);
      }
    }

    const statusWrap = tr.querySelector('.cs-status-pill-wrap');
    if (statusWrap) {
      if (isBlank) {
        statusWrap.innerHTML = '<span class="cs-status-badge cs-st-blank">Vazia</span>';
      } else if (row.syncState === 'synced') {
        const countTag = (row.syncedTxIds && row.syncedTxIds.length > 1) ? ` (${row.syncedTxIds.length}x)` : '';
        statusWrap.innerHTML = `<span class="cs-status-badge cs-st-synced" title="Sincronizado com o cartão">✓ Sincronizado${countTag}</span>`;
      } else if (row.syncState === 'duplicate') {
        statusWrap.innerHTML = `
          <span class="cs-status-badge cs-st-dup" title="${this._esc(row.syncMessage || 'Lançamento semelhante já existe no cartão')}">⚠ Duplicado</span>
          <button type="button" class="cs-mini-btn cs-mini-force" onclick="App.cardSheet.forceSyncRow('${this._esc(row.rowId)}')" title="Importar mesmo sendo semelhante">Forçar</button>
        `;
      } else if (row.syncState === 'error') {
        statusWrap.innerHTML = `<span class="cs-status-badge cs-st-error" title="${this._esc(row.syncMessage || 'Revise os campos da linha')}">✕ ${this._esc(row.syncMessage || 'Erro')}</span>`;
      } else {
        statusWrap.innerHTML = '<span class="cs-status-badge cs-st-pending" title="Aguardando sincronização">● Pendente</span>';
      }
    }

    this._renderSummary();
    this._renderHeaderControls();
  },

  onCardChange(cardId) {
    this.selectedCardId = cardId || null;
    this._savePersistedState();
    this.load();
  },

  toggleAutoSync(enabled) {
    this.autoSync = Boolean(enabled);
    this._savePersistedState();
    this._renderHeaderControls();
    if (this.autoSync) {
      this.syncAllPending({ silentIfEmpty: true });
    }
  },

  onConventionChange(conv) {
    if (conv !== 'excel_signed' && conv !== 'positive_expense') return;
    this.convention = conv;
    this._savePersistedState();
    this.render();
  },

  onFilterChange() {
    this.filterSearch = document.getElementById('cardSheetSearch')?.value || '';
    this.filterStatus = document.getElementById('cardSheetStatusFilter')?.value || 'all';
    this._renderGrid();
  },

  clearFilters() {
    this.filterSearch = '';
    this.filterStatus = 'all';
    const s = document.getElementById('cardSheetSearch');
    const f = document.getElementById('cardSheetStatusFilter');
    if (s) s.value = '';
    if (f) f.value = 'all';
    this._renderGrid();
  },

  onCellInput(rowId, field, value, immediateSync = false) {
    const rows = this._getRows();
    const row = rows.find(r => r.rowId === rowId);
    if (!row) return;

    const engine = this._engine();
    if (field === 'installments') {
      row.installments = engine.parseInstallments(value);
    } else if (field === 'classification') {
      row.classification = engine.normalizeClassification(value);
    } else {
      row[field] = value;
    }

    // Auto-fill today's date when user starts typing description or amount on a row without date
    if ((field === 'description' || field === 'amount') && !row.date && String(value || '').trim()) {
      row.date = App.utils?.todayISO?.() || new Date().toISOString().slice(0, 10);
      const dateInput = document.querySelector(`input[data-row-id="${rowId}"][data-field="date"]`);
      if (dateInput && !dateInput.value) dateInput.value = row.date;
    }

    // Auto-fill category default classification if classification is still empty
    if (field === 'category' && !row.classification && value) {
      const matchedCat = this._categories.find(c => c.name.toLowerCase() === String(value).trim().toLowerCase());
      if (matchedCat && matchedCat.classification) {
        row.classification = matchedCat.classification;
        const classSel = document.querySelector(`select[data-row-id="${rowId}"][data-field="classification"]`);
        if (classSel) classSel.value = row.classification;
      }
    }

    row.forceDuplicate = false;
    if (engine.isRowBlank(row)) {
      row.syncState = 'draft';
      row.syncMessage = '';
    } else {
      row.syncState = 'pending';
      row.syncMessage = '';
    }

    this._savePersistedState();
    this._updateRowVisual(rowId);

    if (this.autoSync) {
      if (immediateSync) {
        clearTimeout(this._syncTimers[rowId]);
        this.syncRow(rowId);
      } else {
        this._scheduleRowSync(rowId, 650);
      }
    }
  },

  onMemberChange(rowId, value) {
    const rows = this._getRows();
    const row = rows.find(r => r.rowId === rowId);
    if (!row) return;
    row.member = value;
    if (!this._engine().isSplitMemberLabel(value)) {
      row.memberSplits = null;
    }
    row.syncState = 'pending';
    row.syncMessage = '';
    this._savePersistedState();
    this.render();
    if (this.autoSync) {
      this._scheduleRowSync(rowId, 200);
    }
  },

  onTimeBlur(rowId) {
    const rows = this._getRows();
    const row = rows.find(r => r.rowId === rowId);
    if (!row) return;
    const raw = String(row.time || '').trim();
    if (raw) {
      let candidate = raw;
      if (/^\d{4}$/.test(raw)) candidate = `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
      const norm = this._engine().normalizeTimeCell(candidate);
      if (norm) {
        row.time = norm.slice(0, 5);
        const input = document.querySelector(`input[data-row-id="${rowId}"][data-field="time"]`);
        if (input) input.value = row.time;
        this._savePersistedState();
      }
    }
    this.onCellBlur(rowId);
  },

  onAmountBlur(rowId) {
    const rows = this._getRows();
    const row = rows.find(r => r.rowId === rowId);
    if (!row) return;
    const engine = this._engine();
    const parsed = engine.parseAmountBR(row.amount);
    if (Number.isFinite(parsed) && parsed !== 0) {
      row.amount = engine.formatAmountInput(parsed);
      const input = document.querySelector(`input[data-row-id="${rowId}"][data-field="amount"]`);
      if (input) input.value = row.amount;
      this._savePersistedState();
    }
    this.onCellBlur(rowId);
  },

  onCellBlur(rowId) {
    if (!this.autoSync) return;
    clearTimeout(this._syncTimers[rowId]);
    this.syncRow(rowId);
  },

  onCellKeyDown(event, rowId, field) {
    const fieldsOrder = ['date', 'time', 'description', 'category', 'classification', 'member', 'installments', 'amount'];
    const visible = this._getVisibleRows();
    const rowIdx = visible.findIndex(r => r.rowId === rowId);
    if (rowIdx === -1) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.autoSync) {
        clearTimeout(this._syncTimers[rowId]);
        this.syncRow(rowId);
      }
      if (rowIdx === visible.length - 1) {
        const newRow = this.addRows(1, false);
        setTimeout(() => this._focusCell(newRow.rowId, field === 'amount' ? 'description' : field), 20);
      } else {
        this._focusCell(visible[rowIdx + 1].rowId, field);
      }
      return;
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target.tagName !== 'SELECT') {
      const targetIdx = event.key === 'ArrowDown' ? rowIdx + 1 : rowIdx - 1;
      if (targetIdx >= 0 && targetIdx < visible.length) {
        event.preventDefault();
        this._focusCell(visible[targetIdx].rowId, field);
      }
      return;
    }

    if (event.key === 'Tab' && !event.shiftKey && field === fieldsOrder[fieldsOrder.length - 1] && rowIdx === visible.length - 1) {
      event.preventDefault();
      const newRow = this.addRows(1, false);
      setTimeout(() => this._focusCell(newRow.rowId, 'date'), 20);
    }
  },

  _focusCell(rowId, field) {
    const el = document.querySelector(`[data-row-id="${rowId}"][data-field="${field}"]`);
    if (el) {
      el.focus();
      if (typeof el.select === 'function' && el.type === 'text') el.select();
    }
  },

  onCellPaste(event, rowId, field) {
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    // Intercept multi-line or tabular paste (from Excel / Google Sheets)
    if (!text.includes('\t') && !text.includes('\n')) return;

    event.preventDefault();
    const engine = this._engine();
    const today = App.utils?.todayISO?.() || new Date().toISOString().slice(0, 10);
    const parsed = engine.parseClipboardTable(text, { defaultDate: today, convention: this.convention });
    if (!parsed.rows.length) return;

    const rows = this._getRows();
    const idx = rows.findIndex(r => r.rowId === rowId);
    const currentRow = rows[idx];

    if (idx !== -1 && engine.isRowBlank(currentRow)) {
      rows.splice(idx, 1, ...parsed.rows);
    } else if (idx !== -1) {
      rows.splice(idx + 1, 0, ...parsed.rows);
    } else {
      rows.push(...parsed.rows);
    }

    // Keep one blank row at bottom for continuous entry
    if (!engine.isRowBlank(rows[rows.length - 1])) {
      rows.push(engine.createEmptyRow({ date: '' }));
    }

    this._setRows(this.selectedCardId, rows);
    this.render();
    App.utils?.showToast?.(`${parsed.rows.length} linha(s) colada(s) na planilha!`);
    if (this.autoSync) {
      this.syncAllPending({ silentIfEmpty: true });
    }
  },

  _scheduleRowSync(rowId, delayMs = 600) {
    clearTimeout(this._syncTimers[rowId]);
    this._syncTimers[rowId] = setTimeout(() => {
      this.syncRow(rowId);
    }, delayMs);
  },

  syncRow(rowId, opts = {}) {
    const prev = this._rowSyncLocks[rowId] || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this._syncRowImpl(rowId, opts));
    this._rowSyncLocks[rowId] = next;
    next.finally(() => {
      if (this._rowSyncLocks[rowId] === next) {
        delete this._rowSyncLocks[rowId];
      }
    });
    return next;
  },

  async _syncRowImpl(rowId, { forceDuplicate = false, silent = false } = {}) {
    const card = this._cards.find(c => c.id === this.selectedCardId);
    if (!card) return false;
    const rows = this._getRows(card.id);
    const row = rows.find(r => r.rowId === rowId);
    if (!row) return false;

    const engine = this._engine();

    // If row became blank and had synced transactions, do not silently delete unless user clicked remove
    if (engine.isRowBlank(row)) {
      row.syncState = 'draft';
      row.syncMessage = '';
      this._savePersistedState();
      this._updateRowVisual(rowId);
      return false;
    }

    const fingerprint = engine.computeRowFingerprint(row, card.id, this.convention);
    if (!forceDuplicate && row.syncState === 'synced' && row.lastSyncedHash === fingerprint && row.syncedTxIds?.length > 0) {
      return true;
    }

    const built = engine.buildTransactionsFromRow(row, {
      card,
      members: this._members,
      accounts: this._accounts,
      convention: this.convention,
      generateId: () => App.utils.generateId()
    });

    if (!built.ok) {
      // Only show error state if user already entered amount or description + left field
      const hasDesc = Boolean(String(row.description || '').trim());
      const hasAmt = Boolean(String(row.amount || '').trim());
      if (hasDesc && hasAmt) {
        row.syncState = 'error';
        row.syncMessage = built.error;
      } else {
        row.syncState = 'pending';
        row.syncMessage = built.error;
      }
      this._savePersistedState();
      this._updateRowVisual(rowId);
      return false;
    }

    // Check duplicates against unlinked transactions unless forced
    const existingAll = await App.db.getAll('transactions');
    if (!forceDuplicate && !row.forceDuplicate) {
      const dups = engine.findDuplicateTransactions(built.transactions, existingAll, row.syncedTxIds || []);
      if (dups.length > 0) {
        row.syncState = 'duplicate';
        row.syncMessage = 'Já existe lançamento igual neste cartão';
        this._savePersistedState();
        this._updateRowVisual(rowId);
        return false;
      }
    }

    try {
      this._isSyncing = true;
      this._renderHeaderControls();

      // Ensure category exists in App.db
      const catName = built.transactions[0]?.category || 'Outros';
      if (App.utils && typeof App.utils.ensureCategory === 'function') {
        await App.utils.ensureCategory(catName);
      }

      // Delete obsolete transactions if installment count changed
      const newIdSet = new Set(built.transactions.map(t => t.id));
      const oldIds = Array.isArray(row.syncedTxIds) ? row.syncedTxIds : [];
      for (const oldId of oldIds) {
        if (!newIdSet.has(oldId)) {
          await App.db.delete('transactions', oldId);
        }
      }

      await App.db.putMany('transactions', built.transactions);

      row.syncedTxIds = built.transactions.map(t => t.id);
      row.syncState = 'synced';
      row.syncMessage = built.transactions.length > 1
        ? `Sincronizado (${built.transactions.length}x)`
        : 'Sincronizado';
      row.forceDuplicate = Boolean(forceDuplicate || row.forceDuplicate);
      row.lastSyncedHash = fingerprint;

      // Update autocomplete memory
      if (row.description && !this._recentDescriptions.includes(row.description.trim())) {
        this._recentDescriptions.unshift(row.description.trim());
        this._renderDatalists();
      }

      this._savePersistedState();
      this._refreshAppViews();
      this._updateRowVisual(rowId);

      if (!silent) {
        // Subtle status update without spamming toasts on every keystroke
      }
      return true;
    } catch (err) {
      console.error('Erro ao sincronizar linha da planilha:', err);
      row.syncState = 'error';
      row.syncMessage = 'Falha ao salvar no banco';
      this._savePersistedState();
      this._updateRowVisual(rowId);
      return false;
    } finally {
      this._isSyncing = false;
      this._renderHeaderControls();
    }
  },

  async forceSyncRow(rowId) {
    const ok = await this.syncRow(rowId, { forceDuplicate: true });
    if (ok) {
      App.utils?.showToast?.('Lançamento sincronizado no cartão!');
    }
  },

  async syncAllPending({ silentIfEmpty = false } = {}) {
    const card = this._cards.find(c => c.id === this.selectedCardId);
    if (!card) return;
    const rows = this._getRows(card.id);
    const engine = this._engine();
    const targets = rows.filter(r => !engine.isRowBlank(r) && r.syncState !== 'synced');

    if (targets.length === 0) {
      if (!silentIfEmpty) App.utils?.showToast?.('Todas as linhas preenchidas já estão sincronizadas.');
      return;
    }

    let okCount = 0;
    let warnCount = 0;
    for (const row of targets) {
      const ok = await this.syncRow(row.rowId, { silent: true });
      if (ok) okCount++;
      else warnCount++;
    }

    this.render();
    if (okCount > 0 && warnCount === 0) {
      App.utils?.showToast?.(`${okCount} lançamento(s) sincronizado(s) com ${card.name}!`);
    } else if (okCount > 0 && warnCount > 0) {
      App.utils?.showToast?.(`${okCount} sincronizado(s), ${warnCount} precisa(m) de revisão.`, 'warning');
    } else if (!silentIfEmpty && warnCount > 0) {
      App.utils?.showToast?.(`${warnCount} linha(s) com pendência ou duplicidade.`, 'warning');
    }
  },

  _refreshAppViews() {
    try {
      App.cache.creditCards = null;
      if (App.transactions && App.transactions.invalidateCache) App.transactions.invalidateCache();
      if (App.creditCards && App.creditCards.load) App.creditCards.load();
      if (App.cardInvoice && App.cardInvoice.currentCardId === this.selectedCardId && App.ui?._currentPage === 'card-invoice') {
        App.cardInvoice.load();
      }
      if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
      if (App.panel && App.panel.refresh) App.panel.refresh();
      if (App.saldos && App.saldos.load) App.saldos.load();
    } catch (e) {}
  },

  addRows(count = 1, focusFirst = true) {
    if (!this.selectedCardId) return null;
    const engine = this._engine();
    const rows = this._getRows();
    const today = App.utils?.todayISO?.() || new Date().toISOString().slice(0, 10);
    let firstAdded = null;
    for (let i = 0; i < count; i++) {
      const newRow = engine.createEmptyRow({ date: i === 0 ? today : '' });
      if (!firstAdded) firstAdded = newRow;
      rows.push(newRow);
    }
    this._setRows(this.selectedCardId, rows);
    this.render();
    if (focusFirst && firstAdded) {
      setTimeout(() => this._focusCell(firstAdded.rowId, 'description'), 20);
    }
    return firstAdded;
  },

  duplicateRow(rowId) {
    const rows = this._getRows();
    const idx = rows.findIndex(r => r.rowId === rowId);
    if (idx === -1) return;
    const src = rows[idx];
    const copy = this._engine().createEmptyRow({
      date: src.date,
      time: src.time,
      description: src.description,
      category: src.category,
      classification: src.classification,
      member: src.member,
      installments: src.installments,
      amount: src.amount,
      memberSplits: src.memberSplits ? src.memberSplits.map(s => ({ ...s })) : null,
      syncState: 'pending'
    });
    rows.splice(idx + 1, 0, copy);
    this._setRows(this.selectedCardId, rows);
    this.render();
    setTimeout(() => this._focusCell(copy.rowId, 'description'), 20);
  },

  removeRow(rowId) {
    const rows = this._getRows();
    const idx = rows.findIndex(r => r.rowId === rowId);
    if (idx === -1) return;
    const row = rows[idx];

    const doRemove = async () => {
      clearTimeout(this._syncTimers[rowId]);
      if (Array.isArray(row.syncedTxIds) && row.syncedTxIds.length > 0) {
        for (const txId of row.syncedTxIds) {
          try {
            await App.db.delete('transactions', txId);
          } catch (e) {}
        }
        this._refreshAppViews();
      }
      rows.splice(idx, 1);
      if (rows.length === 0) {
        rows.push(this._engine().createEmptyRow({ date: App.utils?.todayISO?.() || '' }));
      }
      this._setRows(this.selectedCardId, rows);
      this.render();
      App.utils?.showToast?.(
        row.syncedTxIds?.length ? 'Linha e lançamento sincronizado removidos.' : 'Linha removida.'
      );
    };

    if (Array.isArray(row.syncedTxIds) && row.syncedTxIds.length > 0) {
      App.utils.confirm(
        `A linha "${row.description || 'sem descrição'}" já está sincronizada com a fatura do cartão. Deseja remover também o(s) ${row.syncedTxIds.length} lançamento(s) do cartão?`,
        doRemove
      );
    } else {
      doRemove();
    }
  },

  clearBlankRows() {
    const engine = this._engine();
    const rows = this._getRows().filter(r => !engine.isRowBlank(r));
    if (rows.length === 0) {
      rows.push(engine.createEmptyRow({ date: App.utils?.todayISO?.() || '' }));
    }
    this._setRows(this.selectedCardId, rows);
    this.render();
  },

  openCurrentCardInvoice() {
    if (!this.selectedCardId) return;
    App.cardInvoice.open(this.selectedCardId);
  },

  async loadFromCurrentInvoice() {
    const card = this._cards.find(c => c.id === this.selectedCardId);
    if (!card) return;
    const period = App.cardInvoice.getCurrentInvoicePeriod(card);
    const txInRange = await App.db.getTransactionsInRange(period.start, period.end);
    const cardTx = txInRange.filter(t =>
      t.credit_card_id === card.id &&
      (t.type === 'expense' || t.type === 'refund') &&
      t.category !== 'Pagamento Fatura'
    );

    if (cardTx.length === 0) {
      App.utils?.showToast?.('Nenhum lançamento encontrado na fatura atual deste cartão.', 'warning');
      return;
    }

    // Fetch all transactions to assemble complete installment series
    const allTx = await App.db.getAll('transactions');
    const instGroupIds = new Set(cardTx.map(t => t.installment_id).filter(Boolean));
    const sheetRowIds = new Set(cardTx.map(t => t.sheet_row_id).filter(Boolean));
    const expanded = allTx.filter(t =>
      t.credit_card_id === card.id && (
        cardTx.some(c => c.id === t.id) ||
        (t.installment_id && instGroupIds.has(t.installment_id)) ||
        (t.sheet_row_id && sheetRowIds.has(t.sheet_row_id))
      )
    );

    const engine = this._engine();
    const importedRows = engine.convertTransactionsToSheetRows(expanded, { convention: this.convention });
    const existingRows = this._getRows(card.id).filter(r => !engine.isRowBlank(r));
    const existingTxIds = new Set(existingRows.flatMap(r => r.syncedTxIds || []));

    let added = 0;
    for (const r of importedRows) {
      const alreadyLoaded = r.syncedTxIds.some(id => existingTxIds.has(id));
      if (!alreadyLoaded) {
        r.lastSyncedHash = engine.computeRowFingerprint(r, card.id, this.convention);
        existingRows.push(r);
        added++;
      }
    }

    if (existingRows.length === 0 || !engine.isRowBlank(existingRows[existingRows.length - 1])) {
      existingRows.push(engine.createEmptyRow({ date: '' }));
    }

    this._setRows(card.id, existingRows);
    this.render();
    App.utils?.showToast?.(
      added > 0
        ? `${added} lançamento(s) da fatura atual carregado(s) na planilha!`
        : 'Todos os lançamentos da fatura atual já estão na planilha.'
    );
  },

  handleFileInput(event) {
    const file = event.target?.files?.[0];
    if (file) {
      this._importLocalFile(file);
    }
    if (event.target) event.target.value = '';
  },

  async _importLocalFile(file) {
    try {
      const buf = await file.arrayBuffer();
      await this._loadWorkbookBuffer(new Uint8Array(buf), file.name || 'testecartao.xlsx');
    } catch (err) {
      console.error('Erro ao ler planilha XLSX:', err);
      App.utils?.showToast?.('Não foi possível ler o arquivo selecionado.', 'error');
    }
  },

  async _loadWorkbookBuffer(uint8Data, fileName) {
    if (!window.XLSX) {
      App.utils?.showToast?.('Biblioteca XLSX indisponível no navegador.', 'error');
      return;
    }
    const workbook = XLSX.read(uint8Data, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    const engine = this._engine();
    const today = App.utils?.todayISO?.() || new Date().toISOString().slice(0, 10);
    const parsed = engine.parseWorkbookMatrix(matrix, { defaultDate: today, convention: this.convention });

    if (!parsed.rows.length) {
      App.utils?.showToast?.('Nenhuma linha de lançamento encontrada na planilha.', 'warning');
      return;
    }

    this.fileName = fileName || 'testecartao.xlsx';
    const current = this._getRows(this.selectedCardId).filter(r => !engine.isRowBlank(r));
    const merged = current.concat(parsed.rows);
    merged.push(engine.createEmptyRow({ date: '' }));

    this._setRows(this.selectedCardId, merged);
    this.render();
    App.utils?.showToast?.(`${parsed.rows.length} linha(s) carregada(s) de "${this.fileName}"!`);

    if (this.autoSync) {
      await this.syncAllPending({ silentIfEmpty: true });
    }
  },

  openGithubModal() {
    const input = document.getElementById('cardSheetGithubUrlInput');
    const errEl = document.getElementById('cardSheetGithubError');
    if (input) input.value = this.githubUrl || '';
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
    App.ui.openModal('modalCardSheetGithub');
    setTimeout(() => input && input.focus(), 50);
  },

  async fetchFromGithub() {
    const input = document.getElementById('cardSheetGithubUrlInput');
    const errEl = document.getElementById('cardSheetGithubError');
    const btn = document.getElementById('cardSheetGithubFetchBtn');
    const url = (input?.value || '').trim();

    const engine = this._engine();
    const checked = engine.resolveGithubRawUrl(url);
    if (!checked.ok) {
      if (errEl) {
        errEl.textContent = checked.error;
        errEl.style.display = 'block';
      }
      return;
    }

    if (errEl) errEl.style.display = 'none';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Carregando...';
    }

    try {
      const resp = await fetch(`/api/github/fetch-xlsx?url=${encodeURIComponent(url)}`);
      if (!resp.ok) {
        let msg = `Falha ao baixar arquivo (HTTP ${resp.status}).`;
        try {
          const j = await resp.json();
          if (j?.error) msg = j.error;
        } catch (e) {}
        if (errEl) {
          errEl.textContent = msg;
          errEl.style.display = 'block';
        }
        return;
      }

      const buf = await resp.arrayBuffer();
      const resolvedName = decodeURIComponent(resp.headers.get('X-Resolved-Filename') || 'testecartao.xlsx');
      this.githubUrl = url;
      this._savePersistedState();
      App.ui.closeModal('modalCardSheetGithub');
      await this._loadWorkbookBuffer(new Uint8Array(buf), resolvedName);
    } catch (err) {
      if (errEl) {
        errEl.textContent = 'Erro de rede ao consultar o GitHub.';
        errEl.style.display = 'block';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Importar e Sincronizar';
      }
    }
  },

  exportXLSX() {
    if (!window.XLSX) {
      App.utils?.showToast?.('Biblioteca XLSX indisponível.', 'error');
      return;
    }
    const engine = this._engine();
    const rows = this._getRows();
    const matrix = engine.buildExportMatrix(rows, { convention: this.convention });

    if (matrix.length <= 1) {
      // Export clean template with example header ready for filling
      matrix.push([
        App.utils?.formatDate?.(App.utils.todayISO()) || '20/11/2026',
        '12:00',
        'Exemplo de compra no cartão',
        'Mercado Básico Mensal',
        'Essencial',
        this._members[0]?.name || '',
        1,
        -100.0
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(matrix);
    ws['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 34 }, { wch: 24 },
      { wch: 15 }, { wch: 18 }, { wch: 10 }, { wch: 14 }
    ];

    // Style header row
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) {
        ws[addr].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1F2937' } },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cartao');
    const outName = (this.fileName && this.fileName.endsWith('.xlsx')) ? this.fileName : 'testecartao.xlsx';
    XLSX.writeFile(wb, outName);
    App.utils?.showToast?.(`Planilha "${outName}" exportada!`);
  },

  openSplitModal(rowId) {
    const rows = this._getRows();
    const row = rows.find(r => r.rowId === rowId);
    if (!row) return;
    if (this._members.length === 0) {
      App.utils?.showToast?.('Cadastre membros primeiro na aba Membros.', 'warning');
      return;
    }

    const engine = this._engine();
    const amtInfo = engine.resolveTxTypeAndAmount(row.amount, this.convention);
    const total = amtInfo.valid ? amtInfo.amount : 0;
    this._splitRowId = rowId;

    const titleEl = document.getElementById('cardSheetSplitTitle');
    const totalEl = document.getElementById('cardSheetSplitTotal');
    const container = document.getElementById('cardSheetSplitEntries');
    const errEl = document.getElementById('cardSheetSplitError');

    if (titleEl) titleEl.textContent = row.description || 'Compra dividida';
    if (totalEl) totalEl.textContent = App.utils.formatCurrency(total);
    if (errEl) errEl.style.display = 'none';

    const currentSplits = Array.isArray(row.memberSplits) && row.memberSplits.length
      ? row.memberSplits
      : engine.buildEqualSplits(total, this._members);

    const mapVal = Object.fromEntries(currentSplits.map(s => [s.member_id, s.amount]));
    if (container) {
      container.innerHTML = this._members.map(m => `
        <div class="cs-split-item">
          <label for="csSplit_${this._esc(m.id)}">${this._esc(m.name)}</label>
          <input type="number" step="0.01" min="0" id="csSplit_${this._esc(m.id)}"
            class="cs-split-input" data-member-id="${this._esc(m.id)}"
            value="${Number(mapVal[m.id] || 0).toFixed(2)}"
            oninput="App.cardSheet.validateSplitSum()">
        </div>
      `).join('');
    }

    App.ui.openModal('modalCardSheetSplit');
    this.validateSplitSum();
  },

  distributeSplitEqually() {
    const row = this._getRows().find(r => r.rowId === this._splitRowId);
    if (!row) return;
    const engine = this._engine();
    const amtInfo = engine.resolveTxTypeAndAmount(row.amount, this.convention);
    const total = amtInfo.valid ? amtInfo.amount : 0;
    const equal = engine.buildEqualSplits(total, this._members);
    equal.forEach(s => {
      const inp = document.querySelector(`.cs-split-input[data-member-id="${s.member_id}"]`);
      if (inp) inp.value = Number(s.amount).toFixed(2);
    });
    this.validateSplitSum();
  },

  validateSplitSum() {
    const row = this._getRows().find(r => r.rowId === this._splitRowId);
    const errEl = document.getElementById('cardSheetSplitError');
    if (!row || !errEl) return true;
    const amtInfo = this._engine().resolveTxTypeAndAmount(row.amount, this.convention);
    const total = amtInfo.valid ? amtInfo.amount : 0;
    let sum = 0;
    document.querySelectorAll('.cs-split-input').forEach(inp => {
      sum += parseFloat(inp.value) || 0;
    });
    sum = Math.round(sum * 100) / 100;
    if (total > 0 && Math.abs(sum - total) > 0.01) {
      errEl.textContent = `A soma (${App.utils.formatCurrency(sum)}) difere do total (${App.utils.formatCurrency(total)}).`;
      errEl.style.display = 'block';
      return false;
    }
    errEl.style.display = 'none';
    return true;
  },

  async saveSplitModal() {
    if (!this.validateSplitSum()) return;
    const row = this._getRows().find(r => r.rowId === this._splitRowId);
    if (!row) return;
    const splits = [];
    document.querySelectorAll('.cs-split-input').forEach(inp => {
      const member_id = inp.getAttribute('data-member-id');
      const amount = Math.round((parseFloat(inp.value) || 0) * 100) / 100;
      if (member_id && amount > 0) splits.push({ member_id, amount });
    });
    if (!splits.length) {
      App.utils?.showToast?.('Informe ao menos um membro com valor maior que zero.', 'error');
      return;
    }
    row.memberSplits = splits;
    row.syncState = 'pending';
    this._savePersistedState();
    App.ui.closeModal('modalCardSheetSplit');
    this._splitRowId = null;
    if (this.autoSync) {
      await this.syncRow(row.rowId);
    } else {
      this.render();
    }
    App.utils?.showToast?.('Divisão entre membros atualizada!');
  }
};
