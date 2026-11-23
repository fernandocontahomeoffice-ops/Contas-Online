// =====================================================================
// ARQUIVO: db.js
// Camada de acesso ao IndexedDB (CRUD + queries de transações)
// =====================================================================
var App = window.App || {};

App.cache = { accounts: null, members: null, categories: null, creditCards: null };
App.db = {
  _db: null,
  _suppressAutoBackup: false,

  _notifyChange(storeName, action, payload) {
    if (this._suppressAutoBackup) return;
    if (storeName === 'notifications') return;
    try {
      if (window.App && App.driveBackup && typeof App.driveBackup.scheduleAutoBackup === 'function') {
        App.driveBackup.scheduleAutoBackup(storeName, action);
      }
      if (
        (storeName === 'transactions' || storeName === 'categories') &&
        window.App && App.planning && typeof App.planning.refreshIfActive === 'function'
      ) {
        clearTimeout(this._planningSyncTimer);
        this._planningSyncTimer = setTimeout(() => {
          App.planning.refreshIfActive();
        }, 120);
      }
      if (window.App && App.aiAssistant) {
        if (storeName === 'transactions' && (action === 'put' || action === 'putMany') && typeof App.aiAssistant.onTransactionsSaved === 'function') {
          App.aiAssistant.onTransactionsSaved(payload);
        } else if ((storeName === 'transactions' || storeName === 'locais') && typeof App.aiAssistant.refreshPendingStats === 'function') {
          clearTimeout(this._aiStatsSyncTimer);
          this._aiStatsSyncTimer = setTimeout(() => {
            App.aiAssistant.refreshPendingStats();
          }, 150);
        }
      }
    } catch (e) {}
  },

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(App.config.DB_NAME, App.config.DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          const txIndexes = (App.dbSchema && App.dbSchema.TRANSACTION_INDEXES) || [
            'date', 'type', 'account_id', 'account_to_id', 'member_id',
            'credit_card_id', 'installment_id', 'status', 'reconciled', 'ignore_from_total'
          ];
          txIndexes.forEach(idx => txStore.createIndex(idx, idx, { unique: false }));
        }

        const stores = (App.dbSchema && App.dbSchema.STORES) || [
          'accounts', 'categories', 'investments', 'patrimony', 'members',
          'creditCards', 'goals', 'wishes', 'receipts', 'budgets', 'loans',
          'transactionTemplates', 'investmentHistory', 'accountHistory',
          'creditLimitHistory', 'notifications', 'receiptFolders',
          'vehicles', 'vehicleExpenses', 'previdencia', 'fontesPagadoras',
          'planosOrcamentarios', 'indicatorHistory', 'manualIncomes', 'locais', 'payrolls'
        ];
        stores.forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };

      req.onsuccess = e => {
        this._db = e.target.result;
        resolve();
      };
      req.onerror = e => reject(e);
    });
  },

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getById(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => {
        if (storeName === 'accounts') App.cache.accounts = null;
        if (storeName === 'members') App.cache.members = null;
        if (storeName === 'categories') App.cache.categories = null;
        if (storeName === 'creditCards') App.cache.creditCards = null;
        this._notifyChange(storeName, 'put', item);
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async putMany(storeName, items) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let count = 0;
      for (const item of items) {
        store.put(item);
        count++;
      }
      tx.oncomplete = () => {
        if (storeName === 'accounts') App.cache.accounts = null;
        if (storeName === 'members') App.cache.members = null;
        if (storeName === 'categories') App.cache.categories = null;
        if (storeName === 'creditCards') App.cache.creditCards = null;
        if (count > 0) this._notifyChange(storeName, 'putMany', items);
        resolve(count);
      };
      tx.onerror = () => reject(tx.error);
    });
  },

  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => {
        if (storeName === 'accounts') App.cache.accounts = null;
        if (storeName === 'members') App.cache.members = null;
        if (storeName === 'categories') App.cache.categories = null;
        if (storeName === 'creditCards') App.cache.creditCards = null;
        this._notifyChange(storeName, 'delete');
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => {
        if (storeName === 'accounts') App.cache.accounts = null;
        if (storeName === 'members') App.cache.members = null;
        if (storeName === 'categories') App.cache.categories = null;
        if (storeName === 'creditCards') App.cache.creditCards = null;
        this._notifyChange(storeName, 'clear');
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getTransactionsInRange(startDate, endDate, options = {}) {
    const { status = null, memberId = null } = options;
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('transactions', 'readonly');
      const store = tx.objectStore('transactions');
      const index = store.index('date');
      const startISO = startDate.includes('T') ? startDate : startDate;
      const endISO = endDate.includes('T') ? endDate : endDate + 'T23:59:59';
      const range = IDBKeyRange.bound(startISO, endISO);
      const results = [];

      const cursorReq = index.openCursor(range, 'next');

      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(results);
          return;
        }
        const record = cursor.value;
        if (status && record.status !== status) { cursor.continue(); return; }
        if (memberId && record.member_id !== memberId) { cursor.continue(); return; }
        results.push(record);
        cursor.continue();
      };

      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  async getTransactionsFiltered({
    startDate, endDate, type, accountId, accountToId,
    memberId, creditCardId, status, reconciled, sortBy = 'date',
    sortAsc = false, limit = 50, offset = 0,
    skipCount = false, preCount = null
  }) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('transactions', 'readonly');
      const store = tx.objectStore('transactions');
      const index = store.index('date');
      const rangeStart = startDate || '';
      const rangeEnd = (endDate || '') + (endDate?.includes('T') ? '' : 'T23:59:59');
      const range = IDBKeyRange.bound(rangeStart, rangeEnd);

      const matchesFilters = (record) => {
        if (type && type !== 'all' && record.type !== type) return false;
        if (accountId && accountId !== 'all' && record.account_id !== accountId && record.account_to_id !== accountId) return false;
        if (memberId && memberId !== 'all' && record.member_id !== memberId) return false;
        if (creditCardId && creditCardId !== 'all' && record.credit_card_id !== creditCardId) return false;
        if (status && record.status !== status) return false;
        if (reconciled !== undefined && record.reconciled !== reconciled) return false;
        const recordDateOnly = record.date.slice(0,10);
        if (startDate) {
          const startDateOnly = startDate.includes('T') ? startDate.slice(0,10) : startDate;
          if (recordDateOnly < startDateOnly) return false;
        }
        if (endDate) {
          const endDateOnly = endDate.includes('T') ? endDate.slice(0,10) : endDate;
          if (recordDateOnly > endDateOnly) return false;
        }
        return true;
      };

      // Se skipCount for true, usa o total fornecido e busca apenas a página (sem recontagem)
      if (skipCount && preCount !== null) {
        const direction = sortAsc ? 'next' : 'prev';
        let pageData = [];
        let skip = offset;
        let dataCursorReq = index.openCursor(range, direction);

        dataCursorReq.onsuccess = (ev) => {
          const dataCursor = ev.target.result;
          if (!dataCursor) {
            resolve({ total: preCount, data: pageData });
            return;
          }
          const record = dataCursor.value;
          if (matchesFilters(record)) {
            if (skip > 0) {
              skip--;
              dataCursor.continue();
            } else {
              pageData.push(record);
              if (pageData.length >= limit) {
                resolve({ total: preCount, data: pageData });
                return;
              }
              dataCursor.continue();
            }
          } else {
            dataCursor.continue();
          }
        };
        dataCursorReq.onerror = () => reject(dataCursorReq.error);
        return;
      }

      // Caso contrário, fluxo normal com contagem completa + página
      if (sortBy === 'date') {
        const direction = sortAsc ? 'next' : 'prev';
        let totalCount = 0;
        let countCursorReq = index.openCursor(range, direction);

        countCursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (matchesFilters(cursor.value)) {
              totalCount++;
            }
            cursor.continue();
          } else {
            let pageData = [];
            let skip = offset;
            let dataCursorReq = index.openCursor(range, direction);

            dataCursorReq.onsuccess = (ev) => {
              const dataCursor = ev.target.result;
              if (!dataCursor) {
                resolve({ total: totalCount, data: pageData });
                return;
              }
              const record = dataCursor.value;
              if (matchesFilters(record)) {
                if (skip > 0) {
                  skip--;
                  dataCursor.continue();
                } else {
                  pageData.push(record);
                  if (pageData.length >= limit) {
                    resolve({ total: totalCount, data: pageData });
                    return;
                  }
                  dataCursor.continue();
                }
              } else {
                dataCursor.continue();
              }
            };
            dataCursorReq.onerror = () => reject(dataCursorReq.error);
          }
        };
        countCursorReq.onerror = () => reject(countCursorReq.error);
        return;
      }

      const results = [];
      let fullCursorReq = index.openCursor(range, sortAsc ? 'next' : 'prev');

      fullCursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          if (sortBy !== 'date') {
            results.sort((a, b) => {
              let va = a[sortBy] || '', vb = b[sortBy] || '';
              if (sortBy === 'amount') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
              return (va < vb ? -1 : va > vb ? 1 : 0) * (sortAsc ? 1 : -1);
            });
          }
          const total = results.length;
          const page = results.slice(offset, offset + limit);
          resolve({ total, data: page });
          return;
        }
        const record = cursor.value;
        if (matchesFilters(record)) {
          results.push(record);
        }
        cursor.continue();
      };
      fullCursorReq.onerror = () => reject(fullCursorReq.error);
    });
  },

  async getTransactionsCount(filters) {
    const all = await this.getAll('transactions');
    let filtered = all;
    if (filters.startDate) {
      const startDateOnly = filters.startDate.includes('T') ? filters.startDate.slice(0,10) : filters.startDate;
      filtered = filtered.filter(t => t.date.slice(0,10) >= startDateOnly);
    }
    if (filters.endDate) {
      const endDateOnly = filters.endDate.includes('T') ? filters.endDate.slice(0,10) : filters.endDate;
      filtered = filtered.filter(t => t.date.slice(0,10) <= endDateOnly);
    }
    if (filters.type && filters.type !== 'all') filtered = filtered.filter(t => t.type === filters.type);
    if (filters.accountId && filters.accountId !== 'all') filtered = filtered.filter(t => t.account_id === filters.accountId || t.account_to_id === filters.accountId);
    if (filters.memberId && filters.memberId !== 'all') filtered = filtered.filter(t => t.member_id === filters.memberId);
    if (filters.creditCardId && filters.creditCardId !== 'all') filtered = filtered.filter(t => t.credit_card_id === filters.creditCardId);
    if (filters.status) filtered = filtered.filter(t => t.status === filters.status);
    if (filters.reconciled !== undefined) filtered = filtered.filter(t => t.reconciled === filters.reconciled);
    return filtered.length;
  },

  async seedIfEmpty() {
    const cats = await this.getAll('categories');
    if (cats.length === 0) {
      for (const c of App.config.CATS_EXP) {
        const classification = App.config.CLASSIFICATION_MAP[c] || 'necessary';
        const color = App.config.CAT_COLORS[c] || App.config.COLORS[Math.floor(Math.random() * App.config.COLORS.length)];
        await this.put('categories', { id: App.utils.generateId(), name: c, type: 'expense', classification, parent_id: null, color, archived: false });
      }
      for (const c of App.config.CATS_INC) {
        const color = App.config.CAT_COLORS[c] || '#2ecc71';
        await this.put('categories', { id: App.utils.generateId(), name: c, type: 'income', classification: '', parent_id: null, color, archived: false });
      }
    } else {
      for (const cat of cats) {
        let updated = false;
        if (!cat.classification) { cat.classification = App.config.CLASSIFICATION_MAP[cat.name] || (cat.type === 'expense' ? 'necessary' : ''); updated = true; }
        if (cat.parent_id === undefined) { cat.parent_id = null; updated = true; }
        if (cat.archived === undefined) { cat.archived = false; updated = true; }
        if (!cat.color) { cat.color = App.config.CAT_COLORS[cat.name] || '#95a5a6'; updated = true; }
        if (updated) await this.put('categories', cat);
      }
    }

    // Categorias adicionais que sempre devem existir (importação de cartão etc.)
    const extraCategories = [
      { name: 'Uber & Transporte', classification: 'necessary', color: '#2980b9' },
      { name: 'Carro - Despesas', classification: 'necessary', color: '#e67e22' },
      { name: 'Lanches & Ifood', classification: 'superfluous', color: '#f39c12' },
      { name: 'Eletrodomesticos', classification: 'necessary', color: '#c0392b' },
      { name: 'Pet', classification: 'essential', color: '#27ae60' },
      { name: 'Mercado Básico Mensal', classification: 'essential', color: '#2ecc71' },
      { name: 'Mercado(Não Essenciais)', classification: 'superfluous', color: '#95a5a6' },
      { name: 'Despesas Residenciais', classification: 'essential', color: '#16a085' },
      { name: 'Carro - Combustível', classification: 'necessary', color: '#d35400' },
      { name: 'Presentes', classification: 'superfluous', color: '#e74c3c' },
      { name: 'Carro - Manutenção', classification: 'necessary', color: '#f1c40f' },
      { name: 'Passeios & Restaurantes', classification: 'superfluous', color: '#8e44ad' },
      { name: 'Empréstimos Terceiros', classification: 'necessary', color: '#c0392b' },
      { name: 'Aporte', classification: 'necessary', color: '#2ecc71' },
      { name: 'Resgate', classification: 'necessary', color: '#e67e22' }
    ];
    for (const cat of extraCategories) {
      const exists = cats.some(c => c.name.toLowerCase() === cat.name.toLowerCase());
      if (!exists) {
        await this.put('categories', {
          id: App.utils.generateId(),
          name: cat.name,
          type: 'expense',
          classification: cat.classification,
          parent_id: null,
          color: cat.color,
          archived: false
        });
      }
    }

    if ((await this.getAll('accounts')).length === 0) {
      const defaultMember = (await this.getAll('members'))[0];
      await this.put('accounts', {
        id: App.utils.generateId(), name: 'Conta Principal', type: 'checking',
        member_id: defaultMember ? defaultMember.id : null,
        archived: false, balance: 0, initial_balance: 0, exclude_from_total: false
      });
    }
  },

  async preloadCache() {
    App.cache.accounts = await this.getAll('accounts');
    App.cache.members = await this.getAll('members');
    App.cache.categories = await this.getAll('categories');
    App.cache.creditCards = await this.getAll('creditCards');
  }
};