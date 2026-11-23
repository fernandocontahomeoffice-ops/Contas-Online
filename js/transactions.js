// =====================================================================
// ARQUIVO: transactions.js
// Transações: listagem, filtros, split, saldos, detalhes
// =====================================================================
var App = window.App || {};

// =======================================================================
// Transações (otimizado com cache, split automático do casal e saldo real)
// =======================================================================
App.transactions = {
  currentMonthStart: null,
  useCycle: false,
  _pendingDeleteId: null,
  _pendingEditId: null,
  _pendingEditScope: null,
  currentSubFilter: '',
  currentTab: 'all',
  _pendingClassifyId: null,
  bulkMode: false,
  bulkAllSelected: false,
  sortCol: 'date',
  sortAsc: false,
  currentPage: 1,
  pageSize: 50,
  totalResults: 0,
  _cacheKey: null,
  _cachedTotal: null,
  manualOrder: false,
  _searchTimer: null,
  _runningBalanceMap: null,
  _activeAccountObj: null,
  _bankImportRaw: null,
  _bankImportFileName: '',
  _bankImportParsed: null,
  _lastPageTxMap: {},
  _keyboardBound: false,

  _bindKeyboardShortcuts() {
    if (this._keyboardBound) return;
    this._keyboardBound = true;
    document.addEventListener('keydown', (e) => {
      const page = App.ui?.getCurrentPage?.();
      if (page !== 'transactions') return;
      if (document.querySelector('.modal-overlay.active')) return;
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;

      if (e.key === '/') {
        e.preventDefault();
        const searchEl = document.getElementById('searchTransactions');
        if (searchEl) { searchEl.focus(); searchEl.select(); }
      } else if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        App.ui.openTransactionModal();
      }
    });
  },

  onSearchInput() {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.currentPage = 1;
      this.invalidateCache();
      this.load();
    }, 220);
  },

  onFilterChange() {
    this.currentPage = 1;
    this.invalidateCache();
    this.load();
  },

  async load() {
    try {
      this._bindKeyboardShortcuts();
      this.showLoadingOverlay();
      if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
      const preset = document.getElementById('periodPreset')?.value || '';
      let cycle;
      if (preset === 'all' || preset === 'future') {
        if (preset === 'future') cycle = { start: App.utils.todayISO(), end: '2099-12-31' };
        else cycle = { start: '2000-01-01', end: '2099-12-31' };
      } else if (preset.startsWith('past')) {
        const months = parseInt(preset.replace('past',''), 10);
        cycle = { start: App.utils.addMonths(App.utils.todayISO(), -months), end: App.utils.todayISO() };
      } else {
        cycle = this.useCycle ? App.utils.cycleFromDate(this.currentMonthStart) : App.utils.monthRangeFromDate(this.currentMonthStart);
      }
      const cycleLabel = this.useCycle ? `Ciclo ${cycle.label}` : (cycle.refMonth || 'Período');
      const txCycleLabelEl = document.getElementById('txCycleLabel');
      if (txCycleLabelEl) txCycleLabelEl.textContent = `Período: ${cycleLabel}`;
      this.currentCycle = cycle;
      const monthInput = document.getElementById('txMonthPicker');
      if (monthInput) { const d = new Date(this.currentMonthStart + 'T12:00:00'); monthInput.value = d.toISOString().slice(0, 7); }

      let type = document.getElementById('filterType')?.value || 'all';
      const activeTab = this.currentTab || 'all';

      if (activeTab === 'income' || activeTab === 'expense' || activeTab === 'transfer') {
        type = activeTab;
        const ft = document.getElementById('filterType');
        if (ft) ft.value = type;
      } else if (activeTab === 'all') {
        type = document.getElementById('filterType')?.value || 'all';
      } else {
        type = 'all';
      }

      const acc = document.getElementById('filterAccount')?.value || 'all';
      const catFilter = document.getElementById('filterCategory')?.value || 'all';
      const cc = document.getElementById('filterCreditCard')?.value || 'all';
      const tag = document.getElementById('filterTag')?.value || 'all';
      const search = (document.getElementById('searchTransactions')?.value || '').trim().toLowerCase();
      const groupByCard = document.getElementById('groupByCreditCard')?.value || 'false';
      const sortOrder = document.getElementById('sortOrder')?.value || 'desc';
      const statusFilter = document.getElementById('filterStatus')?.value || 'all';
      const reconciledFilter = document.getElementById('filterReconciled')?.value || 'all';
      const localMemberFilter = document.getElementById('filterTxMember')?.value || 'all';
      const minValRaw = document.getElementById('filterMinVal')?.value || '';
      const maxValRaw = document.getElementById('filterMaxVal')?.value || '';
      const minVal = minValRaw !== '' ? parseFloat(minValRaw) : null;
      const maxVal = maxValRaw !== '' ? parseFloat(maxValRaw) : null;
      const receiptFilter = document.getElementById('filterReceipt')?.value || 'all';

      const effectiveMemberId = (localMemberFilter !== 'all') ? localMemberFilter : (App.state.globalMemberFilter || null);

      this.manualOrder = (sortOrder === 'manual');
      this.sortAsc = sortOrder === 'asc';

      // Atualiza badge de filtros avançados ativos
      const advCount = [
        localMemberFilter !== 'all',
        minVal !== null && !isNaN(minVal),
        maxVal !== null && !isNaN(maxVal),
        receiptFilter !== 'all',
        tag !== 'all',
        sortOrder !== 'desc'
      ].filter(Boolean).length;
      const advBtn = document.getElementById('advancedFiltersBtn');
      if (advBtn) advBtn.textContent = advCount > 0 ? `≡ Filtros (${advCount})` : '≡ Filtros';

      // Popula selects de filtro (Contas, Categorias, Cartões, Membros)
      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      if (!App.cache.accounts) App.cache.accounts = accounts;
      const accSel = document.getElementById('filterAccount');
      if (accSel && accSel.options.length <= 1) {
        accSel.innerHTML = '<option value="all">Todas contas</option>' + accounts.filter(a => !a.archived).map(a => `<option value="${App.math.escapeHtml(a.id)}">${App.math.escapeHtml(a.name)}</option>`).join('');
        accSel.value = acc;
      }
      const catSel = document.getElementById('filterCategory');
      if (catSel && catSel.options.length <= 1) {
        const cats = App.cache.categories || await App.db.getAll('categories');
        if (!App.cache.categories) App.cache.categories = cats;
        const uniqueCats = [...new Set(cats.filter(c => !c.archived).map(c => c.name))].sort((a, b) => a.localeCompare(b));
        catSel.innerHTML = '<option value="all">Todas categorias</option>' + uniqueCats.map(c => `<option value="${App.math.escapeHtml(c)}">${App.math.escapeHtml(c)}</option>`).join('');
        catSel.value = catFilter;
      }
      const ccSel = document.getElementById('filterCreditCard');
      if (ccSel && ccSel.options.length <= 1) {
        const cards = App.cache.creditCards || await App.db.getAll('creditCards');
        if (!App.cache.creditCards) App.cache.creditCards = cards;
        ccSel.innerHTML = '<option value="all">Todos cartões</option>' + cards.map(c => `<option value="${App.math.escapeHtml(c.id)}">${App.math.escapeHtml(c.name)}</option>`).join('');
        ccSel.value = cc;
      }
      const memSel = document.getElementById('filterTxMember');
      if (memSel && memSel.options.length <= 1) {
        const members = App.cache.members || await App.db.getAll('members');
        if (!App.cache.members) App.cache.members = members;
        memSel.innerHTML = '<option value="all">Todos membros</option>' + members.map(m => `<option value="${App.math.escapeHtml(m.id)}">${App.math.escapeHtml(m.name)}</option>`).join('');
        memSel.value = localMemberFilter;
      }

      // Saldo Acumulado (Running Balance) e Banner de Conciliação quando uma conta específica está selecionada
      this._activeAccountObj = acc !== 'all' ? (accounts.find(a => a.id === acc) || null) : null;
      this._runningBalanceMap = null;
      const runBalHeader = document.getElementById('txRunningBalHeader');
      if (runBalHeader) runBalHeader.style.display = this._activeAccountObj ? '' : 'none';

      if (this._activeAccountObj && window.App.ledgerEngine) {
        const allAccountTx = await App.db.getAll('transactions');
        this._runningBalanceMap = App.ledgerEngine.computeRunningBalances(this._activeAccountObj, allAccountTx, { includePending: false });
        await this.renderAccountReconcileBanner(this._activeAccountObj, allAccountTx);
      } else {
        const recBanner = document.getElementById('txAccountReconcileBar');
        if (recBanner) recBanner.style.display = 'none';
      }

      const cacheKey = [
        cycle.start, cycle.end,
        type, acc, catFilter, cc, tag, search,
        statusFilter, reconciledFilter, localMemberFilter,
        minValRaw, maxValRaw, receiptFilter,
        this.currentSubFilter,
        this.sortCol, this.sortAsc,
        this.useCycle,
        effectiveMemberId || '',
        activeTab
      ].join('|');

      const applyTabFilter = (list) => {
        if (activeTab === 'all') return list;
        if (activeTab === 'income') return list.filter(t => t.type === 'income');
        if (activeTab === 'expense') return list.filter(t => t.type === 'expense');
        if (activeTab === 'transfer') return list.filter(t => t.type === 'transfer');
        if (activeTab === 'recurring') return list.filter(t => t.is_recurring_series === true || t.expense_type === 'fixed' || t.recurring === true);
        if (activeTab === 'investment') return list.filter(t =>
          t.type === 'contribution' ||
          t.type === 'withdrawal' ||
          (t.type === 'transfer' && (t.transfer_subtype === 'aporte' || t.transfer_subtype === 'resgate'))
        );
        return list;
      };

      const hasExtraFilter = (
        activeTab === 'investment' || activeTab === 'recurring' ||
        groupByCard === 'invoice' || Boolean(search) ||
        tag === 'ferias' || Boolean(this.currentSubFilter) ||
        statusFilter !== 'all' || catFilter !== 'all' ||
        reconciledFilter !== 'all' ||
        (minVal !== null && !isNaN(minVal)) ||
        (maxVal !== null && !isNaN(maxVal)) ||
        receiptFilter !== 'all'
      );

      let tx = [];
      if (hasExtraFilter) {
        let searchStart = cycle.start;
        let searchEnd = cycle.end;
        // CORREÇÃO: preset 'all' agora busca todo o histórico real (sem truncar em 12 meses!)
        if (preset === 'all') {
          searchStart = '2000-01-01';
          searchEnd = '2099-12-31';
        } else if (preset === 'future') {
          searchStart = App.utils.todayISO();
          searchEnd = '2099-12-31';
        } else if (preset.startsWith('past')) {
          const months = parseInt(preset.replace('past', ''), 10);
          searchStart = App.utils.addMonths(App.utils.todayISO(), -months);
          searchEnd = App.utils.todayISO();
        }

        let invoiceScopeApplied = false;
        if (groupByCard === 'invoice' && preset === '') {
          searchStart = App.utils.addMonths(cycle.start, -3);
          searchEnd = App.utils.addMonths(cycle.end, 3);
          invoiceScopeApplied = true;
        }

        tx = await App.db.getTransactionsInRange(searchStart, searchEnd, { memberId: effectiveMemberId });

        if (invoiceScopeApplied) {
          const scopeStart = cycle.start.slice(0, 10);
          const scopeEnd = cycle.end.slice(0, 10);
          const scopedCards = App.cache.creditCards || await App.db.getAll('creditCards');
          if (!App.cache.creditCards) App.cache.creditCards = scopedCards;
          const scopedCardMap = Object.fromEntries(scopedCards.map(c => [c.id, c]));
          tx = tx.filter(t => {
            const dateOnly = (t.date || '').slice(0, 10);
            if (!t.credit_card_id || (t.type !== 'expense' && t.type !== 'refund')) {
              return dateOnly >= scopeStart && dateOnly <= scopeEnd;
            }
            const card = scopedCardMap[t.credit_card_id];
            if (!card) return false;
            try {
              const period = App.cardInvoice.getInvoicePeriodForDate(card, dateOnly);
              const dueOnly = period.due.slice(0, 10);
              return dueOnly >= scopeStart && dueOnly <= scopeEnd;
            } catch (e) {
              return dateOnly >= scopeStart && dateOnly <= scopeEnd;
            }
          });
        }

        if (type !== 'all') tx = tx.filter(t => t.type === type);
        if (acc !== 'all') tx = tx.filter(t => t.account_id === acc || t.account_to_id === acc);
        if (catFilter !== 'all') tx = tx.filter(t => (t.category || '') === catFilter);
        if (cc !== 'all') tx = tx.filter(t => t.credit_card_id === cc);
        if (tag === 'ferias') tx = tx.filter(t => t.vacation);
        if (statusFilter !== 'all') tx = tx.filter(t => (t.status || 'confirmed') === statusFilter);
        if (reconciledFilter === 'reconciled') tx = tx.filter(t => Boolean(t.reconciled));
        if (reconciledFilter === 'unreconciled') tx = tx.filter(t => !t.reconciled);
        if (minVal !== null && !isNaN(minVal)) tx = tx.filter(t => (parseFloat(t.amount) || 0) >= minVal);
        if (maxVal !== null && !isNaN(maxVal)) tx = tx.filter(t => (parseFloat(t.amount) || 0) <= maxVal);
        if (receiptFilter === 'with') tx = tx.filter(t => Boolean(t.receipt_url));
        if (receiptFilter === 'without') tx = tx.filter(t => !t.receipt_url);
        if (this.currentSubFilter === 'vista') tx = tx.filter(t => !t.installments || t.installments <= 1);
        if (this.currentSubFilter === 'parcelado') tx = tx.filter(t => t.installments > 1);

        if (search) {
          tx = tx.filter(t => {
            const fields = [t.description, t.category, t.account_name, t.account_to_name, t.member_name, t.notes, t.payment_method].map(f => (f || '').toLowerCase());
            return fields.some(f => f.includes(search));
          });
        }

        tx = applyTabFilter(tx);

        tx.sort((a, b) => (this.sortAsc ? (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || '')));
        if (this.sortCol !== 'date') {
          tx.sort((a, b) => this.compareBySortCol(a, b));
        }

        this.totalResults = tx.length;
        if (cacheKey !== this._cacheKey || this._cachedTotal === null) {
          this._cacheKey = cacheKey;
          this._cachedTotal = this.totalResults;
        }

        if (this.manualOrder) {
          tx.sort((a, b) => (a.position || 0) - (b.position || 0));
        }

        const startIdx = (this.currentPage - 1) * this.pageSize;
        const pageData = tx.slice(startIdx, startIdx + this.pageSize);
        this._lastPageTxMap = Object.fromEntries(pageData.map(item => [item.id, item]));
        this.renderPage(pageData, groupByCard);

      } else {
        const skipCount = (cacheKey === this._cacheKey && this._cachedTotal !== null);
        const result = await App.db.getTransactionsFiltered({
          startDate: cycle.start,
          endDate: cycle.end,
          type: type !== 'all' ? type : null,
          accountId: acc !== 'all' ? acc : null,
          creditCardId: cc !== 'all' ? cc : null,
          memberId: effectiveMemberId,
          status: statusFilter !== 'all' ? statusFilter : null,
          sortBy: this.sortCol,
          sortAsc: this.sortAsc,
          limit: this.pageSize,
          offset: (this.currentPage - 1) * this.pageSize,
          skipCount: skipCount,
          preCount: skipCount ? this._cachedTotal : null
        });

        tx = result.data;
        this.totalResults = result.total;

        if (!skipCount) {
          this._cacheKey = cacheKey;
          this._cachedTotal = result.total;
        }

        if (this.manualOrder) {
          tx.sort((a, b) => (a.position || 0) - (b.position || 0));
        }

        this._lastPageTxMap = Object.fromEntries(tx.map(item => [item.id, item]));
        this.renderPage(tx, groupByCard);
      }

      document.querySelectorAll('.bulk-col').forEach(c => c.style.display = this.bulkMode ? '' : 'none');
      const bulkBar = document.getElementById('bulkActionsBar');
      if (bulkBar) bulkBar.style.display = this.bulkMode ? 'block' : 'none';
      const bulkSelectAllCheckbox = document.getElementById('bulkSelectAll');
      if (bulkSelectAllCheckbox) bulkSelectAllCheckbox.checked = this.bulkAllSelected;
      const bulkSelectAllBtn = document.getElementById('bulkSelectAllBtn');
      if (bulkSelectAllBtn) bulkSelectAllBtn.textContent = this.bulkAllSelected ? '☑ Desmarcar todas' : '☐ Marcar todas';
      if (this.bulkMode) {
        const cats = App.cache.categories || await App.db.getAll('categories');
        if (!App.cache.categories) App.cache.categories = cats;
        document.getElementById('bulkCategory').innerHTML = '<option value="">Alterar Categoria…</option>' + cats.filter(c => !c.archived).map(c => `<option value="${App.math.escapeHtml(c.name)}">${App.math.escapeHtml(c.name)}</option>`).join('');
        document.getElementById('bulkAccount').innerHTML = '<option value="">Alterar Conta…</option>' + accounts.filter(a => !a.archived).map(a => `<option value="${App.math.escapeHtml(a.id)}">${App.math.escapeHtml(a.name)}</option>`).join('');
        const members = App.cache.members || await App.db.getAll('members');
        if (!App.cache.members) App.cache.members = members;
        document.getElementById('bulkMember').innerHTML = '<option value="">Alterar Membro…</option>' + members.map(m => `<option value="${App.math.escapeHtml(m.id)}">${App.math.escapeHtml(m.name)}</option>`).join('');
        this.updateBulkSelectionSummary();
      }

      await this.renderSummaryCards();
      this.renderPagination();

    } catch (err) {
      console.error(err);
      App.utils.showToast('Erro ao carregar transações.', 'error');
    }
    finally {
      this.hideLoadingOverlay();
    }
  },

  async renderAccountReconcileBanner(account, allTx) {
    const bar = document.getElementById('txAccountReconcileBar');
    if (!bar || !account) return;
    const snap = App.ledgerEngine.computeAccountBalances([account], allTx, {
      asOfDate: App.utils.todayISO(),
      includeArchived: true
    });
    const st = snap.byAccount[account.id];
    if (!st) { bar.style.display = 'none'; return; }
    const esc = App.math.escapeHtml;
    const recDiff = App.ledgerEngine.round2(st.balance - st.reconciledBalance);
    const lastRecText = st.lastReconciledDate
      ? `Última conferência: ${App.utils.formatDate(st.lastReconciledDate)}`
      : 'Ainda não conferida com o banco';

    bar.style.display = 'flex';
    bar.innerHTML = `
      <div class="tx-rec-info">
        <div class="tx-rec-title">🏦 Extrato: <strong>${esc(account.name)}</strong> <span class="tx-rec-sub">· ${lastRecText}</span></div>
        <div class="tx-rec-metrics">
          <span>Saldo no App: <strong>${App.utils.formatCurrency(st.balance)}</strong></span>
          <span aria-hidden="true">·</span>
          <span>Conciliado: <strong class="green-text">${App.utils.formatCurrency(st.reconciledBalance)}</strong></span>
          <span aria-hidden="true">·</span>
          <span>Não conciliado: <strong class="${st.unreconciledCount > 0 ? 'tx-rec-warn' : ''}">${st.unreconciledCount} lanç. (${App.utils.formatCurrency(recDiff)})</strong></span>
        </div>
      </div>
      <div class="tx-rec-actions">
        <button class="btn btn-sm btn-primary" onclick="App.saldos.openReconcileModal('${esc(account.id)}')">⚖️ Conferir com Banco</button>
      </div>`;
  },

  setTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.tx-tab').forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      if (isActive) {
        btn.style.borderBottomColor = 'var(--text)';
        btn.style.color = 'var(--text)';
        btn.style.fontWeight = '600';
      } else {
        btn.style.borderBottomColor = 'transparent';
        btn.style.color = 'var(--text-muted)';
        btn.style.fontWeight = '500';
      }
    });
    
    const filterType = document.getElementById('filterType');
    if (filterType) {
      if (tab === 'income' || tab === 'expense' || tab === 'transfer') {
        filterType.value = tab;
      } else if (tab === 'all') {
        filterType.value = 'all';
      }
    }
    
    this.currentPage = 1;
    this.invalidateCache();
    this.load();
  },

  invalidateCache() {
    this._cacheKey = null;
    this._cachedTotal = null;
  },

  showLoadingOverlay() {
    const overlay = document.getElementById('txLoadingOverlay');
    if (overlay) overlay.style.display = 'flex';
  },

  hideLoadingOverlay() {
    const overlay = document.getElementById('txLoadingOverlay');
    if (overlay) overlay.style.display = 'none';
  },

  compareBySortCol(a, b) {
    let av, bv;
    switch (this.sortCol) {
      case 'value': av = parseFloat(a.amount)||0; bv = parseFloat(b.amount)||0; break;
      case 'type': av = a.type||''; bv = b.type||''; break;
      case 'category': av = a.category||''; bv = b.category||''; break;
      case 'desc': av = a.description||''; bv = b.description||''; break;
      case 'method': av = a.payment_method||''; bv = b.payment_method||''; break;
      case 'account': av = a.account_name||''; bv = b.account_name||''; break;
      case 'member': av = a.member_name||''; bv = b.member_name||''; break;
      default: return 0;
    }
    if (typeof av === 'string') return av.localeCompare(bv) * (this.sortAsc ? 1 : -1);
    return (av - bv) * (this.sortAsc ? 1 : -1);
  },

  renderPage(tx, groupByCard) {
    const statusFilter = document.getElementById('filterStatus')?.value || 'all';
    const filtered = (statusFilter === 'all')
      ? tx
      : tx.filter(t => (t.status || 'confirmed') === statusFilter);
    if (groupByCard === 'true') this.renderGrouped(filtered);
    else if (groupByCard === 'invoice') this.renderInvoiceGrouped(filtered);
    else this.render(filtered);
  },

  async renderSummaryCards() {
    const container = document.getElementById('transactionsSummaryCards');
    if (!container) return;

    const localMemberFilter = document.getElementById('filterTxMember')?.value || 'all';
    const effectiveMemberId = (localMemberFilter !== 'all') ? localMemberFilter : (App.state.globalMemberFilter || null);
    const totalBalance = await App.saldos.getTotalBalance(effectiveMemberId);

    let start, end;
    if (this.currentCycle) {
      start = this.currentCycle.start;
      end = this.currentCycle.end;
    } else {
      const cycle = this.useCycle ? App.utils.cycleFromDate(this.currentMonthStart) : App.utils.monthRangeFromDate(this.currentMonthStart);
      start = cycle.start;
      end = cycle.end;
    }

    const extendedStart = App.utils.addMonths(start, -2);
    const allTx = await App.db.getTransactionsInRange(extendedStart, '2099-12-31', {
      memberId: effectiveMemberId
    });

    const startDateOnly = start.slice(0, 10);
    const endDateOnly = end.slice(0, 10);

    const confirmedTx = allTx.filter(t => t.status === 'confirmed');
    const confirmedIncomesInPeriod = confirmedTx.filter(
      t => t.type === 'income' && !t.ignore_from_total && t.date.slice(0, 10) >= startDateOnly && t.date.slice(0, 10) <= endDateOnly
    );
    const income = confirmedIncomesInPeriod.reduce((s, t) => s + parseFloat(t.amount), 0);

    const allCards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = allCards;

    let expense = 0;
    for (const t of confirmedTx) {
      if ((t.type !== 'expense' && t.type !== 'refund') || t.ignore_from_total) continue;
      if (t.invoice_locked) continue;
      if (t.credit_card_id) {
        const card = allCards.find(c => c.id === t.credit_card_id);
        let effectiveDate = t.date.slice(0, 10);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
            effectiveDate = period.due.slice(0, 10);
          } catch (e) {}
        }
        if (effectiveDate >= startDateOnly && effectiveDate <= endDateOnly) {
          if (t.type === 'refund') expense -= parseFloat(t.amount);
          else expense += parseFloat(t.amount);
        }
      } else {
        if (t.date.slice(0, 10) >= startDateOnly && t.date.slice(0, 10) <= endDateOnly) {
          if (t.type === 'refund') expense -= parseFloat(t.amount);
          else expense += parseFloat(t.amount);
        }
      }
    }

    const pendingTx = allTx.filter(t => t.status === 'pending');
    const incomePending = pendingTx
      .filter(t => t.type === 'income' && !t.ignore_from_total && t.date.slice(0, 10) >= startDateOnly && t.date.slice(0, 10) <= endDateOnly)
      .reduce((s, t) => s + parseFloat(t.amount), 0);

    let expensePending = 0;
    for (const t of pendingTx) {
      if ((t.type !== 'expense' && t.type !== 'refund') || t.ignore_from_total) continue;
      if (t.invoice_locked) continue;
      let effectiveDate = t.date.slice(0, 10);
      if (t.credit_card_id) {
        const card = allCards.find(c => c.id === t.credit_card_id);
        if (card) {
          try {
            const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
            effectiveDate = period.due.slice(0, 10);
          } catch (e) {}
        }
      }
      if (effectiveDate >= startDateOnly && effectiveDate <= endDateOnly) {
        if (t.type === 'refund') expensePending -= parseFloat(t.amount);
        else expensePending += parseFloat(t.amount);
      }
    }

    const totalIncome = income + incomePending;
    const totalExpense = expense + expensePending;
    const periodResult = totalIncome - totalExpense;
    const isPos = periodResult >= 0;
    const resPct = totalIncome > 0 ? (periodResult / totalIncome) * 100 : (periodResult < 0 ? -100 : 0);

    container.className = 'kpis';
    container.innerHTML = `
      <div class="card clickable" id="saldoAtualCard" onclick="App.transactions.showBalanceDetail()">
        <div class="card-label">Saldo disponível</div>
        <div class="card-value">${App.utils.formatCurrency(totalBalance)}</div>
        <div class="card-sub"><span class="green-text">Saldo consolidado atual</span></div>
      </div>
      <div class="card clickable" onclick="App.transactions.showCardDetail('income')">
        <div class="card-label">Receitas do período</div>
        <div class="card-value green">${App.utils.formatCurrency(income)}</div>
        <div class="card-sub">${confirmedIncomesInPeriod.length} receita${confirmedIncomesInPeriod.length === 1 ? '' : 's'} efetivada${confirmedIncomesInPeriod.length === 1 ? '' : 's'}${incomePending > 0 ? ` · ${App.utils.formatCurrency(incomePending)} prev.` : ''}</div>
      </div>
      <div class="card clickable" onclick="App.transactions.showCardDetail('expense')">
        <div class="card-label">Despesas do período</div>
        <div class="card-value red">${App.utils.formatCurrency(expense + expensePending)}</div>
        <div class="card-sub"><span>${App.utils.formatCurrency(expense)} efetivadas</span><br><span class="blue-text">${App.utils.formatCurrency(expensePending)} previstas</span></div>
      </div>
      <div class="card clickable" onclick="App.transactions.showCardDetail('balance')">
        <div class="card-label">Resultado do período</div>
        <div class="card-value ${isPos ? 'green' : 'red'}">${App.utils.formatCurrency(periodResult)}</div>
        <div class="card-sub"><span class="${isPos ? 'green-text' : 'red-text'}">${isPos ? '▲' : '▼'} ${Math.abs(resPct).toFixed(1)}%</span> vs receitas</div>
      </div>`;

    // Atualiza resumo do período
    const periodLabel = document.getElementById('txPeriodLabel');
    const periodDate = document.getElementById('txPeriodDate');
    const summaryIncome = document.getElementById('txSummaryIncome');
    const summaryExpense = document.getElementById('txSummaryExpense');
    const summaryBalance = document.getElementById('txSummaryBalance');
    const presetVal = document.getElementById('periodPreset')?.value || '';
    if (periodLabel) {
      if (presetVal === 'all') periodLabel.textContent = '📅 Todo o histórico';
      else if (presetVal === 'future') periodLabel.textContent = '📅 Futuro (a vencer)';
      else if (presetVal.startsWith('past')) periodLabel.textContent = `📅 Últimos ${presetVal.replace('past', '')} meses`;
      else {
        const d = new Date(this.currentMonthStart + 'T12:00:00');
        periodLabel.textContent = '📅 ' + d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      }
    }
    if (periodDate) {
      const cycle = this.useCycle ? App.utils.cycleFromDate(this.currentMonthStart) : App.utils.monthRangeFromDate(this.currentMonthStart);
      periodDate.textContent = App.utils.formatDate(cycle.start) + ' — ' + App.utils.formatDate(cycle.end);
    }
    if (summaryIncome) summaryIncome.textContent = App.utils.formatCurrency(income);
    if (summaryExpense) summaryExpense.textContent = App.utils.formatCurrency(expense + expensePending);
    if (summaryBalance) {
      const balance = totalIncome - totalExpense;
      summaryBalance.textContent = (balance >= 0 ? '+' : '') + App.utils.formatCurrency(balance);
      summaryBalance.className = 'summary-value ' + (balance >= 0 ? 'green-text' : 'red-text');
    }

    // ===============================================================
    // ATUALIZA O RODAPÉ (Saldo Anterior, Total e Saldo Atual)
    // ===============================================================
    const allTxForCalc = await App.db.getAll('transactions');
    const selectedAccountId = document.getElementById('filterAccount')?.value || '';
    const allActiveAccounts = (App.cache.accounts || await App.db.getAll('accounts')).filter(a => !a.archived);
    const accountsForCalc = selectedAccountId
      ? allActiveAccounts.filter(a => a.id === selectedAccountId)
      : allActiveAccounts;
    const memberIdCalc = App.state.globalMemberFilter || null;

    const startStr = String(start || App.utils.todayISO()).slice(0, 10);
    const endStr = String(end || App.utils.todayISO()).slice(0, 10);

    const iniDate = new Date(startStr + 'T00:00:00');
    const fimDate = new Date(endStr + 'T23:59:59');
    const fimAnteriorDate = new Date(iniDate);
    fimAnteriorDate.setDate(fimAnteriorDate.getDate() - 1);

    const dataFimAnterior = fimAnteriorDate.toISOString().slice(0, 10);
    const dataFimPeriodo = fimDate.toISOString().slice(0, 10);

    const snapAnterior = App.ledgerEngine.computeAccountBalances(accountsForCalc, allTxForCalc, {
      asOfDate: dataFimAnterior,
      memberId: memberIdCalc,
      includeArchived: false
    });
    const snapPeriodo = App.ledgerEngine.computeAccountBalances(accountsForCalc, allTxForCalc, {
      asOfDate: dataFimPeriodo,
      memberId: memberIdCalc,
      includeArchived: false
    });

    const saldoAnteriorCalc = selectedAccountId
      ? (snapAnterior.byAccount[selectedAccountId]?.balance || 0)
      : snapAnterior.totalBalance;
    const saldoAcumuladoCalc = selectedAccountId
      ? (snapPeriodo.byAccount[selectedAccountId]?.balance || 0)
      : snapPeriodo.totalBalance;
    const saldoPeriodoCalc = App.ledgerEngine.round2(saldoAcumuladoCalc - saldoAnteriorCalc);

    const elSaldoAnteriorFiltro = document.querySelector('.saldo-anterior-filtro');
    if (elSaldoAnteriorFiltro) {
      elSaldoAnteriorFiltro.textContent = selectedAccountId
        ? (accountsForCalc[0]?.name || 'Conta selecionada')
        : 'Todas as contas';
    }

    const elSaldoAnterior = document.getElementById('saldo-anterior-valor');
    if (elSaldoAnterior) elSaldoAnterior.textContent = App.utils.formatCurrency(saldoAnteriorCalc).replace('R$ ', '');

    const elTotalLancamentos = document.getElementById('total-lancamentos');
    if (elTotalLancamentos) {
      const resColor = (totalIncome - totalExpense) >= 0 ? 'var(--income)' : 'var(--expense)';
      elTotalLancamentos.innerHTML = `
        <span style="color:var(--income);">${App.utils.formatCurrency(totalIncome).replace('R$ ', '')}</span>
        <span style="color:var(--text-muted); margin: 0 8px;">−</span>
        <span style="color:var(--expense);">${App.utils.formatCurrency(totalExpense).replace('R$ ', '')}</span>
        <span style="color:var(--text-muted); margin: 0 8px;">=</span>
        <span style="color:${resColor};">${App.utils.formatCurrency(totalIncome - totalExpense).replace('R$ ', '')}</span>
      `;
    }

    const elSaldoAtual = document.getElementById('saldo-atual-valor');
    if (elSaldoAtual) elSaldoAtual.textContent = App.utils.formatCurrency(totalBalance);

    const spAnterior = document.getElementById('sp-saldo-anterior');
    const spPeriodo = document.getElementById('sp-saldo-periodo');
    const spAcumulado = document.getElementById('sp-saldo-acumulado');
    const spDataAnterior = document.getElementById('sp-data-anterior');
    const spDataPeriodo = document.getElementById('sp-data-periodo');
    const spDataAcumulado = document.getElementById('sp-data-acumulado');

    if (spAnterior) spAnterior.textContent = App.utils.formatCurrency(saldoAnteriorCalc).replace('R$ ', '');
    if (spPeriodo) spPeriodo.textContent = App.utils.formatCurrency(saldoPeriodoCalc).replace('R$ ', '');
    if (spAcumulado) spAcumulado.textContent = App.utils.formatCurrency(saldoAcumuladoCalc).replace('R$ ', '');
    
    // Formatação segura das datas (evita "Invalid Date")
    const fmtDate = (d) => {
      if (!d || isNaN(d.getTime())) return '--';
      return d.toLocaleDateString('pt-BR');
    };

    if (spDataAnterior) spDataAnterior.textContent = fmtDate(fimAnteriorDate);
    if (spDataPeriodo) {
      const iniFmt = fmtDate(iniDate);
      const fimFmt = fmtDate(fimDate);
      spDataPeriodo.textContent = `${iniFmt.slice(0,5)} a ${fimFmt}`;
    }
    if (spDataAcumulado) spDataAcumulado.textContent = fmtDate(fimDate);
    // Configura o Popover do Saldo Atual
    const saldoToggle = document.getElementById('saldo-toggle');
    const saldoPopover = document.getElementById('saldo-popover');
    if (saldoToggle && saldoPopover && !saldoToggle.dataset.listenerAdded) {
      saldoToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = saldoPopover.style.display === 'block';
        saldoPopover.style.display = isOpen ? 'none' : 'block';
        saldoToggle.querySelector('.saldo-toggle-seta').style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      });
      document.addEventListener('click', (e) => {
        if (!saldoPopover.contains(e.target) && !saldoToggle.contains(e.target)) {
          saldoPopover.style.display = 'none';
          saldoToggle.querySelector('.saldo-toggle-seta').style.transform = 'rotate(0deg)';
        }
      });
      saldoToggle.dataset.listenerAdded = 'true';
    }
  },

  async showCardDetail(type) {
    const filterDiv = document.getElementById('cardDetailFilters');
    if (filterDiv) filterDiv.style.display = 'none';
    let start, end;
    if (this.currentCycle) {
      start = this.currentCycle.start;
      end = this.currentCycle.end;
    } else {
      const cycle = this.useCycle ? App.utils.cycleFromDate(this.currentMonthStart) : App.utils.monthRangeFromDate(this.currentMonthStart);
      start = cycle.start;
      end = cycle.end;
    }

    const extendedStart = App.utils.addMonths(start, -2);
    const allTx = await App.db.getTransactionsInRange(extendedStart, '2099-12-31', {
      memberId: App.state.globalMemberFilter || null
    });

    const startDateOnly = start.slice(0,10);
    const endDateOnly = end.slice(0,10);

    let filteredTx = [];
    let title = '';
    const allCards = await App.db.getAll('creditCards');

    if (type === 'income') {
      const confirmedTx = allTx.filter(t => t.status === 'confirmed' && t.type === 'income' && !t.ignore_from_total && t.date.slice(0,10) >= startDateOnly && t.date.slice(0,10) <= endDateOnly);
      filteredTx = confirmedTx;
      title = '📥 Receitas do Período';
    } else if (type === 'expense') {
      const confirmedTx = allTx.filter(t => t.status === 'confirmed' && t.type === 'expense' && !t.ignore_from_total);
      const filtered = [];
      for (const t of confirmedTx) {
        if (t.credit_card_id) {
          const card = allCards.find(c => c.id === t.credit_card_id);
          let effectiveDate = t.date.slice(0,10);
          if (card) {
            try {
              const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
              effectiveDate = period.due.slice(0,10);
            } catch (e) {}
          }
          if (effectiveDate >= startDateOnly && effectiveDate <= endDateOnly) {
            filtered.push(t);
          }
        } else {
          if (t.date.slice(0,10) >= startDateOnly && t.date.slice(0,10) <= endDateOnly) {
            filtered.push(t);
          }
        }
      }
      filteredTx = filtered;
      title = '📤 Despesas do Período';
    } else if (type === 'balance') {
      // Balanço: receitas (confirmadas + pendentes) e despesas (exceto cartão já pago)
      const incomeConfirmed = allTx.filter(t => t.status === 'confirmed' && t.type === 'income' && !t.ignore_from_total && t.date.slice(0,10) >= startDateOnly && t.date.slice(0,10) <= endDateOnly);
      const incomePending = allTx.filter(t => t.status === 'pending' && t.type === 'income' && !t.ignore_from_total && t.date.slice(0,10) >= startDateOnly && t.date.slice(0,10) <= endDateOnly);

      const expenseAll = [];
      for (const t of allTx) {
        if ((t.type !== 'expense' && t.type !== 'refund') || t.ignore_from_total) continue;
        if (t.status !== 'confirmed' && t.status !== 'pending') continue;
        // Ignorar compras de cartão já pagas (invoice_locked)
        if (t.credit_card_id && t.invoice_locked) continue;

        let effectiveDate = t.date.slice(0,10);
        if (t.credit_card_id && !t.invoice_locked) {
          const card = allCards.find(c => c.id === t.credit_card_id);
          if (card) {
            try {
              const period = App.cardInvoice.getInvoicePeriodForDate(card, effectiveDate);
              effectiveDate = period.due.slice(0,10);
            } catch (e) {}
          }
        }
        if (effectiveDate >= startDateOnly && effectiveDate <= endDateOnly) {
          expenseAll.push(t);
        }
      }
      filteredTx = [...incomeConfirmed, ...incomePending, ...expenseAll];
      title = '⚖️ Balanço Mensal - Todas as Transações';
    }

    // Montagem da tabela COM AGRUPAMENTO VISUAL E TOTAL CORRETO
    const tbody = document.getElementById('cardDetailTableBody');
    const totalEl = document.getElementById('cardDetailTotal');
    const titleEl = document.getElementById('cardDetailTitle');
    if (titleEl) titleEl.textContent = title;

    if (filteredTx.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">Nenhuma transação encontrada</td></tr>';
      if (totalEl) totalEl.textContent = '';
      App.ui.openModal('modalCardDetail');
      return;
    }

    const typeNames = {income:'Receita',expense:'Despesa',transfer:'Transferência',contribution:'Aporte',withdrawal:'Resgate',refund:'Estorno'};
    let html = '';
    let total = 0;
    filteredTx.sort((a, b) => a.date.localeCompare(b.date));

    // Separar transações de cartão de crédito (agrupáveis) das demais
    const cardTx = [];
    const otherTx = [];
    for (const t of filteredTx) {
      if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
        cardTx.push(t);
      } else {
        otherTx.push(t);
      }
    }

    // Mapa de faturas já pagas (cardId|dueMonth) — evita exibir o grupo quando há Pagamento Fatura correspondente
    const pagosMap = new Map();
    const _norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const p of otherTx) {
      if (p.type !== 'expense' || p.category !== 'Pagamento Fatura' || p.reverted) continue;
      const m = (p.description || '').match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
      if (!m) continue;
      const nome = m[1].trim();
      const mes = m[2];
      const card = allCards.find(c => _norm(c.name) === _norm(nome));
      if (card) pagosMap.set(`${card.id}|${mes}`, true);
    }

    // Agrupar transações de cartão por fatura (exibição visual, sem afetar o total)
    const invoiceGroups = {};
    for (const t of cardTx) {
      const card = allCards.find(c => c.id === t.credit_card_id);
      if (!card) continue;
      let dueDate = t.date.slice(0,10);
      let dueMonth = dueDate.slice(0,7);
      let invoiceLabel = `Fatura ${card.name}`;
      try {
        const period = App.cardInvoice.getInvoicePeriodForDate(card, dueDate);
        dueDate = period.due.slice(0,10);
        dueMonth = period.due.slice(0,7);
        invoiceLabel = `Fatura ${card.name} ${dueMonth}`;
      } catch (e) {}
      const key = `${t.credit_card_id}|${invoiceLabel}`;
      if (!invoiceGroups[key]) {
        invoiceGroups[key] = {
          invoiceLabel,
          dueDate,
          dueMonth,
          cardId: t.credit_card_id,
          cardName: card.name,
          transactions: [],
          totalAmount: 0
        };
      }
      invoiceGroups[key].transactions.push(t);
      const amt = parseFloat(t.amount);
      invoiceGroups[key].totalAmount += (t.type === 'refund') ? -amt : amt;
    }

    // Exibir linhas agrupadas (APENAS VISUAIS, NÃO SOMAM AO TOTAL)
    // Se a fatura já foi paga, NÃO exibimos o grupo — a linha de Pagamento Fatura já a representa
    for (const [key, group] of Object.entries(invoiceGroups)) {
      const chavePagamento = `${group.cardId}|${group.dueMonth}`;
      if (pagosMap.has(chavePagamento)) continue;

      const sign = group.totalAmount >= 0 ? '-' : '+';
      const displayDate = App.utils.formatDate(group.dueDate);
      html += `<tr style="color: var(--text-muted); font-style: italic;">
        <td>${displayDate}</td>
        <td>Despesa</td>
        <td>${group.invoiceLabel}</td>
        <td>Fatura Cartão</td>
        <td>${group.transactions.length} compras</td>
        <td></td>
        <td class="text-right" style="color:${group.totalAmount < 0 ? 'var(--income)' : 'var(--expense)'};">${sign} ${App.utils.formatCurrency(Math.abs(group.totalAmount))}</td>
      </tr>`;
      // Não adiciona ao total
    }

    // Exibir transações não agrupadas e CALCULAR O TOTAL REAL
    for (const t of otherTx) {
      const amt = parseFloat(t.amount);
      let sign, color, tipo;
      if (t.type === 'expense' && t.category === 'Pagamento Fatura') {
        tipo = 'Pagamento Fatura';
      } else {
        tipo = typeNames[t.type] || t.type;
      }
      if (t.type === 'income' || t.type === 'contribution' || t.type === 'refund' || t.type === 'withdrawal') {
        sign = '+';
        color = 'var(--income)';
        total += amt;
      } else {
        sign = '-';
        color = 'var(--expense)';
        total -= amt;
      }
      const esc = (v) => App.utils.escapeHtml(v);
      html += `<tr>
        <td>${App.utils.formatDateTime(t.date)}</td>
        <td>${esc(tipo)}</td>
        <td></td>
        <td>${esc(t.category || '')}</td>
        <td>${esc(t.description || '')}</td>
        <td>${esc(t.member_name || '')}</td>
        <td class="text-right" style="color:${color};">${sign} ${App.utils.formatCurrency(amt)}</td>
      </tr>`;
    }

    tbody.innerHTML = html;
    if (totalEl) totalEl.innerHTML = `Total: <strong>${App.utils.formatCurrency(total)}</strong>`;

    App.ui.openModal('modalCardDetail');
  },

  async showBalanceDetail() {
    const filterDiv = document.getElementById('cardDetailFilters');
    if (filterDiv) filterDiv.style.display = 'none';

    // Recalcula o saldo exato (mesma lógica do card, sem redesenhar a tela Saldos)
    this._balanceDetailTotal = await App.saldos.getTotalBalance();

    // Carrega tudo uma vez e guarda em memória
    const allTx = await App.db.getAll('transactions');
    const allCards = await App.db.getAll('creditCards');
    const allAccounts = await App.db.getAll('accounts');
    const allMembers = await App.db.getAll('members');

    this._balanceDetailData = {
      allTx,
      allCards,
      allAccounts,
      allMembers,
      today: App.utils.todayISO()
    };

    const modalContent = document.getElementById('modalBalanceDetailContent');
    if (!modalContent) return;

    const esc = (v) => App.utils.escapeHtml(v);
    const accountOptions = allAccounts
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
      .join('');

    const memberOptions = allMembers
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`)
      .join('');

    modalContent.innerHTML = `
      <div id="balanceDetailFilters" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; margin-bottom:16px; padding:14px 16px; background:var(--bg-secondary); border-radius:8px; border:1px solid var(--border);">
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Período</label>
          <select id="bdPeriodFilter" onchange="App.transactions._renderBalanceDetail()" style="padding:6px 10px; border-radius:6px; background:var(--card); color:var(--text); border:1px solid var(--border); cursor:pointer;">
            <option value="currentMonth">Mês atual</option>
            <option value="last3">Últimos 3 meses</option>
            <option value="last6">Últimos 6 meses</option>
            <option value="last12" selected>Últimos 12 meses</option>
            <option value="all">Todo período</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Tipo</label>
          <select id="bdTypeFilter" onchange="App.transactions._renderBalanceDetail()" style="padding:6px 10px; border-radius:6px; background:var(--card); color:var(--text); border:1px solid var(--border); cursor:pointer;">
            <option value="all">Todos</option>
            <option value="income">Receitas</option>
            <option value="expense">Despesas</option>
            <option value="transfer">Transferências</option>
            <option value="contribution">Aportes</option>
            <option value="withdrawal">Resgates</option>
            <option value="refund">Estornos</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Conta</label>
          <select id="bdAccountFilter" onchange="App.transactions._renderBalanceDetail()" style="padding:6px 10px; border-radius:6px; background:var(--card); color:var(--text); border:1px solid var(--border); cursor:pointer; min-width:160px;">
            <option value="all">Todas as contas</option>
            ${accountOptions}
          </select>
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Membro</label>
          <select id="bdMemberFilter" onchange="App.transactions._renderBalanceDetail()" style="padding:6px 10px; border-radius:6px; background:var(--card); color:var(--text); border:1px solid var(--border); cursor:pointer; min-width:140px;">
            <option value="all">Todos os membros</option>
            ${memberOptions}
          </select>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="App.transactions._clearBalanceDetailFilters()" style="margin-bottom:2px;">Limpar</button>
      </div>
      <div id="balanceDetailBody"></div>
    `;

    this._renderBalanceDetail();
    App.ui.openModal('modalBalanceDetail');
  },

  _clearBalanceDetailFilters() {
    const p = document.getElementById('bdPeriodFilter'); if (p) p.value = 'last12';
    const t = document.getElementById('bdTypeFilter'); if (t) t.value = 'all';
    const a = document.getElementById('bdAccountFilter'); if (a) a.value = 'all';
    const m = document.getElementById('bdMemberFilter'); if (m) m.value = 'all';
    this._renderBalanceDetail();
  },

  _renderBalanceDetail() {
    const data = this._balanceDetailData;
    const body = document.getElementById('balanceDetailBody');
    if (!data || !body) return;

    const { allTx, allCards, allAccounts, today } = data;
    const totalBalance = this._balanceDetailTotal ?? 0;

    const period = document.getElementById('bdPeriodFilter')?.value || 'last12';
    const typeFilter = document.getElementById('bdTypeFilter')?.value || 'all';
    const accountFilter = document.getElementById('bdAccountFilter')?.value || 'all';
    const memberFilter = document.getElementById('bdMemberFilter')?.value || 'all';

    // Calcula data de início conforme o período
    let startDate = null;
    if (period === 'currentMonth') {
      startDate = App.utils.currentMonth().startDate;
    } else if (period === 'last3') {
      startDate = App.utils.addMonths(today, -3);
    } else if (period === 'last6') {
      startDate = App.utils.addMonths(today, -6);
    } else if (period === 'last12') {
      startDate = App.utils.addMonths(today, -12);
    }

    // Filtra transações
    let filteredTx = allTx.filter(t => (t.date || '').slice(0, 10) <= today);
    if (startDate) {
      filteredTx = filteredTx.filter(t => (t.date || '').slice(0, 10) >= startDate);
    }
    if (typeFilter !== 'all') {
      filteredTx = filteredTx.filter(t => t.type === typeFilter);
    }
    if (accountFilter !== 'all') {
      filteredTx = filteredTx.filter(t => t.account_id === accountFilter || t.account_to_id === accountFilter);
    }
    if (memberFilter !== 'all') {
      filteredTx = filteredTx.filter(t =>
        t.member_id === memberFilter ||
        (t.member_splits && t.member_splits.some(sp => sp.member_id === memberFilter))
      );
    }

    // Separa cartão vs sem cartão
    const cardTxMap = {};
    const nonCardTx = [];
    for (const t of filteredTx) {
      if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
        if (!cardTxMap[t.credit_card_id]) cardTxMap[t.credit_card_id] = [];
        cardTxMap[t.credit_card_id].push(t);
      } else {
        nonCardTx.push(t);
      }
    }

    const cardNameMap = Object.fromEntries(allCards.map(c => [c.id, c.name]));
    const accMap = Object.fromEntries(allAccounts.map(a => [a.id, a.name]));
    const typeNames = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência', contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno' };

    const rows = [];
    let totalTransactions = 0;

    // 1. Faturas agrupadas por cartão
    for (const [cardId, txs] of Object.entries(cardTxMap)) {
      const cardName = cardNameMap[cardId] || 'Cartão';
      const cardObj = allCards.find(c => c.id === cardId);
      const invoiceGroups = {};
      for (const t of txs) {
        let invoiceKey = '';
        try {
          const p = App.cardInvoice.getInvoicePeriodForDate(cardObj, t.date.slice(0, 10));
          invoiceKey = p.due.slice(0, 7);
        } catch (e) {
          invoiceKey = t.date.slice(0, 7);
        }
        if (!invoiceGroups[invoiceKey]) invoiceGroups[invoiceKey] = [];
        invoiceGroups[invoiceKey].push(t);
      }
      for (const [monthKey, invoiceTxs] of Object.entries(invoiceGroups)) {
        const totalExpense = invoiceTxs.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
        const totalRefund = invoiceTxs.filter(t => t.type === 'refund').reduce((s, t) => s + parseFloat(t.amount), 0);
        const netTotal = totalExpense - totalRefund;
        const hasPending = invoiceTxs.some(t => t.status === 'pending');
        const statusLabel = hasPending ? '⏳ Pendente' : '✅';
        const sign = netTotal >= 0 ? '-' : '+';
        const color = netTotal >= 0 ? 'var(--expense)' : 'var(--income)';
        const accountName = invoiceTxs[0]?.account_name || '';
        rows.push({
          sortDate: monthKey + '-01',
          html: `<tr style="background:var(--bg-secondary);">
            <td>${monthKey}</td>
            <td>${statusLabel}</td>
            <td>Despesa</td>
            <td>Fatura</td>
            <td>💳 ${cardName} (${invoiceTxs.length} compras)</td>
            <td>${accountName}</td>
            <td class="text-right" style="font-weight:600;color:${color};">${sign} ${App.utils.formatCurrency(Math.abs(netTotal))}</td>
          </tr>`
        });
        totalTransactions += invoiceTxs.length;
      }
    }

    // 2. Transações sem cartão
    for (const t of nonCardTx) {
      const amt = parseFloat(t.amount);
      let sign, color;
      let descricao = t.description || t.category || '';
      let tipo = typeNames[t.type] || t.type;

      if (t.type === 'transfer') {
        if (t.account_id === App.accountDetail.currentId) {
          sign = '→';
          color = '#fbbf24';
          const contaDestino = t.account_to_name || accMap[t.account_to_id] || '';
          descricao = `Transferência para ${contaDestino}: ${t.description || ''}`;
        } else {
          sign = '←';
          color = '#60a5fa';
          const contaOrigem = t.account_name || accMap[t.account_id] || '';
          descricao = `Transferência de ${contaOrigem}: ${t.description || ''}`;
        }
        tipo = 'Transferência';
      } else {
        sign = (t.type === 'income' || t.type === 'refund') ? '+' : '-';
        color = (t.type === 'income' || t.type === 'refund') ? 'var(--income)' : 'var(--expense)';
      }

      let statusLabel = t.status === 'pending' ? '⏳ Pendente' : '✅';
      if (t.ignore_from_total) statusLabel += ' 🚫';

      rows.push({
        sortDate: t.date,
        html: `<tr>
          <td>${App.utils.formatDateTime(t.date)}</td>
          <td>${statusLabel}</td>
          <td>${tipo}</td>
          <td>${t.category || '-'}</td>
          <td>${descricao}</td>
          <td>${t.account_name || '-'}</td>
          <td class="text-right" style="color:${color};">${sign} ${App.utils.formatCurrency(amt)}</td>
        </tr>`
      });
      totalTransactions++;
    }

    rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate));

    let html = `<div class="table-container" style="max-height:55vh; overflow-y:auto;">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Status</th>
            <th>Tipo</th>
            <th>Categoria</th>
            <th>Descrição</th>
            <th>Conta</th>
            <th class="text-right">Valor</th>
          </tr>
        </thead>
        <tbody>`;
    html += rows.length
      ? rows.map(r => r.html).join('')
      : '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">Nenhuma transação encontrada com os filtros aplicados.</td></tr>';
    html += `</tbody></table></div>`;
    html += `<div style="text-align:right; margin-top:8px; font-weight:600;">
      Total de transações: ${totalTransactions}
    </div>`;
    html += `<div style="text-align:right; margin-top:8px; font-weight:600; font-size:1rem;">
      💰 Saldo Total: ${App.utils.formatCurrency(totalBalance)}
    </div>`;

    body.innerHTML = html;
  },

  renderPagination() {
    const container = document.getElementById('transactionsPagination');
    if (!container) return;
    const totalPages = Math.ceil(this.totalResults / this.pageSize);
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }
    let html = '';
    html += `<button class="btn btn-sm btn-outline" ${this.currentPage === 1 ? 'disabled' : ''} onclick="App.transactions.goToPage(${this.currentPage - 1})">◀</button>`;
    html += `<span class="pagination-info">Página ${this.currentPage} de ${totalPages} (${this.totalResults} registros)</span>`;
    html += `<button class="btn btn-sm btn-outline" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="App.transactions.goToPage(${this.currentPage + 1})">▶</button>`;
    container.innerHTML = html;
  },

  goToPage(page) {
    this.currentPage = page;
    this.load();
  },

    goToToday() {
    this.invalidateCache();
    this.currentMonthStart = App.utils.currentMonth().startDate;
    this.currentPage = 1;
    document.getElementById('periodPreset').value = '';
    const monthInput = document.getElementById('txMonthPicker');
    if (monthInput) {
      const d = new Date();
      monthInput.value = d.toISOString().slice(0,7);
    }
    this.load();
  },

   render(tx) {
    const tbody = document.getElementById('transactionsTableBody');
    const empty = document.getElementById('transactionsEmpty');
    if (!tx.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display='none';
    // Adiciona cabeçalho da tabela (estilo referência)
    const tableContainer = tbody.closest('.table-container');
    if (tableContainer) {
      const oldHeader = tableContainer.querySelector('.table-header');
      if (oldHeader) oldHeader.remove();
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const formatDay = (d) => String(d.getDate()).padStart(2,'0');
      const headerDiv = document.createElement('div');
      headerDiv.className = 'table-header';
      headerDiv.innerHTML = `
        <span><strong>${formatDay(firstDay)}–${formatDay(lastDay)} ${today.toLocaleDateString('pt-BR',{month:'short'}).toUpperCase()}</strong> · ${tx.length} transações</span>
        <span>Ordenar por: <strong>Data (mais recente)</strong> ↕</span>
      `;
      tableContainer.insertBefore(headerDiv, tbody.closest('table'));
    }
    const typeNames = {income:'Receita',expense:'Despesa',transfer:'Transferência',contribution:'Aporte',withdrawal:'Resgate',refund:'Estorno',adjustment:'Ajuste'};
    const badges = {income:'badge-income',expense:'badge-expense',transfer:'badge-transfer',contribution:'badge-contribution',withdrawal:'badge-withdrawal',refund:'badge-refund',adjustment:'badge-transfer'};
    const methodNames = {pix:'Pix',credit_card:'Crédito',debit_card:'Débito',cash:'Dinheiro',transfer:'Transferência'};
    const esc = (v) => App.utils.escapeHtml(v);
    tbody.innerHTML = tx.map(t=>{
      const sign = t.type==='income'||t.type==='contribution'||t.type==='refund'||(t.type==='transfer' && t.transfer_subtype==='loan_payment')?'+':'-';
      let desc = esc(t.description||'');
      let tipoExibicao = typeNames[t.type] || t.type;
      if (t.type === 'expense' && t.category === 'Pagamento Fatura') {
        tipoExibicao = 'Pagamento Fatura';
      }
      // Descrição clicável somente se houver notas (abre modal de notas)
      const hasNotes = t.notes && t.notes.trim().length > 0;
      const clickDescAction = hasNotes
        ? `event.stopPropagation();App.transactions.showNotes('${esc(t.id)}')`
        : '';
      const descStyle = clickDescAction ? 'cursor:pointer;' : '';
      desc = `<span style="${descStyle}" onclick="${clickDescAction}" title="${hasNotes ? 'Ver notas' : ''}">${desc}</span>`;

      if (t.credit_card_id) {
        // Informações de parcelamento (sem selo "Crédito")
        if (t.installments > 1 && t.expense_type !== 'fixed') {
          const purchaseDate = t.purchase_date ? App.utils.formatDate(t.purchase_date) : '';
          const remaining = t.installments - t.installment_number;
          desc += ` <span style="font-size:0.75rem;color:var(--primary);" onclick="event.stopPropagation();App.installments.showDetail('${t.installment_id||t.id}')">(Parcela ${t.installment_number}/${t.installments}${remaining>0?' faltam '+remaining:''} - Total: ${App.utils.formatCurrency(t.amount * t.installments)})</span>`;
        }
      } else {
        if (t.is_recurring_series) desc += ' (Recorrente)';
        else if (t.installments>1 && t.expense_type!=='fixed') {
          const purchaseDate = t.purchase_date ? App.utils.formatDate(t.purchase_date) : '';
          const remaining = t.installments - t.installment_number;
          desc += ` <span style="font-size:0.75rem;cursor:pointer;color:var(--primary);" onclick="event.stopPropagation();App.installments.showDetail('${t.installment_id||t.id}')">(Compra: ${purchaseDate} - Parcela ${t.installment_number}/${t.installments}${remaining>0?' faltam '+remaining:''} - Total: ${App.utils.formatCurrency(t.amount * t.installments)})</span>`;
        }
        if (t.expense_type) { const labels = {single:'Avulsa',installment:'Parcelada',fixed:'Fixa'}; desc += ` <span class="badge badge-transfer">${labels[t.expense_type]}</span>`; }
      }
      if (t.vacation) desc += ' 🏖️';
      // Exibe ícone de notas (apenas se houver) – clicável
      if (hasNotes) desc += ` <span style="cursor:pointer;" onclick="event.stopPropagation();App.transactions.showNotes('${t.id}')" title="Ver notas">📝</span>`;
      const method = t.fonte_pagadora_id ? 'Fonte Pagadora' : (methodNames[t.payment_method] || t.payment_method || '--');
      const classificationBtn = `<button class="icon-btn" title="Classificar" onclick="App.transactions.classify('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>`;
      const refundBtn = (t.type==='expense' && t.credit_card_id) ? `<button class="icon-btn" title="Estornar" onclick="App.transactions.refund('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>` : '';
      const revertInvoiceBtn = (t.type === 'expense' && t.category === 'Pagamento Fatura')
        ? `<button class="icon-btn" title="Reverter pagamento da fatura" onclick="event.stopPropagation();App.creditCards.revertInvoicePayment('${t.id}')">↩️</button>`
        : '';
      const bulkCheck = this.bulkMode ? `<td class="bulk-col" style="display:table-cell;"><input type="checkbox" class="bulkCheck" value="${t.id}" ${this.bulkAllSelected ? 'checked' : ''} onchange="App.transactions.updateBulkSelectionSummary()"></td>` : '';
      const ignoreBadge = t.ignore_from_total ? ' 🚫' : '';
      const dateFormatted = App.utils.formatDateTimeFull(t.date);
      const dateOnly = dateFormatted.split(' ')[0] || '';
      const timeOnly = dateFormatted.split(' ')[1] || '';
      const statusLabel = t.status === 'pending' ? '⏳ Pendente' : '✓ Efetivada';
      const statusClass = t.status === 'pending' ? 'pending' : 'done';
      const valueClass = t.type === 'income' || t.type === 'refund' ? 'income' : 'expense';
      const runBalCell = this._activeAccountObj
        ? (() => {
            const rb = this._runningBalanceMap && Object.prototype.hasOwnProperty.call(this._runningBalanceMap, t.id) ? this._runningBalanceMap[t.id] : null;
            return `<td class="running-bal-col text-right tabular-nums ${rb !== null && rb < 0 ? 'is-neg' : ''}">${rb !== null ? App.utils.formatCurrency(rb) : '—'}</td>`;
          })()
        : '';
      const recBtn = `<button class="icon-btn tx-rec-btn ${t.reconciled ? 'is-reconciled' : ''}" onclick="event.stopPropagation();App.transactions.toggleReconciled('${t.id}')" title="${t.reconciled ? 'Conciliada com banco (clique para desfazer)' : 'Marcar como conciliada com banco'}" aria-label="Conciliar lançamento">${t.reconciled ? '⚖️' : '○'}</button>`;

      return `<tr draggable="true" data-id="${t.id}" 
                ondragstart="App.transactions.dragStart(event)" 
                ondragover="App.transactions.dragOver(event)" 
                ondrop="App.transactions.drop(event)" 
                ondragend="App.transactions.dragEnd(event)">
        ${bulkCheck}
        <td class="date">${dateOnly}<small>${timeOnly}</small></td>
        <td><span class="badge badge-${esc(t.type)}" style="cursor:pointer;" ondblclick="event.stopPropagation();App.transactions.openDetail('${esc(t.id)}')" title="Duplo clique para ver detalhes">${esc(tipoExibicao)}</span></td>
        <td>${esc(t.category || '-')}</td>
        <td>${desc}${ignoreBadge}</td>
        <td class="account">${esc(t.account_name || '')}<small>${t.credit_card_id ? 'Cartão de crédito' : 'Conta corrente'}</small></td>
        <td class="member">${esc(t.member_name || (t.member_splits && t.member_splits.length > 0 ? 'Transação dividida' : ''))}</td>
        <td class="value ${valueClass}">${sign} ${App.utils.formatCurrency(t.amount)}</td>
        ${runBalCell}
        <td class="text-center"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td class="actions-cell">
          ${recBtn}
          <button class="icon-btn" onclick="App.transactions.edit('${t.id}')" title="Editar">✏️</button>
          <button class="icon-btn" onclick="App.transactions.duplicate('${t.id}')" title="Duplicar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          <button class="icon-btn" onclick="App.transactions.toggleStatus('${t.id}')" title="${t.status === 'pending' ? 'Efetivar' : 'Marcar pendente'}">${t.status === 'pending' ? '✅' : '⏳'}</button>
          ${revertInvoiceBtn}
          ${refundBtn}
          ${classificationBtn}
          <button class="icon-btn delete" onclick="App.transactions.confirmDelete('${t.id}')" title="Excluir">🗑️</button>
        </td>
      </tr>`;
    }).join('');
  },

  async renderInvoiceGrouped(tx) {
    const __sf = document.getElementById('filterStatus')?.value || 'all';
    if (__sf !== 'all') tx = tx.filter(t => (t.status || 'confirmed') === __sf);
    const allCards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = allCards;
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;
    const cards = {}; const semCartaoTx = [];
    const cycle = this.currentCycle || (this.useCycle ? App.utils.cycleFromDate(this.currentMonthStart) : App.utils.monthRangeFromDate(this.currentMonthStart));
    tx.forEach(t => {
      if (t.credit_card_id) {
        if (!cards[t.credit_card_id]) cards[t.credit_card_id] = [];
        cards[t.credit_card_id].push(t);
      } else {
        if (t.date >= cycle.start && t.date <= cycle.end) {
          semCartaoTx.push(t);
        }
      }
    });

    const pagosMap = new Map();
    const revertedInvoicesSet = new Set();
    const _normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const _allTxFull = await App.db.getAll('transactions');

    const pagamentos = tx.filter(t => t.category === 'Pagamento Fatura' && t.type === 'expense' && !t.reverted);
    pagamentos.forEach(p => {
      const match = p.description?.match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
      if (match) {
        const nomeCartao = match[1].trim();
        const mesPagamento = match[2];
        const card = allCards.find(c => c.name.toLowerCase() === nomeCartao.toLowerCase());
        if (card) {
          pagosMap.set(`${card.id}|${mesPagamento}`, true);
        }
      }
    });

    _allTxFull.forEach(t => {
      if (!t.reverted || t.category !== 'Pagamento Fatura') return;
      let cid = t.invoice_card_id || null;
      let dm = t.invoice_due_month || null;
      if (!cid || !dm) {
        const m = (t.description || '').match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
        if (!m) return;
        dm = m[2];
        const card = allCards.find(c => _normName(c.name) === _normName(m[1]));
        if (!card) return;
        cid = card.id;
      }
      revertedInvoicesSet.add(`${cid}|${dm}`);
    });
    const tbody = document.getElementById('transactionsTableBody');
    const typeNames = {income:'Receita',expense:'Despesa',transfer:'Transferência',contribution:'Aporte',withdrawal:'Resgate',refund:'Estorno',adjustment:'Ajuste'};

    const rows = [];

    const cycleStart = new Date(cycle.start.substring(0,10) + 'T12:00:00');
    const cycleEnd = new Date(cycle.end.substring(0,10) + 'T12:00:00');
    const monthsInCycle = new Set();
    for (let d = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), 1);
         d <= cycleEnd;
         d.setMonth(d.getMonth() + 1)) {
      monthsInCycle.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }

    for (const [cardId, txList] of Object.entries(cards)) {
      const card = allCards.find(c=>c.id===cardId) || {};
      if (!card) continue;
      const cardName = card.name || 'Cartão';

      const byPeriod = {};
      for (const t of txList) {
        if (t.category === 'Pagamento Fatura') continue; // pagamentos nunca são agrupados como compras da fatura
        let invoicePeriod;
        try {
          invoicePeriod = App.cardInvoice.getInvoicePeriodForDate(card, t.date.substring(0,10));
        } catch (e) {
          const d = new Date(t.date + 'T12:00:00');
          const start = new Date(d.getFullYear(), d.getMonth(), 1);
          const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
          invoicePeriod = {
            start: start.toISOString().slice(0,10),
            end: end.toISOString().slice(0,10),
            due: end.toISOString().slice(0,10)
          };
        }
        const dueMonth = invoicePeriod.due.substring(0,7);
        if (!monthsInCycle.has(dueMonth)) continue;
        const key = dueMonth;
        if (pagosMap.has(`${cardId}|${dueMonth}`)) continue;
        if (!byPeriod[key]) {
          byPeriod[key] = { start: invoicePeriod.start, end: invoicePeriod.end, due: invoicePeriod.due, txs: [] };
        }
        byPeriod[key].txs.push(t);
      }

      for (const [key, data] of Object.entries(byPeriod)) {
        const { start, end, due } = data;
        const cardTx = data.txs.filter(t => t.type === 'expense' || t.type === 'refund');
        if (cardTx.length === 0) continue;

        const totalExpense = cardTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
        const totalRefund = cardTx.filter(t => t.type === 'refund').reduce((s, t) => s + parseFloat(t.amount), 0);
        const total = totalExpense - totalRefund;

        const nomesMembros = new Set();
        cardTx.forEach(t => {
          if (t.member_name && t.member_name.trim()) {
            t.member_name.split('+').map(s => s.trim()).filter(Boolean).forEach(nome => nomesMembros.add(nome));
          }
          if (t.member_splits && t.member_splits.length > 0) {
            t.member_splits.forEach(sp => {
              const membro = members.find(m => m.id === sp.member_id);
              if (membro) nomesMembros.add(membro.name);
            });
          }
        });
        let membersStr = '';
        if (nomesMembros.size > 0) {
          membersStr = Array.from(nomesMembros).join(' + ');
        } else if (card.member_id) {
          const membro = members.find(m => m.id === card.member_id);
          if (membro) membersStr = membro.name;
        }
        const acc = accounts.find(a=>a.id===card.account_id);
        const accountName = acc ? acc.name : '';

        const displayDate = App.utils.formatDate(due);
        const refMonthName = new Date(start + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const descLink = `<span style="cursor:pointer;color:var(--primary);text-decoration:underline;" onclick="App.cardInvoice.open('${cardId}', { start: '${start}', end: '${end}', due: '${due}' })">Fatura ${cardName} ${refMonthName}</span>`;
        const details = `${cardTx.length} compras`;

        let refPosition = 0;
        if (cardTx.length > 0) {
          refPosition = Math.min(...cardTx.map(t => t.position || 0));
        }

        const invoiceHasPending = cardTx.some(t => t.status === 'pending');
        const _revertedKey = `${cardId}|${key}`;
        const isReverted = revertedInvoicesSet.has(_revertedKey) && !pagosMap.has(_revertedKey);
        let invoiceStatusLabel, invoiceStatusClass;
        if (isReverted) {
          invoiceStatusLabel = '🔄 Reaberto';
          invoiceStatusClass = 'reopened';
        } else if (invoiceHasPending) {
          invoiceStatusLabel = '⏳ Pendente';
          invoiceStatusClass = 'pending';
        } else {
          invoiceStatusLabel = '✓ Efetivada';
          invoiceStatusClass = 'done';
        }
        const dateFormatted = App.utils.formatDate(due);
        const valueClass = 'expense';

        const invBulkTd = this.bulkMode ? `<td class="bulk-col" style="display:table-cell;"></td>` : '';
        const invRunBalTd = this._activeAccountObj ? `<td class="running-bal-col text-right">—</td>` : '';
        rows.push({
          sortDate: due,
          position: refPosition,
          html: `<tr draggable="true" data-id="invoice_${cardId}_${key}" 
                    ondragstart="App.transactions.dragStart(event)" 
                    ondragover="App.transactions.dragOver(event)" 
                    ondrop="App.transactions.drop(event)" 
                    ondragend="App.transactions.dragEnd(event)">
            ${invBulkTd}
            <td class="date">${dateFormatted}</td>
            <td><span class="badge badge-expense">Fatura</span></td>
            <td>Fatura Cartão</td>
            <td>${descLink} <span style="font-size:0.75rem;color:var(--text-muted);">(${details})</span></td>
            <td class="account">${accountName}<small>Cartão de crédito</small></td>
            <td class="member">${membersStr}</td>
            <td class="value ${valueClass}">- ${App.utils.formatCurrency(total)}</td>
            ${invRunBalTd}
            <td class="text-center"><span class="status-badge ${invoiceStatusClass}">${invoiceStatusLabel}</span></td>
            <td class="actions-cell">
              <button class="icon-btn" onclick="event.stopPropagation();App.creditCards.payInvoice('${cardId}', ${total}, '${due}', '${start}', '${end}')" title="Pagar fatura">💳</button>
              <button class="icon-btn" onclick="event.stopPropagation();App.creditCards.refundInvoice('${cardId}', ${total}, '${due}', '${start}', '${end}')" title="Estornar fatura">↩️</button>
            </td>
          </tr>`
        });
      }
    }

    semCartaoTx.forEach(t => {
      const sign = t.type === 'income' || t.type === 'contribution' || t.type === 'refund' || (t.type === 'transfer' && t.transfer_subtype === 'loan_payment') ? '+' : '-';
      const typeLabel = typeNames[t.type] || t.type;
      let desc = t.description || '';
      if (t.type === 'expense' && t.category === 'Pagamento Fatura') {
        const match = t.description?.match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
        if (match) {
          const cardName = match[1].trim();
          const dueMonth = match[2];
          const card = allCards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
          if (card) {
            const period = App.cardInvoice.getInvoicePeriodForMonth(card, dueMonth);
            desc = `<span style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="App.cardInvoice.open('${card.id}', { start: '${period.start}', end: '${period.end}', due: '${period.due}' })">${desc}</span>`;
          }
        }
      }
      if (t.is_recurring_series) desc += ' (Recorrente)';
      else if (t.installments > 1 && t.expense_type !== 'fixed') desc += ` (Parcela ${t.installment_number}/${t.installments})`;
      if (t.expense_type) { const labels = { single: 'Avulsa', installment: 'Parcelada', fixed: 'Fixa' }; desc += ` <span class="badge badge-transfer">${labels[t.expense_type]}</span>`; }
      const accountDisplay = (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal')
        ? `${t.account_name || ''} → ${t.account_to_name || ''}`
        : (t.account_name || '');
      const statusLabel = t.status === 'pending' ? '⏳ Pendente' : '✓ Efetivada';
      const statusClass = t.status === 'pending' ? 'pending' : 'done';
      const dateFormatted = App.utils.formatDateTimeFull(t.date);
      const dateOnly = dateFormatted.split(' ')[0] || '';
      const timeOnly = dateFormatted.split(' ')[1] || '';
      const valueClass = t.type === 'income' || t.type === 'refund' ? 'income' : 'expense';
      const bulkTd = this.bulkMode ? `<td class="bulk-col" style="display:table-cell;"><input type="checkbox" class="bulkCheck" value="${t.id}" ${this.bulkAllSelected ? 'checked' : ''} onchange="App.transactions.updateBulkSelectionSummary()"></td>` : '';
      const runBalTd = this._activeAccountObj
        ? (() => {
            const rb = this._runningBalanceMap && Object.prototype.hasOwnProperty.call(this._runningBalanceMap, t.id) ? this._runningBalanceMap[t.id] : null;
            return `<td class="running-bal-col text-right tabular-nums ${rb !== null && rb < 0 ? 'is-neg' : ''}">${rb !== null ? App.utils.formatCurrency(rb) : '—'}</td>`;
          })()
        : '';
      const recBtn = `<button class="icon-btn tx-rec-btn ${t.reconciled ? 'is-reconciled' : ''}" onclick="event.stopPropagation();App.transactions.toggleReconciled('${t.id}')" title="${t.reconciled ? 'Conciliada com banco (clique para desfazer)' : 'Marcar como conciliada com banco'}" aria-label="Conciliar lançamento">${t.reconciled ? '⚖️' : '○'}</button>`;

      rows.push({
        sortDate: t.date,
        position: t.position || 0,
        html: `<tr draggable="true" data-id="${t.id}" 
                  ondragstart="App.transactions.dragStart(event)" 
                  ondragover="App.transactions.dragOver(event)" 
                  ondrop="App.transactions.drop(event)" 
                  ondragend="App.transactions.dragEnd(event)">
          ${bulkTd}
          <td class="date">${dateOnly}<small>${timeOnly}</small></td>
          <td><span class="badge badge-${t.type}" style="cursor:pointer;" ondblclick="event.stopPropagation();App.transactions.openDetail('${t.id}')" title="Duplo clique para ver detalhes">${typeLabel}</span></td>
          <td>${t.category || '-'}</td>
          <td>${desc}</td>
          <td class="account">${accountDisplay}<small>${t.credit_card_id ? 'Cartão de crédito' : 'Conta corrente'}</small></td>
          <td class="member">${t.member_name || ''}</td>
          <td class="value ${valueClass}">${sign} ${App.utils.formatCurrency(t.amount)}</td>
          ${runBalTd}
          <td class="text-center"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td class="actions-cell">
            ${recBtn}
            <button class="icon-btn" onclick="App.transactions.edit('${t.id}')" title="Editar">✏️</button>
            <button class="icon-btn" onclick="App.transactions.duplicate('${t.id}')" title="Duplicar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            <button class="icon-btn" onclick="App.transactions.toggleStatus('${t.id}')" title="${t.status === 'pending' ? 'Efetivar' : 'Marcar pendente'}">${t.status === 'pending' ? '✅' : '⏳'}</button>
            <button class="icon-btn delete" onclick="App.transactions.confirmDelete('${t.id}')" title="Excluir">🗑️</button>
          </td>
        </tr>`
      });
    });

    if (this.manualOrder) {
      rows.sort((a, b) => (a.position || 0) - (b.position || 0));
    } else {
      rows.sort((a, b) => {
        const cmp = a.sortDate.localeCompare(b.sortDate);
        return this.sortAsc ? cmp : -cmp;
      });
    }

    const totalRows = rows.length;
    const startIdx = (this.currentPage - 1) * this.pageSize;
    const endIdx = startIdx + this.pageSize;
    const pageRows = rows.slice(startIdx, endIdx);

    this.totalResults = totalRows;

    tbody.innerHTML = pageRows.map(r => r.html).join('') || '<tr><td colspan="7">Nenhuma transação</td></tr>';
  },

  async renderGrouped(tx) {
    const __sf = document.getElementById('filterStatus')?.value || 'all';
    if (__sf !== 'all') tx = tx.filter(t => (t.status || 'confirmed') === __sf);
    const allCards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = allCards;
    const cards = {};
    tx.forEach(t => { const cardId = t.credit_card_id || 'sem_cartao'; if (!cards[cardId]) cards[cardId] = []; cards[cardId].push(t); });
    const tbody = document.getElementById('transactionsTableBody');
    let html = '';
    const typeNames = {income:'Receita',expense:'Despesa',transfer:'Transferência',contribution:'Aporte',withdrawal:'Resgate',refund:'Estorno',adjustment:'Ajuste'};

    const todayStr = App.utils.todayISO();
    const rangeStart = App.utils.addMonths(todayStr, -2);
    const rangeEnd = App.utils.addMonths(todayStr, 2);
    let allTxInRange = await App.db.getTransactionsInRange(rangeStart, rangeEnd);
    const statusFilterGrouped = document.getElementById('filterStatus')?.value || 'all';
    if (statusFilterGrouped !== 'all') {
      allTxInRange = allTxInRange.filter(t => t.status === statusFilterGrouped);
    }

    for (const [cardId, txList] of Object.entries(cards)) {
      if (cardId === 'sem_cartao') {
        txList.forEach(t => {
          const sign = t.type==='income'||t.type==='contribution'||t.type==='refund'||(t.type==='transfer' && t.transfer_subtype==='loan_payment')?'+':'-';
          const typeLabel = typeNames[t.type] || t.type;
          let desc = t.description||'';
          if (t.is_recurring_series) desc += ' (Recorrente)';
          else if (t.installments>1 && t.expense_type!=='fixed') desc += ` (Parcela ${t.installment_number}/${t.installments})`;
          if (t.expense_type) { const labels = {single:'Avulsa',installment:'Parcelada',fixed:'Fixa'}; desc += ` <span class="badge badge-transfer">${labels[t.expense_type]}</span>`; }
          const accountDisplay = (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal')
            ? `${t.account_name||''} → ${t.account_to_name||''}`
            : (t.account_name||'');
          const statusLabel = t.status === 'pending' ? '⏳ Pendente' : '✓ Efetivada';
          const statusClass = t.status === 'pending' ? 'pending' : 'done';
          const dateFormatted = App.utils.formatDateTimeFull(t.date);
          const dateOnly = dateFormatted.split(' ')[0] || '';
          const timeOnly = dateFormatted.split(' ')[1] || '';
          const valueClass = t.type === 'income' || t.type === 'refund' ? 'income' : 'expense';
          const iconClass = t.type === 'income' || t.type === 'refund' ? 'income-icon' : (t.type === 'transfer' ? 'transfer-icon' : 'expense-icon');
          const iconSymbol = t.type === 'income' ? '$' : (t.type === 'transfer' ? '⇄' : '▣');
          const bulkTd = this.bulkMode ? `<td class="bulk-col" style="display:table-cell;"><input type="checkbox" class="bulkCheck" value="${t.id}" ${this.bulkAllSelected ? 'checked' : ''} onchange="App.transactions.updateBulkSelectionSummary()"></td>` : '';
          const runBalTd = this._activeAccountObj
            ? (() => {
                const rb = this._runningBalanceMap && Object.prototype.hasOwnProperty.call(this._runningBalanceMap, t.id) ? this._runningBalanceMap[t.id] : null;
                return `<td class="running-bal-col text-right tabular-nums ${rb !== null && rb < 0 ? 'is-neg' : ''}">${rb !== null ? App.utils.formatCurrency(rb) : '—'}</td>`;
              })()
            : '';
          const recBtn = `<button class="icon-btn tx-rec-btn ${t.reconciled ? 'is-reconciled' : ''}" onclick="event.stopPropagation();App.transactions.toggleReconciled('${t.id}')" title="${t.reconciled ? 'Conciliada com banco' : 'Marcar como conciliada'}">${t.reconciled ? '⚖️' : '○'}</button>`;
          html += `<tr>
            ${bulkTd}
            <td class="date">${dateOnly}<small>${timeOnly}</small></td>
            <td><span class="badge badge-${t.type}" style="cursor:pointer;" ondblclick="event.stopPropagation();App.transactions.openDetail('${t.id}')" title="Duplo clique para ver detalhes">${typeLabel}</span></td>
            <td>${t.category || '-'}</td>
            <td>${desc}</td>
            <td class="account">${accountDisplay}<small>${t.credit_card_id ? 'Cartão de crédito' : 'Conta corrente'}</small></td>
            <td class="member">${t.member_name || ''}</td>
            <td class="value ${valueClass}">${sign} ${App.utils.formatCurrency(t.amount)}</td>
            ${runBalTd}
            <td class="text-center"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td class="actions-cell">
              ${recBtn}
              <button class="icon-btn" onclick="App.transactions.edit('${t.id}')">✏️</button>
              <button class="icon-btn" onclick="App.transactions.duplicate('${t.id}')" title="Duplicar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
              <button class="icon-btn" onclick="App.transactions.toggleStatus('${t.id}')">${t.status === 'pending' ? '✅' : '⏳'}</button>
              <button class="icon-btn delete" onclick="App.transactions.confirmDelete('${t.id}')">🗑️</button>
            </td>
          </tr>`;
        });
      } else {
        const card = allCards.find(c => c.id === cardId) || {};
        const cardName = card.name || 'Cartão';
        let invoicePeriod;
        try { invoicePeriod = App.cardInvoice.getCurrentInvoicePeriod(card); }
        catch (e) { invoicePeriod = { start: todayStr, end: todayStr, due: todayStr }; }
        const { start, end } = invoicePeriod;
        const cardTx = allTxInRange.filter(t => t.credit_card_id === cardId && t.date >= start && t.date <= end && (t.type === 'expense' || t.type === 'refund'));
        const totalExpense = cardTx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
        const totalRefund = cardTx.filter(t => t.type === 'refund').reduce((s, t) => s + parseFloat(t.amount), 0);
        const total = totalExpense - totalRefund;
        const colSpan = 9 + (this.bulkMode ? 1 : 0) + (this._activeAccountObj ? 1 : 0);
        html += `<tr style="cursor:pointer;background:var(--bg-secondary);" onclick="App.cardInvoice.open('${cardId}')"><td colspan="${colSpan}"><strong>💳 ${cardName}</strong> — ${cardTx.length} transações, Total: ${App.utils.formatCurrency(total)}</td></tr>`;
      }
    }
    tbody.innerHTML = html || '<tr><td colspan="10">Nenhuma transação</td></tr>';
  },

  async quickChangeCategory(txId) {
    const tx = await App.db.getById('transactions', txId);
    if (!tx) return;
    const cats = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = cats;
    const filtered = cats.filter(c => !c.archived && (c.type === tx.type || (['transfer','contribution','withdrawal','refund'].includes(tx.type) && c.type==='expense')));
    let html = '<div class="category-list">';
    filtered.forEach(c => { html += `<div class="category-item ${c.parent_id?'subcategory':''}" onclick="App.transactions.applyCategoryChange('${txId}','${c.name}')" style="cursor:pointer; padding:8px; border-radius:4px; margin:2px;">${c.parent_id ? '↳ ' : ''}${c.name}</div>`; });
    html += '</div>';
    document.getElementById('categoryChangeContent').innerHTML = html;
    App.ui.openModal('modalCategoryChange');
  },

  async applyCategoryChange(txId, newCat) {
    App.ui.closeModal('modalCategoryChange');
    const tx = await App.db.getById('transactions', txId);
    if (!tx) return;
    if (tx.is_recurring_series || (tx.installments > 1)) {
      App.utils.confirm('Esta transação faz parte de uma série. Deseja alterar apenas esta, todas ou esta e as próximas?', () => {
        App.utils.prompt('Escolha: "esta" (apenas esta), "proximas" (esta e próximas), "todas" (todas da série):', 'esta', async (scope) => {
          if (scope === 'todas') {
            const allTx = await App.db.getAll('transactions');
            const group = allTx.filter(t => t.installment_id === tx.installment_id || (tx.is_recurring_series && t.description === tx.description && t.member_id === tx.member_id));
            for (const t of group) { t.category = newCat; await App.db.put('transactions', t); }
          } else if (scope === 'proximas') {
            const allTx = await App.db.getAll('transactions');
            const group = allTx.filter(t => (t.installment_id === tx.installment_id && t.installment_number >= tx.installment_number) || (tx.is_recurring_series && t.description === tx.description && t.member_id === tx.member_id && t.date >= tx.date));
            for (const t of group) { t.category = newCat; await App.db.put('transactions', t); }
          } else { tx.category = newCat; await App.db.put('transactions', tx); }
          this.invalidateCache();
          this.load(); App.dashboard.refresh(); App.panel.refresh(); App.utils.showToast('Categoria(s) atualizada(s)!');
        });
      });
    } else {
      tx.category = newCat; await App.db.put('transactions', tx);
      this.invalidateCache();
      this.load(); App.dashboard.refresh(); App.panel.refresh(); App.utils.showToast('Categoria atualizada!');
    }
  },

   async toggleStatus(id) {
    const tx = await App.db.getById('transactions', id);
    if (!tx) return;
    if (tx.invoice_locked) {
      App.utils.showToast('Esta transação pertence a uma fatura já paga e não pode ser alterada.', 'error');
      return;
    }
    tx.status = tx.status === 'pending' ? 'confirmed' : 'pending';
    await App.db.put('transactions', tx);
    this.invalidateCache();
    await App.saldos.load();
    this.load(); App.dashboard.refresh(); App.panel.refresh();
    App.utils.showToast(`Transação ${tx.status === 'confirmed' ? 'efetivada' : 'pendente'}!`);
  },

  setDateFromCycle() {
    const month = document.getElementById('txCycleMonth').value;
    if (month) { const [y,m] = month.split('-'); document.getElementById('txDate').value = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate; }
  },

  async classify(id) {
    const tx = await App.db.getById('transactions', id); if (!tx) return;
    App.transactions._pendingClassifyId = id;
    document.getElementById('classifyDesc').innerHTML = `Transação: <strong>${tx.description||tx.category}</strong><br>Valor: ${App.utils.formatCurrency(tx.amount)}`;
    App.ui.openModal('modalClassification');
  },

  async applyClassification(classification) {
    App.ui.closeModal('modalClassification');
    const id = App.transactions._pendingClassifyId;
    if (!id) return;
    const tx = await App.db.getById('transactions', id);
    if (tx) {
      tx.classification = classification;
      tx.updatedAt = new Date().toISOString();
      await App.db.put('transactions', tx);
      this.invalidateCache();
      App.cache.totalBalance = null;
      this.load();
      App.dashboard.refresh();
      App.panel.refresh();
      if (App.classification) App.classification.load();
      if (App.categorization) App.categorization.load();
      if (App.analytics) App.analytics.refresh();
    }
    App.transactions._pendingClassifyId = null;
  },  

  async updateEndividamentoHint() {
    const hintEl = document.getElementById('endividamentoHint'); if (!hintEl) return;
    const type = document.getElementById('txType').value; const memberId = document.getElementById('txMember').value;
    const amount = parseFloat((document.getElementById('txAmount').value || '').replace(',', '.')) || 0;
    const installments = parseInt(document.getElementById('txInstallments')?.value) || 1;
    if (type !== 'expense' || !memberId || amount <= 0) { hintEl.style.display = 'none'; return; }
    const txAll = await App.db.getAll('transactions');
    const member = await App.db.getById('members', memberId); const limit = member?.debt_limit || 30;
    const futureExpense = txAll.filter(t => t.member_id === memberId && t.date >= App.utils.todayISO() && t.type === 'expense' && t.status === 'confirmed').reduce((s,t) => s + parseFloat(t.amount), 0);
    const curMonth = App.utils.currentMonth();
    const income = txAll.filter(t => t.member_id === memberId && t.date >= curMonth.start && t.date <= curMonth.end && t.type === 'income' && t.status === 'confirmed').reduce((s,t) => s + parseFloat(t.amount), 0);
    const totalExpense = futureExpense + (amount * installments);
    const percent = income > 0 ? (totalExpense / income) * 100 : (totalExpense > 0 ? 100 : 0);
    let cls = '', msg = '';
    if (percent < 5) { cls = 'endividamento-otimo'; msg = '🟢 Menos de 5% da renda — compra extensa aceitável.'; }
    else if (percent < 10) { cls = 'endividamento-aceitavel'; msg = '🟡 Menos de 10% da renda — aceitável para compras extensas.'; }
    else if (percent < 15) { cls = 'endividamento-aceitavel'; msg = '🟠 Entre 10% e 15% — aceitável apenas a curto prazo.'; }
    else if (percent < 20) { cls = 'endividamento-curto-prazo'; msg = '🔴 Entre 15% e 20% — válido só a curto prazo, cuidado.'; }
    else { cls = 'endividamento-evitar'; msg = '⛔ Acima de 20% da renda — compra não recomendada.'; }
    hintEl.className = cls; hintEl.innerHTML = `${msg} (Comprometimento: ${percent.toFixed(1)}% da renda de ${App.utils.formatCurrency(income)})`; hintEl.style.display = 'block';
  },

  async save(e) {
    e.preventDefault();
    try {
      const id = document.getElementById('txId').value, type = document.getElementById('txType').value;
      const originalTx = id ? await App.db.getById('transactions', id) : null;
      // Limpa flags de edição em lote se a transação atual for diferente da pendente
      if (this._pendingEditId && this._pendingEditId !== id) {
        this._pendingEditId = null;
        this._pendingEditScope = null;
      }
      const amountRaw = document.getElementById('txAmount').value || '0';
      const amount = parseFloat(amountRaw.replace(',', '.'));
      let category = document.getElementById('txCategory').value;
      // Se for transferência de aporte/resgate e a categoria estiver vazia, força o valor padrão
      if (type === 'transfer' && !category) {
        const subtype = document.getElementById('txTransferSubtype')?.value;
        if (subtype === 'aporte') category = 'Aporte';
        else if (subtype === 'resgate') category = 'Resgate';
      }
      let account_id = document.getElementById('txAccount').value;
      const account_to_id = (type==='transfer'||type==='contribution'||type==='withdrawal') ? document.getElementById('txAccountTo').value : null;
      const date = document.getElementById('txDate').value;
      const time = document.getElementById('txTime')?.value || '00:00';
      // Inclui a hora se foi preenchida (diferente de vazio e não for meia-noite)
      const fullDate = (time && time !== '00:00') ? date + 'T' + time + ':00' : date;
      const description = document.getElementById('txDescription').value;
      const notes = document.getElementById('txNotes').value, member_id = document.getElementById('txMember').value;
      const credit_card_id = (type==='expense'||type==='refund') ? document.getElementById('txCreditCard').value : null;

      // ---- Garantia: transação de cartão herda SEMPRE a conta do cartão ----
      // Evita que o account_id do formulário seja gravado em divergência com
      // o cartão (causa do bug "Fatura XP na conta Nubank").
      if (credit_card_id) {
        const _cardForAccount = await App.db.getById('creditCards', credit_card_id);
        if (_cardForAccount && _cardForAccount.account_id) {
          account_id = _cardForAccount.account_id;
        }
      }
      const installments = parseInt(document.getElementById('txInstallments').value)||1;
      if (installments > 720) {
        App.utils.showToast(`🤨 Cara... ${installments} parcelas? Você pretende terminar de pagar isso em outra vida?`, 'error');
        return false;
      }
      const recurring = document.getElementById('txRecurring').checked;
      const recurringTimes = recurring ? (parseInt(document.getElementById('txRecurringTimes')?.value) || 12) : 0;
      const addAsset = document.getElementById('txAddAsset').checked, vacation = document.getElementById('txVacation').checked;
      const classification = document.getElementById('txClassification').value;

      const receipt_url = document.getElementById('txReceiptUrl').value;
      const purchase_date = document.getElementById('txPurchaseDate').value;
      const investment_id = document.getElementById('txInvestment')?.value || null;
      const transfer_subtype = (type === 'transfer') ? (document.getElementById('txTransferSubtype')?.value || 'normal') : '';
      const isLoan = document.getElementById('txIsLoan')?.checked || false;
      const expense_type = document.getElementById('txExpenseType')?.value || '';
      const status = document.getElementById('txStatus')?.value || 'confirmed';
      const reconciled = document.getElementById('txReconciled')?.value === 'true';
      const isSplit = document.getElementById('txIsSplit').value === 'true';
      const ignore_from_total = document.getElementById('txIgnoreFromTotal')?.checked || false;
      const paymentMethodRaw = document.getElementById('txPaymentMethod')?.value || '';
      let fonte_pagadora_id = null;
      let finalPaymentMethod = paymentMethodRaw;
      if (paymentMethodRaw.startsWith('fp_')) {
        fonte_pagadora_id = paymentMethodRaw.substring(3);
        finalPaymentMethod = '';
      }

      // NOVO: Divisão entre membros via toggle – com suporte a parcelamento, aporte e resgate
      const memberSplitData = App.ui.getMemberSplitData();
      if (memberSplitData && memberSplitData.length === 1) {
        App.utils.showToast('Selecione ao menos 2 membros para dividir.', 'error');
        return false;
      }
      if (memberSplitData && memberSplitData.length > 1) {
        if (!type || isNaN(amount) || amount <= 0 || !account_id || !date) {
          if (isNaN(amount) || amount <= 0) App.utils.showFieldError(document.getElementById('txAmount'), 'Valor deve ser positivo');
          if (!account_id) App.utils.showFieldError(document.getElementById('txAccount'), 'Selecione uma conta');
          if (!date) App.utils.showFieldError(document.getElementById('txDate'), 'Informe a data');
          App.utils.showToast('Preencha campos obrigatórios', 'error');
          return false;
        }
        if (type !== 'transfer' && !category) {
          App.utils.showFieldError(document.getElementById('txCategory'), 'Selecione uma categoria');
          App.utils.showToast('Preencha campos obrigatórios', 'error');
          return false;
        }
        if ((type === 'transfer' || type === 'contribution' || type === 'withdrawal') && (!account_to_id || account_id === account_to_id)) {
          App.utils.showFieldError(document.getElementById('txAccountTo'), 'Contas inválidas ou iguais');
          App.utils.showToast('Contas inválidas', 'error');
          return false;
        }

        const totalSplit = memberSplitData.reduce((s, sp) => s + sp.amount, 0);
        if (Math.abs(totalSplit - amount) > 0.01) {
          App.utils.showToast('Soma das partes difere do valor total', 'error');
          return false;
        }

        // ===== COMBINAÇÃO: divisão entre membros + divisão entre cartões =====
        const cardSplitDataCombined = App.ui.getCardSplitData();
        if (cardSplitDataCombined && cardSplitDataCombined.length > 0 && !id) {
          const sumSplitCards = cardSplitDataCombined.reduce((s, e) => s + e.amount, 0);
          if (Math.abs(sumSplitCards - amount) > 0.01) {
            App.utils.showToast('A soma dos valores por cartão difere do total da compra.', 'error');
            return false;
          }

          const accountsCombined = App.cache.accounts || await App.db.getAll('accounts');
          const membersCombined = App.cache.members || await App.db.getAll('members');
          const accCombined = accountsCombined.find(a => a.id === account_id);

          const splitMemberNamesCombined = memberSplitData.map(sp => {
            const mem = membersCombined.find(m => m.id === sp.member_id);
            return mem ? mem.name : sp.member_id;
          }).filter(Boolean);
          const composedNameCombined = splitMemberNamesCombined.length > 0 ? splitMemberNamesCombined.join(' + ') : 'Membros';

          const memberRatiosCombined = memberSplitData.map(sp => ({
            member_id: sp.member_id,
            ratio: sp.amount / amount
          }));

          const baseDateCombined = purchase_date || date;

          for (const splitEntry of cardSplitDataCombined) {
            try {
              const cardIdCombined = splitEntry.card_id;
              const cardAmountTotal = splitEntry.amount;
              const cardMonths = Math.max(1, parseInt(splitEntry.installments) || 1);
              const cardGroupId = cardMonths > 1 ? App.utils.generateId() : null;

              const baseParcelValue = cardAmountTotal / cardMonths;
              const roundedParcel = Math.round(baseParcelValue * 100) / 100;
              const sumFirstParcels = roundedParcel * (cardMonths - 1);
              const lastParcel = Math.round((cardAmountTotal - sumFirstParcels) * 100) / 100;

              for (let i = 0; i < cardMonths; i++) {
                const newDate = App.utils.addMonths(baseDateCombined, i) + 'T' + time + ':00';
                let parcelStatus = status;
                const today = App.utils.todayISO();
                if (newDate.slice(0, 10) > today) {
                  parcelStatus = 'pending';
                }

                let parcelDescription = description;
                if (cardMonths > 1) {
                  parcelDescription = `${description} - Parcela ${i + 1} de ${cardMonths}`;
                }

                const parcelAmount = (i === cardMonths - 1) ? lastParcel : roundedParcel;

                // Distribui o valor da parcela entre os membros
                const memberSplits = [];
                let sumParts = 0;
                for (let j = 0; j < memberRatiosCombined.length; j++) {
                  const rawMemberAmount = parcelAmount * memberRatiosCombined[j].ratio;
                  const roundedMember = Math.round(rawMemberAmount * 100) / 100;
                  memberSplits.push({
                    member_id: memberRatiosCombined[j].member_id,
                    amount: roundedMember
                  });
                  sumParts += roundedMember;
                }
                if (memberSplits.length > 0) {
                  const diff = Math.round((parcelAmount - sumParts) * 100) / 100;
                  memberSplits[memberSplits.length - 1].amount += diff;
                }

                await App.db.put('transactions', {
                  id: App.utils.generateId(),
                  type,
                  amount: parcelAmount,
                  category,
                  account_id,
                  account_name: accCombined?.name || '',
                  account_to_id: account_to_id || '',
                  account_to_name: '',
                  date: newDate,
                  description: parcelDescription,
                  notes: notes || '',
                  member_id: null,
                  member_name: composedNameCombined,
                  credit_card_id: cardIdCombined,
                  installments: cardMonths,
                  installment_number: i + 1,
                  installment_id: cardGroupId,
                  recurring: false,
                  vacation,
                  classification,
                  payment_method: finalPaymentMethod,
                  receipt_url,
                  purchase_date: baseDateCombined,
                  investment_id: null,
                  loan_id: null,
                  is_recurring_series: false,
                  expense_type: cardMonths > 1 ? 'installment' : (expense_type || ''),
                  recurring_times: 0,
                  status: parcelStatus,
                  reconciled,
                  ignore_from_total,
                  fonte_pagadora_id: fonte_pagadora_id || null,
                  createdAt: new Date().toISOString(),
                  position: Date.now(),
                  member_splits: memberSplits
                });
              }
            } catch (parcelError) {
              console.error(`Erro ao criar parcelas do cartão ${splitEntry.card_id}:`, parcelError);
              App.utils.showToast(`Falha ao criar parcelas de um dos cartões. As demais serão processadas.`, 'error');
            }
          }

          this.invalidateCache();
          App.cache.accounts = null;
          App.cache.totalBalance = null;
          await App.saldos.load();
          this.load();
          App.dashboard.refresh();
          App.creditCards.load();
          App.investments.load();
          App.patrimony.load();
          App.panel.refresh();
          App.installments.load();
          App.ui.closeModal('modalTransaction', true);
          App.utils.showToast('Criado com divisão de cartões e membros!');
          return false;
        }
        // ===== FIM DA COMBINAÇÃO =====

        const accounts = App.cache.accounts || await App.db.getAll('accounts');
        const members = App.cache.members || await App.db.getAll('members');
        const acc = accounts.find(a => a.id === account_id);
        const accTo = (type === 'transfer' || type === 'contribution' || type === 'withdrawal') ? accounts.find(a => a.id === account_to_id) : null;
        // Monta nome composto com os membros da divisão
        const splitMemberNames = memberSplitData.map(sp => {
          const mem = members.find(m => m.id === sp.member_id);
          return mem ? mem.name : sp.member_id;
        }).filter(Boolean);
        const composedName = splitMemberNames.length > 0 ? splitMemberNames.join(' + ') : 'Membros';

        // Ajusta recorrência (despesa fixa ou recorrente)
        let finalRecurringSplit = recurring;
        let finalRecurringTimesSplit = recurringTimes;
        if (expense_type === 'fixed') {
          finalRecurringSplit = true;
          finalRecurringTimesSplit = 60;
        }

        // Define quantas parcelas serão geradas
        const totalMonthsSplit = (installments > 1 || finalRecurringSplit) && expense_type !== 'fixed'
          ? (finalRecurringSplit ? Math.min(finalRecurringTimesSplit, 60) : installments)
          : (finalRecurringSplit ? Math.min(finalRecurringTimesSplit, 60) : 1);

        // Se for edição (id existe), preserva metadados da transação original
        if (id) {
          const baseTx = {
            id: id,
            type, amount, category,
            account_id, account_name: acc?.name || '',
            account_to_id: account_to_id || '', account_to_name: accTo?.name || '',
            date: fullDate, description, notes: notes || '',
            member_id: null, member_name: composedName,
            credit_card_id: originalTx ? (originalTx.credit_card_id || '') : (credit_card_id || ''),
            installments: originalTx ? (originalTx.installments || 1) : 1,
            installment_number: originalTx ? (originalTx.installment_number || 1) : 1,
            installment_id: originalTx ? (originalTx.installment_id || null) : null,
            recurring: false, vacation, classification,
            payment_method: finalPaymentMethod, receipt_url, purchase_date: originalTx ? (originalTx.purchase_date || purchase_date) : purchase_date,
            investment_id: investment_id || null, loan_id: originalTx ? (originalTx.loan_id || null) : null,
            is_recurring_series: originalTx ? (originalTx.is_recurring_series || false) : false,
            expense_type: originalTx ? (originalTx.expense_type || '') : '',
            recurring_times: originalTx ? (originalTx.recurring_times || 0) : 0,
            status, reconciled, ignore_from_total,
            fonte_pagadora_id: fonte_pagadora_id || null,
            transfer_subtype,
            createdAt: originalTx ? (originalTx.createdAt || new Date().toISOString()) : new Date().toISOString(),
            position: originalTx ? (originalTx.position || Date.now()) : Date.now(),
            member_splits: memberSplitData
          };
          await App.db.put('transactions', baseTx);
          this.invalidateCache();

          // Atualiza total_recebido da fonte pagadora (se for receita com fonte vinculada)
          if (type === 'income' && fonte_pagadora_id) {
            const fonte = await App.db.getById('fontesPagadoras', fonte_pagadora_id);
            if (fonte) {
              const txAntiga = originalTx;
              const valorAntigo = txAntiga && txAntiga.type === 'income' && txAntiga.fonte_pagadora_id === fonte_pagadora_id ? parseFloat(txAntiga.amount) : 0;
              fonte.total_recebido = (fonte.total_recebido || 0) - valorAntigo + amount;
              await App.db.put('fontesPagadoras', fonte);
            }
          } else if (originalTx && originalTx.type === 'income' && originalTx.fonte_pagadora_id && (type !== 'income' || fonte_pagadora_id !== originalTx.fonte_pagadora_id)) {
            const fonteAntiga = await App.db.getById('fontesPagadoras', originalTx.fonte_pagadora_id);
            if (fonteAntiga) {
              fonteAntiga.total_recebido = Math.max(0, (fonteAntiga.total_recebido || 0) - parseFloat(originalTx.amount));
              await App.db.put('fontesPagadoras', fonteAntiga);
            }
          }
        } else {
          // Atualiza investimento vinculado para aporte/resgate (novos lançamentos)
          if ((type === 'transfer' && (transfer_subtype === 'aporte' || transfer_subtype === 'resgate') && investment_id) ||
              ((type === 'contribution' || type === 'withdrawal') && investment_id)) {
            const inv = await App.db.getById('investments', investment_id);
            if (inv) {
              const oldCurrent = parseFloat(inv.current_value) || 0;
              const isAporte = (type === 'contribution') || (transfer_subtype === 'aporte');
              if (isAporte) {
                inv.current_value = oldCurrent + amount;
              } else {
                inv.current_value = Math.max(0, oldCurrent - amount);
              }
              await App.db.put('investments', inv);
              const note = isAporte ? 'Aporte' : 'Resgate';
              const tipoHist = isAporte ? 'aporte' : 'resgate';
              const existingHistory = (await App.db.getAll('investmentHistory'))
                .filter(h => h.investment_id === investment_id && h.date === fullDate && h.value === inv.current_value && h.note === note);
              if (existingHistory.length === 0) {
                await App.db.put('investmentHistory', {
                  id: App.utils.generateId(),
                  investment_id: investment_id,
                  date: fullDate,
                  value: inv.current_value,
                  note: note,
                  type: tipoHist
                });
              }
            }
          }

          // Nova transação com divisão: cria parcelas
          const groupId = totalMonthsSplit > 1 ? App.utils.generateId() : null;
          const baseDateForInstallments = purchase_date || date;

          // Se for empréstimo, cria o registro uma única vez e guarda o id
          let loanId = null;
          if (isLoan) {
            loanId = App.utils.generateId();
            await App.db.put('loans', {
              id: loanId,
              person: description,
              amount,
              date,
              due_date: '',
              type: type === 'expense' ? 'lent' : 'borrowed',
              status: 'pending',
              notes
            });
          }

          // Calcula proporções de cada membro (para distribuir em cada parcela)
          const memberRatios = memberSplitData.map(sp => ({
            member_id: sp.member_id,
            ratio: sp.amount / amount
          }));

          for (let i = 0; i < totalMonthsSplit; i++) {
            const newDate = App.utils.addMonths(baseDateForInstallments, i) + 'T' + time + ':00';
            let parcelStatus = status;
            const today = App.utils.todayISO();
            if ((expense_type === 'fixed' || (installments > 1 && expense_type !== 'fixed')) && newDate.slice(0, 10) > today) {
              parcelStatus = 'pending';
            }

            let parcelDescription = description;
            if (totalMonthsSplit > 1) {
              parcelDescription = `${description} - Parcela ${i + 1} de ${totalMonthsSplit}`;
            }

            // CORREÇÃO: o valor da parcela é o próprio valor total informado (amount),
            // pois a divisão entre membros já foi definida proporcionalmente.
            const parcelAmount = amount;

            // Distribui os valores dos membros para esta parcela
            const memberSplits = [];
            let sumParts = 0;
            for (let j = 0; j < memberRatios.length; j++) {
              const rawMemberAmount = parcelAmount * memberRatios[j].ratio;
              const roundedMember = Math.round(rawMemberAmount * 100) / 100;
              memberSplits.push({
                member_id: memberRatios[j].member_id,
                amount: roundedMember
              });
              sumParts += roundedMember;
            }
            // Ajusta centavos na última parte do último membro
            if (memberSplits.length > 0) {
              const diff = Math.round((parcelAmount - sumParts) * 100) / 100;
              memberSplits[memberSplits.length - 1].amount += diff;
            }

            await App.db.put('transactions', {
              id: App.utils.generateId(),
              type, amount: parcelAmount, category,
              account_id, account_name: acc?.name || '',
              account_to_id: account_to_id || '', account_to_name: accTo?.name || '',
              date: newDate,
              description: parcelDescription,
              notes: notes || '',
              member_id: null,
              member_name: composedName,
              credit_card_id: credit_card_id || '',
              installments: totalMonthsSplit,
              installment_number: i + 1,
              installment_id: groupId,
              recurring: false,
              vacation,
              classification,
              payment_method: finalPaymentMethod,
              receipt_url,
              purchase_date: baseDateForInstallments,
              investment_id: investment_id || null,
              loan_id: loanId,
              is_recurring_series: finalRecurringSplit,
              expense_type: expense_type,
              recurring_times: finalRecurringTimesSplit,
              status: parcelStatus,
              reconciled,
              ignore_from_total,
              fonte_pagadora_id: fonte_pagadora_id || null,
              transfer_subtype,
              createdAt: new Date().toISOString(),
              position: Date.now(),
              member_splits: memberSplits
            });
          }

          // Se for adicionar ao patrimônio (apenas despesa) – soma total
          if (addAsset && type === 'expense') {
            const assetValue = totalMonthsSplit > 1 ? amount * totalMonthsSplit : amount;
            await App.db.put('patrimony', {
              id: App.utils.generateId(),
              name: description || 'Bem adquirido',
              type: 'asset',
              value: assetValue,
              date,
              description: 'Adquirido via transação dividida',
              createdAt: new Date().toISOString()
            });
          }
        }

        this.invalidateCache();

        App.ui.closeModal('modalTransaction', true);
        App.utils.showToast(id ? 'Atualizado!' : 'Criado!');
      
        // Invalida caches e força recarga consistente
        this.invalidateCache();
        App.cache.accounts = null;
        App.cache.totalBalance = null;
      
        await App.saldos.load();
        this.load();
        App.dashboard.refresh();
        App.creditCards.load();
        App.investments.load();
        App.patrimony.load();
        App.panel.refresh();
        App.installments.load();
      
        // Se a transação envolve cartão de crédito, recarrega a fatura ativa (se houver)
        if (credit_card_id) {
          App.cardInvoice.load().catch(() => {});
        }
        // Se a página ativa for a fatura do cartão, recarrega-a explicitamente
        if (document.getElementById('page-card-invoice')?.classList.contains('active')) {
          App.cardInvoice.load().catch(() => {});
        }
        return false;
      }
      // FIM DO NOVO

      const memberSplitCheck = (App.cache.members || await App.db.getAll('members')).find(m => m.id === member_id);
      if (isSplit || (type === 'expense' && memberSplitCheck && memberSplitCheck.name === 'Casal' && memberSplitCheck.split_to && memberSplitCheck.split_to.length >= 2)) {
        // Preenche automaticamente categoria e conta do split com os valores da transação, se estiverem vazios
        document.querySelectorAll('.split-entry').forEach(entry => {
          const catSel = entry.querySelector('.split-category');
          const accSel = entry.querySelector('.split-account');
          if (catSel && !catSel.value) catSel.value = category;
          if (accSel && !accSel.value) accSel.value = account_id;
        });
        const splits = App.split.getSplits();
        if (!splits.length) { App.utils.showToast('Adicione ao menos uma parte no split','error'); return false; }
        if (Math.abs(splits.reduce((s,sp)=>s+sp.amount,0) - amount) > 0.01) { App.utils.showToast('Soma das partes difere do valor total','error'); return false; }
        for (const sp of splits) {
          const acc = (App.cache.accounts || await App.db.getAll('accounts')).find(a=>a.id===sp.account_id);
          const mem = (App.cache.members || await App.db.getAll('members')).find(m=>m.id===(sp.member_id || member_id));
          const desc = (type === 'expense')
            ? (description ? description + ' [Casal]' : '[Casal]')
            : (description || '');
          const baseTx = { type, amount: sp.amount, category: sp.category, account_id: sp.account_id, account_name: acc?.name||'', account_to_id: '', account_to_name: '', date: fullDate, description: desc, notes, member_id: sp.member_id || member_id, member_name: mem?.name||'', credit_card_id: '', installments:1, installment_number:1, installment_id:null, recurring:false, vacation, classification, payment_method: finalPaymentMethod, receipt_url, purchase_date, investment_id:null, loan_id: null, status, reconciled, expense_type: '', ignore_from_total, createdAt:new Date().toISOString() };
          await App.db.put('transactions', { ...baseTx, id: App.utils.generateId() });
        }
        this.invalidateCache();
        App.ui.closeModal('modalTransaction', true); App.utils.showToast('Transação dividida salva!');
        await App.saldos.load();
        this.load(); App.dashboard.refresh(); App.creditCards.load(); App.investments.load(); App.patrimony.load(); App.panel.refresh(); App.installments.load();
        return false;
      }

      if (!type||isNaN(amount)||amount<=0||!account_id||!date) {
        if (isNaN(amount)||amount<=0) App.utils.showFieldError(document.getElementById('txAmount'),'Valor deve ser positivo');
        if (!account_id) App.utils.showFieldError(document.getElementById('txAccount'),'Selecione uma conta');
        if (!date) App.utils.showFieldError(document.getElementById('txDate'),'Informe a data');
        App.utils.showToast('Preencha campos obrigatórios','error'); return false;
      }
      // Categoria não é obrigatória para transferência
      if (type !== 'transfer' && !category) {
        App.utils.showFieldError(document.getElementById('txCategory'), 'Selecione uma categoria');
        App.utils.showToast('Preencha campos obrigatórios', 'error'); return false;
      }
      if ((type==='transfer'||type==='contribution'||type==='withdrawal') && (!account_to_id||account_id===account_to_id)) {
        App.utils.showFieldError(document.getElementById('txAccountTo'),'Contas inválidas ou iguais'); App.utils.showToast('Contas inválidas','error'); return false;
      }

      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      const members = App.cache.members || await App.db.getAll('members');
      const acc = accounts.find(a=>a.id===account_id), accTo = accounts.find(a=>a.id===account_to_id);
      const member = members.find(m=>m.id===member_id);

      let finalRecurring = recurring;
      let finalRecurringTimes = recurringTimes;
      if (expense_type === 'fixed') {
        finalRecurring = true;
        finalRecurringTimes = 60;
      }

      const isEditAll = (this._pendingEditScope === 'all');
      const baseTx = {
        type, amount, category,
        account_id, account_name:acc?.name||'',
        account_to_id:account_to_id||'', account_to_name:accTo?.name||'',
        date: fullDate,
        description, notes:notes||'',
        member_id:member_id||'', member_name:member?.name||'',
        credit_card_id:credit_card_id||'',
        // Preserva dados estruturais da parcela original quando existir
        installments: originalTx ? (isEditAll ? installments : originalTx.installments) : (type==='expense' && expense_type !== 'fixed' ? installments:1),
        installment_number: originalTx ? (isEditAll ? 1 : originalTx.installment_number) : 1,
        installment_id: originalTx ? originalTx.installment_id : null,
        recurring: false, vacation, classification, payment_method: finalPaymentMethod, receipt_url,
        purchase_date: originalTx ? originalTx.purchase_date : (purchase_date || (type==='expense' && installments>1 ? date : '')),
        investment_id, loan_id: isLoan ? App.utils.generateId() : null,
        is_recurring_series: finalRecurring,
        expense_type: type==='expense' ? expense_type : '',
        recurring_times: finalRecurringTimes,
        status, reconciled, ignore_from_total, fonte_pagadora_id,
        transfer_subtype,
        createdAt:new Date().toISOString(), position: Date.now()
      };

      if (isLoan) { await App.db.put('loans', { id: baseTx.loan_id, person: description, amount, date, due_date: '', type: (type==='expense') ? 'lent' : 'borrowed', status: 'pending', notes }); }
      
      // Atualiza investimento vinculado para:
      // - Transferência com subtipo aporte/resgate
      // - Contribution (aporte) ou Withdrawal (resgate) com investment_id
           if ((type === 'transfer' && (transfer_subtype === 'aporte' || transfer_subtype === 'resgate') && investment_id) ||
          ((type === 'contribution' || type === 'withdrawal') && investment_id)) {
        const inv = await App.db.getById('investments', investment_id);
        if (inv) {
          const oldCurrent = parseFloat(inv.current_value) || 0;
          const isAporte = (type === 'contribution') || (transfer_subtype === 'aporte');
          if (isAporte) {
            inv.current_value = oldCurrent + amount;
          } else {
            inv.current_value = Math.max(0, oldCurrent - amount);
          }
          // amount_invested permanece inalterado (capital inicial fixo)
          await App.db.put('investments', inv);
          const note = isAporte ? 'Aporte' : 'Resgate';
          const tipoHist = isAporte ? 'aporte' : 'resgate';
          const existingHistory = (await App.db.getAll('investmentHistory'))
            .filter(h => h.investment_id === investment_id && h.date === fullDate && h.value === inv.current_value && h.note === note);
          if (existingHistory.length === 0) {
            await App.db.put('investmentHistory', {
              id: App.utils.generateId(),
              investment_id: investment_id,
              date: fullDate,
              value: inv.current_value,
              note: note,
              type: tipoHist
            });
          }
        }
      }
      if (type === 'refund') { baseTx.installments = 1; baseTx.recurring = false; baseTx.account_to_id = ''; baseTx.account_to_name = ''; baseTx.id = id || App.utils.generateId(); await App.db.put('transactions', baseTx); this.invalidateCache(); App.ui.closeModal('modalTransaction', true); App.utils.showToast('Estorno lançado!'); await App.saldos.load(); this.load(); App.dashboard.refresh(); App.creditCards.load(); return false; }

      if (id) {
        baseTx.id = id;
        await App.db.put('transactions', baseTx);
      } else {
        const groupId = App.utils.generateId();
        const totalMonths = (installments > 1 || finalRecurring) && expense_type !== 'fixed' ? (finalRecurring ? Math.min(finalRecurringTimes, 60) : installments) : (finalRecurring ? Math.min(finalRecurringTimes, 60) : 1);
        // Usa a data da compra como base para parcelamento (se existir)
        const baseDateForInstallments = purchase_date || date;

        // ----- DIVISÃO ENTRE CARTÕES (cada cartão com seu próprio parcelamento) -----
        const cardSplitData = App.ui.getCardSplitData();
        const totalAmount = amount; // valor total da compra
        if (cardSplitData && cardSplitData.length > 0) {
          const sumSplit = cardSplitData.reduce((s, e) => s + e.amount, 0);
          if (Math.abs(sumSplit - totalAmount) > 0.01) {
            App.utils.showToast('A soma dos valores por cartão difere do total da compra.', 'error');
            return false;
          }

          // Cada cartão gera sua própria série de parcelas, com numeração independente
          for (const splitEntry of cardSplitData) {
            try {
              const cardId = splitEntry.card_id;
              const cardAmountTotal = splitEntry.amount;
              const cardMonths = Math.max(1, parseInt(splitEntry.installments) || 1);
              const cardGroupId = cardMonths > 1 ? App.utils.generateId() : null;

              // Distribui o valor total do cartão pelas suas próprias parcelas
              const baseParcelValue = cardAmountTotal / cardMonths;
              const roundedParcel = Math.round(baseParcelValue * 100) / 100;
              const sumFirstParcels = roundedParcel * (cardMonths - 1);
              const lastParcel = Math.round((cardAmountTotal - sumFirstParcels) * 100) / 100;

              for (let i = 0; i < cardMonths; i++) {
                const newDate = App.utils.addMonths(baseDateForInstallments, i) + 'T' + time + ':00';
                let parcelStatus = status;
                const today = App.utils.todayISO();
                if (newDate.slice(0, 10) > today) {
                  parcelStatus = 'pending';
                }

                let parcelDescription = description;
                if (cardMonths > 1) {
                  parcelDescription = `${description} - Parcela ${i + 1} de ${cardMonths}`;
                }

                const parcelAmount = (i === cardMonths - 1) ? lastParcel : roundedParcel;

                await App.db.put('transactions', {
                  ...baseTx,
                  id: App.utils.generateId(),
                  date: newDate,
                  description: parcelDescription,
                  credit_card_id: cardId,
                  installment_number: i + 1,
                  installments: cardMonths,
                  installment_id: cardGroupId,
                  expense_type: cardMonths > 1 ? 'installment' : (baseTx.expense_type || ''),
                  is_recurring_series: false,
                  recurring: false,
                  status: parcelStatus,
                  amount: parcelAmount
                });
              }
            } catch (parcelError) {
              console.error(`Erro ao criar parcelas do cartão ${splitEntry.card_id}:`, parcelError);
              App.utils.showToast(`Falha ao criar parcelas de um dos cartões. As demais serão processadas.`, 'error');
            }
          }
        } else {
          // ----- FLUXO ORIGINAL SEM DIVISÃO -----
          for (let i=0; i<totalMonths; i++) {
            try {
              const newDate = App.utils.addMonths(baseDateForInstallments, i) + 'T' + time + ':00';
              let parcelStatus = status;
              const today = App.utils.todayISO();
              if ((expense_type === 'fixed' || (installments > 1 && expense_type !== 'fixed')) && newDate.slice(0,10) > today) {
                parcelStatus = 'pending';
              }
              let parcelDescription = description;
              if (totalMonths > 1) {
                parcelDescription = `${description} - Parcela ${i+1} de ${totalMonths}`;
              }
              await App.db.put('transactions', { ...baseTx, id: App.utils.generateId(), date: newDate, description: parcelDescription, installment_number: i+1, installments: totalMonths, installment_id: totalMonths>1?groupId:null, is_recurring_series: finalRecurring, recurring: false, status: parcelStatus });
            } catch (parcelError) {
              console.error(`Erro ao criar parcela ${i+1}/${totalMonths}:`, parcelError);
              App.utils.showToast(`Falha ao criar parcela ${i+1}. As demais serão processadas.`, 'error');
            }
          }
        }
        if (totalMonths === 60 && finalRecurring) App.utils.addAlert(`Transação fixa "${description}" atingiu 5 anos. Deseja renovar?`, 'warning');
        if (addAsset && type==='expense') {
          try {
            const assetValue = totalMonths > 1 ? amount * totalMonths : amount;
            await App.db.put('patrimony', { id: App.utils.generateId(), name: description||'Bem adquirido', type:'asset', value:assetValue, date, description:'Adquirido via transação', createdAt:new Date().toISOString() });
          } catch (assetError) {
            console.error('Erro ao adicionar ao patrimônio:', assetError);
          }
        }
      }
      this.invalidateCache();
      App.ui.closeModal('modalTransaction', true);
      
      // Aplica alterações em lote conforme escopo de edição
      if (this._pendingEditScope && this._pendingEditId && id) {
        const scope = this._pendingEditScope;

        if (scope !== 'this') {
          const editedTx = await App.db.getById('transactions', id);
          if (editedTx) {
            const allTx = await App.db.getAll('transactions');

            // Normaliza descrição para agrupar corretamente parcelas antigas
            const normalizeDesc = (desc) => (desc || '')
              .replace(/\s*-\s*Parcela\s+\d+\s+de\s+\d+\s*$/i, '')
              .replace(/\s*-\s*Parcela\s+\d+\/\d+\s*$/i, '')
              .replace(/\s+\d+\/\d+$/, '')
              .trim();

            const findGroup = (baseTx, includeAll) => {
              // 1) Agrupamento por installment_id (preferencial)
              if (baseTx.installment_id) {
                return includeAll
                  ? allTx.filter(t => t.installment_id === baseTx.installment_id)
                  : allTx.filter(t => t.installment_id === baseTx.installment_id && parseInt(t.installment_number) >= parseInt(baseTx.installment_number));
              }
              // 2) Séries recorrentes
              if (baseTx.is_recurring_series) {
                return includeAll
                  ? allTx.filter(t => t.description === baseTx.description && t.member_id === baseTx.member_id)
                  : allTx.filter(t => t.description === baseTx.description && t.member_id === baseTx.member_id && t.date >= baseTx.date);
              }
              // 3) Parceladas sem installment_id: agrupa por descrição normalizada, membro e cartão
              const baseDesc = normalizeDesc(baseTx.description);
              const baseMember = baseTx.member_id || '';
              const baseCreditCard = baseTx.credit_card_id || '';
              const sameGroup = allTx.filter(t => {
                if (t.type !== 'expense' && t.type !== 'refund') return false;
                if (!t.installments || parseInt(t.installments) <= 1) return false;
                const tDesc = normalizeDesc(t.description);
                if (tDesc !== baseDesc) return false;
                if (t.member_id !== baseMember) return false;
                if (baseCreditCard) {
                  return (!t.credit_card_id || t.credit_card_id === baseCreditCard);
                }
                return true;
              });
              return includeAll
                ? sameGroup
                : sameGroup.filter(t => parseInt(t.installment_number) >= parseInt(baseTx.installment_number));
            };

            // Ajuste da quantidade de parcelas quando o escopo for "all"
            if (scope === 'all') {
              const groupToAdjust = findGroup(editedTx, true);
              if (groupToAdjust.length > 1) {
                const oldTotal = groupToAdjust.length;
                const newTotal = parseInt(editedTx.installments) || oldTotal;
                if (oldTotal !== newTotal) {
                  // Ordena o grupo original por número da parcela
                  groupToAdjust.sort((a, b) => (parseInt(a.installment_number) || 0) - (parseInt(b.installment_number) || 0));

                  // Total original (soma dos valores das parcelas existentes)
                  const totalOriginal = groupToAdjust.reduce((s, t) => s + parseFloat(t.amount), 0);

                  // Determina a data da primeira parcela (base para recriar)
                  const firstParcel = groupToAdjust[0];
                  const baseDate = firstParcel.date.split('T')[0];
                  const timePart = firstParcel.date.includes('T') ? firstParcel.date.split('T')[1].slice(0, 8) : '00:00:00';

                  // Limpa descrição base (sem sufixo de parcela)
                  const descBaseLimpa = (editedTx.description || '').replace(/\s*-\s*Parcela\s+\d+\s+de\s+\d+\s*$/i, '').trim() || editedTx.category || 'Compra parcelada';

                  // Pergunta ao usuário qual modo de recálculo deseja
                  const valorParcelaAtual = parseFloat(editedTx.amount) || 0;
                  const totalReparcelado = totalOriginal;
                  const totalPorParcela = valorParcelaAtual * newTotal;

                  const escolha = await new Promise((resolve) => {
                    // Criação do modal bonito
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:9999;';
                    
                    const modal = document.createElement('div');
                    modal.style.cssText = 'background:#1e1e1e; color:#fff; border-radius:16px; padding:24px; width:90%; max-width:450px; box-shadow:0 20px 40px rgba(0,0,0,0.5); font-family:inherit;';
                    
                    const titulo = document.createElement('h3');
                    titulo.textContent = 'Ajuste de Parcelas';
                    titulo.style.cssText = 'margin:0 0 12px; font-size:1.2rem; font-weight:600;';
                    
                    const descricao = document.createElement('p');
                    descricao.innerHTML = `Alteração de <strong>${oldTotal}</strong> para <strong>${newTotal}</strong> parcelas.<br>Escolha como deseja recalcular:`;
                    descricao.style.cssText = 'margin:0 0 20px; color:#ccc; line-height:1.4;';
                    
                    const opcao1 = document.createElement('button');
                    opcao1.style.cssText = 'display:block; width:100%; background:#2a2a2a; border:1px solid #444; border-radius:10px; padding:16px; margin-bottom:12px; cursor:pointer; text-align:left; transition:all 0.2s;';
                    opcao1.innerHTML = `
                      <div style="font-weight:600; margin-bottom:6px;">1. Reparcelar o total atual</div>
                      <div style="font-size:0.9rem; color:#aaa;">Total: <strong>${App.utils.formatCurrency(totalReparcelado)}</strong></div>
                      <div style="font-size:0.9rem; color:#aaa;">Cada parcela: ≈ <strong>${App.utils.formatCurrency(totalReparcelado / newTotal)}</strong></div>
                    `;
                    
                    const opcao2 = document.createElement('button');
                    opcao2.style.cssText = 'display:block; width:100%; background:#2a2a2a; border:1px solid #444; border-radius:10px; padding:16px; margin-bottom:16px; cursor:pointer; text-align:left; transition:all 0.2s;';
                    opcao2.innerHTML = `
                      <div style="font-weight:600; margin-bottom:6px;">2. Manter valor da parcela atual</div>
                      <div style="font-size:0.9rem; color:#aaa;">Parcela atual: <strong>${App.utils.formatCurrency(valorParcelaAtual)}</strong></div>
                      <div style="font-size:0.9rem; color:#aaa;">Total geral: <strong>${App.utils.formatCurrency(totalPorParcela)}</strong></div>
                    `;
                    
                    const cancelar = document.createElement('button');
                    cancelar.textContent = 'Cancelar';
                    cancelar.style.cssText = 'display:block; width:100%; background:transparent; border:none; color:#ff6b6b; cursor:pointer; padding:8px; font-size:0.9rem;';
                    
                    // Função para fechar e resolver
                    const fechar = (resultado) => {
                      overlay.remove();
                      resolve(resultado);
                    };
                    
                    opcao1.addEventListener('mouseenter', () => opcao1.style.background = '#333');
                    opcao1.addEventListener('mouseleave', () => opcao1.style.background = '#2a2a2a');
                    opcao2.addEventListener('mouseenter', () => opcao2.style.background = '#333');
                    opcao2.addEventListener('mouseleave', () => opcao2.style.background = '#2a2a2a');
                    
                    opcao1.addEventListener('click', () => fechar('1'));
                    opcao2.addEventListener('click', () => fechar('2'));
                    cancelar.addEventListener('click', () => fechar(null));
                    overlay.addEventListener('click', (e) => {
                      if (e.target === overlay) fechar(null);
                    });
                    
                    modal.appendChild(titulo);
                    modal.appendChild(descricao);
                    modal.appendChild(opcao1);
                    modal.appendChild(opcao2);
                    modal.appendChild(cancelar);
                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);
                  });

                  if (escolha !== '1' && escolha !== '2') {
                    App.utils.showToast('Edição cancelada pelo usuário.', 'info');
                    return false;
                  }

                  const totalParaDividir = escolha === '1' ? totalReparcelado : totalPorParcela;

                  // Exclui todas as parcelas antigas, inclusive órfãs por descrição base
                  const memberBase = editedTx.member_id || '';
                  const cardBase = editedTx.credit_card_id || '';
                  const allTxParaLimpar = await App.db.getAll('transactions');
                  const idsParaExcluir = new Set();
                  for (const t of allTxParaLimpar) {
                    if (t.type !== 'expense' && t.type !== 'refund') continue;
                    if (!t.installments || parseInt(t.installments) <= 1) continue;
                    const tDesc = (t.description || '').replace(/\s*-\s*Parcela\s+\d+\s+de\s+\d+\s*$/i, '').trim();
                    if (tDesc !== descBaseLimpa) continue;
                    if (t.member_id !== memberBase) continue;
                    if (cardBase) {
                      if (t.credit_card_id !== cardBase) continue;
                    }
                    idsParaExcluir.add(t.id);
                  }
                  for (const idParaExcluir of idsParaExcluir) {
                    await App.db.delete('transactions', idParaExcluir);
                  }

                  // Modelo para novas parcelas (baseado na transação editada, mas sem id)
                  const template = { ...editedTx };
                  delete template.id;

                  // Recria todas as parcelas do zero
                  const qtd = newTotal;
                  const raw = totalParaDividir / qtd;
                  const rounded = Math.round(raw * 100) / 100;
                  let sum = 0;

                  for (let i = 0; i < qtd; i++) {
                    // Data mensal contínua a partir da primeira parcela original
                    const newDate = App.utils.addMonths(baseDate, i) + 'T' + timePart;

                    // Valor da parcela (última recebe diferença para fechar total)
                    const amount = (i === qtd - 1) ? Math.round((totalParaDividir - sum) * 100) / 100 : rounded;
                    if (i !== qtd - 1) {
                      sum += amount;
                    }

                    // Cria nova transação com numeração e descrição corretas
                    await App.db.put('transactions', {
                      ...template,
                      id: App.utils.generateId(),
                      installment_number: i + 1,
                      installments: newTotal,
                      date: newDate,
                      amount: amount,
                      description: `${descBaseLimpa} - Parcela ${i + 1} de ${newTotal}`,
                      installment_id: editedTx.installment_id || App.utils.generateId()
                    });
                  }
                }
              }
            }

            // Propagação normal dos demais campos
            const group = scope === 'all' ? findGroup(editedTx, true) : findGroup(editedTx, false);
            const fieldsToPropagate = ['amount', 'category', 'description', 'notes', 'member_id', 'member_name', 'account_id', 'account_name', 'payment_method', 'classification', 'receipt_url', 'vacation', 'ignore_from_total'];
            for (const t of group) {
              if (t.id === editedTx.id) continue;
              try {
                let updated = false;
                for (const field of fieldsToPropagate) {
                  if (editedTx[field] !== undefined && t[field] !== editedTx[field]) {
                    t[field] = editedTx[field];
                    updated = true;
                  }
                }
                if (updated) {
                  await App.db.put('transactions', t);
                }
              } catch (editError) {
                console.error(`Erro ao editar transação ${t.id} no grupo:`, editError);
              }
            }
          }
        }

        this._pendingEditId = null;
        this._pendingEditScope = null;
      }

      App.utils.showToast(id?'Atualizado!':'Criado!');

      // Atualiza total_recebido da fonte pagadora (se for receita com fonte vinculada)
      if (type === 'income' && fonte_pagadora_id) {
        const fonte = await App.db.getById('fontesPagadoras', fonte_pagadora_id);
        if (fonte) {
          const txAntiga = id ? originalTx : null;
          const valorAntigo = txAntiga && txAntiga.type === 'income' && txAntiga.fonte_pagadora_id === fonte_pagadora_id ? parseFloat(txAntiga.amount) : 0;
          fonte.total_recebido = (fonte.total_recebido || 0) - valorAntigo + amount;
          await App.db.put('fontesPagadoras', fonte);
        }
      } else if (id && originalTx && originalTx.type === 'income' && originalTx.fonte_pagadora_id && (type !== 'income' || fonte_pagadora_id !== originalTx.fonte_pagadora_id)) {
        // Remove valor da fonte anterior se a transação deixou de ser receita daquela fonte
        const fonteAntiga = await App.db.getById('fontesPagadoras', originalTx.fonte_pagadora_id);
        if (fonteAntiga) {
          fonteAntiga.total_recebido = Math.max(0, (fonteAntiga.total_recebido || 0) - parseFloat(originalTx.amount));
          await App.db.put('fontesPagadoras', fonteAntiga);
        }
      }

      App.cache.accounts = null;
      App.cache.totalBalance = null;
      App.cache.creditCards = null;
      await App.saldos.load();
      this.load();
      App.dashboard.refresh();
      App.creditCards.load();
      App.investments.load();
      App.patrimony.load();
      App.panel.refresh();
      App.installments.load();
      // Se a página ativa for a fatura do cartão, recarrega-a para refletir nova transação
      if (document.getElementById('page-card-invoice')?.classList.contains('active')) {
        App.cardInvoice.load();
      }
      return false;
    } catch (erro) { console.error(erro); App.utils.showToast('Erro ao salvar transação.', 'error'); return false; }
  },

    async edit(id) {
    const t = await App.db.getById('transactions', id);
    if (!t) return;

    // Se for parcelada (comum ou cartão), primeiro pergunta o escopo
    if (t.installments > 1 && t.expense_type !== 'fixed') {
      this._pendingEditId = id;
      const modal = document.getElementById('modalInstallmentDelete');
      if (modal) {
        modal.querySelector('h2').textContent = 'Editar Parcela';
        modal.querySelector('p').textContent = 'Esta transação faz parte de um parcelamento. Como deseja editar?';
        const buttons = modal.querySelectorAll('button.btn');
        buttons[0].textContent = 'Apenas esta parcela';
        buttons[0].onclick = () => { App.transactions.editInstallment('this'); };
        buttons[1].textContent = 'Esta e as próximas';
        buttons[1].onclick = () => { App.transactions.editInstallment('thisAndNext'); };
        buttons[2].textContent = 'Todas as parcelas';
        buttons[2].onclick = () => { App.transactions.editInstallment('all'); };
        buttons[3].textContent = 'Cancelar';
        buttons[3].onclick = () => { App.ui.closeModal('modalInstallmentDelete'); };
        App.ui.openModal('modalInstallmentDelete');
      }
      return;
    }

    // Se não é parcelada, decide entre cartão e normal
    if (t.credit_card_id) {
      App.ui.openCardTransactionEditModal(t);
    } else {
      App.ui.openTransactionModal(t);
    }
  },
  editInstallment(scope) {
    App.ui.closeModal('modalInstallmentDelete');
    this._pendingEditScope = scope;
    const id = this._pendingEditId;
    if (!id) return;
    App.db.getById('transactions', id).then(t => {
      if (t) {
        if (t.credit_card_id) {
          App.ui.openCardTransactionEditModal(t);
        } else {
          App.ui.openTransactionModal(t);
        }
      }
    });
  },
  _nowLocalStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },

  _buildDuplicateTransaction(tx, nowStamp) {
    const newTx = JSON.parse(JSON.stringify(tx));
    newTx.id = App.utils.generateId();
    newTx.date = nowStamp;
    newTx.createdAt = new Date().toISOString();
    newTx.position = Date.now();

    // A cópia não pertence às séries/parcelamentos originais.
    newTx.installment_id = null;
    newTx.installment_number = 1;
    newTx.installments = 1;
    newTx.is_recurring_series = false;
    newTx.recurring = false;
    newTx.recurring_times = 0;
    if (newTx.expense_type === 'installment' || newTx.expense_type === 'fixed') {
      newTx.expense_type = 'single';
    }

    // Não herda estados de fatura/estorno do original.
    delete newTx.reverted;
    delete newTx.invoice_locked;
    delete newTx.invoice_card_id;
    delete newTx.invoice_due_month;
    delete newTx.reversal_of;

    // Mantém a divisão entre membros, se houver.
    newTx.member_splits = Array.isArray(tx.member_splits)
      ? tx.member_splits.map(sp => ({ ...sp }))
      : [];

    if (newTx.purchase_date) newTx.purchase_date = nowStamp.slice(0, 10);

    return newTx;
  },

  async duplicate(id) {
    const tx = await App.db.getById('transactions', id);
    if (!tx) { App.utils.showToast('Transação não encontrada.', 'error'); return; }
    this._pendingDuplicateId = id;

    const typeNames = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência', contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno', adjustment: 'Ajuste' };
    const methodNames = { pix: 'Pix', credit_card: 'Crédito', debit_card: 'Débito', cash: 'Dinheiro', transfer: 'Transferência', boleto: 'Boleto', vale_alimentacao: 'Vale Alimentação' };
    const esc = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const rows = [];
    rows.push(['Tipo', typeNames[tx.type] || tx.type]);
    rows.push(['Valor', App.utils.formatCurrency(tx.amount)]);
    if (tx.description) rows.push(['Descrição', tx.description]);
    if (tx.category) rows.push(['Categoria', tx.category]);
    if (tx.account_name) rows.push(['Conta', tx.account_name]);
    if (tx.account_to_name) rows.push(['Conta destino', tx.account_to_name]);

    if (tx.credit_card_id) {
      const card = await App.db.getById('creditCards', tx.credit_card_id);
      rows.push(['Cartão', card ? card.name : 'Cartão de crédito']);
    }

    if (tx.member_name) {
      rows.push(['Membro', tx.member_name]);
    } else if (Array.isArray(tx.member_splits) && tx.member_splits.length) {
      const members = App.cache.members || await App.db.getAll('members');
      const names = tx.member_splits.map(sp => {
        const m = members.find(x => x.id === sp.member_id);
        return `${m ? m.name : (sp.member_id || 'Membro')} (${App.utils.formatCurrency(sp.amount || 0)})`;
      });
      rows.push(['Divisão', names.join(' · ')]);
    }

    if (tx.fonte_pagadora_id) {
      const fonte = await App.db.getById('fontesPagadoras', tx.fonte_pagadora_id);
      rows.push(['Fonte pagadora', fonte ? (fonte.razao_social || fonte.name || 'Fonte pagadora') : 'Fonte pagadora']);
    } else if (tx.payment_method) {
      rows.push(['Forma de pagamento', methodNames[tx.payment_method] || tx.payment_method]);
    }

    if (tx.notes) rows.push(['Notas', tx.notes]);
    rows.push(['Nova data', App.utils.formatDateTime(this._nowLocalStamp())]);

    const preview = document.getElementById('duplicateTxPreview');
    if (preview) {
      preview.innerHTML = `
        <div class="duplicate-tx-warning">⚠️ Uma nova transação será criada com a <strong>data e hora atuais</strong>. Os dados abaixo serão copiados exatamente como estão.</div>
        <dl class="duplicate-tx-list">
          ${rows.map(([label, value]) => `<div class="duplicate-tx-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
        </dl>
      `;
    }

    App.ui.openModal('modalDuplicateTransaction');
  },

  async confirmDuplicate() {
    const id = this._pendingDuplicateId;
    if (!id) return;
    this._pendingDuplicateId = null;

    const tx = await App.db.getById('transactions', id);
    if (!tx) { return; }

    const newTx = this._buildDuplicateTransaction(tx, this._nowLocalStamp());
    await App.db.put('transactions', newTx);

    // Mantém o total recebido da fonte pagadora consistente.
    if (newTx.type === 'income' && newTx.fonte_pagadora_id) {
      const fonte = await App.db.getById('fontesPagadoras', newTx.fonte_pagadora_id);
      if (fonte) {
        fonte.total_recebido = (fonte.total_recebido || 0) + (parseFloat(newTx.amount) || 0);
        await App.db.put('fontesPagadoras', fonte);
      }
    }

    App.ui.closeModal('modalDuplicateTransaction', true);

    this.invalidateCache();
    App.cache.accounts = null;
    App.cache.totalBalance = null;
    App.cache.creditCards = null;
    await App.saldos.load();
    this.load();
    App.dashboard.refresh();
    App.creditCards.load();
    App.investments.load();
    App.patrimony.load();
    App.panel.refresh();
    App.installments.load();
    if (document.getElementById('page-card-invoice')?.classList.contains('active')) {
      App.cardInvoice.load();
    }
    App.utils.showToast('Transação duplicada com a data atual!');
  },

  confirmDelete(id) {
    this._pendingDeleteId = id;
    App.db.getById('transactions', id).then(tx => {
      if (tx && (tx.installments > 1 || tx.is_recurring_series)) {
        const modal = document.getElementById('modalInstallmentDelete');
        if (modal) {
          modal.querySelector('h2').textContent = 'Excluir Parcela';
          modal.querySelector('p').textContent = 'Esta transação faz parte de um parcelamento. Como deseja excluir?';
          const buttons = modal.querySelectorAll('button.btn');
          buttons[0].textContent = 'Apenas esta parcela';
          buttons[0].onclick = () => { App.transactions.deleteInstallment('this'); };
          buttons[1].textContent = 'Esta e as próximas';
          buttons[1].onclick = () => { App.transactions.deleteInstallment('thisAndNext'); };
          buttons[2].textContent = 'Todas as parcelas';
          buttons[2].onclick = () => { App.transactions.deleteInstallment('all'); };
          buttons[3].textContent = 'Cancelar';
          buttons[3].onclick = () => { App.ui.closeModal('modalInstallmentDelete'); };
          App.ui.openModal('modalInstallmentDelete');
        }
      } else {
        App.transactions.remove(id);
      }
    });
  },
  async deleteInstallment(scope) {
    App.ui.closeModal('modalInstallmentDelete');
    const id = this._pendingDeleteId;
    if (!id) return;
    const tx = await App.db.getById('transactions', id);
    if (!tx) { this._pendingDeleteId = null; return; }

    const allTx = await App.db.getAll('transactions');

    // Função auxiliar para encontrar parcelas do mesmo grupo
    const findGroup = (baseTx, includeAll) => {
      // Se tiver installment_id, usa esse agrupamento (preferencial)
      if (baseTx.installment_id) {
        return includeAll
          ? allTx.filter(t => t.installment_id === baseTx.installment_id)
          : allTx.filter(t => t.installment_id === baseTx.installment_id && t.installment_number >= baseTx.installment_number);
      }
      // Se for série recorrente, agrupa por descrição e membro
      if (baseTx.is_recurring_series) {
        return includeAll
          ? allTx.filter(t => t.description === baseTx.description && t.member_id === baseTx.member_id)
          : allTx.filter(t => t.description === baseTx.description && t.member_id === baseTx.member_id && t.date >= baseTx.date);
      }
      // Fallback para parceladas sem installment_id: agrupa por descrição, membro e cartão (aceita parcelas sem cartão)
      if (baseTx.installments > 1 && baseTx.expense_type !== 'fixed') {
        const baseDesc = (baseTx.description || '').trim();
        const baseMember = baseTx.member_id || '';
        const baseCreditCard = baseTx.credit_card_id || '';
        const sameGroup = allTx.filter(t =>
          t.installments > 1 &&
          (t.description || '').trim() === baseDesc &&
          t.member_id === baseMember &&
          (baseCreditCard ? (!t.credit_card_id || t.credit_card_id === baseCreditCard) : true)
        );
        return includeAll
          ? sameGroup
          : sameGroup.filter(t => t.installment_number >= baseTx.installment_number);
      }
      return [];
    };

    const revertInvestment = async (t) => {
      if (t.investment_id && (t.description?.startsWith('Rendimento:') || t.description?.startsWith('Prejuízo:'))) {
        const inv = await App.db.getById('investments', t.investment_id);
        if (inv) {
          const amount = parseFloat(t.amount);
          if (t.description.startsWith('Rendimento:')) {
            inv.current_value = Math.max(0, (parseFloat(inv.current_value) || 0) - amount);
          } else if (t.description.startsWith('Prejuízo:')) {
            inv.current_value = (parseFloat(inv.current_value) || 0) + amount;
          }
          await App.db.put('investments', inv);
          const history = await App.db.getAll('investmentHistory');
          const related = history.filter(h => h.investment_id === t.investment_id).sort((a,b) => b.date.localeCompare(a.date));
          if (related.length > 0) {
            await App.db.delete('investmentHistory', related[0].id);
          }
        }
      }
    };

    if (scope === 'this') {
      const target = await App.db.getById('transactions', id);
      if (target) {
        try {
          await revertInvestment(target);
          await App.db.delete('transactions', id);
        } catch (e) {
          console.error('Erro ao excluir parcela única:', e);
        }
      }
    } else if (scope === 'thisAndNext') {
      const group = findGroup(tx, false);
      for (const t of group) {
        try {
          await revertInvestment(t);
          await App.db.delete('transactions', t.id);
        } catch (e) {
          console.error(`Erro ao excluir parcela ${t.id}:`, e);
        }
      }
    } else if (scope === 'all') {
      const group = findGroup(tx, true);
      for (const t of group) {
        try {
          await revertInvestment(t);
          await App.db.delete('transactions', t.id);
        } catch (e) {
          console.error(`Erro ao excluir parcela ${t.id}:`, e);
        }
      }
    }

    this.invalidateCache();
    App.cache.accounts = null;
    App.cache.totalBalance = null;
    App.cache.creditCards = null;
    App.utils.showToast('Parcela(s) excluída(s)!');
    this._pendingDeleteId = null;
    await App.saldos.load();
    this.load();
    App.dashboard.refresh();
    App.creditCards.load();
    App.investments.load();
    App.patrimony.load();
    App.panel.refresh();
    App.installments.load();
    // Recarrega a fatura se estiver ativa ou se houver cartão selecionado
    if (document.getElementById('page-card-invoice')?.classList.contains('active') || App.cardInvoice.currentCardId) {
      App.cardInvoice.load();
    }
  },
  async remove(id) {
    App.utils.confirm('Excluir transação?', async () => {
      const tx = await App.db.getById('transactions', id);
      if (tx) {
        // Reverte impacto em investimento (rendimentos/prejuízos)
        if (tx.investment_id && (tx.description?.startsWith('Rendimento:') || tx.description?.startsWith('Prejuízo:'))) {
          const inv = await App.db.getById('investments', tx.investment_id);
          if (inv) {
            const amount = parseFloat(tx.amount);
            if (tx.description.startsWith('Rendimento:')) {
              inv.current_value = Math.max(0, (parseFloat(inv.current_value) || 0) - amount);
            } else if (tx.description.startsWith('Prejuízo:')) {
              inv.current_value = (parseFloat(inv.current_value) || 0) + amount;
            }
            await App.db.put('investments', inv);
            // Remove a entrada correspondente no histórico de posições (a mais recente)
            const history = await App.db.getAll('investmentHistory');
            const related = history.filter(h => h.investment_id === tx.investment_id).sort((a,b) => b.date.localeCompare(a.date));
            if (related.length > 0) {
              // Remove a entrada mais recente (assumindo que foi gerada por esta transação)
              await App.db.delete('investmentHistory', related[0].id);
            }
          }
        }
        await App.db.delete('transactions', id);
      }
      this.invalidateCache();
      await App.saldos.load();
      this.load(); App.dashboard.refresh(); App.creditCards.load(); App.investments.load(); App.patrimony.load(); App.panel.refresh(); App.installments.load();
      if (document.getElementById('page-card-invoice')?.classList.contains('active') || App.cardInvoice.currentCardId) {
        App.cardInvoice.load();
      }
    });
  },
  async refund(id) {
    const original = await App.db.getById('transactions', id);
    if (!original || original.type !== 'expense' || !original.credit_card_id) { App.utils.showToast('Estorno disponível apenas para compras no cartão de crédito','error'); return; }
    App.utils.prompt(`Valor do estorno (use negativo se necessário):`, original.amount.toString(), async (val) => {
      const amount = parseFloat(val); if (isNaN(amount) || amount === 0) { App.utils.showToast('Valor inválido', 'error'); return; }
      await App.db.put('transactions', { id: App.utils.generateId(), type: 'refund', amount: Math.abs(amount), category: original.category, account_id: original.account_id, account_name: original.account_name, date: App.utils.todayISO(), description: `Estorno: ${original.description||''}`, notes: amount < 0 ? 'Ajuste de saldo' : '', credit_card_id: original.credit_card_id, member_id: original.member_id, member_name: original.member_name, status:'confirmed', ignore_from_total: false, createdAt:new Date().toISOString() });
      this.invalidateCache();
      App.utils.showToast('Estorno registrado!');
      await App.saldos.load();
      this.load(); App.dashboard.refresh(); App.creditCards.load(); App.panel.refresh();
    });
  },
  clearFilters() {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('filterType', 'all');
    setVal('filterAccount', 'all');
    setVal('filterCategory', 'all');
    setVal('filterCreditCard', 'all');
    setVal('filterTag', 'all');
    setVal('filterStatus', 'all');
    setVal('filterReconciled', 'all');
    setVal('filterTxMember', 'all');
    setVal('filterMinVal', '');
    setVal('filterMaxVal', '');
    setVal('filterReceipt', 'all');
    setVal('searchTransactions', '');
    setVal('periodPreset', '');
    setVal('sortOrder', 'desc');
    this.currentMonthStart = App.utils.currentMonth().startDate;
    this.invalidateCache();
    this.currentPage = 1;
    this.load();
  },
  filterByCreditCard(cardId) { App.cardInvoice.open(cardId); },
  prevMonth() { const d = new Date(this.currentMonthStart + 'T12:00:00'); d.setMonth(d.getMonth() - 1); this.currentMonthStart = (this.useCycle ? App.utils.cycleFromDate(d.toISOString().slice(0, 10)) : App.utils.monthRangeFromDate(d.toISOString().slice(0, 10))).startDate; this.invalidateCache(); this.currentPage = 1; this.load(); },
  nextMonth() { const d = new Date(this.currentMonthStart + 'T12:00:00'); d.setMonth(d.getMonth() + 1); this.currentMonthStart = (this.useCycle ? App.utils.cycleFromDate(d.toISOString().slice(0, 10)) : App.utils.monthRangeFromDate(d.toISOString().slice(0, 10))).startDate; this.invalidateCache(); this.currentPage = 1; this.load(); },
  gotoMonth() { const month = document.getElementById('txMonthPicker').value; if (month) { const [y, m] = month.split('-'); const d = `${y}-${m}-15`; this.currentMonthStart = (this.useCycle ? App.utils.cycleFromDate(d) : App.utils.monthRangeFromDate(d)).startDate; this.invalidateCache(); this.currentPage = 1; this.load(); } },
  toggleCycle() { this.useCycle = document.getElementById('useCycleToggle')?.checked || false; this.invalidateCache(); this.currentPage = 1; this.load(); },

  async toggleReconciled(id) {
    try {
      const tx = await App.db.getById('transactions', id);
      if (!tx) return;
      tx.reconciled = !tx.reconciled;
      await App.db.put('transactions', tx);
      this.invalidateCache();
      App.utils.showToast(tx.reconciled ? 'Lançamento conciliado!' : 'Conciliação removida.');
      this.load();
    } catch (e) {
      console.error(e);
      App.utils.showToast('Erro ao alterar conciliação.', 'error');
    }
  },

  toggleBulkEdit() {
    this.bulkMode = !this.bulkMode;
    this.bulkAllSelected = false;
    const btn = document.getElementById('bulkEditBtn');
    if (btn) btn.textContent = this.bulkMode ? '✅ Concluir edição' : '✏️ Edição em massa';
    const bulkSelectAllCheckbox = document.getElementById('bulkSelectAll');
    if (bulkSelectAllCheckbox) bulkSelectAllCheckbox.checked = false;
    this.load();
  },

  updateBulkSelectionSummary() {
    const summaryEl = document.getElementById('bulkSelectedSummary');
    if (!summaryEl) return;
    const checked = Array.from(document.querySelectorAll('.bulkCheck:checked'));
    let netSum = 0;
    for (const cb of checked) {
      const tx = this._lastPageTxMap?.[cb.value];
      if (!tx) continue;
      const amt = parseFloat(tx.amount) || 0;
      netSum += (tx.type === 'income' || tx.type === 'refund') ? amt : -amt;
    }
    summaryEl.textContent = checked.length
      ? `${checked.length} selecionada(s) · Líquido: ${App.utils.formatCurrency(netSum)}`
      : '0 selecionada(s)';
  },

  toggleSelectAll() {
    this.bulkAllSelected = !this.bulkAllSelected;
    const bulkSelectAllCheckbox = document.getElementById('bulkSelectAll');
    if (bulkSelectAllCheckbox) bulkSelectAllCheckbox.checked = this.bulkAllSelected;
    document.querySelectorAll('.bulkCheck').forEach(cb => cb.checked = this.bulkAllSelected);
    const bulkSelectAllBtn = document.getElementById('bulkSelectAllBtn');
    if (bulkSelectAllBtn) bulkSelectAllBtn.textContent = this.bulkAllSelected ? '☑ Desmarcar todas' : '☐ Marcar todas';
    this.updateBulkSelectionSummary();
  },

  async applyBulkQuickAction(action) {
    const checkboxes = document.querySelectorAll('.bulkCheck:checked');
    if (!checkboxes.length) { App.utils.showToast('Nenhuma transação selecionada', 'error'); return; }
    const ids = Array.from(checkboxes).map(cb => cb.value);
    for (const id of ids) {
      const tx = await App.db.getById('transactions', id);
      if (!tx) continue;
      if (action === 'confirm') tx.status = 'confirmed';
      else if (action === 'pending') tx.status = 'pending';
      else if (action === 'reconcile') tx.reconciled = true;
      else if (action === 'unreconcile') tx.reconciled = false;
      await App.db.put('transactions', tx);
    }
    const labels = {
      confirm: 'efetivada(s)',
      pending: 'marcada(s) como pendente',
      reconcile: 'conciliada(s)',
      unreconcile: 'desconciliada(s)'
    };
    this.invalidateCache();
    App.cache.totalBalance = null;
    App.utils.showToast(`${ids.length} transação(ões) ${labels[action] || 'atualizada(s)'}!`);
    this.load();
    App.dashboard?.refresh?.();
    App.panel?.refresh?.();
  },

  async deleteBulkSelected() {
    const checkboxes = document.querySelectorAll('.bulkCheck:checked');
    if (!checkboxes.length) { App.utils.showToast('Nenhuma transação selecionada', 'error'); return; }
    const ids = Array.from(checkboxes).map(cb => cb.value);
    App.utils.confirm(`Excluir permanentemente ${ids.length} transação(ões) selecionada(s)?`, async () => {
      for (const id of ids) {
        await App.db.delete('transactions', id);
      }
      this.invalidateCache();
      App.cache.totalBalance = null;
      App.utils.showToast(`${ids.length} transação(ões) excluída(s)!`);
      this.load();
      App.dashboard?.refresh?.();
      App.panel?.refresh?.();
    });
  },

  async applyBulkEdit() {
    const checkboxes = document.querySelectorAll('.bulkCheck:checked');
    if (!checkboxes.length) { App.utils.showToast('Nenhuma transação selecionada', 'error'); return; }
    const ids = Array.from(checkboxes).map(cb => cb.value);
    const category = document.getElementById('bulkCategory')?.value || '';
    const member = document.getElementById('bulkMember')?.value || '';
    const account = document.getElementById('bulkAccount')?.value || '';
    const classification = document.getElementById('bulkClassification')?.value || '';
    if (!category && !member && !account && !classification) { App.utils.showToast('Selecione ao menos um campo para alterar', 'error'); return; }
    const members = App.cache.members || await App.db.getAll('members');
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    for (const id of ids) {
      const tx = await App.db.getById('transactions', id);
      if (!tx) continue;
      if (category) tx.category = category;
      if (classification) tx.classification = classification;
      if (member) { tx.member_id = member; const mem = members.find(m => m.id === member); if (mem) tx.member_name = mem.name; }
      if (account) { tx.account_id = account; const acc = accounts.find(a => a.id === account); if (acc) tx.account_name = acc.name; }
      await App.db.put('transactions', tx);
    }
    this.invalidateCache();
    App.cache.totalBalance = null;
    App.utils.showToast(`${ids.length} transações atualizadas!`);
    this.load();
    App.dashboard?.refresh?.();
    App.panel?.refresh?.();
  },

  // ========== Importação Universal de Extrato Bancário (OFX / CSV) ==========
  async openBankImportModal() {
    const accounts = (App.cache.accounts || await App.db.getAll('accounts')).filter(a => !a.archived);
    const sel = document.getElementById('bankImportAccount');
    if (sel) {
      const currentFilterAcc = document.getElementById('filterAccount')?.value;
      sel.innerHTML = accounts.map(a => `<option value="${App.math.escapeHtml(a.id)}">${App.math.escapeHtml(a.name)}</option>`).join('');
      if (currentFilterAcc && currentFilterAcc !== 'all') sel.value = currentFilterAcc;
    }
    const fileInput = document.getElementById('bankImportFile');
    if (fileInput) fileInput.value = '';
    this._bankImportRaw = null;
    this._bankImportFileName = '';
    this._bankImportParsed = null;
    const sumEl = document.getElementById('bankImportSummary');
    const wrapEl = document.getElementById('bankImportPreviewWrap');
    const btnEl = document.getElementById('bankImportConfirmBtn');
    if (sumEl) sumEl.style.display = 'none';
    if (wrapEl) wrapEl.style.display = 'none';
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Importar Lançamentos'; }
    App.ui.openModal('modalBankImport');
  },

  handleBankImportFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      this._bankImportRaw = String(ev.target.result || '');
      this._bankImportFileName = file.name;
      await this.reparseBankImport();
    };
    reader.readAsText(file, 'UTF-8');
  },

  async loadBankImportText(rawText, fileName = 'extrato.ofx') {
    this._bankImportRaw = String(rawText || '');
    this._bankImportFileName = fileName;
    await this.reparseBankImport();
  },

  async reparseBankImport() {
    if (!this._bankImportRaw) return;
    const accountId = document.getElementById('bankImportAccount')?.value || '';
    const existingTx = await App.db.getAll('transactions');
    const categories = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = categories;

    this._bankImportParsed = App.ledgerEngine.parseBankStatement(
      this._bankImportRaw,
      this._bankImportFileName,
      { existingTransactions: existingTx, accountId, categories: categories.filter(c => !c.archived) }
    );
    this._renderBankImportPreview(categories.filter(c => !c.archived));
  },

  _renderBankImportPreview(categories) {
    const parsed = this._bankImportParsed;
    const sumEl = document.getElementById('bankImportSummary');
    const wrapEl = document.getElementById('bankImportPreviewWrap');
    const tbody = document.getElementById('bankImportPreviewBody');
    const btnEl = document.getElementById('bankImportConfirmBtn');
    const selAll = document.getElementById('bankImportSelectAll');
    if (!parsed || !sumEl || !wrapEl || !tbody) return;

    const esc = App.math.escapeHtml;
    if (!parsed.items.length) {
      sumEl.style.display = 'block';
      sumEl.innerHTML = `<strong>Nenhum lançamento válido identificado</strong> no arquivo (${esc(parsed.format)}). Verifique se o extrato possui colunas de Data e Valor.`;
      wrapEl.style.display = 'none';
      if (btnEl) btnEl.disabled = true;
      return;
    }

    const selectedCount = parsed.items.filter(i => i.selected).length;
    sumEl.style.display = 'block';
    sumEl.innerHTML = `
      <span>Formato: <strong>${esc(parsed.format)}</strong></span>
      <span aria-hidden="true">·</span>
      <span>Encontrados: <strong>${parsed.totalCount}</strong></span>
      <span aria-hidden="true">·</span>
      <span class="green-text">Novos: <strong>${parsed.newCount}</strong></span>
      ${parsed.duplicateCount > 0 ? `<span aria-hidden="true">·</span><span class="tx-rec-warn">Possíveis duplicatas: <strong>${parsed.duplicateCount}</strong> (desmarcadas)</span>` : ''}
    `;

    const catNames = [...new Set((categories || []).map(c => c.name))].sort((a, b) => a.localeCompare(b));
    tbody.innerHTML = parsed.items.map((item, idx) => {
      const catOptions = [item.suggestedCategory, ...catNames]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .map(c => `<option value="${esc(c)}" ${c === item.suggestedCategory ? 'selected' : ''}>${esc(c)}</option>`)
        .join('');
      const valCls = item.type === 'income' ? 'green-text' : 'red-text';
      const sign = item.type === 'income' ? '+' : '−';
      const statusHtml = item.isDuplicate
        ? `<span class="bank-imp-dup" title="${esc(item.duplicateReason)}">⚠️ Duplicata</span>`
        : `<span class="bank-imp-new">✓ Novo</span>`;

      return `<tr class="${item.isDuplicate ? 'is-dup-row' : ''}">
        <td><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="App.transactions.toggleBankImportRow(${idx}, this.checked)"></td>
        <td>${App.utils.formatDate(item.date)}</td>
        <td>${esc(item.description)}</td>
        <td><select class="bank-imp-cat-select" onchange="App.transactions.updateBankImportCategory(${idx}, this.value)">${catOptions}</select></td>
        <td class="text-right tabular-nums ${valCls}" style="font-weight:600;">${sign} ${App.utils.formatCurrency(item.amount)}</td>
        <td>${statusHtml}</td>
      </tr>`;
    }).join('');

    wrapEl.style.display = 'block';
    if (selAll) selAll.checked = selectedCount === parsed.items.length;
    if (btnEl) {
      btnEl.disabled = selectedCount === 0;
      btnEl.textContent = selectedCount > 0 ? `Importar ${selectedCount} Lançamento(s)` : 'Nenhum selecionado';
    }
  },

  toggleBankImportSelectAll(checked) {
    if (!this._bankImportParsed) return;
    this._bankImportParsed.items.forEach(i => { i.selected = Boolean(checked); });
    const categories = (App.cache.categories || []).filter(c => !c.archived);
    this._renderBankImportPreview(categories);
  },

  toggleBankImportRow(idx, checked) {
    if (!this._bankImportParsed?.items?.[idx]) return;
    this._bankImportParsed.items[idx].selected = Boolean(checked);
    const selectedCount = this._bankImportParsed.items.filter(i => i.selected).length;
    const btnEl = document.getElementById('bankImportConfirmBtn');
    if (btnEl) {
      btnEl.disabled = selectedCount === 0;
      btnEl.textContent = selectedCount > 0 ? `Importar ${selectedCount} Lançamento(s)` : 'Nenhum selecionado';
    }
  },

  updateBankImportCategory(idx, cat) {
    if (!this._bankImportParsed?.items?.[idx]) return;
    this._bankImportParsed.items[idx].suggestedCategory = cat;
  },

  async confirmBankImport() {
    try {
      const parsed = this._bankImportParsed;
      const accountId = document.getElementById('bankImportAccount')?.value;
      if (!parsed || !accountId) return;
      const toImport = parsed.items.filter(i => i.selected);
      if (!toImport.length) {
        App.utils.showToast('Selecione ao menos um lançamento.', 'error');
        return;
      }

      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      const members = App.cache.members || await App.db.getAll('members');
      const acc = accounts.find(a => a.id === accountId);
      if (!acc) return;
      const mem = members.find(m => m.id === acc.member_id);
      const status = document.getElementById('bankImportMarkConfirmed')?.checked ? 'confirmed' : 'pending';
      const reconciled = Boolean(document.getElementById('bankImportMarkReconciled')?.checked);

      const nowIso = new Date().toISOString();
      const basePos = Date.now();
      for (let i = 0; i < toImport.length; i++) {
        const item = toImport[i];
        await App.db.put('transactions', {
          id: App.utils.generateId(),
          type: item.type,
          amount: item.amount,
          category: item.suggestedCategory || 'Outros',
          account_id: acc.id,
          account_name: acc.name,
          account_to_id: '',
          account_to_name: '',
          date: `${item.date}T12:00:00`,
          description: item.description,
          notes: `Importado via ${parsed.format} (${this._bankImportFileName || 'extrato'})`,
          external_fitid: item.fitid || '',
          member_id: acc.member_id || '',
          member_name: mem ? mem.name : '',
          credit_card_id: null,
          installments: 1,
          installment_number: 1,
          installment_id: null,
          recurring: false,
          status,
          reconciled,
          ignore_from_total: false,
          createdAt: nowIso,
          position: basePos + i
        });
      }

      this.invalidateCache();
      App.cache.totalBalance = null;
      App.ui.closeModal('modalBankImport');
      App.utils.showToast(`${toImport.length} lançamento(s) importado(s) com sucesso!`);
      this.load();
      App.dashboard?.refresh?.();
      App.panel?.refresh?.();
    } catch (err) {
      console.error(err);
      App.utils.showToast('Erro ao importar extrato.', 'error');
    }
  },

  // ========== Drag and Drop ==========
  dragStart(e) {
    this.dragSrcRow = e.target.closest('tr');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dragSrcRow.dataset.id);
    this.dragSrcRow.classList.add('dragging');
  },

  dragOver(e) {
    e.preventDefault();
    const targetRow = e.target.closest('tr');
    if (!targetRow || targetRow === this.dragSrcRow) return;
    const tbody = targetRow.parentNode;
    const rows = [...tbody.querySelectorAll('tr:not(.dragging)')];
    const targetIndex = rows.indexOf(targetRow);
    const draggedIndex = rows.indexOf(this.dragSrcRow);
    if (draggedIndex < targetIndex) {
      tbody.insertBefore(this.dragSrcRow, targetRow.nextSibling);
    } else {
      tbody.insertBefore(this.dragSrcRow, targetRow);
    }
  },

  async drop(e) {
    e.preventDefault();
    this.dragSrcRow.classList.remove('dragging');
    const tbody = this.dragSrcRow.parentNode;
    const newOrder = [...tbody.querySelectorAll('tr')].map(tr => tr.dataset.id).filter(Boolean);

    // Ativa modo manual automaticamente
    if (!this.manualOrder) {
      this.manualOrder = true;
      const sortSel = document.getElementById('sortOrder');
      if (sortSel) sortSel.value = 'manual';
    }

        // Atribui posições sequenciais (1,2,3...) conforme nova ordem
    for (let i = 0; i < newOrder.length; i++) {
      const rowId = newOrder[i];
      if (rowId.startsWith('invoice_')) {
          // Linha de fatura: extrai apenas o cardId antes do primeiro '_'
          const parts = rowId.split('_');
          // parts[0] = 'invoice', parts[1] = cardId, parts[2...] = dueMonth (pode conter '_')
          const cardId = parts[1];
          const allTx = await App.db.getAll('transactions');
          const cardTx = allTx.filter(t => t.credit_card_id === cardId && (t.type === 'expense' || t.type === 'refund'));
          // Ordena as transações por data para consistência
          cardTx.sort((a, b) => a.date.localeCompare(b.date));
          let base = i + 1;
          cardTx.forEach((tx, idx) => {
            tx.position = base + (idx + 1) / 1000;  // incrementos de 0.001
          });
          // Atualiza no banco em lote
          for (const tx of cardTx) {
            await App.db.put('transactions', tx);
          }
        } else {
        // Linha de transação individual
        const tx = await App.db.getById('transactions', rowId);
        if (tx) {
          tx.position = i + 1;
          await App.db.put('transactions', tx);
        }
      }
    }

    this.invalidateCache();
    this.load(); // recarrega a lista já ordenada manualmente
  },

  dragEnd(e) {
    if (this.dragSrcRow) {
      this.dragSrcRow.classList.remove('dragging');
      this.dragSrcRow = null;
    }
  },

  async showNotes(id) {
    const tx = await App.db.getById('transactions', id);
    if (!tx) return;
    const notes = tx.notes || '';
    document.getElementById('modalNotesContent').textContent = notes || 'Nenhuma nota cadastrada.';
    App.ui.openModal('modalTransactionNotes');
  },

  async openDetail(txId) {
    try {
      const t = await App.db.getById('transactions', txId);
      if (!t) {
        App.utils.showToast('Transação não encontrada.', 'error');
        return;
      }

      const dateStr = (t.date || '').slice(0, 10);
      const dateObj = new Date(dateStr + 'T12:00:00');
      const ano = isNaN(dateObj.getTime()) ? '—' : dateObj.getFullYear();
      const dataExtenso = isNaN(dateObj.getTime()) ? '—' :
        dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
      const diaSemana = isNaN(dateObj.getTime()) ? '' :
        dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
      const horaStr = (t.date || '').includes('T')
        ? t.date.split('T')[1].slice(0, 5)
        : '—';

      const ind = await this._getIndicatorsForDate(dateStr);
      const indRefDate = ind.date
        ? App.utils.formatDate(ind.date)
        : '(valores atuais)';

      const typeNames = {
        income: 'Receita', expense: 'Despesa', transfer: 'Transferência',
        contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno',
        adjustment: 'Ajuste'
      };
      const typeLabel = typeNames[t.type] || t.type;
      const isEntrada = t.type === 'income' || t.type === 'refund'
        || (t.type === 'transfer' && t.transfer_subtype === 'loan_payment');
      const typeColor = isEntrada ? '#22c55e' : '#ef4444';

      const amt = parseFloat(t.amount) || 0;
      const sinal = isEntrada ? '+' : '-';

      const statusLabel = t.status === 'pending' ? '⏳ Pendente' : '✓ Efetivada';
      const statusColor = t.status === 'pending' ? '#f59e0b' : '#22c55e';

      const classMap = { essential: 'Essencial', necessary: 'Necessário', superfluous: 'Supérfluo' };
      const classLabel = classMap[t.classification] || t.classification || '—';

      let parcelaStr = '—';
      if (t.installments > 1) {
        parcelaStr = `${t.installment_number}/${t.installments}`;
        if (t.purchase_date) {
          parcelaStr += ` (compra em ${App.utils.formatDate(t.purchase_date)})`;
        }
      }

      const methodMap = {
        pix: 'Pix', credit_card: 'Crédito', debit_card: 'Débito',
        cash: 'Dinheiro', transfer: 'Transferência'
      };
      const methodLabel = t.payment_method ? (methodMap[t.payment_method] || t.payment_method) : '—';

      const row = (label, value, opts = {}) => {
        if (value === undefined || value === null || value === '') return '';
        const color = opts.color || 'var(--text)';
        const bold = opts.bold ? 'font-weight:600;' : '';
        return `<div style="display:flex; justify-content:space-between; gap:16px; padding:8px 0; border-bottom:1px solid var(--border);">
          <span style="color:var(--text-muted); font-size:0.82rem;">${label}</span>
          <span style="color:${color}; font-size:0.85rem; text-align:right; ${bold}">${value}</span>
        </div>`;
      };

      const indCard = (label, value, icon, color) => {
        const num = parseFloat(value);
        if (isNaN(num)) return '';
        return `<div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; padding:12px 14px;">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">${icon} ${label}</div>
          <div style="font-size:1.2rem; font-weight:700; color:${color}; margin-top:6px;">${num.toFixed(2)}%</div>
          <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">ao ano</div>
        </div>`;
      };

      const html = `
        <div style="margin-bottom:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div>
              <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em;">${diaSemana}</div>
              <div style="font-size:1.6rem; font-weight:300; color:var(--text); margin-top:2px;">${dataExtenso}</div>
              <div style="display:flex; align-items:center; gap:10px; margin-top:6px;">
                <span style="font-size:2rem; font-weight:800; color:${typeColor}; letter-spacing:-1px;">${ano}</span>
                <span style="font-size:0.8rem; color:var(--text-muted);">🕐 ${horaStr}</span>
              </div>
            </div>
            <div style="text-align:right;">
              <span class="badge badge-${t.type}" style="font-size:0.9rem; padding:8px 16px;">${typeLabel}</span>
              <div style="margin-top:8px; font-size:0.75rem; color:${statusColor};">${statusLabel}</div>
            </div>
          </div>
        </div>

        <div style="background:linear-gradient(135deg, rgba(96,165,250,0.08), rgba(96,165,250,0.02)); border-left:4px solid ${typeColor}; border-radius:8px; padding:16px 20px; margin-bottom:20px;">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">Valor da transação</div>
          <div style="font-size:2rem; font-weight:700; color:${typeColor}; margin-top:4px;">${sinal} ${App.utils.formatCurrency(amt)}</div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
          <div>
            <h4 style="margin:0 0 10px; font-size:0.9rem; color:var(--primary);">💰 Dados Financeiros</h4>
            ${row('Tipo', typeLabel, { color: typeColor, bold: true })}
            ${row('Categoria', t.category || '—')}
            ${row('Descrição', t.description || '—')}
            ${row('Conta origem', t.account_name || '—')}
            ${t.account_to_name ? row('Conta destino', t.account_to_name) : ''}
            ${row('Membro', t.member_name || '—')}
            ${t.credit_card_id ? row('Cartão', 'Cartão de crédito') : ''}
            ${t.installments > 1 ? row('Parcela', parcelaStr) : ''}
            ${row('Forma de pagamento', methodLabel)}
            ${row('Classificação', classLabel)}
            ${row('Conciliado', t.reconciled ? '✅ Sim' : 'Não')}
            ${t.ignore_from_total ? row('Ignorar no saldo total', '⚠️ Sim', { color: '#f59e0b' }) : ''}
            ${t.invoice_locked ? row('Fatura travada', '🔒 Sim') : ''}
            ${t.notes ? row('Notas', t.notes) : ''}
          </div>

          <div>
            <h4 style="margin:0 0 10px; font-size:0.9rem; color:var(--primary);">📈 Indicadores Econômicos</h4>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:12px;">
              Vigentes em <strong style="color:var(--text);">${indRefDate}</strong>
              ${ind._fallback === 'posterior' ? '<br><span style="color:#f59e0b;">⚠️ Valores anteriores ao primeiro registro — usando o mais antigo disponível</span>' : ''}
              ${ind._fallback === 'atual' ? '<br><span style="color:#f59e0b;">⚠️ Sem histórico — usando valores atuais</span>' : ''}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              ${indCard('SELIC', ind.selic, '📊', '#22c55e')}
              ${indCard('IPCA', ind.ipca, '💹', '#f59e0b')}
              ${indCard('CDI', ind.cdi, '💵', '#60a5fa')}
              ${indCard('Poupança', ind.poupanca, '🏦', '#a78bfa')}
            </div>
          </div>
        </div>

        <div class="modal-actions" style="margin-top:24px;">
          ${t.notes ? `<button class="btn btn-ghost btn-sm" onclick="App.ui.closeModal('modalTxDetail'); App.transactions.showNotes('${t.id}')">📝 Ver notas</button>` : ''}
          <button class="btn btn-ghost" onclick="App.ui.closeModal('modalTxDetail')">Fechar</button>
          <button class="btn btn-primary" onclick="App.ui.closeModal('modalTxDetail'); App.transactions.edit('${t.id}')">✏️ Editar</button>
        </div>
      `;

      const container = document.getElementById('txDetailContent');
      if (!container) {
        console.error('Container #txDetailContent não encontrado.');
        return;
      }
      container.innerHTML = html;
      App.ui.openModal('modalTxDetail');
    } catch (e) {
      console.error('Erro ao abrir detalhe da transação:', e);
      App.utils.showToast('Erro ao abrir detalhes.', 'error');
    }
  },

  async _getIndicatorsForDate(dateStr) {
    try {
      const target = (dateStr || '').slice(0, 10);
      const all = await App.db.getAll('indicatorHistory');

      if (!all || all.length === 0) {
        return { date: null, ...App.config.INDICATORS, _fallback: 'atual' };
      }

      const anteriores = all.filter(h => (h.date || '').slice(0, 10) <= target);

      if (anteriores.length > 0) {
        anteriores.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return { ...anteriores[0], _fallback: null };
      }

      const maisAntigo = all.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
      return { ...maisAntigo, _fallback: 'posterior' };
    } catch (e) {
      console.error('Erro ao buscar indicadores:', e);
      return { date: null, ...App.config.INDICATORS, _fallback: 'atual' };
    }
  },

  _closeAdvancedFilters: (e) => {
    const menu = document.getElementById('advancedFilters');
    const btn = document.querySelector('.btn-ghost[onclick*="toggleAdvancedFilters"]');
    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.style.display = 'none';
      document.removeEventListener('click', App.transactions._closeAdvancedFilters);
    }
  },

  toggleAdvancedFilters() {
    const el = document.getElementById('advancedFilters');
    if (!el) return;
    const isOpen = el.style.display === 'block';
    if (isOpen) {
      el.style.display = 'none';
      document.removeEventListener('click', this._closeAdvancedFilters);
    } else {
      el.style.display = 'block';
      setTimeout(() => {
        document.addEventListener('click', this._closeAdvancedFilters);
      }, 0);
    }
  },

  getCurrentFilters() {
    const preset = document.getElementById('periodPreset')?.value || '';
    let startDate, endDate;
    if (preset === 'all' || preset === 'future') {
      startDate = preset === 'future' ? App.utils.todayISO() : '2000-01-01';
      endDate = '2099-12-31';
    } else if (preset.startsWith('past')) {
      const months = parseInt(preset.replace('past',''));
      startDate = App.utils.addMonths(App.utils.todayISO(), -months);
      endDate = App.utils.todayISO();
    } else {
      const cycle = this.currentCycle || App.utils.currentMonth();
      startDate = cycle.start;
      endDate = cycle.end;
    }
    return {
      startDate,
      endDate,
      type: document.getElementById('filterType').value,
      accountId: document.getElementById('filterAccount').value,
      creditCardId: document.getElementById('filterCreditCard').value,
      status: document.getElementById('filterStatus')?.value || 'all',
      memberId: App.state.globalMemberFilter || null,
      sortBy: this.manualOrder ? 'position' : this.sortCol,
      sortAsc: this.manualOrder ? true : this.sortAsc,
      limit: this.pageSize,
      offset: (this.currentPage - 1) * this.pageSize
    };
  },

  async loadTransactionStats() {
    App.ui.navigateTo('transaction-stats');
    const filters = this.getCurrentFilters();
    const txAll = await App.db.getTransactionsInRange(filters.startDate, filters.endDate, { memberId: filters.memberId });
    let tx = txAll.filter(t => t.status === 'confirmed' && !t.ignore_from_total);
    if (filters.type && filters.type !== 'all') tx = tx.filter(t => t.type === filters.type);
    if (filters.accountId && filters.accountId !== 'all') tx = tx.filter(t => t.account_id === filters.accountId || t.account_to_id === filters.accountId);
    if (filters.creditCardId && filters.creditCardId !== 'all') tx = tx.filter(t => t.credit_card_id === filters.creditCardId);

    const income = tx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
    const expense = tx.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
    const transfer = tx.filter(t => t.type === 'transfer').reduce((s, t) => s + parseFloat(t.amount), 0);
    const refund = tx.filter(t => t.type === 'refund').reduce((s, t) => s + parseFloat(t.amount), 0);
    const contribution = tx.filter(t => t.type === 'contribution').reduce((s, t) => s + parseFloat(t.amount), 0);
    const withdrawal = tx.filter(t => t.type === 'withdrawal').reduce((s, t) => s + parseFloat(t.amount), 0);

    // Expense breakdown: category
    const expensesByCat = {};
    tx.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.category || 'Outros';
      expensesByCat[cat] = (expensesByCat[cat] || 0) + parseFloat(t.amount);
    });
    let expCatTotal = 0;

    // Expense breakdown: member
    const expensesByMember = {};
    tx.filter(t => t.type === 'expense').forEach(t => {
      const name = t.member_name || 'Desconhecido';
      expensesByMember[name] = (expensesByMember[name] || 0) + parseFloat(t.amount);
    });
    let expMemTotal = 0;

    // Income breakdown: category
    const incomeByCat = {};
    tx.filter(t => t.type === 'income').forEach(t => {
      const cat = t.category || 'Outros';
      incomeByCat[cat] = (incomeByCat[cat] || 0) + parseFloat(t.amount);
    });
    let incCatTotal = 0;

    // Vista vs parcelado
    const vista = tx.filter(t => t.type === 'expense' && (!t.installments || t.installments <= 1)).reduce((s, t) => s + parseFloat(t.amount), 0);
    const parcelado = tx.filter(t => t.type === 'expense' && t.installments > 1).reduce((s, t) => s + parseFloat(t.amount), 0);

    // Top 5 expenses
    const topExpenses = tx.filter(t => t.type === 'expense').sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)).slice(0, 5);

    // Build HTML
    let html = `<div class="cards-row">
      <div class="card"><div class="card-label">📥 Receitas</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(income)}</div></div>
      <div class="card"><div class="card-label">📤 Despesas</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(expense)}</div></div>
      <div class="card"><div class="card-label">🔄 Transferências</div><div class="card-value">${App.utils.formatCurrency(transfer)}</div></div>
      <div class="card"><div class="card-label">↩️ Estornos</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(refund)}</div></div>
      <div class="card"><div class="card-label">💸 Aportes</div><div class="card-value">${App.utils.formatCurrency(contribution)}</div></div>
      <div class="card"><div class="card-label">💰 Resgates</div><div class="card-value">${App.utils.formatCurrency(withdrawal)}</div></div>
      <div class="card"><div class="card-label">⚖️ Resultado</div><div class="card-value" style="color:${(income + refund - expense - contribution) >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(income + refund - expense - contribution)}</div></div>
      <div class="card"><div class="card-label">💳 À Vista</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(vista)}</div></div>
      <div class="card"><div class="card-label">📦 Parcelado</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(parcelado)}</div></div>
    </div>`;

    // Despesas por categoria
    html += `<h3>🏷️ Despesas por Categoria</h3>
      <div class="table-container">
        <table><thead><tr><th>Categoria</th><th class="text-right">Valor</th></tr></thead><tbody>`;
    const sortedExpCat = Object.entries(expensesByCat).sort((a, b) => b[1] - a[1]);
    sortedExpCat.forEach(([cat, val]) => {
      expCatTotal += val;
      html += `<tr><td>${cat}</td><td class="text-right">${App.utils.formatCurrency(val)}</td></tr>`;
    });
    html += `<tr style="font-weight:700; border-top:2px solid var(--border);"><td><strong>TOTAL</strong></td><td class="text-right">${App.utils.formatCurrency(expCatTotal)}</td></tr>`;
    html += `</tbody></table></div>`;

    // Despesas por membro
    html += `<h3>👥 Despesas por Membro</h3>
      <div class="table-container">
        <table><thead><tr><th>Membro</th><th class="text-right">Valor</th></tr></thead><tbody>`;
    const sortedExpMem = Object.entries(expensesByMember).sort((a, b) => b[1] - a[1]);
    sortedExpMem.forEach(([name, val]) => {
      expMemTotal += val;
      html += `<tr><td>${name}</td><td class="text-right">${App.utils.formatCurrency(val)}</td></tr>`;
    });
    html += `<tr style="font-weight:700; border-top:2px solid var(--border);"><td><strong>TOTAL</strong></td><td class="text-right">${App.utils.formatCurrency(expMemTotal)}</td></tr>`;
    html += `</tbody></table></div>`;

    // Receitas por categoria
    html += `<h3>💰 Receitas por Categoria</h3>
      <div class="table-container">
        <table><thead><tr><th>Categoria</th><th class="text-right">Valor</th></tr></thead><tbody>`;
    const sortedIncCat = Object.entries(incomeByCat).sort((a, b) => b[1] - a[1]);
    sortedIncCat.forEach(([cat, val]) => {
      incCatTotal += val;
      html += `<tr><td>${cat}</td><td class="text-right">${App.utils.formatCurrency(val)}</td></tr>`;
    });
    html += `<tr style="font-weight:700; border-top:2px solid var(--border);"><td><strong>TOTAL</strong></td><td class="text-right">${App.utils.formatCurrency(incCatTotal)}</td></tr>`;
    html += `</tbody></table></div>`;

    // Top 5 maiores despesas
    html += `<h3>🔝 Top 5 Maiores Despesas</h3>
      <div class="table-container">
        <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Membro</th><th class="text-right">Valor</th></tr></thead><tbody>`;
    const esc = (v) => App.utils.escapeHtml(v);
    topExpenses.forEach(t => {
      html += `<tr><td>${App.utils.formatDateTime(t.date)}</td><td>${esc(t.description || '')}</td><td>${esc(t.category || '')}</td><td>${esc(t.member_name || '')}</td><td class="text-right">${App.utils.formatCurrency(t.amount)}</td></tr>`;
    });
    html += `</tbody></table></div>`;

    document.getElementById('transactionStatsContent').innerHTML = html;
  }
};

// =======================================================================
// Extratos (otimizado com getTransactionsInRange)
// =======================================================================
App.extracts = {
  async load() {
    const accountId = document.getElementById('extractAccount').value;
    const memberId = document.getElementById('extractMember').value;
    const typeFilter = document.getElementById('extractTypeFilter')?.value || 'all';
    let start = document.getElementById('extractStart').value;
    let end = document.getElementById('extractEnd').value;
    if (!start) start = App.utils.currentMonth().start;
    if (!end) end = App.utils.currentMonth().end;
    document.getElementById('extractStart').value = start;
    document.getElementById('extractEnd').value = end;

    let tx = await App.db.getTransactionsInRange(start, end, {
      memberId: App.state.globalMemberFilter || null
    });

    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    if (!App.cache.members) App.cache.members = members;
    const esc = (v) => App.utils.escapeHtml(v);
    const accSel = document.getElementById('extractAccount');
    if (accSel.options.length <= 1) accSel.innerHTML = '<option value="all">Todas contas</option>' + accounts.filter(a => !a.archived).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
    const memSel = document.getElementById('extractMember');
    if (memSel.options.length <= 1) memSel.innerHTML = '<option value="all">Todos membros</option>' + members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');

    if (accountId !== 'all') tx = tx.filter(t => t.account_id === accountId || t.account_to_id === accountId);
    if (memberId !== 'all') tx = tx.filter(t => t.member_id === memberId);
    if (typeFilter !== 'all') tx = tx.filter(t => t.type === typeFilter);
    tx = tx.filter(t => !t.ignore_from_total);

    const today = App.utils.todayISO();
    const thirtyDaysFromNow = new Date(today + 'T12:00:00');
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const cutoffDate = thirtyDaysFromNow.toISOString().slice(0, 10);
    tx = tx.filter(t => {
      if (t.expense_type === 'fixed') {
        if (t.status === 'confirmed') return true;
        if (t.date <= cutoffDate) return true;
        return false;
      }
      return true;
    });

    tx.sort((a, b) => a.date.localeCompare(b.date));
    // Calcula saldo inicial das contas (considerando filtros)
    let initialBalance = 0;
    const selectedAccounts = accountId !== 'all' ? accounts.filter(a => a.id === accountId) : accounts.filter(a => !a.archived);
    for (const a of selectedAccounts) {
      if (a.exclude_from_total) continue;
      initialBalance += (a.initial_balance || 0);
      // Também soma transações confirmadas e não ignoradas até a data de início (exclusive)
      // para compor o saldo real na data start
    }
    // Precisamos calcular o saldo acumulado até start (exclusive) com transações confirmadas e não ignoradas
    const txBeforeStart = await App.db.getTransactionsInRange('2000-01-01', start, { memberId: App.state.globalMemberFilter || null });
    const filteredBefore = txBeforeStart.filter(t => {
      if (t.status !== 'confirmed' || t.ignore_from_total) return false;
      if (accountId !== 'all' && t.account_id !== accountId && t.account_to_id !== accountId) return false;
      if (memberId !== 'all' && t.member_id !== memberId) return false;
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      return true;
    });
    let runningBalance = initialBalance;
    filteredBefore.sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund') runningBalance += amt;
      else if (t.type === 'expense') runningBalance -= amt;
      else if (t.type === 'transfer' || t.type === 'contribution') { if (t.account_id) runningBalance -= amt; if (t.account_to_id) runningBalance += amt; }
      else if (t.type === 'withdrawal') { if (t.account_id) runningBalance -= amt; if (t.account_to_id) runningBalance += amt; }
    });
    this.render(tx, runningBalance);
  },
  render(tx) {
    const tbody = document.getElementById('extractTableBody'), empty = document.getElementById('extractEmpty');
    if (!tx.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const days = {};
    tx.forEach(t => { const d = t.date; if (!days[d]) days[d] = []; days[d].push(t); });
    const sortedDays = Object.keys(days).sort();
    let balance = 0, html = '';
    sortedDays.forEach(date => {
      const dayTx = days[date];
      const openingBalance = balance;
      let dayTotal = 0;
      dayTx.forEach(t => {
        const amt = parseFloat(t.amount);
        if (t.type === 'income' || t.type === 'refund') dayTotal += amt;
        else if (t.type === 'expense') dayTotal -= amt;
        else if (t.type === 'transfer' || t.type === 'contribution') { if (t.account_id) dayTotal -= amt; if (t.account_to_id) dayTotal += amt; }
        else if (t.type === 'withdrawal') { if (t.account_id) dayTotal -= amt; if (t.account_to_id) dayTotal += amt; }
      });
      balance += dayTotal;
      const closingBalance = balance;
      html += `<tr class="extract-day"><td colspan="4"><strong>${App.utils.formatDateTime(date)}</strong> — Saldo inicial: ${App.utils.formatCurrency(openingBalance)}</td></tr>`;
      const esc = (v) => App.utils.escapeHtml(v);
      dayTx.forEach(t => {
        const sign = t.type === 'income' || t.type === 'contribution' || t.type === 'refund' ? '+' : '-';
        const hist = { income: 'Receita', expense: 'Despesa', contribution: 'Aporte', withdrawal: 'Resgate', transfer: 'Transferência', refund: 'Estorno' }[t.type] || t.type;
        const statusLabel = (t.status !== 'confirmed') ? ' (Pendente)' : '';
        html += `<tr><td></td><td>${esc(hist)}: ${esc(t.description || t.category || '')} ${t.member_name ? '(' + esc(t.member_name) + ')' : ''}${statusLabel}</td><td class="text-right">${sign} ${App.utils.formatCurrency(t.amount)}</td><td class="text-right"></td></tr>`;
      });
      html += `<tr class="extract-day"><td colspan="4"><strong>Saldo final do dia: ${App.utils.formatCurrency(closingBalance)}</strong></td></tr>`;
    });
    tbody.innerHTML = html;
  },
  async exportExtract() {
    const accountId = document.getElementById('extractAccount').value;
    const memberId = document.getElementById('extractMember').value;
    const start = document.getElementById('extractStart').value;
    const end = document.getElementById('extractEnd').value;
    let tx = await App.db.getTransactionsInRange(start, end, {
      memberId: App.state.globalMemberFilter || null
    });
    if (accountId !== 'all') tx = tx.filter(t => t.account_id === accountId || t.account_to_id === accountId);
    if (memberId !== 'all') tx = tx.filter(t => t.member_id === memberId);
    const today = App.utils.todayISO();
    const thirtyDaysFromNow = new Date(today + 'T12:00:00');
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const cutoffDate = thirtyDaysFromNow.toISOString().slice(0, 10);
    tx = tx.filter(t => {
      if (t.expense_type === 'fixed') {
        if (t.status === 'confirmed') return true;
        if (t.date <= cutoffDate) return true;
        return false;
      }
      return true;
    });
    tx.sort((a, b) => a.date.localeCompare(b.date));
    const typeNames = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência', contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno' };
    const headers = ['Data', 'Tipo', 'Descrição', 'Valor', 'Saldo', 'Membro'];
    const rows = [];
    let balance = 0;
    tx.forEach(t => {
      const amt = parseFloat(t.amount);
      if (t.type === 'income' || t.type === 'refund') balance += amt;
      else if (t.type === 'expense') balance -= amt;
      else if (t.type === 'transfer' || t.type === 'contribution') { if (t.account_id) balance -= amt; if (t.account_to_id) balance += amt; }
      else if (t.type === 'withdrawal') { if (t.account_id) balance -= amt; if (t.account_to_id) balance += amt; }
      const sign = t.type === 'income' || t.type === 'contribution' || t.type === 'refund' ? '+' : '-';
      rows.push([App.utils.formatDateTime(t.date), typeNames[t.type] || t.type, t.description || t.category || '', `${sign} ${App.utils.formatCurrency(amt)}`, App.utils.formatCurrency(balance), t.member_name || '']);
    });
    App.utils.exportCSV('extrato.csv', headers, rows);
    App.utils.showToast('Extrato exportado!');
  }
};

// =======================================================================
// Cartões de Crédito
// =======================================================================
App.creditCards = {
  currentMonthStart: null,
  _extendedLogosPromise: null,
  ensureExtendedLogos() {
    if (App.bankLogos && typeof App.bankLogos.ensureLoaded === 'function') {
      return App.bankLogos.ensureLoaded().then(() => true).catch(() => false);
    }
    return Promise.resolve(true);
  },
  bankLogoMap: {},
  bankColors: {},
  getBankLogo(cardNameOrObj) {
    if (App.bankLogos && typeof App.bankLogos.getLogoUrl === 'function') {
      return App.bankLogos.getLogoUrl(cardNameOrObj);
    }
    return '';
  },

  getBankColor(cardNameOrObj) {
    if (App.bankLogos && typeof App.bankLogos.getColor === 'function') {
      return App.bankLogos.getColor(cardNameOrObj);
    }
    return '#2c3e50';
  },
  onCardTypeChange() {
    const type = document.getElementById('ccCardType')?.value || 'credit';
    const creditFields = document.getElementById('ccCreditFields');
    const prepaidFields = document.getElementById('ccPrepaidFields');
    const limitInput = document.getElementById('ccLimit');
    const dueDayInput = document.getElementById('ccDueDay');
    if (type === 'prepaid') {
      if (creditFields) creditFields.style.display = 'none';
      if (prepaidFields) prepaidFields.style.display = 'block';
      if (limitInput) limitInput.removeAttribute('required');
      if (dueDayInput) dueDayInput.removeAttribute('required');
    } else {
      if (creditFields) creditFields.style.display = 'block';
      if (prepaidFields) prepaidFields.style.display = 'none';
      if (limitInput) limitInput.setAttribute('required', 'required');
      if (dueDayInput) dueDayInput.setAttribute('required', 'required');
    }
  },

  onBankSelect() {
    const bankSelect = document.getElementById('ccBank');
    const nameInput = document.getElementById('ccName');
    const previewEl = document.getElementById('ccBankPreview');
    if (bankSelect && bankSelect.value) {
      const entry = App.bankLogos ? App.bankLogos.resolve(bankSelect.value) : null;
      if (entry && nameInput) {
        nameInput.value = entry.displayName;
      }
      if (App.bankLogos && previewEl) {
        App.bankLogos.updatePreview(previewEl, entry || bankSelect.value);
      }
    } else if (App.bankLogos && previewEl) {
      App.bankLogos.updatePreview(previewEl, nameInput ? nameInput.value : '');
    }
  },

  async load() {
    await this.ensureExtendedLogos();
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().start;
    const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
    document.getElementById('ccCycleLabel').textContent = `Ref. ${cycle.refMonth}`;
    const cards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = cards;
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    if (!App.cache.members) App.cache.members = members;
    const gridEl = document.getElementById('creditCardsGrid'), empty = document.getElementById('creditCardsEmpty');
    const summaryContainer = document.getElementById('creditCardsSummary');
    if (!cards.length) {
      if (gridEl) gridEl.innerHTML = '';
      if (empty) empty.style.display = 'block';
      if (summaryContainer) summaryContainer.innerHTML = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    const startRange = App.utils.addMonths(cycle.start, -1);
    const endRange = App.utils.addMonths(cycle.end, 1);
    const txAll = await App.db.getTransactionsInRange(startRange, endRange);

    let totalLimit = 0, totalUsed = 0;
    const cardData = cards.map(c => {
      const account = accounts.find(a => a.id === c.account_id);
      const member = members.find(m => m.id === c.member_id);
      const isPrepaid = c.card_type === 'prepaid';

      let total = 0;
      if (isPrepaid) {
        const allCardTx = txAll.filter(t => t.credit_card_id === c.id);
        const reloads = allCardTx.filter(t => t.description && t.description.startsWith('Recarga') && t.type === 'income')
          .reduce((s, t) => s + parseFloat(t.amount), 0);
        const expenses = allCardTx.filter(t => t.type === 'expense' && !(t.description && t.description.startsWith('Recarga')))
          .reduce((s, t) => s + parseFloat(t.amount), 0);
        const refunds = allCardTx.filter(t => t.type === 'refund')
          .reduce((s, t) => s + parseFloat(t.amount), 0);
        total = (c.initial_balance || 0) + reloads - expenses + refunds;
      } else {
        const expenses = txAll.filter(t => t.credit_card_id === c.id && t.date >= cycle.start && t.date <= cycle.end && t.type === 'expense');
        const refunds = txAll.filter(t => t.credit_card_id === c.id && t.date >= cycle.start && t.date <= cycle.end && t.type === 'refund');
        total = expenses.reduce((s, t) => s + parseFloat(t.amount), 0) - refunds.reduce((s, t) => s + parseFloat(t.amount), 0);
        totalLimit += parseFloat(c.limit);
        totalUsed += Math.max(0, total);
      }

      const today = new Date();
      const closeDay = c.close_day || (c.due_day - 10 > 0 ? c.due_day - 10 : 1);
      let nextClose = new Date(today.getFullYear(), today.getMonth(), closeDay);
      if (today > nextClose) nextClose.setMonth(nextClose.getMonth() + 1);
      const daysToClose = Math.ceil((nextClose - today) / (1000 * 60 * 60 * 24));
      return { card: c, account, member, total, nextClose, daysToClose, isPrepaid };
    });

    // Resumo financeiro no topo
    if (summaryContainer) {
      const prepaidCards = cardData.filter(d => d.isPrepaid);
      const creditCardsOnly = cardData.filter(d => !d.isPrepaid);
      const totalPrepaidBalance = prepaidCards.reduce((s, d) => s + d.total, 0);
      const totalCC = creditCardsOnly.length + prepaidCards.length;
      const usagePercent = totalLimit ? ((totalUsed / totalLimit) * 100).toFixed(1) : 0;
      const available = totalLimit - totalUsed;
      let summaryHTML = `
        <div class="summary-item">
          <div class="summary-label">Limite total</div>
          <div class="summary-value">${App.utils.formatCurrency(totalLimit)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Utilizado</div>
          <div class="summary-value green">${App.utils.formatCurrency(totalUsed)}</div>
          <div class="summary-subtitle">${usagePercent}% do limite</div>
          <div class="summary-progress"><span style="width:${usagePercent}%;"></span></div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Disponível</div>
          <div class="summary-value">${App.utils.formatCurrency(available)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Cartões</div>
          <div class="summary-value">${totalCC}</div>
        </div>
      `;
      if (prepaidCards.length > 0) {
        summaryHTML += `<div class="summary-item">
          <div class="summary-label">Saldo Pré‑pago</div>
          <div class="summary-value green">${App.utils.formatCurrency(totalPrepaidBalance)}</div>
        </div>`;
      }
      summaryContainer.innerHTML = summaryHTML;
      summaryContainer.className = 'financial-summary';

      
    }

    // Grid de cartões + resumo lateral no container "Faturas atuais"
    if (gridEl) {
      const creditCardsOnly = cardData.filter(d => !d.isPrepaid);
      const cardsHTML = creditCardsOnly.map(d => {
        const limitVal = parseFloat(d.card.limit);
        const usagePct = limitVal > 0 ? Math.min((d.total / limitVal) * 100, 100) : 0;
        const invoiceColor = d.total > (limitVal * 0.8) ? '#c62828' : '#35b94b';
        const progressColor = usagePct > 80 ? '#c62828' : usagePct > 50 ? '#f57c00' : '#35b94b';
        return `
          <article class="credit-card" onclick="App.cardInvoice.open('${d.card.id}')" style="border-left: 4px solid ${App.creditCards.getBankColor(d.card)};">
            <div class="card-head">
              <div class="card-brand">
                <div class="brand-logo">${App.bankLogos ? App.bankLogos.renderLogoHtml(d.card) : d.card.name.charAt(0)}</div>
                <div class="card-title-area">
                  <div class="card-name">${d.card.name}</div>
                  <div class="card-limit">Limite: ${App.utils.formatCurrency(limitVal)}</div>
                </div>
              </div>
              <div class="card-actions">
                <button class="icon-btn" onclick="event.stopPropagation();App.creditCards.edit('${d.card.id}')" title="Editar">✏️</button>
                <button class="icon-btn delete" onclick="event.stopPropagation();App.creditCards.remove('${d.card.id}')" title="Excluir">🗑️</button>
              </div>
            </div>
            <div class="usage">
              <div class="usage-top">
                <span>Utilizado</span>
                <span class="usage-percent">${usagePct.toFixed(0)}%</span>
              </div>
              <div class="usage-value">${App.utils.formatCurrency(d.total)}</div>
              <div class="progress">
                <span style="width:${usagePct}%; background:${progressColor};"></span>
              </div>
            </div>
            <div class="card-info">
              <div class="info-column">
                <div class="info-label">Vencimento</div>
                <div class="info-value">Dia ${d.card.due_day}</div>
              </div>
              <div class="info-column">
                <div class="info-label">Fechamento</div>
                <div class="info-value">Dia ${d.card.close_day || d.card.due_day - 10}</div>
              </div>
              <div class="info-column">
                <div class="info-label">Conta</div>
                <div class="info-value">${d.account?.name || ''}</div>
              </div>
            </div>
            <div class="card-footer">
              <span>Fatura atual</span>
              <strong style="color:${invoiceColor};">${App.utils.formatCurrency(d.total)}</strong>
            </div>
          </article>
        `;
      }).join('');

      const summaryHTML = creditCardsOnly.length > 0 ? `
        <aside class="invoice-summary">
          <h3>Resumo das faturas atuais</h3>
          ${creditCardsOnly.map(d => `
            <div class="invoice-row">
              <div class="invoice-row-name">
                <span class="mini-logo">${App.bankLogos ? App.bankLogos.renderLogoHtml(d.card) : d.card.name.charAt(0)}</span>
                ${d.card.name}
              </div>
              <div class="invoice-row-value">${App.utils.formatCurrency(d.total)}</div>
            </div>
          `).join('')}
          <div class="invoice-total">
            <span>Total</span>
            <strong>${App.utils.formatCurrency(totalUsed)}</strong>
          </div>
        </aside>
      ` : '';

      gridEl.innerHTML = `
        <div class="current-invoices">
          <div class="invoices-header">
            <h2>Faturas atuais <span class="info-icon" title="Faturas do ciclo atual">i</span></h2>
            <div class="invoices-total">
              <span>Total das faturas</span>
              <strong>${App.utils.formatCurrency(totalUsed)}</strong>
            </div>
          </div>
          <div class="cards-grid">
            ${summaryHTML}
            ${cardsHTML}
          </div>
        </div>
        <div class="bottom-tip">
          <span class="tip-icon">♧</span>
          Dica: mantenha o pagamento em dia para evitar juros e manter seu limite disponível.
        </div>
      `;
    }
  },
  async save(e) {
    e.preventDefault();
    const id = document.getElementById('ccId').value, name = document.getElementById('ccName').value;
    const card_type = document.getElementById('ccCardType')?.value || 'credit';
    const limit = parseFloat(document.getElementById('ccLimit').value) || 0;
    const due_day = parseInt(document.getElementById('ccDueDay').value) || 10;
    const close_day = parseInt(document.getElementById('ccCloseDay').value) || (due_day - 10 > 0 ? due_day - 10 : 1);
    const account_id = document.getElementById('ccAccount').value, member_id = document.getElementById('ccMember').value;
    const initial_balance = card_type === 'prepaid' ? (parseFloat(document.getElementById('ccInitialBalance')?.value) || 0) : 0;

    if (!name) { App.utils.showToast('Preencha o nome', 'error'); return false; }
    if (card_type === 'credit' && (isNaN(limit) || limit <= 0)) { App.utils.showToast('Informe um limite válido', 'error'); return false; }
    if (!account_id) { App.utils.showToast('Selecione uma conta', 'error'); return false; }

    const existing = id ? await App.db.getById('creditCards', id) : null;
    if (existing && card_type === 'credit' && parseFloat(existing.limit) !== limit) {
      await App.db.put('creditLimitHistory', { id: App.utils.generateId(), card_id: id, date: App.utils.todayISO(), old_limit: parseFloat(existing.limit), new_limit: limit });
    }

    const bank_ispb = document.getElementById('ccBank')?.value || existing?.bank_ispb || '';
    const cardData = {
      id: id || App.utils.generateId(),
      name,
      bank_ispb,
      card_type,
      limit: card_type === 'credit' ? limit : 0,
      due_day,
      close_day,
      account_id,
      member_id,
      created_at: existing?.created_at || new Date().toISOString()
    };

    if (card_type === 'prepaid') {
      cardData.initial_balance = initial_balance;
      if (!existing && initial_balance > 0) {
        const acc = (App.cache.accounts || await App.db.getAll('accounts')).find(a => a.id === account_id);
        await App.db.put('transactions', {
          id: App.utils.generateId(),
          type: 'income',
          amount: initial_balance,
          category: 'Recarga Cartão',
          account_id: account_id,
          account_name: acc?.name || '',
          date: App.utils.todayISO(),
          description: 'Recarga inicial - ' + name,
          notes: '',
          member_id: member_id || '',
          member_name: (App.cache.members?.find(m => m.id === member_id) || {}).name || '',
          credit_card_id: cardData.id,
          payment_method: 'transfer',
          status: 'confirmed',
          reconciled: false,
          ignore_from_total: false,
          createdAt: new Date().toISOString()
        });
      }
    }

    await App.db.put('creditCards', cardData);
    App.cache.creditCards = null;

    // ---- Propaga troca de conta do cartão para TODAS as transações do cartão ----
    // Se o cartão trocou de conta de débito, as transações antigas precisam ser
    // migradas para a nova conta, senão a fatura aparece agrupada na conta antiga.
    if (existing && existing.account_id && existing.account_id !== account_id) {
      try {
        const _acc = (App.cache.accounts || await App.db.getAll('accounts')).find(a => a.id === account_id);
        const _accName = _acc ? _acc.name : '';
        const _allTx = await App.db.getAll('transactions');
        const _toFix = [];
        for (const _t of _allTx) {
          if (_t.credit_card_id === cardData.id && _t.account_id !== account_id) {
            _toFix.push({ ..._t, account_id: account_id, account_name: _accName });
          }
        }
        if (_toFix.length > 0) {
          await App.db.putMany('transactions', _toFix);
          if (App.transactions && App.transactions.invalidateCache) App.transactions.invalidateCache();
          App.cache.totalBalance = null;
        }
      } catch (_e) {
        console.warn('Falha ao sincronizar account_id das transações do cartão:', _e);
      }
    }

    App.ui.closeModal('modalCreditCard'); App.utils.showToast(id ? 'Atualizado!' : 'Criado!'); this.load(); return false;
  },
  async payBill(cardId) {
    const card = await App.db.getById('creditCards', cardId);
    if (!card) return;

    // Obtém a fatura atual
    const today = App.utils.todayISO();
    const cycle = App.utils.monthRangeFromDate(today);
    const txAll = await App.db.getTransactionsInRange(cycle.start, cycle.end, { memberId: App.state.globalMemberFilter || null });
    const total = txAll.filter(t => t.credit_card_id === cardId && t.type === 'expense' && t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0) - txAll.filter(t => t.credit_card_id === cardId && t.type === 'refund' && t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);
    if (total <= 0) { App.utils.showToast('Fatura zerada', 'error'); return; }

    // Determina o período exato da fatura
    const period = App.cardInvoice.getCurrentInvoicePeriod(card);
    const { start, end, due } = period;

    await App.ui.openPayInvoiceModal(cardId, total, due, start, end);
  },
  async payInvoice(cardId, total, dueDate, startPeriod, endPeriod) {
    await App.ui.openPayInvoiceModal(cardId, total, dueDate, startPeriod, endPeriod);
  },

  async processInvoicePayment(cardId, total, dueDate, startPeriod, endPeriod, fullDate, notes = '') {
    const card = await App.db.getById('creditCards', cardId);
    if (!card) return;

    // Verifica se a fatura já foi paga (transações do ciclo já estão travadas)
    const txInRange = await App.db.getTransactionsInRange(startPeriod, endPeriod);
    const alreadyPaid = txInRange.some(t => t.credit_card_id === cardId && t.invoice_locked);
    if (alreadyPaid) {
      App.utils.showToast('Esta fatura já foi paga anteriormente.', 'warning');
      return;
    }

    const acc = (App.cache.accounts || await App.db.getAll('accounts')).find(a => a.id === card.account_id);
    const dueMonth = dueDate ? dueDate.slice(0,7) : '';
    const desc = `Pagamento Fatura ${card.name} ${dueMonth}${notes ? ' - ' + notes : ''}`;

    // Cria a despesa de pagamento de fatura
    await App.db.put('transactions', {
      id: App.utils.generateId(),
      type: 'expense',
      amount: total,
      category: 'Pagamento Fatura',
      account_id: card.account_id,
      account_name: acc?.name || '',
      date: fullDate,
      description: desc,
      notes: notes || '',
      member_id: card.member_id || '',
      status: 'confirmed',
      ignore_from_total: false,
      createdAt: new Date().toISOString()
    });

    // Efetivar e travar todas as transações do cartão naquele ciclo
    await this.lockInvoiceTransactions(cardId, startPeriod, endPeriod);

    App.cache.totalBalance = null;
  },
  async refundInvoice(cardId, total, dueDate, startPeriod, endPeriod) {
    const card = await App.db.getById('creditCards', cardId);
    if (!card) return;
    App.utils.prompt(
      `Data do estorno da fatura de ${App.utils.formatCurrency(total)}?`,
      App.utils.todayISO(),
      async (refundDate) => {
        if (!refundDate) return;
        App.utils.confirm(
          `Estornar fatura de ${App.utils.formatCurrency(total)} na data ${App.utils.formatDate(refundDate)}?`,
          async () => {
            const acc = (App.cache.accounts || await App.db.getAll('accounts')).find(a => a.id === card.account_id);
            await App.db.put('transactions', {
              id: App.utils.generateId(),
              type: 'refund',
              amount: total,
              category: 'Estorno Fatura',
              account_id: card.account_id,
              account_name: acc?.name || '',
              date: refundDate,
              description: `Estorno fatura ${card.name} período ${App.utils.formatDate(startPeriod)} a ${App.utils.formatDate(endPeriod)}`,
              notes: '',
              member_id: card.member_id || '',
              credit_card_id: cardId,
              status: 'confirmed',
              ignore_from_total: false,
              createdAt: new Date().toISOString()
            });
            // Força a atualização do saldo imediatamente
            App.cache.totalBalance = null;
            await App.saldos.load();
            
            App.utils.showToast('Estorno da fatura lançado!');
            this.load(); App.transactions.load(); App.dashboard.refresh(); App.panel.refresh();
          }
        );
      }
    );
  },

  async revertInvoicePayment(paymentTxId) {
    const payment = await App.db.getById('transactions', paymentTxId);
    if (!payment) {
      App.utils.showToast('Pagamento não encontrado.', 'error');
      return;
    }
    if (payment.category !== 'Pagamento Fatura' || payment.type !== 'expense') {
      App.utils.showToast('Esta transação não é um pagamento de fatura.', 'error');
      return;
    }
    if (payment.reverted) {
      App.utils.showToast('Este pagamento já foi revertido anteriormente.', 'warning');
      return;
    }

    const allCards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = allCards;

    let cardId = payment.invoice_card_id || null;
    let dueMonth = payment.invoice_due_month || null;

    if (!cardId || !dueMonth) {
      const m = (payment.description || '').match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
      if (!m) {
        App.utils.showToast('Não foi possível identificar o cartão/período do pagamento.', 'error');
        return;
      }
      dueMonth = m[2];
      const _norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      let card = allCards.find(c => _norm(c.name) === _norm(m[1]));
      if (!card) {
        card = allCards.find(c => {
          const n = _norm(c.name);
          return n && (n.includes(_norm(m[1])) || _norm(m[1]).includes(n));
        });
      }
      if (!card && payment.account_id) {
        const sameAcc = allCards.filter(c => c.account_id === payment.account_id);
        if (sameAcc.length === 1) card = sameAcc[0];
      }
      if (!card) {
        App.utils.showToast('Cartão do pagamento não encontrado.', 'error');
        return;
      }
      cardId = card.id;
    }

    const card = await App.db.getById('creditCards', cardId);
    if (!card) {
      App.utils.showToast('Cartão não encontrado.', 'error');
      return;
    }

    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    const debitAccount = accounts.find(a => a.id === payment.account_id);

    App.utils.confirm(
      `Reverter o pagamento "${payment.description}" no valor de ${App.utils.formatCurrency(payment.amount)}?\n\n` +
      `• Crédito de reversão será lançado em ${debitAccount ? debitAccount.name : '(conta do pagamento)'}\n` +
      `• Data e hora do crédito: ${App.utils.formatDateTime(payment.date)} (idênticas ao pagamento)\n` +
      `• A fatura ${dueMonth} do cartão ${card.name} volta a ficar aberta`,
      async () => {
        try {
          const period = App.cardInvoice.getInvoicePeriodForMonth(card, dueMonth);

          // 1) Desbloqueia transações do cartão no período
          const txInRange = await App.db.getTransactionsInRange(period.start, period.end);
          let unlocked = 0;
          for (const tx of txInRange) {
            if (tx.credit_card_id === cardId && (tx.type === 'expense' || tx.type === 'refund') && tx.invoice_locked) {
              delete tx.invoice_locked;
              tx.updatedAt = new Date().toISOString();
              await App.db.put('transactions', tx);
              unlocked++;
            }
          }

          // 2) Cria o crédito de reversão na MESMA data e hora do pagamento
          const reversalId = App.utils.generateId();
          await App.db.put('transactions', {
            id: reversalId,
            type: 'refund',
            amount: payment.amount,
            category: 'Reversão Pagamento Fatura',
            account_id: payment.account_id,
            account_name: payment.account_name || (debitAccount ? debitAccount.name : ''),
            account_to_id: null,
            account_to_name: null,
            date: payment.date,
            description: `Reversão: ${payment.description}`,
            notes: 'Estorno automático por reversão de pagamento de fatura',
            member_id: payment.member_id || '',
            member_name: payment.member_name || '',
            credit_card_id: null,
            payment_method: payment.payment_method || '',
            classification: 'necessary',
            receipt_url: '',
            investment_id: null,
            loan_id: null,
            installments: 1,
            installment_number: 1,
            installment_id: null,
            recurring: false,
            vacation: false,
            status: 'confirmed',
            reconciled: false,
            ignore_from_total: false,
            reverts_payment_id: payment.id,
            createdAt: new Date().toISOString(),
            position: payment.position || Date.now()
          });

          // 3) Marca o pagamento original como revertido
          payment.reverted = true;
          payment.reverted_at = new Date().toISOString();
          payment.reverted_by = reversalId;
          payment.updatedAt = new Date().toISOString();
          await App.db.put('transactions', payment);

          App.cache.totalBalance = null;
          App.transactions.invalidateCache?.();

          await App.saldos.load();
          App.transactions.load();
          App.creditCards.load();
          App.dashboard.refresh();
          App.panel.refresh();
          if (typeof App.installments?.load === 'function') App.installments.load();
          if (typeof App.classification?.load === 'function') App.classification.load();
          if (typeof App.analytics?.refresh === 'function') App.analytics.refresh();

          if (document.getElementById('page-card-invoice')?.classList.contains('active')) {
            App.cardInvoice.load();
          }
          if (document.getElementById('page-account-detail')?.classList.contains('active')) {
            App.accountDetail.render();
          }

          App.utils.showToast(`Pagamento revertido. Crédito de ${App.utils.formatCurrency(payment.amount)} lançado em ${App.utils.formatDateTime(payment.date)}.`);
        } catch (e) {
          console.error('Erro ao reverter pagamento de fatura:', e);
          App.utils.showToast('Erro ao reverter pagamento.', 'error');
        }
      }
    );
  },

  async lockInvoiceTransactions(cardId, start, end) {
    const txAll = await App.db.getTransactionsInRange(start, end);
    for (const tx of txAll) {
      if (tx.credit_card_id === cardId && (tx.type === 'expense' || tx.type === 'refund')) {
        tx.status = 'confirmed';
        tx.invoice_locked = true;
        await App.db.put('transactions', tx);
      }
    }
  },

  async edit(id) { const c = await App.db.getById('creditCards', id); if (c) App.ui.openCreditCardModal(c); },
  async remove(id) { App.utils.confirm('Excluir cartão?', async () => { await App.db.delete('creditCards', id); App.cache.creditCards = null; this.load(); }); },
  openCurrentInvoice() { App.db.getAll('creditCards').then(cards => { if (cards.length) App.cardInvoice.open(cards[0].id); }); },

  async reloadBalance(cardId) {
    const card = await App.db.getById('creditCards', cardId);
    if (!card) return;
    App.utils.prompt('Valor da recarga:', '', async (val) => {
      const amount = parseFloat(val);
      if (isNaN(amount) || amount <= 0) { App.utils.showToast('Valor inválido', 'error'); return; }
      const acc = (App.cache.accounts || await App.db.getAll('accounts')).find(a => a.id === card.account_id);
      await App.db.put('transactions', {
        id: App.utils.generateId(),
        type: 'income',
        amount: amount,
        category: 'Recarga Cartão',
        account_id: card.account_id,
        account_name: acc?.name || '',
        date: App.utils.todayISO(),
        description: 'Recarga - ' + card.name,
        notes: '',
        member_id: card.member_id || '',
        member_name: (App.cache.members?.find(m => m.id === card.member_id) || {}).name || '',
        credit_card_id: cardId,
        payment_method: 'transfer',
        status: 'confirmed',
        reconciled: false,
        ignore_from_total: false,
        createdAt: new Date().toISOString()
      });
      App.utils.showToast('Recarga de ' + App.utils.formatCurrency(amount) + ' realizada!');
      App.cache.totalBalance = null; // força recálculo do saldo
      await App.saldos.load();
      this.load();
      App.transactions.load();
      App.dashboard.refresh();
      App.panel.refresh();
    });
  },
  async showLimitHistory() {
    const cards = App.cache.creditCards || await App.db.getAll('creditCards'); if (!cards.length) return;
    const history = await App.db.getAll('creditLimitHistory');
    const recentHistory = history.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    let html = '<h3>Histórico de Alterações de Limite</h3>';
    if (recentHistory.length) {
      html += '<table><thead><tr><th>Data</th><th>Cartão</th><th>Limite Anterior</th><th>Novo Limite</th></tr></thead><tbody>';
      for (const h of recentHistory) { const card = cards.find(c => c.id === h.card_id); html += `<tr><td>${App.utils.formatDate(h.date)}</td><td>${card?.name || 'Desconhecido'}</td><td>${App.utils.formatCurrency(h.old_limit)}</td><td>${App.utils.formatCurrency(h.new_limit)}</td></tr>`; }
      html += '</tbody></table>';
    } else html += '<p>Nenhuma alteração de limite registrada.</p>';
    document.getElementById('limitChangeContent').innerHTML = html; App.ui.openModal('modalLimitChange');
  },
  prevMonth() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() - 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    const input = document.getElementById('ccMonthPicker');
    if (input) { const x = new Date(this.currentMonthStart + 'T12:00:00'); input.value = x.toISOString().slice(0,7); }
    this.load();
  },
  nextMonth() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    const d = new Date(this.currentMonthStart + 'T12:00:00');
    d.setMonth(d.getMonth() + 1);
    this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0, 10)).startDate;
    const input = document.getElementById('ccMonthPicker');
    if (input) { const x = new Date(this.currentMonthStart + 'T12:00:00'); input.value = x.toISOString().slice(0,7); }
    this.load();
  },
  gotoMonth() {
    const month = document.getElementById('ccMonthPicker')?.value;
    if (month) {
      const [y, m] = month.split('-');
      this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate;
      this.load();
    }
  }
};

// =======================================================================
// Fatura do Cartão
// =======================================================================
App.cardInvoice = {
  currentCardId: null,
  currentInvoiceStart: null,
  currentInvoiceEnd: null,
  currentInvoiceDue: null,
  _importCancelled: false,
  _pendingImportedIds: [],
  _selectedIds: [],
  _allSelected: false,

  async openPrepaid(cardId) {
    const card = await App.db.getById('creditCards', cardId);
    if (!card || card.card_type !== 'prepaid') return;
    this.currentCardId = cardId;
    App.ui.navigateTo('card-invoice');
    await this.loadPrepaid();
  },

  async loadPrepaid() {
    if (!this.currentCardId) return;
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;

    document.getElementById('invoiceCycleLabel').textContent = 'Saldo do Cartão Pré‑pago';
    document.getElementById('invoiceMonthPicker').style.display = 'none';

    const txAll = await App.db.getAll('transactions');
    const cardTx = txAll.filter(t => t.credit_card_id === this.currentCardId && t.category !== 'Pagamento Fatura');

    const reloads = cardTx.filter(t => t.description && t.description.startsWith('Recarga') && t.type === 'income')
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const expenses = cardTx.filter(t => t.type === 'expense' && !(t.description && t.description.startsWith('Recarga')))
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const refunds = cardTx.filter(t => t.type === 'refund')
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const balance = (card.initial_balance || 0) + reloads - expenses + refunds;

        document.getElementById('invoiceSummary').innerHTML = `
      <div class="card"><div class="card-label">Cartão Pré‑pago</div><div class="card-value">${card.name}</div></div>
      <div class="card"><div class="card-label">Saldo Inicial</div><div class="card-value">${App.utils.formatCurrency(card.initial_balance || 0)}</div></div>
      <div class="card"><div class="card-label">Recargas</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(reloads)}</div></div>
      <div class="card"><div class="card-label">Gastos</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(expenses)}</div></div>
      <div class="card"><div class="card-label">Saldo Atual</div><div class="card-value" style="color:${balance >= 0 ? '#2e7d32' : '#c62828'};">${App.utils.formatCurrency(balance)}</div></div>
      <div class="card"><div class="card-label">🔁 Ações</div><div class="card-value"><button class="btn btn-primary btn-sm" id="btnPrepaidReload">💰 Recarregar</button></div></div>
    `;

    // Vincula o botão de recarga após renderizar
    const reloadBtn = document.getElementById('btnPrepaidReload');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        App.creditCards.reloadBalance(this.currentCardId);
      });
    }

    const tbody = document.getElementById('invoiceTableBody');
    const allTx = cardTx.sort((a, b) => b.date.localeCompare(a.date));
    tbody.innerHTML = allTx.length ? allTx.map(t => {
      const sign = isReload ? '+' : (t.type === 'expense' ? '-' : '+');
      const isReload = t.description && t.description.startsWith('Recarga');
      const color = isReload ? 'var(--income)' : (t.type === 'expense' ? 'var(--expense)' : 'var(--income)');
      return `<tr>
        <td>${App.utils.formatDateTime(t.date)}</td><td>${t.description || ''}</td><td>${t.member_name || ''}</td><td>${t.category || '-'}</td>
        <td>${isReload ? 'Recarga' : (t.type === 'expense' ? 'Despesa' : 'Estorno')}</td>
        <td class="text-right" style="color:${color};">${sign} ${App.utils.formatCurrency(t.amount)}</td>
        <td class="text-center"><button class="icon-btn" onclick="App.transactions.edit('${t.id}')">✏️</button><button class="icon-btn delete" onclick="App.transactions.confirmDelete('${t.id}')">🗑️</button></td></tr>`;
    }).join('') : '<tr><td colspan="7">Nenhuma transação</td></tr>';
    document.getElementById('invoiceEmpty').style.display = allTx.length ? 'none' : 'block';
    document.getElementById('btnPayInvoice').style.display = 'none';
  },

  async newPurchase() {
    if (!this.currentCardId) return;
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;
    await App.ui.openCardTransactionModal(this.currentCardId);
  },

  async open(cardId, period = null) {
    this.currentCardId = cardId;
    const card = await App.db.getById('creditCards', cardId);
    if (!card) return;

    if (period && period.start && period.end && period.due) {
      // Usar período fornecido
      this.currentInvoiceStart = period.start;
      this.currentInvoiceEnd = period.end;
      this.currentInvoiceDue = period.due;
    } else {
      // Cálculo automático baseado na data atual
      const today = new Date();
      const closeDay = card.close_day || (card.due_day - 10 > 0 ? card.due_day - 10 : 1);
      const dueDay = card.due_day || 10;
      const getCloseDate = (year, month) => new Date(year, month, closeDay);

      let closeDateCurrentMonth = getCloseDate(today.getFullYear(), today.getMonth());
      let start, end, dueDate;

      if (today <= closeDateCurrentMonth) {
        end = closeDateCurrentMonth;
        start = new Date(today.getFullYear(), today.getMonth() - 1, closeDay + 1);
        dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);
      } else {
        end = getCloseDate(today.getFullYear(), today.getMonth() + 1);
        start = new Date(today.getFullYear(), today.getMonth(), closeDay + 1);
        dueDate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
      }

      if (dueDate <= end) {
        dueDate = new Date(end.getFullYear(), end.getMonth() + 1, dueDay);
      }

      if (card.created_at) {
        const creationDate = new Date(card.created_at + 'T12:00:00');
        if (start < creationDate) {
          let creationCloseDate = getCloseDate(creationDate.getFullYear(), creationDate.getMonth());
          if (creationDate > creationCloseDate) {
            creationCloseDate = getCloseDate(creationDate.getFullYear(), creationDate.getMonth() + 1);
          }
          start = new Date(creationCloseDate.getFullYear(), creationCloseDate.getMonth() - 1, closeDay + 1);
          end = creationCloseDate;
          dueDate = new Date(end.getFullYear(), end.getMonth(), dueDay);
          if (dueDate <= end) {
            dueDate = new Date(end.getFullYear(), end.getMonth() + 1, dueDay);
          }
        }
      }

      this.currentInvoiceStart = start.toISOString().slice(0, 10);
      this.currentInvoiceEnd = end.toISOString().slice(0, 10);
      this.currentInvoiceDue = dueDate.toISOString().slice(0, 10);
    }

    App.ui.navigateTo('card-invoice');
    await this.load();
  },
  async load() {
    if (!this.currentCardId) return;
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;
    
    const startStr = this.currentInvoiceStart;
    const endStr = this.currentInvoiceEnd;
    const dueStr = this.currentInvoiceDue;

    document.getElementById('invoiceCycleLabel').textContent = `Fatura: ${App.utils.formatDate(startStr)} → ${App.utils.formatDate(endStr)}`;
    document.getElementById('invoiceMonthPicker').value = endStr.slice(0, 7);

    const txAll = await App.db.getTransactionsInRange(startStr, endStr);
    const expenses = txAll.filter(t => t.credit_card_id === this.currentCardId && t.type === 'expense' && t.category !== 'Pagamento Fatura');
    const refunds = txAll.filter(t => t.credit_card_id === this.currentCardId && t.type === 'refund' && t.category !== 'Pagamento Fatura');
    const totalExpense = expenses.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalRefund = refunds.reduce((s, t) => s + parseFloat(t.amount), 0);
    const fatura = totalExpense - totalRefund;
    this._expenses = expenses;
    this._refunds = refunds;

    // ---- Determinar status da fatura (Aberta / Paga / Atrasada) ----
    const dueMonthKey = dueStr.slice(0, 7);
    const todasTransacoes = await App.db.getAll('transactions');
    const cardNameLower = card.name.toLowerCase();
    const pagamentoEncontrado = todasTransacoes.some(p => {
      if (p.type !== 'expense' || p.category !== 'Pagamento Fatura') return false;
      if (p.reverted) return false;
      const desc = (p.description || '').trim();

      // Formato 1 (padrão): "Pagamento Fatura {nome} {AAAA-MM}"
      const matchPadrao = desc.match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
      if (matchPadrao) {
        const nomeCartao = matchPadrao[1].trim().toLowerCase();
        const mesPago = matchPadrao[2];
        return nomeCartao === cardNameLower && mesPago === dueMonthKey;
      }

      // Formato 2 (legado): "Fatura {nome}" — infere o mês pela data da transação
      const matchLegado = desc.match(/^Fatura\s+(.+)$/i);
      if (matchLegado) {
        const nomeCartao = matchLegado[1].trim().toLowerCase();
        if (nomeCartao !== cardNameLower) return false;
        // Mês do pagamento: usa a data da transação como proxy do mês do vencimento
        const mesPagamento = (p.date || '').slice(0, 7);
        return mesPagamento === dueMonthKey;
      }

      return false;
    });

    const hojeISO = App.utils.todayISO();
    const vencISO = dueStr.slice(0, 10);
    const temValor = fatura > 0.005;

    let invoiceStatus, statusLabel, statusColor, statusBg;
    if (pagamentoEncontrado) {
      invoiceStatus = 'paga';
      statusLabel = '✅ Paga';
      statusColor = '#a3e635';
      statusBg = 'rgba(163,230,53,0.15)';
    } else if (temValor && vencISO < hojeISO) {
      invoiceStatus = 'atrasada';
      statusLabel = '⚠️ Atrasada';
      statusColor = '#f87171';
      statusBg = 'rgba(248,113,113,0.15)';
    } else if (temValor) {
      invoiceStatus = 'aberta';
      statusLabel = '🟢 Aberta';
      statusColor = '#60a5fa';
      statusBg = 'rgba(96,165,250,0.15)';
    } else {
      invoiceStatus = 'sem-valor';
      statusLabel = '— Sem valor';
      statusColor = '#888';
      statusBg = 'rgba(136,136,136,0.15)';
    }

    document.getElementById('invoiceSummary').innerHTML = `
      <div class="card"><div class="card-label">Cartão</div><div class="card-value">${card.name}</div><div class="card-sub">Limite: ${App.utils.formatCurrency(card.limit)}</div><button class="btn btn-sm btn-ghost" onclick="App.ui.navigateTo('invoice-stats')" style="margin-top:8px;">📊 Estatísticas</button></div>
      <div class="card"><div class="card-label">Total Gastos</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(totalExpense)}</div></div>
      <div class="card"><div class="card-label">Estornos</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(totalRefund)}</div></div>
      <div class="card"><div class="card-label">Valor da Fatura</div><div class="card-value" style="color:${fatura >= 0 ? '#c62828' : '#2e7d32'};">${App.utils.formatCurrency(fatura)}</div></div>
      <div class="card">
        <div class="card-label">📊 Limite</div>
        <div class="card-value">${App.utils.formatCurrency(card.limit)}</div>
        <div class="card-sub">Utilizado: ${App.utils.formatCurrency(totalExpense)}</div>
        <div class="progress-bar-bg" style="margin-top:8px;">
          <div class="progress-bar-fill" style="width:${Math.min((totalExpense / card.limit) * 100, 100)}%; background:${(totalExpense / card.limit) > 0.8 ? '#c62828' : '#2e7d32'};"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-label">📅 Vencimento</div>
        <div class="card-value">${App.utils.formatDate(dueStr)}</div>
        <div style="display:inline-block; margin-top:8px; padding:3px 10px; background:${statusBg}; color:${statusColor}; border-radius:20px; font-size:0.72rem; font-weight:600;">${statusLabel}</div>
        ${invoiceStatus === 'paga' ? `<div style="margin-top:10px;"><button class="btn btn-sm btn-outline" onclick="App.cardInvoice.revertCurrentInvoicePayment('${card.id}', '${dueMonthKey}')">↩️ Reverter pagamento</button></div>` : ''}
      </div>
      <div class="card"><div class="card-label">🛒 Gastos desde ${App.utils.formatDate(this.currentInvoiceStart)}</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(totalExpense - totalRefund)}</div><div class="card-sub">(${expenses.length} compras, ${refunds.length} estornos)</div></div>`;

    const tbody = document.getElementById('invoiceTableBody');
        // Carrega categorias e membros para filtros e classificação
    const categories = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = categories;
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;

    // Popula selects de membro e categoria se ainda não preenchidos
    const memberSelect = document.getElementById('invoiceFilterMember');
    if (memberSelect && memberSelect.options.length <= 1) {
      memberSelect.innerHTML = '<option value="">Todos</option>' + 
        members.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    }
    const categorySelect = document.getElementById('invoiceFilterCategory');
    if (categorySelect && categorySelect.options.length <= 1) {
      // Obtém categorias únicas das transações da fatura
      const allCategories = [...new Set([...expenses, ...refunds].map(t => t.category).filter(Boolean))];
      categorySelect.innerHTML = '<option value="">Todas</option>' + 
        allCategories.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    // Popula o select de categoria para edição em massa (usa todas as categorias ativas)
    const bulkCategorySelect = document.getElementById('invoiceBulkCategory');
    if (bulkCategorySelect) {
      const activeCats = categories
        .filter(c => !c.archived)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      const preservedValue = bulkCategorySelect.value;
      bulkCategorySelect.innerHTML = '<option value="">Alterar categoria…</option>' +
        activeCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
      // Preserva a escolha do usuário caso a categoria ainda exista
      if (preservedValue && activeCats.some(c => c.name === preservedValue)) {
        bulkCategorySelect.value = preservedValue;
      }
    }

    const searchTerm = (document.getElementById('invoiceSearch')?.value || '').toLowerCase();
    const sortOrder = document.getElementById('invoiceSortOrder')?.value || 'desc';
    let allTx = [...expenses, ...refunds].sort((a, b) => {
      const cmp = (a.date || '').localeCompare(b.date || '');
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    // Aplica filtro de busca
    if (searchTerm) {
      allTx = allTx.filter(t => 
        (t.description || '').toLowerCase().includes(searchTerm) ||
        (t.category || '').toLowerCase().includes(searchTerm) ||
        (t.member_name || '').toLowerCase().includes(searchTerm)
      );
    }

    // Aplica filtro de classificação
    const filterClassification = document.getElementById('invoiceFilterClassification')?.value || '';
    if (filterClassification) {
      allTx = allTx.filter(t => {
        let cls = t.classification || '';
        if (!cls) {
          const cat = categories.find(c => c.name === t.category);
          cls = cat?.classification || '';
        }
        return cls === filterClassification;
      });
    }

    // Aplica filtro de membro
    const filterMember = document.getElementById('invoiceFilterMember')?.value || '';
    if (filterMember) {
      allTx = allTx.filter(t => (t.member_name || '') === filterMember);
    }

    // Aplica filtro de categoria
    const filterCategory = document.getElementById('invoiceFilterCategory')?.value || '';
    if (filterCategory) {
      allTx = allTx.filter(t => t.category === filterCategory);
    }

    // Aplica filtro por tipo de compra (à vista / parcelada)
    const filterInstallmentType = document.getElementById('invoiceFilterInstallmentType')?.value || 'all';
    if (filterInstallmentType === 'vista') {
      allTx = allTx.filter(t => !t.installments || t.installments <= 1);
    } else if (filterInstallmentType === 'parcelada') {
      allTx = allTx.filter(t => t.installments > 1);
    }

    const selectAllCheckbox = document.getElementById('invoiceSelectAll');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    this._selectedIds = [];
    this._allSelected = false;
    this._updateDeleteButtonVisibility();
    tbody.innerHTML = allTx.length ? allTx.map(t => {
      const sign = t.type === 'expense' ? '-' : '+';
      const checked = this._selectedIds.includes(t.id) ? 'checked' : '';
      // Determina a classificação: usa o campo da transação ou busca na categoria
      let classification = t.classification || '';
      if (!classification) {
        const cat = categories.find(c => c.name === t.category);
        classification = cat?.classification || '';
      }
      const classLabel = classification === 'essential' ? 'Essenciais' : classification === 'necessary' ? 'Necessários' : classification === 'superfluous' ? 'Supérfluos' : '-';
      // Informação de tipo: à vista ou parcela
      const installmentInfo = (t.installments && t.installments > 1)
        ? `Parcela ${t.installment_number}/${t.installments}`
        : 'À vista';
      // Se for parcela, exibe a data e hora da compra original; caso contrário, data/hora da transação
      const dataExibicao = (t.installments > 1 && t.purchase_date)
        ? App.utils.formatDateTimeFull(t.purchase_date)
        : App.utils.formatDateTimeFull(t.date);
      return `<tr>
        <td><input type="checkbox" class="invoiceCheck" value="${t.id}" ${checked} onchange="App.cardInvoice.onCheckboxChange()"></td>
        <td>${dataExibicao}</td><td>${t.description || ''}</td><td>${t.member_name || ''}</td><td>${t.category || '-'}</td>
        <td>${installmentInfo}</td>
        <td>${classLabel}</td>
        <td class="text-right" style="color:${t.type === 'expense' ? 'var(--expense)' : 'var(--income)'};">${sign} ${App.utils.formatCurrency(t.amount)}</td>
        <td class="text-center"><button class="icon-btn" onclick="App.transactions.edit('${t.id}')">✏️</button><button class="icon-btn delete" onclick="App.transactions.confirmDelete('${t.id}')">🗑️</button></td></tr>`;
    }).join('') : '<tr><td colspan="9">Nenhuma transação</td></tr>';
       document.getElementById('invoiceEmpty').style.display = allTx.length ? 'none' : 'block';


  },


  async revertCurrentInvoicePayment(cardId, dueMonthKey) {
    const all = await App.db.getAll('transactions');
    const cards = App.cache.creditCards || await App.db.getAll('creditCards');
    if (!App.cache.creditCards) App.cache.creditCards = cards;
    const card = cards.find(c => c.id === cardId);
    if (!card) {
      App.utils.showToast('Cartão não encontrado.', 'error');
      return;
    }
    const _norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cardNorm = _norm(card.name);

    const pagamentos = all.filter(t => {
      if (t.type !== 'expense' || t.category !== 'Pagamento Fatura') return false;
      if (t.reverted) return false;
      if (t.invoice_card_id === cardId && t.invoice_due_month === dueMonthKey) return true;
      const m = (t.description || '').match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
      if (!m || m[2] !== dueMonthKey) return false;
      return _norm(m[1]) === cardNorm;
    });

    if (!pagamentos.length) {
      App.utils.showToast('Pagamento desta fatura não encontrado.', 'error');
      return;
    }
    if (pagamentos.length > 1) {
      App.utils.showToast('Há mais de um pagamento para esta fatura. Reverta pela seção Transações.', 'warning');
      return;
    }
    await App.creditCards.revertInvoicePayment(pagamentos[0].id);
  },

  async _statsGotoMonth(monthStr) {
    if (!monthStr || !this.currentCardId) return;
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;
    const period = this.getInvoicePeriodForMonth(card, monthStr);
    this.currentInvoiceStart = period.start;
    this.currentInvoiceEnd = period.end;
    this.currentInvoiceDue = period.due;
    this._statsParcelamentosExpandido = false;
    await this._loadInvoiceDataOnly();
    await this.loadInvoiceStats();
  },

  _statsPrevMonth() {
    const currentMonth = this.currentInvoiceDue ? this.currentInvoiceDue.slice(0, 7) : null;
    if (!currentMonth) return;
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this._statsGotoMonth(prev);
  },

  _statsNextMonth() {
    const currentMonth = this.currentInvoiceDue ? this.currentInvoiceDue.slice(0, 7) : null;
    if (!currentMonth) return;
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() + 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this._statsGotoMonth(next);
  },

  async _loadInvoiceDataOnly() {
    if (!this.currentCardId) return;
    const startStr = this.currentInvoiceStart;
    const endStr = this.currentInvoiceEnd;
    if (!startStr || !endStr) return;
    const txAll = await App.db.getTransactionsInRange(startStr, endStr);
    const expenses = txAll.filter(t => t.credit_card_id === this.currentCardId && t.type === 'expense' && t.category !== 'Pagamento Fatura');
    const refunds = txAll.filter(t => t.credit_card_id === this.currentCardId && t.type === 'refund' && t.category !== 'Pagamento Fatura');
    this._expenses = expenses;
    this._refunds = refunds;
  },

  _toggleAllParcelamentos() {
    this._statsParcelamentosExpandido = !this._statsParcelamentosExpandido;
    this.loadInvoiceStats();
  },

  async loadInvoiceStats() {
    if (!this._expenses) {
      await this._loadInvoiceDataOnly();
    }
    if (!this._expenses) return;

    const expenses = this._expenses;
    const refunds = this._refunds || [];
    const allTx = [...expenses, ...refunds];
    const fmt = (v) => App.utils.formatCurrency(v);

    // ---- Totais ----
    const vistaTx = expenses.filter(t => (!t.installments || t.installments <= 1));
    const parcTx  = expenses.filter(t => t.installments > 1);
    const totalVista    = vistaTx.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalParc     = parcTx.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalEstornos = refunds.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalFatura   = totalVista + totalParc - totalEstornos;

    // ---- Por categoria ----
    const catTotals = {};
    expenses.forEach(t => {
      const cat = t.category || 'Outros';
      if (!catTotals[cat]) catTotals[cat] = { total: 0, qtd: 0 };
      catTotals[cat].total += parseFloat(t.amount);
      catTotals[cat].qtd++;
    });
    const sortedCats = Object.entries(catTotals).sort((a, b) => b[1].total - a[1].total);
    const totalCategorias = sortedCats.reduce((s, [, v]) => s + v.total, 0);
    const totalQtdCats = sortedCats.reduce((s, [, v]) => s + v.qtd, 0);

    // ---- Por membro ----
    const membroTotals = {};
    expenses.forEach(t => {
      const nome = t.member_name || 'Desconhecido';
      if (!membroTotals[nome]) membroTotals[nome] = { total: 0, qtd: 0 };
      membroTotals[nome].total += parseFloat(t.amount);
      membroTotals[nome].qtd++;
    });
    const sortedMembers = Object.entries(membroTotals).sort((a, b) => b[1].total - a[1].total);

    // ---- Parcelamentos ----
    const parcelamentos = parcTx.map(t => ({
      desc: (t.description || '').replace(/\s*-\s*Parcela.*$/, '').trim() || t.category || 'Compra',
      categoria: t.category || 'Outros',
      parcelaAtual: t.installment_number || 1,
      parcelaTotal: t.installments || 1,
      valor: parseFloat(t.amount),
      restantes: (t.installments || 1) - (t.installment_number || 1)
    })).sort((a, b) => b.valor - a.valor);

    // ---- Helpers ----
    const getCategoryIcon = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('alimenta') || n.includes('mercado') || n.includes('lanche') || n.includes('restaurant') || n.includes('ifood')) return '🍽️';
      if (n.includes('carro') || n.includes('veículo') || n.includes('combustível') || n.includes('automóvel') || n.includes('manutenção')) return '🚗';
      if (n.includes('moradia') || n.includes('residencial') || n.includes('aluguel') || n.includes('casa')) return '🏠';
      if (n.includes('saúde') || n.includes('saude') || n.includes('médic') || n.includes('farmacia') || n.includes('drogaria')) return '❤️';
      if (n.includes('educa') || n.includes('curso') || n.includes('escola') || n.includes('faculdade')) return '🎓';
      if (n.includes('lazer') || n.includes('passeio') || n.includes('cinema') || n.includes('viagem')) return '🎬';
      if (n.includes('vestuário') || n.includes('vestuario') || n.includes('roupa')) return '👕';
      if (n.includes('eletrônico') || n.includes('eletronic') || n.includes('celular') || n.includes('computador') || n.includes('ipad')) return '📱';
      if (n.includes('eletrodomést') || n.includes('eletrodomest') || n.includes('geladeira') || n.includes('fogão')) return '📺';
      if (n.includes('empréstimo') || n.includes('emprestimo') || n.includes('empréstim')) return '👥';
      if (n.includes('pet') || n.includes('animal')) return '🐾';
      if (n.includes('assinatura') || n.includes('streaming')) return '📅';
      if (n.includes('presente')) return '🎁';
      if (n.includes('transporte') || n.includes('uber') || n.includes('taxi')) return '🚕';
      if (n.includes('comunicação') || n.includes('internet') || n.includes('telefone')) return '📶';
      if (n.includes('cuidado')) return '💅';
      if (n.includes('pagamento')) return '💳';
      return '📋';
    };

    const catColors = ['#8b5cf6', '#3b82f6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#f43f5e', '#a855f7', '#eab308', '#14b8a6'];

    // ---- Donut SVG ----
    const donutR = 40;
    const circumference = 2 * Math.PI * donutR;
    const totalComposicao = totalVista + totalParc;
    const parcFrac = totalComposicao > 0 ? (totalParc / totalComposicao) : 0;
    const donutParc = circumference * parcFrac;
    const donutVista = circumference - donutParc;

    const donutSVG = `
      <svg viewBox="0 0 100 100" style="width:150px;height:150px;transform:rotate(-90deg);">
        <circle cx="50" cy="50" r="${donutR}" fill="none" stroke="#2a2a2a" stroke-width="16"/>
        <circle cx="50" cy="50" r="${donutR}" fill="none" stroke="#8b5cf6" stroke-width="16"
                stroke-dasharray="${donutParc} ${circumference}" stroke-dashoffset="0"/>
        <circle cx="50" cy="50" r="${donutR}" fill="none" stroke="#4b5563" stroke-width="16"
                stroke-dasharray="${donutVista} ${circumference}" stroke-dashoffset="${-donutParc}"/>
      </svg>
    `;

    // Atualiza o month picker do header
    const picker = document.getElementById('invStatsMonthPicker');
    if (picker && this.currentInvoiceDue) {
      picker.value = this.currentInvoiceDue.slice(0, 7);
    }

    // ---- HTML ----
    const html = `
      <div class="inv-stats-page">

        <div class="inv-kpis">
          <div class="inv-kpi">
            <div class="inv-kpi-icon green">📷</div>
            <div class="inv-kpi-body">
              <div class="inv-kpi-label">Compras à vista</div>
              <div class="inv-kpi-value green">${fmt(totalVista)}</div>
              <div class="inv-kpi-sub">${vistaTx.length} ${vistaTx.length === 1 ? 'compra' : 'compras'}</div>
            </div>
          </div>
          <div class="inv-kpi">
            <div class="inv-kpi-icon purple">💳</div>
            <div class="inv-kpi-body">
              <div class="inv-kpi-label">Compras parceladas</div>
              <div class="inv-kpi-value">${fmt(totalParc)}</div>
              <div class="inv-kpi-sub">${parcTx.length} ${parcTx.length === 1 ? 'compra' : 'compras'}</div>
            </div>
          </div>
          <div class="inv-kpi destaque">
            <div class="inv-kpi-icon blue">📄</div>
            <div class="inv-kpi-body">
              <div class="inv-kpi-label">Total da fatura</div>
              <div class="inv-kpi-value">${fmt(totalFatura)}</div>
              <div class="inv-kpi-sub">${allTx.length} ${allTx.length === 1 ? 'compra' : 'compras'}</div>
            </div>
          </div>
          <div class="inv-kpi">
            <div class="inv-kpi-icon gray">🔄</div>
            <div class="inv-kpi-body">
              <div class="inv-kpi-label">Estornos</div>
              <div class="inv-kpi-value">${fmt(totalEstornos)}</div>
              <div class="inv-kpi-sub">${refunds.length} ${refunds.length === 1 ? 'estorno' : 'estornos'}</div>
            </div>
          </div>
        </div>

        <div class="inv-grid3">

          <div class="inv-panel">
            <div class="inv-panel-header">
              <div class="inv-panel-title">Composição da fatura</div>
              <div class="inv-panel-sub">Distribuição do valor entre compras à vista e parceladas</div>
            </div>
            <div class="inv-composition">
              <div class="inv-donut-wrap">
                ${donutSVG}
                <div class="inv-donut-center">
                  <div class="val">${fmt(totalComposicao)}</div>
                  <div class="lbl">Total da fatura</div>
                </div>
              </div>
              <div class="inv-legend">
                <div class="inv-legend-item">
                  <div class="inv-legend-dot" style="background:#8b5cf6;"></div>
                  <div class="inv-legend-body">
                    <div class="inv-legend-label">Parceladas</div>
                    <div class="inv-legend-values">
                      <span class="inv-legend-val">${fmt(totalParc)}</span>
                      <span class="inv-legend-pct">${totalComposicao > 0 ? ((totalParc / totalComposicao) * 100).toFixed(1) : '0.0'}%</span>
                    </div>
                  </div>
                </div>
                <div class="inv-legend-item">
                  <div class="inv-legend-dot" style="background:#4b5563;"></div>
                  <div class="inv-legend-body">
                    <div class="inv-legend-label">À vista</div>
                    <div class="inv-legend-values">
                      <span class="inv-legend-val">${fmt(totalVista)}</span>
                      <span class="inv-legend-pct">${totalComposicao > 0 ? ((totalVista / totalComposicao) * 100).toFixed(1) : '0.0'}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="inv-info-box">
              ${totalVista === 0 && totalParc > 0 ? '100% das compras desta fatura são parceladas.' :
                totalParc === 0 && totalVista > 0 ? '100% das compras desta fatura são à vista.' :
                totalComposicao === 0 ? 'Nenhuma compra registrada nesta fatura.' :
                `${((totalParc / totalComposicao) * 100).toFixed(1)}% das compras são parceladas e ${((totalVista / totalComposicao) * 100).toFixed(1)}% à vista.`}
            </div>
          </div>

          <div class="inv-panel">
            <div class="inv-panel-header">
              <div class="inv-panel-title">Gastos por categoria</div>
              <div class="inv-panel-sub">Maiores categorias desta fatura</div>
            </div>
            <div class="inv-cat-list">
              ${sortedCats.length === 0 ? '<div class="inv-empty-sub">Nenhuma categoria registrada.</div>' :
                sortedCats.slice(0, 8).map(([cat, v], i) => {
                  const pct = totalCategorias > 0 ? (v.total / totalCategorias) * 100 : 0;
                  const cor = catColors[i % catColors.length];
                  return `
                    <div class="inv-cat-row">
                      <div class="inv-cat-icon">${getCategoryIcon(cat)}</div>
                      <div class="inv-cat-name">${cat}</div>
                      <div class="inv-cat-value">${fmt(v.total)}</div>
                      <div class="inv-cat-pct">${pct.toFixed(1)}%</div>
                      <div class="inv-cat-bar-bg">
                        <div class="inv-cat-bar-fill" style="width:${Math.min(pct, 100)}%;background:${cor};"></div>
                      </div>
                    </div>
                  `;
                }).join('')}
            </div>
          </div>

          <div class="inv-panel">
            <div class="inv-panel-header">
              <div class="inv-panel-title">Por membro</div>
              <div class="inv-panel-sub">Divisão do valor da fatura</div>
            </div>
            <div class="inv-member-list">
              ${sortedMembers.length === 0 ? '<div class="inv-empty-sub">Nenhum membro identificado.</div>' :
                sortedMembers.slice(0, 5).map(([nome, v]) => {
                  const pct = totalCategorias > 0 ? (v.total / totalCategorias) * 100 : 0;
                  return `
                    <div class="inv-member-row">
                      <div class="inv-member-head">
                        <div class="inv-member-avatar">👤</div>
                        <div class="inv-member-name">${nome}</div>
                        <div class="inv-member-values">
                          <div class="inv-member-val">${fmt(v.total)}</div>
                          <div class="inv-member-pct">${pct.toFixed(1)}%</div>
                        </div>
                      </div>
                      <div class="inv-member-bar-bg">
                        <div class="inv-member-bar-fill" style="width:${Math.min(pct, 100)}%;"></div>
                      </div>
                    </div>
                  `;
                }).join('')}
            </div>
          </div>
        </div>

        <div class="inv-grid3">

          <div class="inv-panel">
            <div class="inv-panel-header">
              <div class="inv-panel-title">Parcelamentos</div>
              <div class="inv-panel-sub">Compras que serão pagas em mais de uma fatura</div>
            </div>
            ${parcelamentos.length === 0 ? `
              <div class="inv-empty">
                <div class="inv-empty-title">Nenhum parcelamento nesta fatura</div>
                <div class="inv-empty-sub">Todas as compras foram à vista.</div>
              </div>
            ` : `
              <div id="invStatsParcelamentosContainer" style="max-height:${this._statsParcelamentosExpandido ? 'none' : '260px'}; overflow-y:auto; transition:max-height 0.3s ease;">
                <table class="inv-mini-table">
                  <thead>
                    <tr>
                      <th class="col-icon"></th>
                      <th>Compra</th>
                      <th class="text-center">Parcela</th>
                      <th class="text-right">Valor da parcela</th>
                      <th class="text-center">Restantes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(this._statsParcelamentosExpandido ? parcelamentos : parcelamentos.slice(0, 6)).map(p => `
                      <tr>
                        <td class="col-icon">${getCategoryIcon(p.categoria)}</td>
                        <td>${p.desc.length > 22 ? p.desc.substring(0, 22) + '…' : p.desc}</td>
                        <td class="text-center">${p.parcelaAtual}/${p.parcelaTotal}</td>
                        <td class="text-right val-strong">${fmt(p.valor)}</td>
                        <td class="text-center">${p.restantes}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              ${parcelamentos.length > 6 ? `<a class="inv-link" onclick="App.cardInvoice._toggleAllParcelamentos()">${this._statsParcelamentosExpandido ? 'Ver menos ↑' : 'Ver todas as parcelas →'}</a>` : ''}
            `}
          </div>

          <div class="inv-panel">
            <div class="inv-panel-header">
              <div class="inv-panel-title">Detalhes das compras</div>
              <div class="inv-panel-sub">Resumo por categoria com valores e quantidade de transações</div>
            </div>
            ${sortedCats.length === 0 ? '<div class="inv-empty-sub">Nenhuma compra registrada.</div>' : `
              <table class="inv-mini-table">
                <thead>
                  <tr>
                    <th class="col-icon"></th>
                    <th>Categoria</th>
                    <th class="text-right">Valor</th>
                    <th class="text-right">%</th>
                    <th class="text-center">Qtd.</th>
                  </tr>
                </thead>
                <tbody>
                  ${sortedCats.map(([cat, v]) => {
                    const pct = totalCategorias > 0 ? (v.total / totalCategorias) * 100 : 0;
                    return `
                      <tr>
                        <td class="col-icon">${getCategoryIcon(cat)}</td>
                        <td>${cat}</td>
                        <td class="text-right val-strong">${fmt(v.total)}</td>
                        <td class="text-right">${pct.toFixed(1)}%</td>
                        <td class="text-center">${v.qtd}</td>
                      </tr>
                    `;
                  }).join('')}
                  <tr style="border-top:1px solid #333;">
                    <td></td>
                    <td><strong>Total</strong></td>
                    <td class="text-right val-strong">${fmt(totalCategorias)}</td>
                    <td class="text-right">100,0%</td>
                    <td class="text-center">${totalQtdCats}</td>
                  </tr>
                </tbody>
              </table>
            `}
          </div>

          <div class="inv-panel">
            <div class="inv-panel-header">
              <div class="inv-panel-title">Estornos</div>
              <div class="inv-panel-sub">Compras que foram canceladas ou devolvidas</div>
            </div>
            ${refunds.length === 0 ? `
              <div class="inv-empty">
                <div class="inv-empty-icon">🔄</div>
                <div class="inv-empty-title">Não há estornos nesta fatura.</div>
                <div class="inv-empty-sub">Todas as compras foram confirmadas.</div>
              </div>
            ` : `
              <table class="inv-mini-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th class="text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  ${refunds
                    .slice()
                    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                    .map(r => `
                      <tr>
                        <td>${App.utils.formatDate(r.date)}</td>
                        <td>${(r.description || r.category || '').substring(0, 32)}</td>
                        <td class="text-right val-strong">${fmt(r.amount)}</td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

        <div class="inv-footer">
          ⓘ Os valores podem sofrer pequenas variações devido à forma de arredondamento.
        </div>
      </div>
    `;

    const container = document.getElementById('invoiceStatsContent');
    if (container) container.innerHTML = html;
  },

  toggleSelectAll() {
    const selectAll = document.getElementById('invoiceSelectAll');
    const checkboxes = document.querySelectorAll('.invoiceCheck');
    this._allSelected = selectAll.checked;
    checkboxes.forEach(cb => {
      cb.checked = this._allSelected;
      const id = cb.value;
      if (this._allSelected) {
        if (!this._selectedIds.includes(id)) this._selectedIds.push(id);
      } else {
        this._selectedIds = [];
      }
    });
    this._updateDeleteButtonVisibility();
  },

  onCheckboxChange() {
    const checkboxes = document.querySelectorAll('.invoiceCheck');
    this._selectedIds = [];
    checkboxes.forEach(cb => {
      if (cb.checked) this._selectedIds.push(cb.value);
    });
    const selectAll = document.getElementById('invoiceSelectAll');
    if (selectAll) selectAll.checked = (this._selectedIds.length === checkboxes.length && checkboxes.length > 0);
    this._allSelected = selectAll ? selectAll.checked : false;
    this._updateDeleteButtonVisibility();
  },

  _updateDeleteButtonVisibility() {
    const bar = document.getElementById('invoiceBulkActions');
    const countEl = document.getElementById('invoiceBulkCount');
    const hasSelection = this._selectedIds.length > 0;
    if (bar) bar.style.display = hasSelection ? 'flex' : 'none';
    if (countEl) countEl.textContent = this._selectedIds.length;
  },
    toggleMenu() {
    const menu = document.getElementById('invoiceMenuDropdown');
    if (menu) {
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }
  },

  async deleteSelected() {
    if (!this._selectedIds.length) {
      App.utils.showToast('Nenhuma transação selecionada', 'error');
      return;
    }
    const total = this._selectedIds.length;
    App.utils.confirm(`Excluir ${total} transação(ões) selecionada(s)?`, async () => {
      for (const id of this._selectedIds) {
        await App.db.delete('transactions', id);
      }
      this._selectedIds = [];
      this._allSelected = false;
      App.transactions.invalidateCache?.();
      App.cache.totalBalance = null;
      await App.saldos.load();
      // Recarrega a fatura e força a atualização das demais seções
      await this.load();
      App.transactions.load();
      App.dashboard.refresh();
      App.panel.refresh();
      App.creditCards.load();
      if (App.analytics) App.analytics.refresh();
      if (App.installments) App.installments.load();
      if (App.classification) App.classification.load();
      if (App.categorization) App.categorization.load();
      App.utils.showToast(`${total} transação(ões) excluída(s).`);
    });
  },

  async applyBulkEditToSelected() {
    if (!this._selectedIds.length) {
      App.utils.showToast('Nenhuma transação selecionada', 'error');
      return;
    }
    const categoryValue = document.getElementById('invoiceBulkCategory')?.value || '';
    const classificationValue = document.getElementById('invoiceBulkClassification')?.value || '';

    if (!categoryValue && !classificationValue) {
      App.utils.showToast('Escolha uma categoria e/ou classificação para aplicar.', 'error');
      return;
    }

    const total = this._selectedIds.length;
    App.utils.confirm(
      `Aplicar alterações em ${total} transação(ões)?`,
      async () => {
        try {
          const updatedIds = [];
          for (const id of this._selectedIds) {
            const tx = await App.db.getById('transactions', id);
            if (!tx) continue;

            let changed = false;

            if (categoryValue && tx.category !== categoryValue) {
              tx.category = categoryValue;
              // Importante: NÃO mexemos em tx.classification quando o usuário
              // só altera a categoria. Assim, se a transação tiver classification
              // própria, ela é preservada; se não tiver, ela passa a herdar
              // automaticamente a classificação da nova categoria (mesma lógica
              // usada em toda a aplicação).
              changed = true;
            }

            if (classificationValue && tx.classification !== classificationValue) {
              tx.classification = classificationValue;
              changed = true;
            }

            if (changed) {
              tx.updatedAt = new Date().toISOString();
              await App.db.put('transactions', tx);
              updatedIds.push(id);
            }
          }

          // Invalida caches que dependem das transações
          App.transactions.invalidateCache?.();
          App.cache.totalBalance = null;

          // Limpa seleção antes de recarregar (evita re-render com checkboxes marcadas)
          this._selectedIds = [];
          this._allSelected = false;
          const selectAllCheckbox = document.getElementById('invoiceSelectAll');
          if (selectAllCheckbox) selectAllCheckbox.checked = false;

          // Reset dos selects do lote
          const catSel = document.getElementById('invoiceBulkCategory');
          const classSel = document.getElementById('invoiceBulkClassification');
          if (catSel) catSel.value = '';
          if (classSel) classSel.value = '';

          // Sincroniza TODAS as seções que dependem de category/classification
          await this.load();
          await App.saldos.load();
          App.transactions.load();
          App.dashboard.refresh();
          App.panel.refresh();
          App.creditCards.load();
          if (App.analytics) App.analytics.refresh();
          if (App.installments) App.installments.load();
          if (App.classification) App.classification.load();
          if (App.categorization) App.categorization.load();

          App.utils.showToast(`${updatedIds.length} transação(ões) atualizada(s)!`);
        } catch (e) {
          console.error('Erro ao aplicar edição em massa:', e);
          App.utils.showToast('Erro ao aplicar edição em massa.', 'error');
        }
      }
    );
  },

  clearSelection() {
    this._selectedIds = [];
    this._allSelected = false;
    document.querySelectorAll('.invoiceCheck').forEach(cb => { cb.checked = false; });
    const selectAllCheckbox = document.getElementById('invoiceSelectAll');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    const catSel = document.getElementById('invoiceBulkCategory');
    const classSel = document.getElementById('invoiceBulkClassification');
    if (catSel) catSel.value = '';
    if (classSel) classSel.value = '';
    this._updateDeleteButtonVisibility();
  },

   async importXLSX(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        if (rows.length < 2) { App.utils.showToast('Arquivo vazio ou inválido', 'error'); return; }
        const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
        const cardId = this.currentCardId;
        const card = await App.db.getById('creditCards', cardId);
        if (!card) { App.utils.showToast('Cartão não encontrado', 'error'); return; }
        const members = App.cache.members || await App.db.getAll('members');
        const categories = App.cache.categories || await App.db.getAll('categories');

        const normalTxs = [];   // transações comuns (serão salvas em lote)
        const splitItems = [];  // compras divididas (serão processadas depois)
        const ignoredRows = []; // linhas com problema

        // Função auxiliar para verificar duplicata (consulta banco e lote atual)
                const isDuplicateTx = async (tx) => {
          const existing = await App.db.getAll('transactions');
          const inDb = existing.some(t =>
            t.credit_card_id === tx.credit_card_id &&
            t.description === tx.description &&
            Math.abs(parseFloat(t.amount) - tx.amount) < 0.001 &&
            t.date === tx.date &&
            (t.member_id === tx.member_id || t.member_name === tx.member_name)
          );
          if (inDb) return true;
          const inBatch = normalTxs.some(t =>
            t.credit_card_id === tx.credit_card_id &&
            t.description === tx.description &&
            Math.abs(parseFloat(t.amount) - tx.amount) < 0.001 &&
            t.date === tx.date &&
            (t.member_id === tx.member_id || t.member_name === tx.member_name)
          );
          return inBatch;
        };

        for (let i = 1; i < rows.length; i++) {
          const vals = rows[i];
          // Pula linhas completamente vazias sem gerar aviso
          const nonEmptyCount = (vals || []).filter(v => v != null && String(v).trim() !== '').length;
          if (nonEmptyCount === 0) {
            continue; // linha totalmente em branco: ignora silenciosamente
          }
          if (nonEmptyCount < 2) {
            ignoredRows.push({ linha: i+1, motivo: 'Linha vazia ou com poucas colunas' });
            continue;
          }
          const obj = {};
          headers.forEach((h, idx) => obj[h] = vals[idx] != null ? String(vals[idx]).trim() : '');

          const rawAmountStr = (obj.valor || obj.amount || '0').trim();
          const rawAmount = parseFloat(rawAmountStr);
          if (isNaN(rawAmount) || rawAmount === 0) {
            ignoredRows.push({ linha: i+1, motivo: 'Valor inválido (zero ou não numérico)' });
            continue;
          }

          const txType = rawAmount < 0 ? 'expense' : 'refund';
          const totalAmount = Math.abs(rawAmount);

          const category = obj.categoria || obj.category || 'Outros';
          await App.utils.ensureCategory(category);
          const description = obj.descricao || obj['descrição'] || obj.description || obj.desc || '';
          let classification = obj.classificacao || obj['classificação'] || obj.classification || '';

          // Converte rótulos comuns do XLSX para os códigos internos
          if (classification) {
            const c = classification
              .toLowerCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
              .replace(/[^a-z]/g, ''); // remove espaços e caracteres especiais
            if (c.includes('essenc')) classification = 'essential';
            else if (c.includes('necess')) classification = 'necessary';
            else if (c.includes('superflu')) classification = 'superfluous';
            else classification = ''; // não reconhecido → limpa
          }
          let rawDate = obj.data || obj.date || '';
          let date;
          if (!rawDate) {
            date = App.utils.todayISO();
          } else if (!isNaN(rawDate) && rawDate !== '') {
            // Valor numérico → provável número de série do Excel
            const parsed = XLSX.SSF.parse_date_code(parseFloat(rawDate));
            if (parsed) {
              date = `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
            } else {
              date = App.utils.todayISO();
            }
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            date = rawDate;
          } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
            const [d, m, y] = rawDate.split('/');
            date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
          } else {
            // Formato não reconhecido → usa a data de hoje como fallback
            date = App.utils.todayISO();
          }

          // Leitura da hora (coluna "hora") – aceita número serial do Excel e texto
          const rawHora = obj.hora || obj['hora'] || '';
          let fullDate = date; // padrão sem hora
          let horaNormalizada = '';
          if (rawHora !== '' && rawHora !== null && rawHora !== undefined) {
            let timePart = '';
            if (!isNaN(rawHora) && String(rawHora).trim() !== '') {
              // Valor numérico → hora serial do Excel (fração do dia)
              const totalSeconds = Math.round(parseFloat(rawHora) * 86400);
              const hours = Math.floor(totalSeconds / 3600);
              const minutes = Math.floor((totalSeconds % 3600) / 60);
              const seconds = totalSeconds % 60;
              timePart = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
            } else {
              // Valor texto → normaliza
              timePart = String(rawHora).trim();
              if (/^\d{1,2}:\d{2}$/.test(timePart)) {
                timePart += ':00';
              } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(timePart)) {
                // ok
              } else {
                timePart = '';
              }
            }
            if (timePart) {
              horaNormalizada = timePart;
              fullDate = date + 'T' + horaNormalizada;
            }
          }

          const memberNameRaw = obj.membro || obj.member || obj.member_name || '';
          const memberName = memberNameRaw.trim().toLowerCase();
          let memberId = null;
          if (memberName && memberName !== 'compra dividida' && memberName !== 'transação dividida') {
            const member = members.find(m => m.name.toLowerCase() === memberName);
            if (member) memberId = member.id;
            else {
              ignoredRows.push({ linha: i+1, motivo: `Membro "${memberNameRaw}" não encontrado` });
              continue;
            }
          }

          const installmentsRaw = obj.parcelas || obj.installments || obj.parcela || '1';
          const installments = parseInt(installmentsRaw) || 1;

          // Compra dividida → será processada depois
          if (memberName === 'compra dividida' || memberName === 'transação dividida') {
            // Para compras divididas, repassamos a data com hora (se houver)
            splitItems.push({ totalAmount, date: fullDate, category, description, cardId, installments, txType, classification });
            continue;
          }

          // Monta transações normais (com ou sem parcelas)
          if (installments > 1) {
            const rawParcel = totalAmount / installments;
            const roundedParcel = Math.round(rawParcel * 100) / 100;
            const sumFirstParts = roundedParcel * (installments - 1);
            const lastAmount = totalAmount - sumFirstParts;
            const groupId = App.utils.generateId();
            for (let p = 0; p < installments; p++) {
              const baseDate = App.utils.addMonths(date, p);
              const parcelDate = horaNormalizada ? baseDate + 'T' + horaNormalizada : baseDate;
              const parcelAmount = (p === installments - 1) ? lastAmount : roundedParcel;
              const newTx = {
                id: App.utils.generateId(),
                type: txType,
                amount: parcelAmount,
                category,
                description,
                date: parcelDate,
                account_id: card.account_id,
                account_name: card.account_id ? (App.cache.accounts?.find(a => a.id === card.account_id)?.name || '') : '',
                account_to_id: null,
                account_to_name: null,
                member_id: memberId || card.member_id || '',
                member_name: memberNameRaw || (card.member_id ? members.find(m => m.id === card.member_id)?.name || '' : ''),
                credit_card_id: cardId,
                payment_method: 'credit_card',
                classification,
                receipt_url: '',
                investment_id: null,
                purchase_date: date, // data da compra sem hora
                installment_id: groupId,
                installments,
                installment_number: p + 1,
                recurring: false,
                vacation: false,
                status: 'pending',
                reconciled: false,
                ignore_from_total: false,
                createdAt: new Date().toISOString()
              };
              if (await isDuplicateTx(newTx)) {
                ignoredRows.push({ linha: i+1, motivo: 'Duplicado', descricao: newTx.description, valor: newTx.amount });
              } else {
                normalTxs.push(newTx);
              }
            }
          } else {
            const newTx = {
              id: App.utils.generateId(),
              type: txType,
              amount: totalAmount,
              category,
              description,
              date: fullDate, // usa data+hora se disponível
              account_id: card.account_id,
              account_name: card.account_id ? (App.cache.accounts?.find(a => a.id === card.account_id)?.name || '') : '',
              account_to_id: null,
              account_to_name: null,
              member_id: memberId || card.member_id || '',
              member_name: memberNameRaw || (card.member_id ? members.find(m => m.id === card.member_id)?.name || '' : ''),
              credit_card_id: cardId,
              payment_method: 'credit_card',
              classification,
              receipt_url: '',
              investment_id: null,
              purchase_date: '',
              installment_id: null,
              installments: 1,
              installment_number: 1,
              recurring: false,
              vacation: false,
              status: 'pending',
              reconciled: false,
              ignore_from_total: false,
              createdAt: new Date().toISOString()
            };
            if (await isDuplicateTx(newTx)) {
              ignoredRows.push({ linha: i+1, motivo: 'Duplicado', descricao: newTx.description, valor: newTx.amount });
            } else {
              normalTxs.push(newTx);
            }
          }
        } // fim do loop de linhas

        // 1) Verifica conflitos com transações existentes (apenas para normais)
        const existingAll = await App.db.getAll('transactions');
        const conflicted = [];
        const nonConflicted = [];
        normalTxs.forEach(newTx => {
          const isSimilar = existingAll.some(ex =>
            ex.credit_card_id === newTx.credit_card_id &&
            ex.description === newTx.description &&
            Math.abs(parseFloat(ex.amount) - newTx.amount) < 0.001 &&
            ex.date.slice(0,10) === newTx.date.slice(0,10) &&
            ex.type === newTx.type
          );
          if (isSimilar) {
            conflicted.push(newTx);
          } else {
            nonConflicted.push(newTx);
          }
        });

        this._pendingNormalTxs = nonConflicted;
        this._pendingSplitItems = splitItems;
        this._pendingIgnoredRows = ignoredRows;
        this._pendingMembers = members;
        this._conflictedNormalTxs = conflicted;

        if (conflicted.length > 0) {
          // Abre revisão e, ao fechar, continua o fluxo
          this.reviewConflicts(conflicted, existingAll, (accepted) => {
            // Adiciona as aceitas ao lote normal
            this._pendingNormalTxs = nonConflicted.concat(accepted);
            // Adiciona as recusadas à lista de ignoradas
            const refused = conflicted.filter(tx => !accepted.includes(tx));
            refused.forEach(tx => {
              this._pendingIgnoredRows.push({ linha: 'Conflito', motivo: 'Recusado pelo usuário', descricao: tx.description, valor: tx.amount });
            });
            this.showImportStep1(this._pendingNormalTxs);
          });
        } else {
          this.showImportStep1(nonConflicted);
        }

        // O restante (salvar e processar splits) será feito após o usuário clicar em Avançar
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      console.error('Erro ao importar XLSX da fatura:', err);
      App.utils.showToast('Erro ao processar arquivo XLSX.', 'error');
    }
    event.target.value = '';
  },

   // Função auxiliar: abre modal exclusivo para compra dividida na fatura
  handleSplitImport(item) {
    return new Promise(async (resolve) => {
      const { totalAmount, date, category, description, cardId, installments, txType } = item;
      const card = await App.db.getById('creditCards', cardId);
      const members = App.cache.members || await App.db.getAll('members');
      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      const acc = accounts.find(a => a.id === card.account_id);

      // Flag local para saber se a Promise já foi resolvida
      let resolved = false;
      const safeResolve = (value) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      // Popula campos do novo modal
      document.getElementById('splitImportDesc').value = description;
      document.getElementById('splitImportAmount').value = App.utils.formatCurrency(totalAmount)
        + (installments > 1 ? ` (${installments}x)` : '');
      document.getElementById('splitImportCategory').value = category;
      document.getElementById('splitImportCard').value = card?.name || '';
      document.getElementById('splitImportDate').value = date;

      // Armazena dados para uso no confirm/cancel
      this._splitImportData = { totalAmount, date, category, description, cardId, card, members, resolve: safeResolve, installments, txType };

      // Renderiza os membros com divisão igual
      const container = document.getElementById('splitImportEntries');
      container.innerHTML = '';
      const memberCount = members.length;
      const rawPart = totalAmount / memberCount;
      const roundedPart = Math.round(rawPart * 100) / 100;
      const sumFirstParts = roundedPart * (memberCount - 1);
      const lastPart = totalAmount - sumFirstParts;

      members.forEach((member, idx) => {
        const amount = (idx === memberCount - 1) ? lastPart : roundedPart;
        const row = document.createElement('div');
        row.className = 'split-import-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '12px';
        row.style.marginBottom = '8px';
        row.innerHTML = `
          <span style="flex:1;">${member.name}</span>
          <input type="number" class="split-import-amount" step="0.01" value="${amount}" data-member-id="${member.id}" style="width:120px;">
        `;
        container.appendChild(row);
      });

      // Exibe/esconde mensagem de erro da soma
      const validateSum = () => {
        const sum = this.getSplitImportSum();
        const errEl = document.getElementById('splitImportSumError');
        if (Math.abs(sum - totalAmount) > 0.01) {
          errEl.style.display = 'block';
          errEl.textContent = `A soma das partes (${App.utils.formatCurrency(sum)}) difere do total (${App.utils.formatCurrency(totalAmount)})`;
          return false;
        } else {
          errEl.style.display = 'none';
          return true;
        }
      };

      // Adiciona listener de input a cada campo para validar soma em tempo real
      document.querySelectorAll('.split-import-amount').forEach(input => {
        input.addEventListener('input', validateSum);
      });

      App.ui.openModal('modalCardSplit');

      // Caso o modal seja fechado manualmente (sem Confirmar), cancela toda a importação
      const observer = new MutationObserver(() => {
        const modal = document.getElementById('modalCardSplit');
        if (modal && !modal.classList.contains('open')) {
          // Só cancela se a Promise ainda não foi resolvida (ou seja, fechou sem confirmar)
          if (!resolved) {
            this._importCancelled = true;
            safeResolve(false);
          }
          this._splitImportData = null;
          observer.disconnect();
        }
      });
      observer.observe(document.getElementById('modalCardSplit'), { attributes: true, attributeFilter: ['class'] });
    });
  },

   // Chamado ao clicar em "Confirmar" no modal de split – agora com suporte a parcelamento, tipo dinâmico e verificação de duplicatas
  async confirmSplitImport() {
    const data = this._splitImportData;
    if (!data) return;
    const { totalAmount, date, category, description, cardId, card, members, resolve, installments, txType } = data;

    // Valida soma
    const sum = this.getSplitImportSum();
    if (Math.abs(sum - totalAmount) > 0.01) {
      App.utils.showToast('A soma das partes difere do valor total.', 'error');
      return;
    }

    // Constrói member_splits (valores absolutos do total) e nome composto
    const memberSplitsTotal = [];
    const memberNames = [];
    document.querySelectorAll('.split-import-amount').forEach(input => {
      const memberId = input.getAttribute('data-member-id');
      const amount = parseFloat(input.value) || 0;
      if (memberId && amount > 0) {
        const member = members.find(m => m.id === memberId);
        if (member) {
          memberSplitsTotal.push({ member_id: memberId, amount: amount });
          memberNames.push(member.name);
        }
      }
    });

    if (memberSplitsTotal.length === 0) {
      App.utils.showToast('Nenhum membro com valor válido.', 'error');
      return;
    }

    const composedName = memberNames.join(' + ');

    // Gera as transações (uma ou mais parcelas)
    const installmentCount = Math.max(1, installments || 1);
    const rawParcelAmount = totalAmount / installmentCount;
    const roundedParcel = Math.round(rawParcelAmount * 100) / 100;
    const sumFirstParcels = roundedParcel * (installmentCount - 1);
    const lastParcel = totalAmount - sumFirstParcels;

    // Calcula proporções de cada membro
    const memberRatios = memberSplitsTotal.map(ms => ({
      member_id: ms.member_id,
      ratio: ms.amount / totalAmount
    }));

    const groupId = installmentCount > 1 ? App.utils.generateId() : null;

    // Função auxiliar para verificar duplicata (compara data+hora completa)
    const isDuplicateTx = async (t) => {
      const all = await App.db.getAll('transactions');
      return all.some(ex =>
        ex.credit_card_id === t.credit_card_id &&
        ex.description === t.description &&
        Math.abs(parseFloat(ex.amount) - t.amount) < 0.001 &&
        ex.date === t.date &&
        (ex.member_id === t.member_id || ex.member_name === t.member_name)
      );
    };

    let savedCount = 0;

    for (let p = 0; p < installmentCount; p++) {
      const parcelAmount = (p === installmentCount - 1) ? lastParcel : roundedParcel;
      // Preserva a hora original (se houver) ao deslocar os meses
     const [baseDateOnly, timeSuffix] = date.split('T');
const shiftedDate = App.utils.addMonths(baseDateOnly || date, p);
const parcelDate = timeSuffix ? shiftedDate + 'T' + timeSuffix : shiftedDate;

      // Calcula os valores individuais dentro desta parcela
      const memberSplits = [];
      let sumParts = 0;
      for (let i = 0; i < memberRatios.length; i++) {
        const rawMemberAmount = parcelAmount * memberRatios[i].ratio;
        const roundedMember = Math.round(rawMemberAmount * 100) / 100;
        memberSplits.push({
          member_id: memberRatios[i].member_id,
          amount: roundedMember
        });
        sumParts += roundedMember;
      }

      // Ajusta centavos na última parte do último membro
      if (memberSplits.length > 0) {
        const diff = Math.round((parcelAmount - sumParts) * 100) / 100;
        memberSplits[memberSplits.length - 1].amount += diff;
      }

      const tx = {
        id: App.utils.generateId(),
        type: txType || 'expense',
        amount: parcelAmount,
        category: category,
        description: description,
        date: parcelDate,
        account_id: card.account_id,
        account_name: card.account_id ? (App.cache.accounts?.find(a => a.id === card.account_id)?.name || '') : '',
        account_to_id: null,
        account_to_name: null,
        member_id: null,
        member_name: composedName,
        credit_card_id: cardId,
        payment_method: 'credit_card',
        classification: '',
        receipt_url: '',
        investment_id: null,
        purchase_date: date,
        installment_id: groupId,
        installments: installmentCount,
        installment_number: p + 1,
        recurring: false,
        vacation: false,
        status: 'pending',
        reconciled: false,
        ignore_from_total: false,
        createdAt: new Date().toISOString(),
        position: Date.now(),
        member_splits: memberSplits
      };

      if (await isDuplicateTx(tx)) {
        // Adiciona à lista de ignorados
        if (this._pendingIgnoredRows) {
          this._pendingIgnoredRows.push({ linha: 'Split', motivo: 'Duplicado' });
        }
      } else {
        await App.db.put('transactions', tx);
        savedCount++;
      }
    }

    App.ui.closeModal('modalCardSplit');
    // Resolve com o número de transações realmente salvas
    resolve(savedCount);
    this._splitImportData = null;
  },

  // Chamado ao clicar em "Cancelar" ou fechar o modal
  cancelSplitImport() {
    this._importCancelled = true;   // interrompe todo o processo de importação
    App.ui.closeModal('modalCardSplit');
    if (this._splitImportData) {
      this._splitImportData.resolve(false);
      this._splitImportData = null;
    }
  },

  // Calcula a soma dos valores atuais nos campos de split
  getSplitImportSum() {
    let sum = 0;
    document.querySelectorAll('.split-import-amount').forEach(input => {
      sum += parseFloat(input.value) || 0;
    });
    return Math.round(sum * 100) / 100;
  },
  // Exibe a etapa 1 com a lista de transações comuns
  showImportStep1(normalTxs) {
    const total = normalTxs.reduce((s, t) => s + t.amount, 0);
    const members = App.cache.members || this._pendingMembers || [];
    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

    let html = '';
    if (normalTxs.length === 0) {
      html = '<p style="color:var(--income);">Nenhuma transação comum encontrada.</p>';
    } else {
      html = `<table style="width:100%; border-collapse:collapse;">
                <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Membro</th><th class="text-right">Valor</th></tr></thead>
                <tbody>`;
      normalTxs.forEach(t => {
        html += `<tr>
          <td>${App.utils.formatDate(t.date)}</td>
          <td>${t.description}</td>
          <td>${t.category}</td>
          <td>${t.member_name || (t.member_id ? (memberMap[t.member_id] || '') : '')}</td>
          <td class="text-right">${App.utils.formatCurrency(t.amount)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    document.getElementById('step1ListContainer').innerHTML = html;
    document.getElementById('step1Total').textContent = App.utils.formatCurrency(total);
    App.ui.openModal('modalImportStep1');
  },

  // Revisão manual de conflitos (transações semelhantes)
  reviewConflicts(conflictedTxs, existingTxs, callback) {
    if (!conflictedTxs.length) {
      callback([]); // sem conflitos, segue vazio
      return;
    }

    document.getElementById('conflictReviewMessage').innerHTML =
      `⚠️ Foram encontradas <strong>${conflictedTxs.length} transações</strong> muito parecidas com registros já existentes.<br>
      <span style="color:var(--text-muted);">Marque as que deseja <strong>importar mesmo assim</strong>:</span>`;

    let html = '';
    conflictedTxs.forEach((newTx, idx) => {
      const similar = existingTxs.find(ex =>
        ex.credit_card_id === newTx.credit_card_id &&
        ex.description === newTx.description &&
        Math.abs(parseFloat(ex.amount) - newTx.amount) < 0.001 &&
        ex.date.slice(0,10) === newTx.date.slice(0,10) &&
        ex.type === newTx.type
      );

      html += `<div style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border);">
        <input type="checkbox" class="conflictCheck" data-index="${idx}" checked>
        <div style="flex:1;">
          <div><strong>${newTx.description || 'Sem descrição'}</strong></div>
          <div style="font-size:0.75rem; color:var(--text-muted);">
            ${App.utils.formatCurrency(newTx.amount)} – ${App.utils.formatDate(newTx.date)}
          </div>
        </div>
        <div style="font-size:0.7rem; background:var(--bg-secondary); padding:2px 6px; border-radius:4px;">já existe</div>
      </div>`;
    });

    document.getElementById('conflictReviewList').innerHTML = html;
    App.ui.openModal('modalConflictReview');

    this._conflictCallback = callback;
    this._conflictedTxs = conflictedTxs;
  },

  _closeConflictReview(selectedIndices) {
    App.ui.closeModal('modalConflictReview');
    const conflicted = this._conflictedTxs || [];
    if (selectedIndices === null) {
      // Coleta índices dos checkboxes marcados
      const checks = document.querySelectorAll('.conflictCheck:checked');
      selectedIndices = Array.from(checks).map(cb => parseInt(cb.getAttribute('data-index')));
    }
    const accepted = selectedIndices.map(i => conflicted[i]).filter(Boolean);
    if (this._conflictCallback) this._conflictCallback(accepted);
    this._conflictCallback = null;
    this._conflictedTxs = null;
  },

  // Cancela toda a importação e descarta os dados
  cancelImportStep1() {
    App.ui.closeModal('modalImportStep1');
    this._pendingNormalTxs = null;
    this._pendingSplitItems = null;
    this._pendingIgnoredRows = null;
    this._conflictedNormalTxs = null;
    App.utils.showToast('Importação cancelada.');
  },

   // Exibe a etapa 2 com a lista de compras divididas
  showImportStep2(splitItems) {
    const members = App.cache.members || [];
    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
    let totalGeral = 0;

    let html = '';
    splitItems.forEach((item, idx) => {
      // Garante que o total tenha no máximo duas casas decimais
      const total = Math.round(item.totalAmount * 100) / 100;
      const isRefund = item.txType === 'refund';
      // Atualiza total geral líquido: despesa soma, estorno subtrai
      totalGeral += isRefund ? -total : total;
      const count = members.length;
      
      // Distribuição exata: todos recebem o valor arredondado,
      // e o último membro recebe a diferença para fechar o total
      const rawPart = total / count;
      const roundedPart = Math.round(rawPart * 100) / 100;
      const sumFirstParts = roundedPart * (count - 1);
      const lastPart = Math.round((total - sumFirstParts) * 100) / 100;

      const tipoLabel = isRefund ? 'Estorno' : 'Despesa';
      const tipoCor = isRefund ? 'var(--income)' : 'var(--expense)';
      const sinal = isRefund ? '+' : '-';

      html += `<div style="border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:12px;">
        <strong>${item.description || 'Compra dividida'}</strong> – 
        <span style="color:${tipoCor}; font-weight:600;">${tipoLabel}: ${sinal} ${App.utils.formatCurrency(total)}</span> – 
        ${item.category} – ${App.utils.formatDate(item.date)}
        ${item.installments > 1 ? ` (${item.installments}x)` : ''}
        <div style="margin-top:8px;">`;

      members.forEach((member, mIdx) => {
        const amount = (mIdx === count - 1) ? lastPart : roundedPart;
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
          <span style="flex:1;">${member.name}</span>
          <input type="number" class="split-step2-amount" step="0.01" value="${amount.toFixed(2)}"
                 data-split-index="${idx}" data-member-id="${member.id}" style="width:120px;">
        </div>`;
      });
      html += `</div></div>`;
    });

    // Arredonda o total geral para evitar imprecisões
    totalGeral = Math.round(totalGeral * 100) / 100;
    document.getElementById('step2ListContainer').innerHTML = html;
    document.getElementById('step2Total').textContent = App.utils.formatCurrency(totalGeral);

    // Armazena os itens originais para uso no confirm
    this._pendingSplitItemsData = splitItems;

    App.ui.openModal('modalImportStep2');
  },

  // Cancela a etapa 2 (os normais já foram salvos, ignora os splits)
  cancelImportStep2() {
    App.ui.closeModal('modalImportStep2');
    // Mostra o resumo considerando apenas os normais já salvos
    const normalCount = this._pendingNormalTxs ? this._pendingNormalTxs.length : 0;
    const ignoredRows = this._pendingIgnoredRows || [];
    // Adiciona splits como ignorados
    if (this._pendingSplitItemsData) {
      this._pendingSplitItemsData.forEach((_, idx) => {
        const item = this._pendingSplitItemsData[idx];
        ignoredRows.push({ linha: 'Split #' + (idx+1), motivo: 'Cancelado pelo usuário', descricao: item.description, valor: item.totalAmount });
      });
    }
    const totalNormal = this._pendingNormalTxs
      ? this._pendingNormalTxs.reduce((s, t) => s + (t.type === 'refund' ? -t.amount : t.amount), 0)
      : 0;
    this.showImportSummary(normalCount, 0, ignoredRows, totalNormal, 0);
    this.load();
    App.dashboard.refresh();
    App.panel.refresh();
    App.saldos.load();
    this._pendingNormalTxs = null;
    this._pendingSplitItems = null;
    this._pendingSplitItemsData = null;
    this._pendingIgnoredRows = null;
  },

  // Processa todas as compras divididas de uma vez
  async confirmImportStep2() {
    App.ui.closeModal('modalImportStep2');

    const splitItems = this._pendingSplitItemsData || [];
    const ignoredRows = this._pendingIgnoredRows || [];
    const normalCount = this._pendingNormalTxs ? this._pendingNormalTxs.length : 0;
    let splitCount = 0;
    let totalSplit = 0;

    if (splitItems.length > 0) {
      const members = App.cache.members || [];
      const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

      // Função auxiliar para verificar duplicata (compara data+hora)
      const isDuplicateTx = async (t) => {
        const all = await App.db.getAll('transactions');
        return all.some(ex =>
          ex.credit_card_id === t.credit_card_id &&
          ex.description === t.description &&
          Math.abs(parseFloat(ex.amount) - t.amount) < 0.001 &&
          ex.date === t.date &&
          (ex.member_id === t.member_id || ex.member_name === t.member_name)
        );
      };

      for (let idx = 0; idx < splitItems.length; idx++) {
        const item = splitItems[idx];
        const totalAmount = item.totalAmount;
        const installmentCount = Math.max(1, item.installments || 1);
        const txType = item.txType || 'expense';
        const card = await App.db.getById('creditCards', item.cardId);
        if (!card) continue;

        // Obtém os valores por membro dos inputs
        const memberAmounts = {};
        const inputs = document.querySelectorAll(`.split-step2-amount[data-split-index="${idx}"]`);
        inputs.forEach(inp => {
          const memberId = inp.getAttribute('data-member-id');
          const amount = parseFloat(inp.value) || 0;
          memberAmounts[memberId] = amount;
        });

        // Valida soma
        const sum = Object.values(memberAmounts).reduce((s, a) => s + a, 0);
        if (Math.abs(sum - totalAmount) > 0.01) {
          ignoredRows.push({ linha: 'Split #' + (idx+1), motivo: 'Soma dos valores difere do total', descricao: item.description, valor: item.totalAmount });
          continue;
        }

        // Calcula proporções
        const memberRatios = Object.entries(memberAmounts).map(([mid, amount]) => ({
          member_id: mid,
          ratio: amount / totalAmount
        }));
        const memberNamesArr = memberRatios.map(r => memberMap[r.member_id] || r.member_id);
        const composedName = memberNamesArr.join(' + ');

        const groupId = installmentCount > 1 ? App.utils.generateId() : null;

        let savedCount = 0;
        for (let p = 0; p < installmentCount; p++) {
          const rawParcel = totalAmount / installmentCount;
          const roundedParcel = Math.round(rawParcel * 100) / 100;
          const sumFirstParcels = roundedParcel * (installmentCount - 1);
          const lastParcel = Math.round((totalAmount - sumFirstParcels) * 100) / 100;
          const parcelAmount = (p === installmentCount - 1) ? lastParcel : roundedParcel;
          // Preserva a hora original (se houver) ao deslocar os meses
          const [baseDateOnly, timeSuffix] = item.date.split('T');
          const shiftedDate = App.utils.addMonths(baseDateOnly || item.date, p);
          const parcelDate = timeSuffix ? shiftedDate + 'T' + timeSuffix : shiftedDate;

          // Calcula valores individuais
          const memberSplits = [];
          let sumParts = 0;
          for (let i = 0; i < memberRatios.length; i++) {
            const rawMember = parcelAmount * memberRatios[i].ratio;
            const roundedMember = Math.round(rawMember * 100) / 100;
            memberSplits.push({
              member_id: memberRatios[i].member_id,
              amount: roundedMember
            });
            sumParts += roundedMember;
          }
          if (memberSplits.length > 0) {
            const diff = Math.round((parcelAmount - sumParts) * 100) / 100;
            memberSplits[memberSplits.length - 1].amount += diff;
          }

          const tx = {
            id: App.utils.generateId(),
            type: txType,
            amount: parcelAmount,
            category: item.category,
            description: item.description,
            date: parcelDate,
            account_id: card.account_id,
            account_name: card.account_id ? (App.cache.accounts?.find(a => a.id === card.account_id)?.name || '') : '',
            account_to_id: null,
            account_to_name: null,
            member_id: null,
            member_name: composedName,
            credit_card_id: item.cardId,
            payment_method: 'credit_card',
            classification: item.classification || '',
            receipt_url: '',
            investment_id: null,
            purchase_date: item.date,
            installment_id: groupId,
            installments: installmentCount,
            installment_number: p + 1,
            recurring: false,
            vacation: false,
            status: 'pending',
            reconciled: false,
            ignore_from_total: false,
            createdAt: new Date().toISOString(),
            position: Date.now(),
            member_splits: memberSplits
          };

          if (await isDuplicateTx(tx)) {
                         ignoredRows.push({ linha: 'Split #' + (idx+1), motivo: 'Duplicado', descricao: item.description, valor: tx.amount });
          } else {
            await App.db.put('transactions', tx);
            savedCount++;
            this._pendingImportedIds.push(tx.id);
            totalSplit += (tx.type === 'refund' ? -tx.amount : tx.amount);
          }
        }

        if (savedCount > 0) {
          splitCount += savedCount;
        } else {
                    ignoredRows.push({ linha: 'Split #' + (idx+1), motivo: 'Todas as parcelas duplicadas', descricao: item.description, valor: item.totalAmount });
        }
      }
    }

    // Resumo final
    const totalNormal = this._pendingNormalTxs
      ? this._pendingNormalTxs.reduce((s, t) => s + (t.type === 'refund' ? -t.amount : t.amount), 0)
      : 0;
    this.showImportSummary(normalCount, splitCount, ignoredRows, totalNormal, totalSplit);

    this.load();
    App.dashboard.refresh();
    App.panel.refresh();
    App.saldos.load();

    this._pendingNormalTxs = null;
    this._pendingSplitItems = null;
    this._pendingSplitItemsData = null;
    this._pendingIgnoredRows = null;
    this._pendingImportedIds = [];
  },

    // Avança para a etapa 2 (salva normais e abre modal de compras divididas)
  async processImportStep2() {
    App.ui.closeModal('modalImportStep1');

    const normalTxs = this._pendingNormalTxs || [];
    const splitItems = this._pendingSplitItems || [];

    // 1) Salva as transações comuns
    let normalCount = 0;
    let totalNormal = 0;
    if (normalTxs.length > 0) {
      await App.db.putMany('transactions', normalTxs);
      normalCount = normalTxs.length;
      totalNormal = normalTxs.reduce((s, t) => s + (t.type === 'refund' ? -t.amount : t.amount), 0);
      this._pendingImportedIds = normalTxs.map(t => t.id);
    }

    // 2) Abre modal da Etapa 2 com todas as compras divididas
    if (splitItems.length > 0) {
      this.showImportStep2(splitItems);
    } else {
      // Se não houver splits, vai direto para o resumo
      this.showImportSummary(normalCount, 0, this._pendingIgnoredRows || [], totalNormal, 0);
      this.load();
      App.dashboard.refresh();
      App.panel.refresh();
      App.saldos.load();
      this._pendingNormalTxs = null;
      this._pendingSplitItems = null;
      this._pendingIgnoredRows = null;
      this._pendingImportedIds = [];
    }
  },

  // Cancela a importação atual e fecha o modal de progresso
  cancelImport() {
    this._importCancelled = true;
    App.ui.closeModal('modalImportProgress');
  },

  // Cancela toda a importação, revertendo as transações já salvas
  async cancelEntireImport() {
    if (this._pendingImportedIds && this._pendingImportedIds.length > 0) {
      for (const id of this._pendingImportedIds) {
        await App.db.delete('transactions', id);
      }
      App.utils.showToast('Importação cancelada. Transações removidas.');
    } else {
      App.utils.showToast('Nenhuma transação para cancelar.');
    }
    App.ui.closeModal('modalImportSummary');
    this._pendingNormalTxs = null;
    this._pendingSplitItems = null;
    this._pendingSplitItemsData = null;
    this._pendingIgnoredRows = null;
    this._pendingImportedIds = [];
    this.load();
    App.dashboard.refresh();
    App.panel.refresh();
    App.saldos.load();
  },

  // Exibe modal com resumo final da importação
  showImportSummary(normalCount, splitCount, ignoredRows, totalNormal = 0, totalSplit = 0) {
    const total = normalCount + splitCount;
    const totalValue = totalNormal + totalSplit;
    let html = `<p><strong>✅ Transações importadas:</strong> ${total}</p>`;
    html += `<p>📌 Compras comuns (automáticas): ${normalCount}</p>`;
    html += `<p>🔀 Compras divididas (guiadas): ${splitCount}</p>`;
    if (totalValue > 0) {
      html += `<p><strong>💰 Valor total importado:</strong> ${App.utils.formatCurrency(totalValue)}</p>`;
      html += `<button class="btn btn-danger btn-sm" onclick="App.cardInvoice.cancelEntireImport()" style="margin-bottom:12px;">🗑️ Cancelar Importação</button>`;
    }

    if (ignoredRows.length > 0) {
      html += `<hr><p style="color:var(--expense);">⚠️ Linhas ignoradas (${ignoredRows.length}):</p>`;
      html += `<table style="width:100%; border-collapse:collapse; margin-top:8px;">
                 <thead><tr><th>Linha</th><th>Motivo</th></tr></thead><tbody>`;
      ignoredRows.forEach(r => {
        const desc = r.descricao ? ` – ${r.descricao}` : '';
        const valor = r.valor != null ? ` (${App.utils.formatCurrency(r.valor)})` : '';
        html += `<tr><td>${r.linha}</td><td>${r.motivo}${desc}${valor}</td></tr>`;
      });
      html += `</tbody></table>`;
    } else {
      html += `<p style="color:var(--income);">🎉 Nenhuma linha foi ignorada!</p>`;
    }

    document.getElementById('importSummaryContent').innerHTML = html;
    App.ui.openModal('modalImportSummary');
  },

  // Calcula período e vencimento da fatura para um cartão em determinado mês (formato 'YYYY-MM')
  getInvoicePeriodForMonth(card, targetMonth) {
    const [y, m] = targetMonth.split('-').map(Number);
    const closeDay = card.close_day || (card.due_day - 10 > 0 ? card.due_day - 10 : 1);
    const dueDay = card.due_day || 10;
    
    // Fechamento no mês alvo
    const closeDate = new Date(y, m - 1, closeDay);
    // Abertura = dia seguinte ao fechamento do mês anterior
    const startDate = new Date(y, m - 2, closeDay + 1);
    // Vencimento = dia do vencimento no mês seguinte ao fechamento
    let dueDate = new Date(y, m - 1, dueDay);
    if (dueDate <= closeDate) {
      dueDate = new Date(y, m, dueDay); // se o vencimento cai antes do fechamento, joga pro próximo mês
    }
    return {
      start: startDate.toISOString().slice(0, 10),
      end: closeDate.toISOString().slice(0, 10),
      due: dueDate.toISOString().slice(0, 10)
    };
  },
  

  // Calcula o período da fatura atual (que contém a data de hoje) para um cartão
  getCurrentInvoicePeriod(card) {
    const today = new Date();
    const closeDay = card.close_day || (card.due_day - 10 > 0 ? card.due_day - 10 : 1);
    const dueDay = card.due_day || 10;
    const getCloseDate = (year, month) => new Date(year, month, closeDay);

    let closeDateCurrentMonth = getCloseDate(today.getFullYear(), today.getMonth());
    let start, end, dueDate;

    if (today <= closeDateCurrentMonth) {
      end = closeDateCurrentMonth;
      start = new Date(today.getFullYear(), today.getMonth() - 1, closeDay + 1);
      dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);
    } else {
      end = getCloseDate(today.getFullYear(), today.getMonth() + 1);
      start = new Date(today.getFullYear(), today.getMonth(), closeDay + 1);
      dueDate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
    }
    if (dueDate <= end) {
      dueDate = new Date(end.getFullYear(), end.getMonth() + 1, dueDay);
    }
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      due: dueDate.toISOString().slice(0, 10)
    };
  },

  getInstallmentDateForInvoice(card, purchaseDate, installmentNumber) {
    const firstPeriod = this.getInvoicePeriodForDate(card, purchaseDate);
    const [year, month] = firstPeriod.due.slice(0, 7).split('-').map(Number);
    const targetDate = new Date(year, month - 1 + (installmentNumber - 1), 1);
    const targetMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    const period = this.getInvoicePeriodForMonth(card, targetMonth);
    return period.start;
  },

  // Calcula o período da fatura que contém uma data específica (não apenas a atual)
  getInvoicePeriodForDate(card, dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const closeDay = card.close_day || (card.due_day - 10 > 0 ? card.due_day - 10 : 1);
    const dueDay = card.due_day || 10;
    const getCloseDate = (year, month) => new Date(year, month, closeDay);

    // Determina o fechamento que é >= data fornecida
    let closeCandidate = getCloseDate(d.getFullYear(), d.getMonth());
    if (d > closeCandidate) {
      closeCandidate = getCloseDate(d.getFullYear(), d.getMonth() + 1);
    }
    // Abertura = dia seguinte ao fechamento do mês anterior
    const start = new Date(closeCandidate.getFullYear(), closeCandidate.getMonth() - 1, closeDay + 1);
    const end = closeCandidate;
    let dueDate = new Date(end.getFullYear(), end.getMonth(), dueDay);
    if (dueDate <= end) {
      dueDate = new Date(end.getFullYear(), end.getMonth() + 1, dueDay);
    }

    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      due: dueDate.toISOString().slice(0, 10)
    };
  },

  // Exporta a fatura em formato XLSX
  async exportXLSX() {
    if (!this.currentCardId) {
      App.utils.showToast('Nenhum cartão selecionado.', 'error');
      return;
    }
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;

    // Pergunta qual vencimento deseja exportar (mês/ano)
    App.utils.prompt(
      'Informe o mês/ano da fatura que deseja exportar (ex: 2026-05):',
      this.currentInvoiceDue ? this.currentInvoiceDue.slice(0,7) : '',
      async (monthStr) => {
        if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
          App.utils.showToast('Formato inválido. Use AAAA-MM.', 'error');
          return;
        }

        const period = App.cardInvoice.getInvoicePeriodForMonth(card, monthStr);
        const txAll = await App.db.getTransactionsInRange(period.start, period.end);
        const cardTx = txAll.filter(t =>
          t.credit_card_id === this.currentCardId &&
          (t.type === 'expense' || t.type === 'refund')
        );

        if (cardTx.length === 0) {
          App.utils.showToast('Nenhuma transação encontrada para este período.', 'warning');
          return;
        }

        // Monta os dados para a planilha
        const headers = ['Data', 'Descrição', 'Categoria', 'Membro', 'Valor', 'Status'];
        const rows = cardTx.map(t => [
          App.utils.formatDate(t.date),
          t.description || '',
          t.category || '',
          t.member_name || '',
          t.amount,
          t.status === 'confirmed' ? 'Efetivado' : 'Pendente'
        ]);

        // Cria o workbook e a planilha
        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Fatura');

        const filename = `fatura_${card.name.replace(/\s+/g, '_')}_${monthStr}.xlsx`;
        XLSX.writeFile(wb, filename);
        App.utils.showToast('Fatura exportada com sucesso!');
      }
    );
  },

   async prevInvoice() {
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;
    const endDate = new Date(this.currentInvoiceEnd + 'T12:00:00');
    const refMonth = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = refMonth.split('-').map(Number);
    const newRefMonth = new Date(y, m - 2, 1);
    const prevMonthStr = `${newRefMonth.getFullYear()}-${String(newRefMonth.getMonth() + 1).padStart(2, '0')}`;
    const period = App.cardInvoice.getInvoicePeriodForMonth(card, prevMonthStr);
    // Verifica se há transações no período ANTES de alterar as datas
    const tx = await App.db.getTransactionsInRange(period.start, period.end);
    const hasTx = tx.some(t => t.credit_card_id === this.currentCardId && (t.type === 'expense' || t.type === 'refund'));
    if (!hasTx) {
      App.ui.openModal('modalInvoiceEmpty');
      return;
    }
    this.currentInvoiceStart = period.start;
    this.currentInvoiceEnd = period.end;
    this.currentInvoiceDue = period.due;
    this.load();
  },
   async nextInvoice() {
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;
    const endDate = new Date(this.currentInvoiceEnd + 'T12:00:00');
    const refMonth = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = refMonth.split('-').map(Number);
    const newRefMonth = new Date(y, m - 1, 1);
    newRefMonth.setMonth(newRefMonth.getMonth() + 1);
    const nextMonthStr = `${newRefMonth.getFullYear()}-${String(newRefMonth.getMonth() + 1).padStart(2, '0')}`;
    const period = App.cardInvoice.getInvoicePeriodForMonth(card, nextMonthStr);
    // Verifica se há transações no período ANTES de alterar as datas
    const tx = await App.db.getTransactionsInRange(period.start, period.end);
    const hasTx = tx.some(t => t.credit_card_id === this.currentCardId && (t.type === 'expense' || t.type === 'refund'));
    if (!hasTx) {
      App.ui.openModal('modalInvoiceEmpty');
      return;
    }
    this.currentInvoiceStart = period.start;
    this.currentInvoiceEnd = period.end;
    this.currentInvoiceDue = period.due;
    this.load();
  },
   async gotoMonth() {
    const month = document.getElementById('invoiceMonthPicker').value;
    if (!month) return;
    const card = await App.db.getById('creditCards', this.currentCardId);
    if (!card) return;
    const period = App.cardInvoice.getInvoicePeriodForMonth(card, month);
    // Verifica se há transações no período ANTES de alterar as datas
    const tx = await App.db.getTransactionsInRange(period.start, period.end);
    const hasTx = tx.some(t => t.credit_card_id === this.currentCardId && (t.type === 'expense' || t.type === 'refund'));
    if (!hasTx) {
      // Restaura o picker para o mês da fatura atual
      const currentEnd = new Date(this.currentInvoiceEnd + 'T12:00:00');
      const currentMonthStr = `${currentEnd.getFullYear()}-${String(currentEnd.getMonth() + 1).padStart(2, '0')}`;
      document.getElementById('invoiceMonthPicker').value = currentMonthStr;
      App.ui.openModal('modalInvoiceEmpty');
      return;
    }
    this.currentInvoiceStart = period.start;
    this.currentInvoiceEnd = period.end;
    this.currentInvoiceDue = period.due;
    this.load();
  },
};
// =======================================================================
// Split (com renderEntries e suporte ao Casal)
// =======================================================================
App.split = {
  entries: [],
  init() { const isSplit = document.getElementById('txIsSplit')?.value === 'true'; document.getElementById('splitSection').style.display = isSplit ? 'block' : 'none'; if (isSplit) { this.entries = []; document.getElementById('splitEntries').innerHTML = ''; this.addEntry(); } },
  addEntry() {
    const container = document.getElementById('splitEntries');
    const idx = this.entries.length;
    const div = document.createElement('div');
    div.className = 'split-entry';
    div.innerHTML = `<select class="split-category" style="flex:1.5"><option value="">Categoria</option></select><select class="split-account" style="flex:1.5"><option value="">Conta</option></select><select class="split-member" style="flex:1"><option value="">Membro</option></select><input type="number" class="split-amount" step="0.01" placeholder="Valor" style="flex:1"><button type="button" class="btn btn-ghost btn-sm" onclick="App.split.removeEntry(${idx})">✕</button>`;
    container.appendChild(div);
    this.entries.push({ category: '', account: '', member: '', amount: 0 });
    this.populateSelects(div);
  },
  removeEntry(idx) {
    const container = document.getElementById('splitEntries');
    if (container.children[idx]) container.children[idx].remove();
    this.entries.splice(idx, 1);
  },
  async populateSelects(div) {
    const cats = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = cats;
    div.querySelector('.split-category').innerHTML = cats.filter(c => c.type === 'expense').map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    div.querySelector('.split-account').innerHTML = accounts.filter(a => !a.archived).map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    const members = App.cache.members || await App.db.getAll('members');
    if (!App.cache.members) App.cache.members = members;
    div.querySelector('.split-member').innerHTML = '<option value="">(mesmo)</option>' + members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  },
  renderEntries() {
    const container = document.getElementById('splitEntries');
    container.innerHTML = '';
    this.entries.forEach((entry, idx) => {
      const div = document.createElement('div');
      div.className = 'split-entry';
      div.innerHTML = `<select class="split-category" style="flex:1.5"><option value="">Categoria</option></select><select class="split-account" style="flex:1.5"><option value="">Conta</option></select><select class="split-member" style="flex:1"><option value="">Membro</option></select><input type="number" class="split-amount" step="0.01" value="${entry.amount}" style="flex:1"><button type="button" class="btn btn-ghost btn-sm" onclick="App.split.removeEntry(${idx})">✕</button>`;
      container.appendChild(div);
      this.populateSelects(div);
      setTimeout(() => {
        const selects = div.querySelectorAll('select');
        if (selects[2]) selects[2].value = entry.member || '';
      }, 20);
    });
  },
  getSplits() {
    const entries = document.querySelectorAll('.split-entry');
    return Array.from(entries).map(e => ({
      category: e.querySelector('.split-category').value,
      account_id: e.querySelector('.split-account').value,
      member_id: e.querySelector('.split-member').value || null,
      amount: parseFloat(e.querySelector('.split-amount').value) || 0
    })).filter(s => s.category && s.account_id && s.amount > 0);
  }
};
