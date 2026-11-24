// =====================================================================
// ARQUIVO: ui.js
// Interface do usuário: modais, navegação, FAB, sidebar, métricas
// =====================================================================
var App = window.App || {};

  // =======================================================================
  // UI – interface do usuário (modais, navegação, FAB, Sidebar)
  // =======================================================================
  App.ui = {
    navigateTo(page) {
      // Expande a sidebar automaticamente se estiver no modo mini
      const sidebar = document.getElementById('sidebar');
      const main = document.getElementById('mainContent');
      if (sidebar.classList.contains('mini')) {
        sidebar.classList.remove('mini');
        if (main) main.classList.remove('expanded');
      }

      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('active'));

      // Se a página fornecida for inválida ou vazia, mostra a página de fallback
      const targetPage = page || 'empty';
      const pg = document.getElementById('page-' + targetPage);
      if (pg) pg.classList.add('active');

      const btn = document.querySelector(`[data-page="${page}"]`);
      if (btn) btn.classList.add('active');
      document.getElementById('sidebar').classList.remove('open');
      const loaders = {
        'dashboard': () => App.dashboard.refresh(),
        'panel': () => App.panel.refresh(),
        'saldos': () => App.saldos.load(),
        'projection': () => App.projection.load(),
        'patrimony-evolution': () => App.patrimonyEvolution.load(),
        'tabela': () => App.tabela.load(),
        'transactions': () => App.transactions.load(),
        'financial-history': () => App.financialHistory.load(),
        'transaction-stats': () => App.transactions.loadTransactionStats(),
        'search': () => App.search.load(),
        'extracts': () => App.extracts.load(),
        'credit-cards': () => App.creditCards.load(),
        'card-sheet': () => App.cardSheet && App.cardSheet.load(),
        'installments': () => App.installments.load(),
        'investments': () => App.investments.load(),
        'patrimony': () => App.patrimony.load(),
        'metrics': () => App.metrics.load(),
        'members': () => App.members.load(),
        'accounts': () => App.accounts.load(),
        'account-detail': () => { if (App.accountDetail.currentId) App.accountDetail.render(); },
        'card-history': () => App.cardHistory.load(),
        'card-invoice': () => { if (App.cardInvoice.currentCardId) App.cardInvoice.load(); },
        'invoice-stats': () => { if (App.cardInvoice.currentCardId) App.cardInvoice.loadInvoiceStats(); },
        'loan-detail': () => { if (App.loanDetail.currentLoanId) App.loanDetail.render(); },
        'loan-history': () => App.loans.loadPersonHistory(),        'balance-detail': () => App.balanceDetail.load(),
        'income-detail': () => App.incomeDetail.load(),
        'expense-detail': () => App.expenseDetail.load(),
        'costofliving-detail': () => App.costoflivingDetail.load(),
        'reconciliation': () => App.reconciliation.load(),
        'reports': () => App.reports.init(),
        'loans': () => App.loans.load(),
        'goals': () => App.goals.load(),
        'wishes': () => App.wishes.load(),
        'categorization': () => App.categorization.load(),
        'classifications': () => App.classification.load(),
        'subcategories': () => { if (App.subcategories.currentParentId) App.subcategories.load(App.subcategories.currentParentId); },
        'planning': () => App.planning.load(),
        'planning-detail': () => App.planning.renderPlanDetail(),
        'acompanhamento': () => App.planning.renderAcompanhamento(),
        'templates': () => App.templates.load(),
        'cashflow': () => App.cashflow.load(),
        'achievements': () => App.achievements.load(),
        'annual': () => App.annual.load(),
        'analytics': () => App.analytics.refresh(),
        'analytics-detail': () => App.analyticsDetail.load(),
        'analytics-annual': () => App.analyticsAnnual.load(),
        'member-detail': () => { if (App.memberDetail.currentMemberId) App.memberDetail.render(); },
        'notifications': () => App.notifications.load(),
        'data-io': () => { if (App.driveBackup && App.driveBackup.onPageOpen) App.driveBackup.onPageOpen(); },
        'downloads': () => App.downloads.load(),
        'vehicles': () => App.vehicles.load(),
        'vehicle-detail': () => { if (App.vehicles.currentVehicleId) App.vehicles.loadDetail(); },
        'all-installments': () => App.installments.renderAllMonthsPage(),
        'previdencia': () => App.previdencia.load(),
  'fontes-pagadoras': () => App.fontesPagadoras.load(),
        'desassociacao': () => App.desassociacao.load(),
        'locais': () => App.locais.load(),
        'gemini': () => App.gemini && App.gemini.load(),
        'melhoria': () => App.melhoria && App.melhoria.load()
      };
      if (loaders[page]) loaders[page]();
      if (page && page !== 'empty') {
        sessionStorage.setItem('lastPage', page);
      }
      this._currentPage = page;

      // Se estamos saindo da tela de detalhe, limpa o estado para não reaparecer depois
      if (page !== 'loan-detail' && App.loanDetail) {
        App.loanDetail._fromHistory = false;
        App.loanDetail.currentLoanId = null;
      }

      if (App.fab && App.fab.updateVisibility) App.fab.updateVisibility();
    },

    openModal(id) {
      document.getElementById(id).classList.add('open');
      document.body.style.overflow = 'hidden';
    },

    closeModal(id, skipConfirmation = false) {
      if (!skipConfirmation && id === 'modalTransaction' && this._formChanged) {
        App.utils.confirm('Tem certeza que deseja sair sem salvar?', () => {
          document.getElementById(id).classList.remove('open');
          document.body.style.overflow = '';
          this._formChanged = false;
        });
      } else {
        document.getElementById(id).classList.remove('open');
        document.body.style.overflow = '';
        this._formChanged = false;
      }
    },

    toggleSaldoVisibility(elementId) {
      const el = document.getElementById(elementId);
      if (!el) return;
      el.style.filter = el.style.filter === 'blur(4px)' ? '' : 'blur(4px)';
    },

    toggleAllOvalores(iconEl) {
      if (App.dashboard && typeof App.dashboard.toggleValores === 'function') {
        App.dashboard.toggleValores();
        if (iconEl) {
          iconEl.textContent = App.dashboard._valoresOcultos ? '🙈' : '👁️';
          iconEl.title = App.dashboard._valoresOcultos ? 'Mostrar valores' : 'Ocultar valores';
        }
      }
    },

  async populateAccounts(sel, types = []) {
      if (!sel) return;
      // Força a consulta ao banco para obter sempre a lista mais recente
      const accounts = await App.db.getAll('accounts');
      App.cache.accounts = accounts;      // atualiza o cache global
      const members = App.cache.members || await App.db.getAll('members');
      if (!App.cache.members) App.cache.members = members;
      const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
      let filtered = types.length
          ? accounts.filter(a => types.includes(a.type) && !a.archived)
          : accounts.filter(a => !a.archived);
      sel.innerHTML = filtered
          .map(a => `<option value="${a.id}">${a.name} (${memberMap[a.member_id] || ''})</option>`)
          .join('');
  },

    async populateInvestments(sel) {
      if (!sel) return;
      const invs = await App.db.getAll('investments');
      sel.innerHTML = '<option value="">--</option>' + invs.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    },

    async populateMembers(sel) {
      if (!sel) return;
      const members = App.cache.members || await App.db.getAll('members');
      if (!App.cache.members) App.cache.members = members;
      sel.innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    },

    async populateReceiptFolders(sel) {
      if (!sel) return;
      const folders = await App.db.getAll('receiptFolders');
      sel.innerHTML = '<option value="">(sem pasta)</option>' + folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    },

    async populateCreditCards(sel) {
      if (!sel) return;
      // Força consulta ao banco para obter sempre a lista mais recente
      const cards = await App.db.getAll('creditCards');
      App.cache.creditCards = cards;
      sel.innerHTML = '<option value="">Nenhum</option>' + cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    },

    async populatePaymentMethodWithFontes(sel, type) {
      if (!sel) return;
      const methods = [
        { value: '', label: '--' },
        { value: 'pix', label: 'Pix' },
        { value: 'credit_card', label: 'Crédito' },
        { value: 'debit_card', label: 'Débito' },
        { value: 'cash', label: 'Dinheiro' },
        { value: 'transfer', label: 'Transferência' }
      ];
      let options = methods.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
      if (type === 'income') {
        const fontes = await App.db.getAll('fontesPagadoras');
        if (fontes.length > 0) {
          options += '<optgroup label="Fontes Pagadoras">';
          options += fontes.map(f => `<option value="fp_${f.id}">📋 ${f.razao_social}</option>`).join('');
          options += '</optgroup>';
        }
      }
      sel.innerHTML = options;
    },

    // Preenche o container de membros da divisão no modal de membro
    populateSplitMembers(member = null) {
      const container = document.getElementById('memSplitMembers');
      if (!container) return;
      const members = App.cache.members || [];
      const splitTo = (member && member.split_to) ? member.split_to : [];
      let html = '';
      splitTo.forEach((sp, idx) => {
        const m = members.find(m => m.id === sp.id);
        html += `<div class="form-row" style="margin-bottom:6px;">
          <select class="splitMemberSelect" data-index="${idx}" style="flex:1;">
            ${members.map(m => `<option value="${m.id}" ${m.id === sp.id ? 'selected' : ''}>${m.name}</option>`).join('')}
          </select>
          <input type="number" class="splitMemberRatio" data-index="${idx}" value="${sp.ratio}" min="1" max="99" style="width:70px;">%
          <button type="button" class="btn btn-ghost btn-sm" onclick="App.members.removeSplitMember(${idx})">✕</button>
        </div>`;
      });
      container.innerHTML = html;
      document.getElementById('memSplitConfig').style.display =
        (member && member.name === 'Casal') ? 'block' : 'none';
    },

    async openTransactionModal(tx = null, forceType = null, isSplit = false, prefillCardId = null) {
      try {
        this._formChanged = false;
        const safeVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const safeCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
        safeVal('txId', tx?.id || '');
        document.getElementById('modalTransactionTitle').textContent = tx ? 'Editar' : 'Nova Transação';
        const type = forceType || (tx ? tx.type : 'expense');
        
        // Se for edição (tx existe), restringe as opções do tipo e bloqueia o campo
        if (tx) {
          const txTypeSelect = document.getElementById('txType');
          if (txTypeSelect) {
            const typeOptions = {
              income: `<option value="income">Receita</option><option value="contribution">Aporte</option>`,
              expense: `<option value="expense">Despesa</option><option value="withdrawal">Resgate</option>`,
              transfer: `<option value="transfer">Transferência</option>`,
              contribution: `<option value="contribution">Aporte</option>`,
              withdrawal: `<option value="withdrawal">Resgate</option>`,
              refund: `<option value="refund">Estorno</option>`
            };
            txTypeSelect.innerHTML = typeOptions[tx.type] || typeOptions.expense;
            txTypeSelect.value = tx.type;
            txTypeSelect.disabled = true;
          }
        } else {
          safeVal('txType', type);
        }
        
        // Em modo de edição (tx não nulo), travar o tipo para preservar a natureza original da transação
        const txTypeSelect = document.getElementById('txType');
        if (tx && txTypeSelect) {
          txTypeSelect.disabled = true;   // impede alteração do tipo
          // Garante que as opções exibidas correspondam ao tipo original, evitando confusão
          // (o select foi populado no HTML com todas as opções; ao desabilitar, o usuário vê o valor correto mas não pode mudar)
        }

        const rawAmount = tx?.amount;
        if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
          const numericAmount = App.utils.parseFloatLocale(String(rawAmount));
          safeVal('txAmount', isNaN(numericAmount) ? '' : numericAmount.toFixed(2));
        } else {
          safeVal('txAmount', '');
        }
        const dateVal = tx?.date || App.utils.todayISO();
        const datePart = dateVal.split('T')[0];
        const timePart = dateVal.includes('T') ? dateVal.split('T')[1].substring(0,5) : '';
        safeVal('txDate', datePart);
        safeVal('txTime', timePart);
        safeVal('txDescription', tx?.description || '');
        safeVal('txNotes', tx?.notes || '');
        safeVal('txInstallments', tx?.installments || 1);
        safeVal('txPurchaseDate', tx?.purchase_date || '');
        safeVal('txPaymentMethod', tx?.payment_method || '');
        safeVal('txClassification', tx?.classification || '');
        safeVal('txReceiptUrl', tx?.receipt_url || '');
        safeVal('txStatus', tx?.status || 'confirmed');
        safeVal('txReconciled', tx?.reconciled ? 'true' : 'false');
        safeCheck('txRecurring', tx?.recurring || tx?.is_recurring_series || false);
        safeCheck('txAddAsset', false);
        safeCheck('txVacation', tx?.vacation || false);
        safeCheck('txIsLoan', !!tx?.loan_id);
        safeCheck('txIgnoreFromTotal', tx?.ignore_from_total || false);
        safeVal('txIsSplit', isSplit ? 'true' : 'false');
        safeVal('txExpenseType', tx?.expense_type || 'single');
        // Garante que o campo de parcelas apareça quando a transação for parcelada
        const expenseTypeSelect = document.getElementById('txExpenseType');
        const installmentRowEl = document.getElementById('installmentRow');
        if (expenseTypeSelect && installmentRowEl) {
          const shouldShowInstallments = (tx && (tx.installments > 1 || tx.expense_type === 'installment'));
          if (shouldShowInstallments) {
            expenseTypeSelect.value = 'installment';
            installmentRowEl.style.display = 'flex';
          } else {
            installmentRowEl.style.display = 'none';
          }
          // Remove listener antigo para evitar duplicação
          const oldListener = expenseTypeSelect.dataset.listener;
          if (oldListener) {
            expenseTypeSelect.removeEventListener('change', window[oldListener]);
          }
          // Cria novo listener e armazena referência
          const changeHandler = () => {
            if (expenseTypeSelect.value === 'installment') {
              installmentRowEl.style.display = 'flex';
              const purchaseDateInput = document.getElementById('txPurchaseDate');
              if (purchaseDateInput && !purchaseDateInput.value) {
                purchaseDateInput.value = document.getElementById('txDate').value;
              }
            } else {
              installmentRowEl.style.display = 'none';
            }
          };
          expenseTypeSelect.addEventListener('change', changeHandler);
          // Guarda referência para remoção futura
          expenseTypeSelect.dataset.listener = '_expenseTypeHandler';
          window._expenseTypeHandler = changeHandler;
        }
        safeVal('txTransferSubtype', tx?.transfer_subtype || 'normal');
        const subtype = document.getElementById('txTransferSubtype')?.value;
        const investmentGroup = document.getElementById('txInvestmentGroup');
        if (investmentGroup) {
          investmentGroup.style.display = (subtype === 'aporte' || subtype === 'resgate') ? 'block' : 'none';
        }
        // Se for transferência de aporte/resgate, oculta categoria e define valor automaticamente
        if (type === 'transfer') {
          if (subtype === 'aporte' || subtype === 'resgate') {
            const categoryGroup = document.getElementById('txCategory')?.closest('.form-group');
            if (categoryGroup) categoryGroup.style.display = 'none';
            document.getElementById('txCategory').value = subtype === 'aporte' ? 'Aporte' : 'Resgate';
          }
        }
        if (tx?.recurring || tx?.is_recurring_series) {
          document.getElementById('recurringTimes').style.display = '';
          safeVal('txRecurringTimes', tx?.recurring_times || 12);
        } else {
          document.getElementById('recurringTimes').style.display = 'none';
          safeVal('txRecurringTimes', 12);
        }
        const cycle = App.utils.monthRangeFromDate(datePart);
        document.getElementById('txCycleMonth').value = cycle.start.slice(0, 7);

        if (document.getElementById('txAccount')) {
          await this.populateAccounts(document.getElementById('txAccount'));
          if (tx && tx.account_id) {
            const accSel = document.getElementById('txAccount');
            if (!accSel.querySelector(`option[value="${tx.account_id}"]`)) {
              const allAccounts = App.cache.accounts || await App.db.getAll('accounts');
              if (!App.cache.accounts) App.cache.accounts = allAccounts;
              const origAcc = allAccounts.find(a => a.id === tx.account_id);
              if (origAcc) {
                const members = App.cache.members || await App.db.getAll('members');
                if (!App.cache.members) App.cache.members = members;
                const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
                const opt = document.createElement('option');
                opt.value = origAcc.id;
                opt.textContent = `${origAcc.name} (${memberMap[origAcc.member_id] || ''})`;
                accSel.appendChild(opt);
              }
            }
            document.getElementById('txAccount').value = tx.account_id;
          }
        }

        if (document.getElementById('txAccountTo')) {
          await this.populateAccounts(document.getElementById('txAccountTo'));
          if (tx && tx.account_to_id) {
            const accToSel = document.getElementById('txAccountTo');
            if (!accToSel.querySelector(`option[value="${tx.account_to_id}"]`)) {
              const allAccounts = App.cache.accounts || await App.db.getAll('accounts');
              if (!App.cache.accounts) App.cache.accounts = allAccounts;
              const origToAcc = allAccounts.find(a => a.id === tx.account_to_id);
              if (origToAcc) {
                const members = App.cache.members || await App.db.getAll('members');
                if (!App.cache.members) App.cache.members = members;
                const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
                const opt = document.createElement('option');
                opt.value = origToAcc.id;
                opt.textContent = `${origToAcc.name} (${memberMap[origToAcc.member_id] || ''})`;
                accToSel.appendChild(opt);
              }
            }
            document.getElementById('txAccountTo').value = tx.account_to_id;
          }
        }

        if (document.getElementById('txMember')) {
          await this.populateMembers(document.getElementById('txMember'));
          if (tx) document.getElementById('txMember').value = tx.member_id || '';
          const txMemberSelect = document.getElementById('txMember');
          txMemberSelect.addEventListener('change', () => {
            this._memberChangedByUser = true;
            this.onTxMemberChange();
          });
        }

        if (document.getElementById('txInvestment')) {
          await this.populateInvestments(document.getElementById('txInvestment'));
          if (tx) document.getElementById('txInvestment').value = tx.investment_id || '';
        }
        this.onTxTypeChange();
        // Restaura valor do método de pagamento ou fonte pagadora
        if (tx) {
          const methodSel = document.getElementById('txPaymentMethod');
          if (methodSel) {
            if (tx.fonte_pagadora_id) {
              methodSel.value = 'fp_' + tx.fonte_pagadora_id;
            } else if (tx.payment_method) {
              methodSel.value = tx.payment_method;
            }
          }
        }

        // --- PRESERVA valores originais após repopulação das listas ---
        if (tx) {
          // Aguarda um pequeno intervalo para garantir que todos os selects foram populados
          await new Promise(resolve => setTimeout(resolve, 50));

          const members = App.cache.members || await App.db.getAll('members');
          const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

          // Garante que a conta de origem esteja disponível e selecionada
          const accSel = document.getElementById('txAccount');
          if (accSel && tx.account_id) {
            // Força a recarga das contas caso a lista esteja vazia ou não contenha o id
            if (!accSel.querySelector(`option[value="${tx.account_id}"]`)) {
              const allAcc = await App.db.getAll('accounts');
              App.cache.accounts = allAcc;
              await this.populateAccounts(accSel);
              const orig = allAcc.find(a => a.id === tx.account_id);
              if (orig && !accSel.querySelector(`option[value="${tx.account_id}"]`)) {
                const opt = document.createElement('option');
                opt.value = orig.id;
                opt.textContent = `${orig.name} (${memberMap[orig.member_id] || ''})`;
                accSel.appendChild(opt);
              }
            }
            accSel.value = tx.account_id;
          }

          // Conta destino (se houver)
          const accToSel = document.getElementById('txAccountTo');
          if (accToSel && tx.account_to_id) {
            if (!accToSel.querySelector(`option[value="${tx.account_to_id}"]`)) {
              const allAcc = App.cache.accounts || await App.db.getAll('accounts');
              const origTo = allAcc.find(a => a.id === tx.account_to_id);
              if (origTo) {
                const opt = document.createElement('option');
                opt.value = origTo.id;
                opt.textContent = `${origTo.name} (${memberMap[origTo.member_id] || ''})`;
                accToSel.appendChild(opt);
              }
            }
            accToSel.value = tx.account_to_id;
          }

          // Categoria – repopula se necessário
          const catSel = document.getElementById('txCategory');
          if (catSel && tx.category) {
            if (!catSel.querySelector(`option[value="${tx.category}"]`)) {
              const opt = document.createElement('option');
              opt.value = tx.category;
              opt.textContent = tx.category;
              catSel.appendChild(opt);
            }
            catSel.value = tx.category;
          }

          // Membro
          const memSel = document.getElementById('txMember');
          if (memSel && tx.member_id) {
            if (!memSel.querySelector(`option[value="${tx.member_id}"]`)) {
              const origMem = members.find(m => m.id === tx.member_id);
              if (origMem) {
                const opt = document.createElement('option');
                opt.value = origMem.id;
                opt.textContent = origMem.name;
                memSel.appendChild(opt);
              }
            }
            memSel.value = tx.member_id;
          }

          // Método de pagamento
          const methodSel = document.getElementById('txPaymentMethod');
          if (methodSel && tx.payment_method) {
            methodSel.value = tx.payment_method;
          }

          // Cartão de crédito (se aplicável)
          const ccSel = document.getElementById('txCreditCard');
          if (ccSel && tx.credit_card_id) {
            ccSel.value = tx.credit_card_id;
          }
        }

        App.transactions.updateEndividamentoHint();
        await this.populateCreditCards(document.getElementById('txCreditCard'));
        const ccSel = document.getElementById('txCreditCard');
        if (ccSel && tx?.credit_card_id) ccSel.value = tx.credit_card_id;
        else if (prefillCardId) ccSel.value = prefillCardId;

        // Armazena o estado original de disabled (para uso em updateCardSplitVisibility)
        if (ccSel) {
          ccSel.dataset.originalDisabled = ccSel.disabled ? 'true' : 'false';
        }
        const accountSelectForState = document.getElementById('txAccount');
        if (accountSelectForState) {
          accountSelectForState.dataset.originalDisabled = accountSelectForState.disabled ? 'true' : 'false';
        }

        this._memberChangedByUser = false;
              // ---- NOVO: listener para preencher conta automaticamente ao escolher um cartão ----
        const ccSelect = document.getElementById('txCreditCard');
        const accountSelect = document.getElementById('txAccount');
        if (ccSelect && accountSelect && (type === 'expense' || type === 'refund')) {
          const updateAccountFromCard = async () => {
            const selectedCardId = ccSelect.value;
            if (!selectedCardId) return;
            const card = await App.db.getById('creditCards', selectedCardId);
            if (card && card.account_id) {
              // Garante que a conta esteja presente no select
              if (!accountSelect.querySelector(`option[value="${card.account_id}"]`)) {
                const accounts = App.cache.accounts || await App.db.getAll('accounts');
                const acc = accounts.find(a => a.id === card.account_id);
                if (acc) {
                  const members = App.cache.members || await App.db.getAll('members');
                  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
                  const opt = document.createElement('option');
                  opt.value = acc.id;
                  opt.textContent = `${acc.name} (${memberMap[acc.member_id] || ''})`;
                  accountSelect.appendChild(opt);
                }
              }
              accountSelect.value = card.account_id;
              accountSelect.disabled = true; // 🔒 Trava a conta após selecionar o cartão
            }
          };
          ccSelect.addEventListener('change', updateAccountFromCard);
          // Se já houver um cartão pré‑selecionado, dispara a atualização imediatamente
          if (ccSelect.value) updateAccountFromCard();
        }
        // ---- FIM DO NOVO ----
        document.getElementById('splitSection').style.display = isSplit ? 'block' : 'none';
        document.getElementById('splitEntries').innerHTML = '';
        if (isSplit) App.split.entries = [];
        App.split.init();

        // Listener para detectar alterações no formulário
        const form = document.getElementById('formTransaction');
        form.querySelectorAll('input, select, textarea').forEach(el => {
          el.addEventListener('change', () => { this._formChanged = true; });
          el.addEventListener('input', () => { this._formChanged = true; });
        });

        // Garante que o método de pagamento fique visível em transações normais
        const pmGroup = document.getElementById('txPaymentMethod')?.closest('.form-row');
        if (pmGroup) pmGroup.style.display = 'flex';
        // Garante que a conta de origem esteja visível, a menos que seja um modal de cartão
        if (!this._cardEditMode) {
          const accEl = document.getElementById('txAccount');
          if (accEl) {
            const accGroup = accEl.parentNode;
            if (accGroup && accGroup.classList.contains('form-group')) {
              accGroup.style.display = 'block';
            }
          }
        }

        this.initMemberSplit();
        if (tx && Array.isArray(tx.member_splits) && tx.member_splits.length > 0) {
          this._restoreMemberSplit(tx);
        }
        
        // Resetar divisão entre cartões
        this._cardSplitData = [];
        const cardSplitCheckbox = document.getElementById('txCardSplit');
        if (cardSplitCheckbox) cardSplitCheckbox.checked = false;
        const cardSplitSection = document.getElementById('cardSplitSection');
        if (cardSplitSection) cardSplitSection.style.display = 'none';
        this.updateCardSplitVisibility();
        this.renderCardSplitList();

        // Listener para atualizar a visibilidade da divisão ao trocar o método de pagamento
        const paymentMethodSelect = document.getElementById('txPaymentMethod');
        if (paymentMethodSelect) {
          paymentMethodSelect.removeEventListener('change', this._updateCardSplitVisibilityHandler);
          this._updateCardSplitVisibilityHandler = () => this.updateCardSplitVisibility();
          paymentMethodSelect.addEventListener('change', this._updateCardSplitVisibilityHandler);
        }

        this.openModal('modalTransaction');
      } catch (e) {
        console.error('Erro ao abrir modal:', e);
        App.utils.showToast('Erro ao abrir formulário.', 'error');
      }
    },

    async openTransactionModalWithType(type, preselectAccountId = null) {
      await this.openTransactionModal(null, type, false);
      if (preselectAccountId) {
        const accEl = document.getElementById('txAccount');
        if (accEl) {
          accEl.value = preselectAccountId;
          accEl.dispatchEvent(new Event('change'));
        }
      }
    },

    async openTypedModal(type) {
      // Abre modal com tipo fixo, sem permitir alteração
      await this.openTransactionModal(null, type, type === 'split');
      const txTypeSelect = document.getElementById('txType');
      const txCategoryGroup = document.getElementById('txCategory').closest('.form-group'); // grupo da categoria

      // Configura tipos permitidos conforme o modal
      if (type === 'income') {
        // Nova Receita: apenas Receita e Aporte
        txTypeSelect.innerHTML = `
          <option value="income">Receita</option>
          <option value="contribution">Aporte</option>
        `;
        txTypeSelect.disabled = false;
        document.getElementById('splitSection').style.display = 'none';
        document.getElementById('txIsSplit').value = 'false';
      } else if (type === 'expense') {
        // Nova Despesa: apenas Despesa e Resgate
        txTypeSelect.innerHTML = `
          <option value="expense">Despesa</option>
          <option value="withdrawal">Resgate</option>
        `;
        txTypeSelect.disabled = false;
        document.getElementById('splitSection').style.display = 'none';
        document.getElementById('txIsSplit').value = 'false';
      } else if (type === 'transfer') {
        // Nova Transferência: apenas Transferência, sem categoria
        txTypeSelect.innerHTML = `<option value="transfer">Transferência</option>`;
        txTypeSelect.disabled = true;
        document.getElementById('splitSection').style.display = 'none';
        document.getElementById('txIsSplit').value = 'false';
        if (txCategoryGroup) txCategoryGroup.style.display = 'none';
        const transferSubtypeGroup = document.getElementById('txTransferSubtypeGroup');
        if (transferSubtypeGroup) transferSubtypeGroup.style.display = 'block';
      } else if (type === 'split') {
        // Split: mantém opções originais, split visível
        txTypeSelect.disabled = false;
      } else {
        // Demais (contribution, withdrawal, refund): tipo fixo, split escondido
        txTypeSelect.disabled = true;
        document.getElementById('splitSection').style.display = 'none';
        document.getElementById('txIsSplit').value = 'false';
      }

      // Reaplica lógica de exibição dos campos após mudar tipo
      this.onTxTypeChange();

      // Define o título do modal de acordo com o tipo
      const titles = {
        income: 'Nova Receita',
        expense: 'Nova Despesa',
        transfer: 'Nova Transferência',
        contribution: 'Novo Aporte',
        withdrawal: 'Novo Resgate',
        split: 'Nova Transação Dividida',
        refund: 'Novo Estorno'
      };
      const modalTitle = document.getElementById('modalTransactionTitle');
      if (modalTitle) {
        modalTitle.textContent = titles[type] || 'Nova Transação';
      }
    },

      async openCardTransactionModal(cardId) {
      await this.openTransactionModal(null, 'expense', false, cardId);
      const card = cardId ? await App.db.getById('creditCards', cardId) : null;
      const isPrepaid = card && card.card_type === 'prepaid';
      const txTypeSelect = document.getElementById('txType');
      txTypeSelect.innerHTML = '<option value="expense">Despesa</option><option value="refund">Estorno</option>';
      txTypeSelect.disabled = false;
      document.getElementById('splitSection').style.display = 'none';
      document.getElementById('txIsSplit').value = 'false';
      // Fixa método de pagamento conforme tipo do cartão
      const paymentSel = document.getElementById('txPaymentMethod');
      if (isPrepaid) {
        paymentSel.innerHTML = '<option value="vale_alimentacao">Vale Alimentação</option>';
      } else {
        paymentSel.innerHTML = '<option value="credit_card">Crédito</option>';
      }
      paymentSel.disabled = true;
      document.getElementById('modalTransactionTitle').textContent = isPrepaid ? 'Nova Despesa no Cartão Pré‑pago' : 'Nova Despesa no Cartão';

      // Força status pendente (compras no cartão são efetivadas apenas no pagamento da fatura)
      const statusSel = document.getElementById('txStatus');
      if (statusSel) {
        statusSel.innerHTML = '<option value="pending" selected>Pendente</option>';
        statusSel.disabled = true;
      }

      // Garante que o select de conta seja populado antes de ocultar
      await this.populateAccounts(document.getElementById('txAccount'));
      
      // Agora oculta a conta de origem – ela será preenchida automaticamente pelo listener
      const accountSel = document.getElementById('txAccount');
      if (accountSel) {
        const accountGroup = accountSel.closest('.form-group');
        if (accountGroup) accountGroup.style.display = 'none';
      }

      // Se foi chamado com um cartão específico, apenas preenche os campos.
      // O bloqueio/liberação será controlado por updateCardSplitVisibility.
      if (cardId) {
        const ccSel = document.getElementById('txCreditCard');
        const accountSel = document.getElementById('txAccount');
        if (ccSel) {
          ccSel.value = cardId;
          ccSel.dataset.originalDisabled = ccSel.disabled ? 'true' : 'false';
        }
        if (accountSel) {
          if (card && card.account_id) {
            // Garante que a conta de débito está disponível no select
            if (!accountSel.querySelector(`option[value="${card.account_id}"]`)) {
              const accounts = App.cache.accounts || await App.db.getAll('accounts');
              const acc = accounts.find(a => a.id === card.account_id);
              if (acc) {
                const members = App.cache.members || await App.db.getAll('members');
                const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
                const opt = document.createElement('option');
                opt.value = acc.id;
                opt.textContent = `${acc.name} (${memberMap[acc.member_id] || ''})`;
                accountSel.appendChild(opt);
              }
            }
            accountSel.value = card.account_id;
          }
          accountSel.dataset.originalDisabled = accountSel.disabled ? 'true' : 'false';
        }
      }

      // Tipo de despesa: lançamento único (padrão), parcelada ou fixa
      const expenseTypeSel = document.getElementById('txExpenseType');
      if (expenseTypeSel) {
        expenseTypeSel.innerHTML = `
          <option value="" selected>Lançamento único</option>
          <option value="installment">Parcelada</option>
          <option value="fixed">Fixa</option>
        `;
      }

      // Listener para controlar exibição de opções conforme tipo de despesa
      if (expenseTypeSel) {
        expenseTypeSel.addEventListener('change', () => {
          const installmentRow = document.getElementById('installmentRow');
          const purchaseDateInput = document.getElementById('txPurchaseDate');
          if (expenseTypeSel.value === 'installment') {
            if (installmentRow) installmentRow.style.display = 'flex';
            if (purchaseDateInput) purchaseDateInput.value = document.getElementById('txDate').value;
          } else {
            if (installmentRow) installmentRow.style.display = 'none';
          }
        });
        // Disparar uma vez para garantir o estado inicial (lançamento único, sem parcelas)
        expenseTypeSel.dispatchEvent(new Event('change'));
      }

      // Garante que a visibilidade da divisão de cartões seja reavaliada após todas as configurações
      this.updateCardSplitVisibility();
    },

    async openCardTransactionEditModal(tx) {
      // Abre o modal de edição normal, mas já passando o cartão como prefill
      this._cardEditMode = true;   // impede que a restauração de visibilidade desfaça as alterações
      await this.openTransactionModal(tx, null, false, tx.credit_card_id);
      this._cardEditMode = false;

      // ---- Ajustes específicos para edição de cartão de crédito ----

      // 1) Método de pagamento fixo = Crédito (oculto)
      const paymentSel = document.getElementById('txPaymentMethod');
      if (paymentSel) {
        paymentSel.innerHTML = '<option value="credit_card">Crédito</option>';
        paymentSel.disabled = true;
        const pmGroup = paymentSel.closest('.form-row');
        if (pmGroup) pmGroup.style.display = 'none';
      }

      // Atualiza a visibilidade da divisão entre cartões
      this.updateCardSplitVisibility();

      // 2) Oculta a conta de origem (já está preenchida com a conta de débito do cartão)
      const accountSel = document.getElementById('txAccount');
      if (accountSel) {
        const accountGroup = accountSel.closest('.form-group');
        if (accountGroup) accountGroup.style.display = 'none';
      }

      // 3) Oculta o campo de cartão de crédito (o cartão não pode ser alterado)
      const ccGroup = document.getElementById('txCreditCardGroup');
      if (ccGroup) ccGroup.style.display = 'none';

      // 4) Garante que split esteja desabilitado
      document.getElementById('splitSection').style.display = 'none';
      document.getElementById('txIsSplit').value = 'false';

      // 5) Título do modal
      document.getElementById('modalTransactionTitle').textContent = 'Editar Despesa no Cartão';
    },
    onTransferSubtypeChange() {
      const subtype = document.getElementById('txTransferSubtype')?.value;
      const investmentGroup = document.getElementById('txInvestmentGroup');
      const categorySel = document.getElementById('txCategory');
      const categoryGroup = categorySel?.closest('.form-group');

      if (investmentGroup) {
        investmentGroup.style.display = (subtype === 'aporte' || subtype === 'resgate') ? 'block' : 'none';
      }

      if (subtype === 'aporte' || subtype === 'resgate') {
        // Define automaticamente a categoria e oculta o campo
        if (categorySel) {
          categorySel.value = subtype === 'aporte' ? 'Aporte' : 'Resgate';
          if (categoryGroup) categoryGroup.style.display = 'none';
        }
      } else {
        // Mostra a categoria para transferência normal
        if (categoryGroup) categoryGroup.style.display = 'block';
        if (categorySel) categorySel.value = '';
      }

      const type = document.getElementById('txType')?.value || '';
      const allowMemberSplit = (type === 'transfer' && (subtype === 'aporte' || subtype === 'resgate'));
      const toggleArea = document.getElementById('memberSplitToggleArea');
      if (toggleArea) {
        toggleArea.style.display = allowMemberSplit ? 'block' : 'none';
        if (!allowMemberSplit) {
          const chk = document.getElementById('txMemberSplit');
          if (chk) chk.checked = false;
          const sec = document.getElementById('memberSplitSection');
          if (sec) sec.style.display = 'none';
          const memSel = document.getElementById('txMember');
          if (memSel) {
            memSel.style.display = '';
            if (!memSel.value && memSel.options.length > 0) memSel.selectedIndex = 0;
          }
          const memLbl = document.getElementById('txMemberSplitLabel');
          if (memLbl) memLbl.style.display = 'none';
          const preview = document.getElementById('memberSplitPreview');
          if (preview) preview.innerHTML = '';
          this._memberSplitSelected = [];
        }
      }
    },
    onTxMemberChange() {
      const memberId = document.getElementById('txMember').value;
      const type = document.getElementById('txType').value;
      const members = App.cache.members || [];
      const member = members.find(m => m.id === memberId);

      // Só ativa split automático para DESPESAS com o membro Casal configurado
      // E apenas se a alteração foi feita manualmente pelo usuário
      if (this._memberChangedByUser && type === 'expense' && member && member.name === 'Casal' && member.split_to && member.split_to.length >= 2) {
        document.getElementById('txIsSplit').value = 'true';
        document.getElementById('splitSection').style.display = 'block';
        const rawValue = document.getElementById('txAmount').value || '';
        const total = parseFloat(rawValue.replace(',', '.')) || 0;
        App.split.entries = [];
        document.getElementById('splitEntries').innerHTML = '';
        member.split_to.forEach(sp => {
          const m = members.find(m => m.id === sp.id);
          const amount = total > 0 ? (total * sp.ratio / 100).toFixed(2) : 0;
          App.split.entries.push({
            category: '',
            account: '',
            member: sp.id,
            amount: parseFloat(amount)
          });
        });
        App.split.renderEntries();
      } else {
        // Para qualquer outro caso (receita, transferência, ou Casal não configurado)
        document.getElementById('txIsSplit').value = 'false';
        document.getElementById('splitSection').style.display = 'none';
      }
      // Resetar o sinalizador após processar a alteração
      this._memberChangedByUser = false;
    },

    onTxTypeChange() {
      const type = document.getElementById('txType').value;
      // Mostra/oculta o campo de categoria conforme o tipo
      const txCategoryGroup = document.getElementById('txCategory').closest('.form-group');
      const transferSubtypeNow = document.getElementById('txTransferSubtype')?.value;
      if (txCategoryGroup) {
        txCategoryGroup.style.display = (type === 'transfer' && (transferSubtypeNow === 'aporte' || transferSubtypeNow === 'resgate')) ? 'none' : (type === 'transfer' ? 'none' : 'block');
      }

      // Mostrar toggle de divisão para expense, income, refund, contribution, withdrawal e transfer (aporte/resgate)
      const transferSubtypeSplit = document.getElementById('txTransferSubtype')?.value || 'normal';
      const allowMemberSplit = (
        type === 'expense' ||
        type === 'income' ||
        type === 'refund' ||
        type === 'contribution' ||
        type === 'withdrawal' ||
        (type === 'transfer' && (transferSubtypeSplit === 'aporte' || transferSubtypeSplit === 'resgate'))
      );
      const toggleArea = document.getElementById('memberSplitToggleArea');
      if (toggleArea) {
        toggleArea.style.display = allowMemberSplit ? 'block' : 'none';
        if (!allowMemberSplit) {
          document.getElementById('txMemberSplit').checked = false;
          document.getElementById('memberSplitSection').style.display = 'none';
          const memSel = document.getElementById('txMember');
          if (memSel) {
            memSel.style.display = '';
            if (!memSel.value && memSel.options.length > 0) memSel.selectedIndex = 0;
          }
          const memLbl = document.getElementById('txMemberSplitLabel');
          if (memLbl) memLbl.style.display = 'none';
          const preview = document.getElementById('memberSplitPreview');
          if (preview) preview.innerHTML = '';
          this._memberSplitSelected = [];
        }
      }

      // Esconde split automaticamente quando o tipo não é "split"
      if (document.getElementById('txIsSplit').value !== 'true') {
        document.getElementById('splitSection').style.display = 'none';
      }
      document.getElementById('txAccountToGroup').style.display =
        type === 'transfer' || type === 'contribution' || type === 'withdrawal' ? 'block' : 'none';
      const transferSubtypeGroup = document.getElementById('txTransferSubtypeGroup');
      if (transferSubtypeGroup) {
        transferSubtypeGroup.style.display = type === 'transfer' ? 'block' : 'none';
      }
      const methodSel = document.getElementById('txPaymentMethod');
      if (methodSel) {
        this.populatePaymentMethodWithFontes(methodSel, type);
      }
      const transferSubtype = document.getElementById('txTransferSubtype')?.value;
      document.getElementById('txInvestmentGroup').style.display =
        type === 'contribution' || type === 'withdrawal' || (type === 'transfer' && (transferSubtype === 'aporte' || transferSubtype === 'resgate')) ? 'block' : 'none';
      document.getElementById('expenseTypeRow').style.display =
        type === 'expense' ? 'flex' : 'none';
      const toLabel = document.querySelector('#txAccountToGroup label');
      if (toLabel)
        toLabel.textContent =
          type === 'contribution'
            ? 'Conta Investimento'
            : type === 'withdrawal'
            ? 'Conta Destino'
            : 'Conta Destino';
      App.ui.populateCategorySelect(type);
      App.ui.populateAccounts(document.getElementById('txAccount'));
      if (document.getElementById('txAccountTo')) {
        App.ui.populateAccounts(document.getElementById('txAccountTo'));
      }
      // Garante que a divisão do Casal seja reavaliada ao mudar o tipo
      this.onTxMemberChange();
      
      // Atualiza a seção de divisão entre cartões
      this.updateCardSplitVisibility();
    },

    async populateCategorySelect(type) {
      const cats = App.cache.categories || await App.db.getAll('categories');
      if (!App.cache.categories) App.cache.categories = cats;
      let filtered;
      if (type === 'transfer') {
        filtered = []; // transferência não precisa de categoria
      } else {
        filtered = cats.filter(
          c =>
            !c.archived &&
            (c.type === type ||
              (['contribution', 'withdrawal', 'refund'].includes(type) && c.type === 'expense'))
        );
      }
      const sel = document.getElementById('txCategory');
      if (sel) {
        const currentVal = sel.value; // preserva o valor definido manualmente (ex: 'Aporte')
        if (filtered.length === 0 && type !== 'transfer') {
          sel.innerHTML = '<option value="Outros">Outros</option>';
        } else {
          sel.innerHTML = filtered
            .map(c => `<option value="${c.name}">${c.name}${c.parent_id ? ' (sub)' : ''}</option>`)
            .join('');
          if (type === 'transfer') {
            sel.innerHTML += '<option value="">(sem categoria)</option>';
          }
          // Restaura o valor se ele existir na nova lista ou se o campo estiver oculto (definido automaticamente)
          if (currentVal && (sel.querySelector(`option[value="${currentVal}"]`) || document.getElementById('txCategory').closest('.form-group')?.style.display === 'none')) {
            sel.value = currentVal;
          }
        }
      }
    },

    async openCreditCardModal(cc) {
      cc = cc || null;
      var el;
      el = document.getElementById('ccId');
      if (el) el.value = cc ? (cc.id || '') : '';
      el = document.getElementById('modalCreditCardTitle');
      if (el) el.textContent = cc ? 'Editar Cartao' : 'Novo Cartao';
      el = document.getElementById('ccName');
      if (el) el.value = cc ? (cc.name || '') : '';
      el = document.getElementById('ccCardType');
      if (el) el.value = cc ? (cc.card_type || 'credit') : 'credit';
      el = document.getElementById('ccLimit');
      if (el) el.value = cc ? (cc.limit || '') : '';
      el = document.getElementById('ccDueDay');
      if (el) el.value = cc ? (cc.due_day || 10) : 10;
      el = document.getElementById('ccCloseDay');
      if (el) el.value = cc ? (cc.close_day || '') : '';
      el = document.getElementById('ccInitialBalance');
      if (el) el.value = cc ? (cc.initial_balance || 0) : 0;
      App.creditCards.onCardTypeChange();

      if (App.bankLogos && typeof App.bankLogos.bindPicker === 'function') {
        App.bankLogos.bindPicker({
          selectId: 'ccBank',
          searchId: 'ccBankSearch',
          previewId: 'ccBankPreview',
          nameInputId: 'ccName',
          countId: 'ccBankCount',
          initialBankId: cc ? (cc.bank_ispb || '') : '',
          initialName: cc ? (cc.name || '') : '',
          fillNameOnSelect: true
        });
      }

      await this.populateAccounts(document.getElementById('ccAccount'), ['checking', 'savings']);
      await this.populateMembers(document.getElementById('ccMember'));
      if (cc) {
        el = document.getElementById('ccAccount');
        if (el) el.value = cc.account_id || '';
        el = document.getElementById('ccMember');
        if (el) el.value = cc.member_id || '';
      }
      this.openModal('modalCreditCard');
    },

    async openInvestmentModal(inv = null) {
      document.getElementById('invId').value = inv?.id || '';
      document.getElementById('modalInvestmentTitle').textContent = inv ? 'Editar' : 'Novo Investimento';
      document.getElementById('invName').value = inv?.name || '';
      document.getElementById('invType').value = inv?.type || 'Tesouro Direto';
      document.getElementById('invAmountInvested').value = inv?.amount_invested || '';
      document.getElementById('invCurrentValue').value = inv?.current_value || '';
      document.getElementById('invStartDate').value = inv?.start_date || App.utils.todayISO();
      document.getElementById('invNotes').value = inv?.notes || '';
      await this.populateAccounts(document.getElementById('invAccount'), ['investment']);
      if (inv) document.getElementById('invAccount').value = inv.account_id || '';
      this.openModal('modalInvestment');
    },

    async openPatrimonyModal(p = null) {
      document.getElementById('patId').value = p?.id || '';
      document.getElementById('modalPatrimonyTitle').textContent = p ? 'Editar' : 'Novo';
      document.getElementById('patName').value = p?.name || '';
      document.getElementById('patType').value = p?.type || 'asset';
      document.getElementById('patValue').value = p?.value || '';
      document.getElementById('patDate').value = p?.date || App.utils.todayISO();
      document.getElementById('patDescription').value = p?.description || '';
      this.openModal('modalPatrimony');
    },

    async openMemberModal(m = null) {
      document.getElementById('memId').value = m?.id || '';
      document.getElementById('modalMemberTitle').textContent = m ? 'Editar' : 'Novo Membro';
      document.getElementById('memName').value = m?.name || '';
      document.getElementById('memColor').value = m?.color || '#4CAF50';
      document.getElementById('memDebtLimit').value = m?.debt_limit || 30;

      // Paleta de cores
      const palette = document.getElementById('memberColorPalette');
      palette.innerHTML = App.config.COLORS.map(
        c =>
          `<div class="color-swatch" style="background:${c}" data-color="${c}" onclick="App.members.selectColor('${c}')"></div>`
      ).join('');

      // Paleta de avatares (emojis estilo Apple)
      const avatarEmojis = ['👤','👩','👨','👩‍🦰','👨‍🦰','👩‍🦱','👨‍🦱','👩‍🦳','👨‍🦳','👩‍🦲','👨‍🦲','🧑','👶','👧','🧒','👦','👩‍🦯','👨‍🦯','👩‍🦼','👨‍🦼','🙋‍♀️','🙋‍♂️','💁‍♀️','💁‍♂️','🙆‍♀️','🙆‍♂️','🤷‍♀️','🤷‍♂️','🐱','🐶','🦊','🐼','🐨','🐸','🐵','🦁'];
      const avatarPalette = document.getElementById('memberAvatarPalette');
      const currentAvatar = m?.avatar || '👤';
      avatarPalette.innerHTML = avatarEmojis.map(
        emoji =>
          `<div class="avatar-swatch ${emoji === currentAvatar ? 'selected' : ''}" style="font-size:1.5rem; cursor:pointer; padding:4px; border-radius:8px; border:2px solid ${emoji === currentAvatar ? 'var(--primary)' : 'transparent'};" data-avatar="${emoji}" onclick="App.members.selectAvatar('${emoji}')">${emoji}</div>`
      ).join('');



      this.populateSplitMembers(m);
      this.openModal('modalMember');
    },

      async openAccountModal(a = null) {
    document.getElementById('accId').value = a?.id || '';
    document.getElementById('modalAccountTitle').textContent = a ? 'Editar' : 'Nova Conta';
    document.getElementById('accName').value = a?.name || '';
    if (App.bankLogos && typeof App.bankLogos.bindPicker === 'function') {
      App.bankLogos.bindPicker({
        selectId: 'accBank',
        searchId: 'accBankSearch',
        previewId: 'accBankPreview',
        nameInputId: 'accName',
        countId: 'accBankCount',
        initialBankId: a?.bank_ispb || '',
        initialName: a?.name || '',
        fillNameOnSelect: !a
      });
    }
    document.getElementById('accType').value = a?.type || 'checking';
    document.getElementById('accArchived').checked = a?.archived || false;
    document.getElementById('accExcludeFromTotal').checked = a?.exclude_from_total || false;
    document.getElementById('accInitialBalance').value = a?.initial_balance || 0;
    document.getElementById('accOtherTypeGroup').style.display = a?.type === 'other' ? '' : 'none';
    document.getElementById('accOtherType').value = a?.other_type || '';
    // Empréstimo: esconde campos desnecessários
    const isLoan = a?.type === 'loan';
    document.getElementById('accInitialBalance').parentNode.style.display = isLoan ? 'none' : '';
    const investmentTypeGroup = document.getElementById('accInvestmentTypeGroup');
    if (investmentTypeGroup) {
      investmentTypeGroup.style.display = a?.type === 'investment' ? '' : 'none';
      document.getElementById('accInvestmentType').value = a?.investment_type || '';
    }
    await this.populateMembers(document.getElementById('accMember'));
    if (a) document.getElementById('accMember').value = a.member_id || '';

    // ===== NOVO: Gerenciar bloco de vínculo com conta de investimento =====
    const linkedGroup = document.getElementById('accLinkedInvestmentGroup');
    const linkedSelect = document.getElementById('accLinkedInvestmentSelect');
    const createCheck = document.getElementById('accCreateInvestmentCheckbox');
    const newInvNameInput = document.getElementById('accNewInvestmentName');

    // Popular select com contas de investimento existentes (excluindo a própria se edição for investment)
    const allAccounts = App.cache.accounts || await App.db.getAll('accounts');
    const investmentAccounts = allAccounts.filter(acc => acc.type === 'investment' && acc.id !== a?.id);
    linkedSelect.innerHTML = '<option value="">Nenhuma</option>' +
      investmentAccounts.map(acc => `<option value="${acc.id}">${acc.name}</option>`).join('');

    // Se a conta editada tiver vínculo, selecionar
    if (a && a.linked_investment_account_id) {
      linkedSelect.value = a.linked_investment_account_id;
    }

    // Mostrar bloco apenas para checking/savings
    const showLinked = a?.type === 'checking' || a?.type === 'savings' || a?.type === null;
    linkedGroup.style.display = showLinked ? '' : 'none';

    // Checkbox e input de nova conta
    createCheck.checked = false;
    newInvNameInput.style.display = 'none';
    createCheck.addEventListener('change', () => {
      if (createCheck.checked) {
        linkedSelect.disabled = true;
        newInvNameInput.style.display = '';
        // Sugere nome: nome da conta corrente + " Investimentos"
        newInvNameInput.value = (document.getElementById('accName').value || 'Conta') + ' Investimentos';
      } else {
        linkedSelect.disabled = false;
        newInvNameInput.style.display = 'none';
      }
    });

    // Listener para tipo de conta: atualizar visibilidade
    const accTypeSel = document.getElementById('accType');
    accTypeSel.addEventListener('change', () => {
      investmentTypeGroup.style.display = accTypeSel.value === 'investment' ? '' : 'none';
      linkedGroup.style.display = (accTypeSel.value === 'checking' || accTypeSel.value === 'savings') ? '' : 'none';
    });

    this.openModal('modalAccount');
  },
    async openGoalModal(g = null) {
      document.getElementById('goalId').value = g?.id || '';
      document.getElementById('modalGoalTitle').textContent = g ? 'Editar Meta' : 'Nova Meta';
      document.getElementById('goalName').value = g?.name || '';
      document.getElementById('goalTarget').value = g?.target_amount || '';
      document.getElementById('goalDeadline').value = g?.deadline || '';
      const cats = App.cache.categories || await App.db.getAll('categories');
      if (!App.cache.categories) App.cache.categories = cats;
      const incomeCats = cats.filter(c => c.type === 'income');
      document.getElementById('goalCategory').innerHTML =
        '<option value="">-- Nenhuma --</option>' +
        incomeCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
      if (g) document.getElementById('goalCategory').value = g.category_id || '';
      this.openModal('modalGoal');
    },

    async openWishModal(w = null) {
      document.getElementById('wishId').value = w?.id || '';
      document.getElementById('modalWishTitle').textContent = w ? 'Editar Desejo' : 'Novo Desejo';
      document.getElementById('wishName').value = w?.name || '';
      document.getElementById('wishValue').value = w?.value || '';
      document.getElementById('wishDate').value = w?.desired_date || '';
      this.openModal('modalWish');
    },

    async openLoanModal(l = null) {
      document.getElementById('loanId').value = l?.id || '';
      document.getElementById('modalLoanTitle').textContent = l ? 'Editar' : 'Novo Empréstimo';
      document.getElementById('loanPerson').value = l?.person || '';
      document.getElementById('loanAmount').value = l?.amount || '';
      document.getElementById('loanDate').value = l?.date || App.utils.todayISO();
      document.getElementById('loanDueDate').value = l?.due_date || '';
      document.getElementById('loanEndDate').value = l?.end_date || '';
      document.getElementById('loanType').value = l?.type || 'lent';
      document.getElementById('loanNotes').value = l?.notes || '';
      document.getElementById('loanInstallments').value = l?.total_installments || 1;
      document.getElementById('loanInterest').value = '';
      document.getElementById('loanMonthly').checked = false;

      // Popula o datalist com todas as pessoas já cadastradas em empréstimos
      const datalistEl = document.getElementById('loanPersonList');
      if (datalistEl) {
        try {
          const todos = await App.db.getAll('loans');
          const nomesUnicos = [...new Set(
            todos.map(x => (x.person || '').trim()).filter(Boolean)
          )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
          datalistEl.innerHTML = nomesUnicos
            .map(nome => `<option value="${nome.replace(/"/g, '&quot;')}"></option>`)
            .join('');
        } catch (e) {
          console.warn('Não foi possível popular a lista de pessoas.', e);
          datalistEl.innerHTML = '';
        }
      }

      await this.populateAccounts(document.getElementById('loanAccount'));
      if (l && l.account_id) document.getElementById('loanAccount').value = l.account_id;
      await this.populateCreditCards(document.getElementById('loanCreditCard'));
      if (l && l.credit_card_id) document.getElementById('loanCreditCard').value = l.credit_card_id;
      const modeSelect = document.getElementById('loanPaymentMode');
      if (modeSelect) {
        modeSelect.value = (l && l.payment_mode) ? l.payment_mode : 'account';
        App.loans.onPaymentModeChange();
      }
      this.openModal('modalLoan');
    },

    async openPayInvoiceModal(cardId, total, dueDate, startPeriod, endPeriod) {
      const card = await App.db.getById('creditCards', cardId);
      if (!card) return;

      // Busca o valor da próxima fatura (mês seguinte)
      let nextInvoiceTotal = 0;
      let nextDueDate = '';
      let nextStart = '', nextEnd = '';
      try {
        const nextPeriod = App.cardInvoice.getInvoicePeriodForMonth(card, App.utils.addMonths(dueDate.slice(0,7), 1));
        nextStart = nextPeriod.start;
        nextEnd = nextPeriod.end;
        nextDueDate = nextPeriod.due;
        const txNext = await App.db.getTransactionsInRange(nextStart, nextEnd);
        const nextExpenses = txNext.filter(t => t.credit_card_id === cardId && t.type === 'expense');
        const nextRefunds = txNext.filter(t => t.credit_card_id === cardId && t.type === 'refund');
        nextInvoiceTotal = nextExpenses.reduce((s, t) => s + parseFloat(t.amount), 0) - nextRefunds.reduce((s, t) => s + parseFloat(t.amount), 0);
      } catch (e) {
        nextInvoiceTotal = 0;
      }

      const today = App.utils.todayISO();
      const accountId = card.account_id;
      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      const account = accounts.find(a => a.id === accountId);
      const accountName = account ? account.name : 'Conta não encontrada';

      const html = `
        <div class="form-group">
          <label>Cartão</label>
          <input type="text" value="${card.name}" readonly>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Valor da Fatura Atual</label>
            <input type="text" id="piCurrentTotal" value="${App.utils.formatCurrency(total)}" readonly>
          </div>
          <div class="form-group">
            <label>Vencimento</label>
            <input type="text" value="${App.utils.formatDate(dueDate)}" readonly>
          </div>
        </div>
        <div class="form-group">
          <label class="toggle-switch">
            <input type="checkbox" id="piIncludeNext" onchange="App.ui.updatePayInvoiceTotal(${total}, ${nextInvoiceTotal})">
            <span class="slider"></span> Incluir próxima fatura (${App.utils.formatDate(nextDueDate)})
          </label>
          <small style="color:var(--text-muted);">Valor adicional: ${App.utils.formatCurrency(Math.max(0, nextInvoiceTotal))}</small>
        </div>
        <div class="form-group">
          <label>Valor Total a Pagar</label>
          <input type="text" id="piTotalAmount" value="${App.utils.formatCurrency(total)}" readonly style="font-weight:700; font-size:1.2rem;">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Data do Pagamento</label>
            <input type="date" id="piPaymentDate" value="${today}" required>
          </div>
          <div class="form-group">
            <label>Hora</label>
            <input type="time" id="piPaymentTime" value="${new Date().toTimeString().slice(0,5)}" step="60">
          </div>
        </div>
        <div class="form-group">
          <label>Conta de Débito</label>
          <input type="text" value="${accountName}" readonly>
          <small style="color:var(--text-muted);">O valor será debitado automaticamente desta conta.</small>
        </div>
        <div class="form-group">
          <label>Observação</label>
          <input type="text" id="piNotes" placeholder="Ex.: Pagamento adiantado">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="App.ui.closeModal('modalPayInvoice')">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btnConfirmPayInvoice">Pagar</button>
        </div>
      `;

      document.getElementById('payInvoiceContent').innerHTML = html;
      App.ui.openModal('modalPayInvoice');

      // Configura o botão de pagamento
      document.getElementById('btnConfirmPayInvoice').onclick = async () => {
        const includeNext = document.getElementById('piIncludeNext').checked;
        const paymentDate = document.getElementById('piPaymentDate').value;
        const paymentTime = document.getElementById('piPaymentTime').value || '00:00';
        const fullDate = `${paymentDate}T${paymentTime}:00`;
        const notes = document.getElementById('piNotes').value.trim();

        if (!paymentDate) {
          App.utils.showToast('Informe a data do pagamento.', 'error');
          return;
        }

        // Pagar fatura atual
        await App.creditCards.processInvoicePayment(cardId, total, dueDate, startPeriod, endPeriod, fullDate, notes);

        // Pagar próxima fatura, se solicitado
        if (includeNext && nextInvoiceTotal > 0) {
          await App.creditCards.processInvoicePayment(cardId, nextInvoiceTotal, nextDueDate, nextStart, nextEnd, fullDate, notes + ' (adiantamento)');
        }

        App.ui.closeModal('modalPayInvoice');
        App.utils.showToast('Pagamento(s) processado(s)!');
        App.saldos.load();
        App.transactions.load();
        App.creditCards.load();
        App.dashboard.refresh();
        App.panel.refresh();
      };
    },

    updatePayInvoiceTotal(currentTotal, nextTotal) {
      const include = document.getElementById('piIncludeNext').checked;
      const total = include ? currentTotal + nextTotal : currentTotal;
      document.getElementById('piTotalAmount').value = App.utils.formatCurrency(total);
    },

    // ---------- NOVAS FUNÇÕES DE DIVISÃO ENTRE MEMBROS ----------
    _memberSplitSelected: [],

    initMemberSplit() {
      const container = document.getElementById('memberSplitButtons');
      if (!container) return;
      const amountInput = document.getElementById('txAmount');
      if (amountInput && this._splitAmountListener) {
        amountInput.removeEventListener('input', this._splitAmountListener);
        this._splitAmountListener = null;
      }
      const members = App.cache.members || [];
      let html = '';
      members.forEach(m => {
        html += `<button type="button" class="btn btn-sm btn-outline member-split-btn" data-member-id="${m.id}" onclick="App.ui.toggleMemberSelection('${m.id}')" style="margin:3px;">${m.name}</button>`;
      });
      container.innerHTML = html;
      this._memberSplitSelected = [];
      document.getElementById('memberSplitValues').innerHTML = '';
      document.getElementById('memberSplitPreview').innerHTML = '';
      document.getElementById('btnManualSplit').textContent = '✏️ Manual';
      document.getElementById('txMemberSplit').checked = false;
      document.getElementById('memberSplitSection').style.display = 'none';
      document.getElementById('txMemberSplitLabel').style.display = 'none';
      document.getElementById('txMember').style.display = '';
      this.updateMemberSplitButtons();
    },

    _restoreMemberSplit(tx) {
      if (!tx || !Array.isArray(tx.member_splits) || tx.member_splits.length === 0) return;
      const chk = document.getElementById('txMemberSplit');
      const sec = document.getElementById('memberSplitSection');
      const memSel = document.getElementById('txMember');
      const memLbl = document.getElementById('txMemberSplitLabel');
      const valuesContainer = document.getElementById('memberSplitValues');
      const preview = document.getElementById('memberSplitPreview');
      const manualBtn = document.getElementById('btnManualSplit');
      const amountInput = document.getElementById('txAmount');
      if (!chk || !sec || !valuesContainer) return;

      const members = App.cache.members || [];
      chk.checked = true;
      sec.style.display = 'block';
      if (memSel) memSel.style.display = 'none';
      if (memLbl) memLbl.style.display = '';

      this._memberSplitSelected = tx.member_splits.map(sp => sp.member_id).filter(Boolean);
      this.updateMemberSplitButtons();

      const firstAmt = parseFloat(tx.member_splits[0]?.amount) || 0;
      const allEqual = tx.member_splits.every(sp => Math.abs((parseFloat(sp.amount) || 0) - firstAmt) < 0.02);
      const isManual = !allEqual;
      if (manualBtn) manualBtn.textContent = isManual ? '🔒 Automático' : '✏️ Manual';

      let html = '';
      tx.member_splits.forEach(sp => {
        const m = members.find(x => x.id === sp.member_id);
        const val = (parseFloat(sp.amount) || 0).toFixed(2);
        html += `<div class="form-row" style="margin-bottom:4px;">
          <span style="flex:1;">${m ? m.name : sp.member_id}</span>
          <input type="number" class="member-split-value" data-member-id="${sp.member_id}" value="${val}" step="0.01" style="width:100px;" ${isManual ? '' : 'disabled'}>
        </div>`;
      });
      valuesContainer.innerHTML = html;

      if (preview && this._memberSplitSelected.length > 0) {
        const total = parseFloat(tx.amount) || 0;
        const avg = (total / this._memberSplitSelected.length).toFixed(2);
        preview.innerHTML = `💡 ${this._memberSplitSelected.length} membro(s) selecionado(s) — Valor por membro (médio): <strong>${App.utils.formatCurrency(avg)}</strong>`;
      }

      if (amountInput) {
        if (this._splitAmountListener) {
          amountInput.removeEventListener('input', this._splitAmountListener);
        }
        this._splitAmountListener = () => {
          this.updateMemberSplitAmounts();
        };
        amountInput.addEventListener('input', this._splitAmountListener);
      }
    },

    onToggleMemberSplit() {
      const checked = document.getElementById('txMemberSplit').checked;
      document.getElementById('memberSplitSection').style.display = checked ? 'block' : 'none';
      const memberSelect = document.getElementById('txMember');
      const memberLabel = document.getElementById('txMemberSplitLabel');
      const amountInput = document.getElementById('txAmount');
      
      // Remove listener antigo para evitar duplicações
      if (this._splitAmountListener) {
        amountInput.removeEventListener('input', this._splitAmountListener);
        this._splitAmountListener = null;
      }

      if (checked) {
        memberSelect.style.display = 'none';
        memberLabel.style.display = '';
        // Se nenhum membro foi selecionado ainda, seleciona todos automaticamente
        if (this._memberSplitSelected.length === 0) {
          const allMembers = App.cache.members || [];
          this._memberSplitSelected = allMembers.map(m => m.id);
          this.updateMemberSplitButtons();
          this.updateMemberSplitAmounts();
        }

        // Atualiza automaticamente os valores da divisão quando o usuário altera o valor total
        this._splitAmountListener = () => {
          this.updateMemberSplitAmounts();
        };
        amountInput.addEventListener('input', this._splitAmountListener);
      } else {
        memberSelect.style.display = '';
        if (!memberSelect.value && memberSelect.options.length > 0) memberSelect.selectedIndex = 0;
        memberLabel.style.display = 'none';
        this._memberSplitSelected = [];
        document.getElementById('memberSplitValues').innerHTML = '';
        document.getElementById('memberSplitPreview').innerHTML = '';
        this.updateMemberSplitButtons();
      }
    },

    toggleMemberSelection(memberId) {
      const idx = this._memberSplitSelected.indexOf(memberId);
      if (idx > -1) {
        this._memberSplitSelected.splice(idx, 1);
      } else {
        this._memberSplitSelected.push(memberId);
      }
      this.updateMemberSplitButtons();
      this.updateMemberSplitAmounts();
    },

    updateMemberSplitButtons() {
      const buttons = document.querySelectorAll('.member-split-btn');
      buttons.forEach(btn => {
        const mid = btn.dataset.memberId;
        if (this._memberSplitSelected.includes(mid)) {
          btn.style.background = 'var(--primary)';
          btn.style.color = '#0a0a0a';
        } else {
          btn.style.background = '';
          btn.style.color = '';
        }
      });
    },

    updateMemberSplitAmounts() {
      const rawValue = document.getElementById('txAmount').value;
      const total = parseFloat(rawValue.replace(',', '.')) || 0;
      const count = this._memberSplitSelected.length;
      const container = document.getElementById('memberSplitValues');
      const preview = document.getElementById('memberSplitPreview');
      
      if (count === 0) {
        container.innerHTML = '';
        if (preview) preview.innerHTML = '';
        return;
      }
      // Calcula em centavos para evitar arredondamentos prematuros
      const totalCents = Math.round(total * 100);
      const baseCents = Math.floor(totalCents / count);
      const remainder = totalCents - (baseCents * count);
      const amounts = [];
      for (let i = 0; i < count; i++) {
        const cents = baseCents + (i === count - 1 ? remainder : 0);
        amounts.push((cents / 100).toFixed(2));
      }

      const allMembersCount = (App.cache.members || []).length;
      if (preview) {
        // Exibe o valor médio para referência, mas a distribuição exata está nos inputs
        const avg = (total / count).toFixed(2);
        if (count === allMembersCount) {
          preview.innerHTML = `💡 Transação dividida — Valor por membro (médio): <strong>${App.utils.formatCurrency(avg)}</strong>`;
        } else {
          preview.innerHTML = `💡 ${count} membro(s) selecionado(s) — Valor por membro (médio): <strong>${App.utils.formatCurrency(avg)}</strong>`;
        }
      }
      const members = App.cache.members || [];
      let html = '';
      this._memberSplitSelected.forEach((mid, index) => {
        const m = members.find(m => m.id === mid);
        html += `<div class="form-row" style="margin-bottom:4px;">
          <span style="flex:1;">${m ? m.name : mid}</span>
          <input type="number" class="member-split-value" data-member-id="${mid}" value="${amounts[index]}" step="0.01" style="width:100px;" disabled>
        </div>`;
      });
      container.innerHTML = html;
    },

    toggleManualSplit() {
      const inputs = document.querySelectorAll('.member-split-value');
      const isManual = inputs.length > 0 && !inputs[0].disabled;
      inputs.forEach(inp => { inp.disabled = isManual; });
      document.getElementById('btnManualSplit').textContent = isManual ? '✏️ Manual' : '🔒 Automático';
    },

    getMemberSplitData() {
      if (!document.getElementById('txMemberSplit').checked) return null;
      // Se nenhum membro foi selecionado manualmente, usa todos os membros
      if (this._memberSplitSelected.length === 0) {
        const allMembers = App.cache.members || [];
        this._memberSplitSelected = allMembers.map(m => m.id);
      }
      const values = [];
      const inputs = document.querySelectorAll('.member-split-value');
      inputs.forEach(inp => {
        const rawVal = inp.value || '';
        values.push({
          member_id: inp.dataset.memberId,
          amount: parseFloat(rawVal.replace(',', '.')) || 0
        });
      });
      return values.length > 0 ? values : null;
    },

    // ========== Calculadora inline ==========
    _calcExpression: '',

    toggleCalculator() {
      const panel = document.getElementById('calculatorPanel');
      if (!panel) return;
      if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'block';
        this._calcExpression = document.getElementById('txAmount').value || '';
        document.getElementById('calcDisplay').textContent = this._calcExpression || '0';
      } else {
        panel.style.display = 'none';
      }
    },

    calcButton(val) {
      const display = document.getElementById('calcDisplay');
      this._calcExpression += val;
      display.textContent = this._calcExpression;
    },

    calcClear() {
      this._calcExpression = '';
      document.getElementById('calcDisplay').textContent = '0';
    },

    calcEquals() {
      try {
        let expr = this._calcExpression.replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/');
        if (!expr) return;
        if (!/^[\d+\-*/.() ]+$/.test(expr)) {
          App.utils.showToast('Expressão inválida', 'error');
          return;
        }
        const result = Function('"use strict"; return (' + expr + ')')();
        if (isNaN(result) || !isFinite(result)) {
          App.utils.showToast('Resultado inválido', 'error');
          return;
        }
        const formatted = parseFloat(result.toFixed(2));
        this._calcExpression = formatted.toString();
        document.getElementById('calcDisplay').textContent = this._calcExpression;
      } catch (e) {
        App.utils.showToast('Erro ao calcular', 'error');
      }
    },

    calcDone() {
      const display = document.getElementById('calcDisplay');
      const value = display.textContent;
      if (!value || value === '0' && this._calcExpression === '') {
        // Se nada foi calculado, apenas fecha
        document.getElementById('calculatorPanel').style.display = 'none';
        return;
      }
      document.getElementById('txAmount').value = String(value).replace(',', '.');
      document.getElementById('calculatorPanel').style.display = 'none';
      document.getElementById('txAmount').dispatchEvent(new Event('input'));
    },
    // ========== DIVISÃO ENTRE CARTÕES (nova funcionalidade) ==========
    _cardSplitData: [],

    updateCardSplitVisibility() {
      // Obtém todos os elementos com verificação de existência
      const typeSelect = document.getElementById('txType');
      const paymentMethodSelect = document.getElementById('txPaymentMethod');
      const toggleArea = document.getElementById('cardSplitToggleArea');
      const splitSection = document.getElementById('cardSplitSection');
      const cardSelect = document.getElementById('txCreditCard');
      const accountSelect = document.getElementById('txAccount');
      const cardSplitCheckbox = document.getElementById('txCardSplit');

      // Se qualquer elemento obrigatório não existir, simplesmente retorna sem fazer nada
      if (!typeSelect || !paymentMethodSelect || !toggleArea || !splitSection || !cardSelect) {
        return;
      }

      const type = typeSelect.value || '';
      const method = paymentMethodSelect.value || '';
      const show = type === 'expense' && method === 'credit_card';
      const cardSplitActive = cardSplitCheckbox ? cardSplitCheckbox.checked : false;

      toggleArea.style.display = show ? 'block' : 'none';

      if (!show) {
        if (cardSplitCheckbox) cardSplitCheckbox.checked = false;
        splitSection.style.display = 'none';
      }

      // Se a divisão entre cartões estiver ativa, libera o cartão principal e a conta
      if (cardSplitActive && show) {
        cardSelect.disabled = false;
        if (accountSelect) accountSelect.disabled = false;
      } else {
        // Caso contrário, restaura o estado original (definido nos modais)
        if (cardSelect.dataset.originalDisabled === 'true') {
          cardSelect.disabled = true;
        } else {
          cardSelect.disabled = false;
        }
        if (accountSelect) {
          if (accountSelect.dataset.originalDisabled === 'true') {
            accountSelect.disabled = true;
          } else {
            accountSelect.disabled = false;
          }
        }
      }
    },

    onToggleCardSplit() {
      const checkbox = document.getElementById('txCardSplit');
      const splitSection = document.getElementById('cardSplitSection');
      if (!checkbox || !splitSection) return;

      splitSection.style.display = checkbox.checked ? 'block' : 'none';
      if (checkbox.checked && this._cardSplitData.length === 0) {
        this.addCardSplitEntry();
      }
    },

    addCardSplitEntry() {
      this._cardSplitData.push({ card_id: '', amount: 0, installments: 1 });
      this.renderCardSplitList();
    },

    removeCardSplitEntry(index) {
      if (index >= 0 && index < this._cardSplitData.length) {
        this._cardSplitData.splice(index, 1);
        this.renderCardSplitList();
      }
    },

    renderCardSplitList() {
      const container = document.getElementById('cardSplitList');
      if (!container) return;

      container.innerHTML = '';

      this._cardSplitData.forEach((entry, idx) => {
        const div = document.createElement('div');
        div.className = 'form-row';
        div.style.marginBottom = '8px';
        div.innerHTML = `
          <select class="card-split-select" style="flex:2;">
            <option value="">Selecione o cartão</option>
          </select>
          <input type="number" class="card-split-amount" placeholder="Valor (R$)" step="0.01" min="0" style="flex:1;" value="${entry.amount || ''}">
          <input type="number" class="card-split-installments" placeholder="x" min="1" max="720" style="width:70px;" value="${entry.installments || 1}" title="Nº de parcelas para este cartão">
          <button type="button" class="btn btn-ghost btn-sm" onclick="App.ui.removeCardSplitEntry(${idx})">✕</button>
        `;
        container.appendChild(div);

        const select = div.querySelector('.card-split-select');
        const amountInput = div.querySelector('.card-split-amount');
        const installmentsInput = div.querySelector('.card-split-installments');

        this.populateCreditCards(select).then(() => {
          // Não removemos mais o cartão principal: ele pode fazer parte da divisão.
          select.value = entry.card_id || '';
          select.addEventListener('change', (e) => {
            entry.card_id = e.target.value;
          });
          amountInput.addEventListener('input', (e) => {
            entry.amount = parseFloat(e.target.value) || 0;
          });
          amountInput.addEventListener('change', (e) => {
            entry.amount = parseFloat(e.target.value) || 0;
          });
          installmentsInput.addEventListener('input', (e) => {
            entry.installments = Math.max(1, parseInt(e.target.value) || 1);
          });
          installmentsInput.addEventListener('change', (e) => {
            entry.installments = Math.max(1, parseInt(e.target.value) || 1);
          });
        });
      });
    },

    getCardSplitData() {
      if (!document.getElementById('txCardSplit')?.checked) return null;

      const entries = [];
      const rows = document.querySelectorAll('#cardSplitList .form-row');
      rows.forEach(row => {
        const cardId = row.querySelector('.card-split-select')?.value;
        const amount = parseFloat(row.querySelector('.card-split-amount')?.value) || 0;
        const installments = Math.max(1, parseInt(row.querySelector('.card-split-installments')?.value) || 1);
        if (cardId && amount > 0) {
          entries.push({ card_id: cardId, amount, installments });
        }
      });
      return entries.length > 0 ? entries : null;
    },

    // ---------- FIM DAS NOVAS FUNÇÕES ----------
  };

  // =======================================================================
  // Sidebar
  // =======================================================================
  App.sidebar = {
    init() {
      const nav = document.getElementById('sidebarNav');
      const buttons = nav.querySelectorAll('button');
      buttons.forEach(btn => {
        btn.setAttribute('draggable', 'true');
        btn.addEventListener('dragstart', this.onDragStart);
        btn.addEventListener('dragover', this.onDragOver);
        btn.addEventListener('drop', this.onDrop);
        btn.addEventListener('dragend', this.onDragEnd);
      });
      this.applyVisibility();
    },
    onDragStart(e) {
      e.target.classList.add('dragging');
      e.dataTransfer.setData('text/plain', e.target.dataset.page);
    },
    onDragOver(e) {
      e.preventDefault();
      e.target.closest('button')?.classList.add('drag-over');
    },
    onDrop(e) {
      e.preventDefault();
      const draggedPage = e.dataTransfer.getData('text/plain');
      const targetBtn = e.target.closest('button');
      if (!targetBtn || targetBtn.dataset.page === draggedPage) return;
      const draggedBtn = document.querySelector(`[data-page="${draggedPage}"]`);
      const parent = draggedBtn.parentNode;
      const targetIndex = Array.from(parent.children).indexOf(targetBtn);
      const draggedIndex = Array.from(parent.children).indexOf(draggedBtn);
      if (targetIndex > draggedIndex) {
        parent.insertBefore(draggedBtn, targetBtn.nextSibling);
      } else {
        parent.insertBefore(draggedBtn, targetBtn);
      }
      targetBtn.classList.remove('drag-over');
      this.saveOrder();
    },
    onDragEnd(e) {
      e.target.classList.remove('dragging');
      document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('drag-over'));
    },
    applyVisibility() {
      const hiddenPages = [
        'installments', 'card-history', 'templates', 'achievements', 'annual',
        'cashflow', 'member-detail', 'card-invoice', 'loan-detail', 'balance-detail',
        'income-detail', 'expense-detail', 'costofliving-detail', 'projection',
        'patrimony-evolution', 'subcategories', 'notifications', 'analytics-detail', 'analytics-annual'
      ];
      document.querySelectorAll('.sidebar-nav button').forEach(btn => {
        if (hiddenPages.includes(btn.dataset.page)) btn.classList.add('hidden-item');
      });
    },
    saveOrder() {
      localStorage.setItem(
        'sidebar_order',
        JSON.stringify(
          Array.from(document.querySelectorAll('.sidebar-nav button')).map(b => b.dataset.page)
        )
      );
    },
    loadOrder() {
      const saved = localStorage.getItem('sidebar_order');
      if (!saved) return;
      const order = JSON.parse(saved);
      const nav = document.getElementById('sidebarNav');
      order.forEach(page => {
        const btn = nav.querySelector(`[data-page="${page}"]`);
        if (btn) nav.appendChild(btn);
      });
    }
  };

  // =======================================================================
  // FAB (botão de ação flutuante)
  // =======================================================================
  App.fab = {
    init() {
      this.main = document.getElementById('fabMain');
      this.menu = document.getElementById('fabMenu');
      this.container = document.getElementById('fabContainer');
      this.items = document.querySelectorAll('.fab-item');
      this.main.addEventListener('click', () => this.toggle());
      this.items.forEach(item => {
        item.addEventListener('click', e => {
          e.stopPropagation();
          this.doAction(item.dataset.action);
          this.close();
        });
      });
      document.addEventListener('click', e => {
        if (!this.container.contains(e.target)) this.close();
      });
    },
    toggle() {
      this.main.classList.contains('open') ? this.close() : this.open();
    },
    open() {
      this.main.classList.add('open');
      this.menu.classList.add('open');
      this.updateLabels();
    },
    close() {
      this.main.classList.remove('open');
      this.menu.classList.remove('open');
    },
    updateLabels() {
      const page = this.getCurrentPage();
      this.items.forEach(item => {
        const action = item.dataset.action;

        // Página da fatura: apenas despesa no cartão
        if (page === 'card-invoice') {
          if (action === 'expense') {
            item.style.display = '';
            item.title = 'Nova Despesa no Cartão';
            item.textContent = '💳';
          } else {
            item.style.display = 'none';
          }
          return;
        }

        // Página de transações: adiciona opção de cartão, mantendo as demais
        if (page === 'transactions') {
          if (action === 'card-expense') {
            item.style.display = '';
            item.title = 'Nova Despesa no Cartão';
            item.textContent = '💳';
          } else {
            // Exibe os botões normais (expense, income, transfer, split)
            item.style.display = '';
            // Restaura os títulos e ícones padrão
            if (action === 'expense') { 
              item.title = 'Nova Despesa'; 
              item.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>'; 
            }
            else if (action === 'income') { 
              item.title = 'Nova Receita'; 
              item.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'; 
            }
            else if (action === 'transfer') { 
              item.title = 'Nova Transferência'; 
              item.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'; 
            }
            else if (action === 'split') { 
              item.title = 'Nova Transação Dividida'; 
              item.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M21 16v5h-5"/><path d="M3 16v5h5"/></svg>'; 
            }
          }
          return;
        }

        // Demais páginas (dashboard, investiments, etc.)
        item.style.display = '';
        if (page === 'investments') {
          if (action === 'expense') { 
            item.title = 'Novo Aporte'; 
            item.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'; 
          }
          else if (action === 'income') { 
            item.title = 'Novo Resgate'; 
            item.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V2M7 19h5.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H18"/></svg>'; 
          }
          else { item.style.display = 'none'; }
        } else {
          // Oculta o botão card-expense em páginas que não sejam transactions nem card-invoice
          if (action === 'card-expense') {
            item.style.display = 'none';
          } else {
            if (action === 'expense') { item.title = 'Nova Despesa'; item.textContent = '💸'; }
            else if (action === 'income') { item.title = 'Nova Receita'; item.textContent = '💰'; }
            else if (action === 'transfer') { item.title = 'Nova Transferência'; item.textContent = '🔄'; }
            else if (action === 'split') { item.title = 'Nova Transação Dividida'; item.textContent = '🔀'; }
          }
        }
      });
    },
    getCurrentPage() {
      const active = document.querySelector('.page.active');
      return active ? active.id.replace('page-', '') : '';
    },
    updateVisibility() {
      const visible = [
        'dashboard', 'panel', 'transactions', 'credit-cards', 'extracts',
        'investments', 'patrimony', 'planning', 'installments', 'card-invoice',
        'vehicles', 'vehicle-detail'
      ];
      this.container.classList.toggle('hidden', !visible.includes(this.getCurrentPage()));
    },
    async doAction(action) {
      if (action === 'split') { await App.ui.openTypedModal('split'); return; }
      
      // Despesa no cartão: na fatura usa o cartão atual, nas outras páginas sem cartão pré-selecionado
      if (action === 'card-expense') {
        const cardId = (this.getCurrentPage() === 'card-invoice') ? App.cardInvoice.currentCardId : null;
        await App.ui.openCardTransactionModal(cardId);
        return;
      }
      
      // Se estiver na página da fatura do cartão (qualquer outra ação visível)
      if (this.getCurrentPage() === 'card-invoice') {
        const cardId = App.cardInvoice.currentCardId;
        if (cardId) {
          await App.ui.openCardTransactionModal(cardId);
          return;
        }
      }
      
      let type = action;
      if (this.getCurrentPage() === 'investments')
        type = action === 'expense' ? 'contribution' : 'withdrawal';
      await App.ui.openTypedModal(type);
    }
  };

  // =============================================
  // Setup UI – eventos globais
  // =============================================
  function setupUI() {
    document.querySelectorAll('.sidebar-nav button[data-page]').forEach(b => {
      b.addEventListener('click', () => App.ui.navigateTo(b.dataset.page));
    });

    document.querySelectorAll('.modal-overlay').forEach(o => {
      o.addEventListener('click', function (e) {
        if (e.target === this) {
          this.classList.remove('open');
          document.body.style.overflow = '';
        }
      });
    });

    App.fab.init();
    App.fab.updateVisibility();

    // Abre apenas o primeiro grupo da sidebar por padrão
    const firstGroup = document.querySelector('.nav-group-title');
    if (firstGroup) toggleNavGroup(firstGroup);

    document.addEventListener('keydown', e => {
      if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        App.ui.openTransactionModal();
      }
      if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        const page = document.querySelector('.page.active')?.id.replace('page-', '');
        if (App[page]?.prevMonth) App[page].prevMonth();
      }
      if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        const page = document.querySelector('.page.active')?.id.replace('page-', '');
        if (App[page]?.nextMonth) App[page].nextMonth();
      }
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => App.ui.closeModal(m.id));
        const alertDropdown = document.getElementById('alertDropdown');
        if (alertDropdown) alertDropdown.style.display = 'none';
      }
    });

    const bell = document.getElementById('globalAlertBell');
    const alertDropdown = document.getElementById('alertDropdown');
    const alertList = document.getElementById('alertList');
    if (bell && alertDropdown && alertList) {
      bell.addEventListener('click', () => {
        if (alertDropdown.style.display === 'none' || !alertDropdown.style.display) {
          alertList.innerHTML =
            App.utils.getAlerts().map(a => {
              const icon = a.type === 'danger' ? '🔴' : a.type === 'warning' ? '🟡' : '🔵';
              return `<div class="alert-item">${icon} ${a.msg} <small style="color:var(--text-muted);">${new Date(a.date).toLocaleString('pt-BR')}</small></div>`;
            }).join('') || '<div class="alert-item">Nenhum alerta no momento</div>';
          alertDropdown.style.display = 'block';
          sessionStorage.setItem('last_alert_count', App.utils._alerts.filter(a => !a.read).length);
          App.utils.updateAlertBell();
        } else {
          alertDropdown.style.display = 'none';
        }
      });
      document.addEventListener('click', e => {
        if (!bell.contains(e.target) && !alertDropdown.contains(e.target))
          alertDropdown.style.display = 'none';
      });
    }
    

    // Busca global com debounce (300ms)
    let searchTimeout;
    const globalSearch = document.getElementById('globalSearchInput');
    if (globalSearch) {
      globalSearch.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const term = globalSearch.value.trim();
        if (term.length >= 2) {
          searchTimeout = setTimeout(() => {
            App.search.term = term;
            App.ui.navigateTo('search');
          }, 300);
        }
      });
      globalSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(searchTimeout);
          const term = globalSearch.value.trim();
          if (term.length >= 2) {
            App.search.term = term;
            App.ui.navigateTo('search');
          }
        }
      });
    }

    setTimeout(() => {
      const lastBackup = localStorage.getItem('last_backup_date');
      const skipReminder = localStorage.getItem('skip_backup_reminder');
      if (skipReminder === 'true') return;
      const today = new Date();
      if (!lastBackup || (today - new Date(lastBackup)) > 7 * 24 * 60 * 60 * 1000) {
        App.ui.openModal('modalBackupReminder');
        document.getElementById('backupRemindLater').onclick = () => {
          localStorage.setItem('last_backup_date', new Date().toISOString());
          App.ui.closeModal('modalBackupReminder');
        };
        document.getElementById('backupNever').onclick = () => {
          localStorage.setItem('skip_backup_reminder', 'true');
          App.ui.closeModal('modalBackupReminder');
        };
      }
    }, 2000);

    const originalPrint = window.print;
    window.print = function () {
      const page = document.querySelector('.page.active')?.id.replace('page-', '');
      if (App[page]?.refresh) App[page].refresh().then(() => setTimeout(originalPrint, 300));
      else if (App[page]?.load) App[page].load().then(() => setTimeout(originalPrint, 300));
      else originalPrint.call(window);
    };

    setTimeout(() => {
      if (App.dashboard?.loadCardsOrder) App.dashboard.loadCardsOrder();
    }, 500);
  }

  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
  }

  function toggleSidebarMini() {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    const isNowMini = !sidebar.classList.contains('mini'); // será mini após toggle

    sidebar.classList.toggle('mini');
    if (main) main.classList.toggle('expanded');

    // Se acabou de recolher (ficou mini), fecha todos os submenus abertos
    if (isNowMini) {
      document.querySelectorAll('.nav-group-items').forEach(el => {
        el.style.display = 'none';
      });
      document.querySelectorAll('.nav-group-title.expanded').forEach(btn => {
        btn.classList.remove('expanded');
      });
    }
  }

// =======================================================================
// Métricas do Banco de Dados – leitura crua do IndexedDB
// =======================================================================
App.metrics = {
  _lastSnapshot: null,
  _historyKey: 'metrics_history',
  _historyMax: 30,

  async load() {
    const el = document.getElementById('metricsContent');
    if (!el) return;
    el.innerHTML = '<p style="color:var(--text-muted);">Carregando…</p>';

    const snap = await this._collectSnapshot();
    this._lastSnapshot = snap;

    // Crescimento vs snapshot anterior
    const crescimento = this._computeGrowth(snap);
    this._pushHistory(snap);

    // Tamanho estimado por store
    const sizes = await this._estimateSizes();

    // Último backup
    const ultimoBackupISO = localStorage.getItem('last_backup_date');
    const ultimoBackupDias = ultimoBackupISO
      ? Math.floor((Date.now() - new Date(ultimoBackupISO).getTime()) / 86400000)
      : null;

    // Render
    const row = (label, value, cls = '') =>
      `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #1a1a1a;">
         <span style="color:#b0b0b0;">${label}</span>
         <strong style="${cls}">${value}</strong>
       </div>`;

    const cardStyle = 'background:var(--card); border:1px solid #1f1f1f; border-radius:12px; padding:20px 24px;';
    const titleStyle = 'font-size:0.78rem; text-transform:uppercase; letter-spacing:0.06em; color:#888; margin-bottom:14px; font-weight:500;';
    const btnDet = (key) =>
      `<button class="btn btn-sm btn-outline" style="margin-left:8px; padding:2px 8px; font-size:0.72rem;" onclick="App.metrics.showDetails('${key}')">detalhes</button>`;

    const totaisStores = Object.values(snap.counts).reduce((s, v) => s + v, 0);
    const problemas = snap.duplicatas.length
      + snap.parcelamentosProblemas.length
      + snap.recorrentesProblemas.length
      + snap.investProblemas.length
      + snap.faturaProblemas.length
      + snap.datasInvalidas.length
      + snap.valoresInvalidos.length
      + snap.tx.orfasReais
      + snap.tx.txSemConta
      + snap.tx.txCartaoInvalido
      + snap.cartaoDivergencias.length
      + snap.cartaoOrfaos.length;

    const saudeTexto = problemas === 0 ? 'OK' : 'Atenção';
    const saudeCor = problemas === 0 ? '#a3e635' : '#f87171';

    const orfasLista = snap.orfasPorNome.size > 0
      ? [...snap.orfasPorNome.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([nome, qtd]) => `<div style="display:flex; justify-content:space-between; padding:4px 0;"><span style="color:#c9ced5;">${nome}</span><span style="color:#f87171; font-weight:600;">${qtd}</span></div>`)
          .join('')
      : '<div style="color:#a3e635;">Nenhuma órfã real.</div>';

    const crescimentoHTML = crescimento
      ? Object.entries(crescimento.changes)
          .filter(([, v]) => v.delta !== 0)
          .map(([store, v]) => {
            const cor = v.delta > 0 ? '#fbbf24' : '#a3e635';
            const sinal = v.delta > 0 ? '+' : '';
            return row(store, `${sinal}${v.delta} (de ${v.antes} para ${v.agora})`, `color:${cor};`);
          }).join('') || '<div style="color:#a3e635;">Sem variação desde o último snapshot.</div>'
      : '<div style="color:#888;">Sem histórico anterior.</div>';

    const ultimoBackupHTML = ultimoBackupDias === null
      ? '<div style="color:#fbbf24;">Nenhum backup registrado.</div>'
      : row('Último backup', `${ultimoBackupDias} dia(s) atrás`, ultimoBackupDias > 7 ? 'color:#f87171;' : 'color:#a3e635;');

    const sizeRows = Object.entries(sizes)
      .sort((a, b) => b[1] - a[1])
      .map(([store, bytes]) => {
        const kb = (bytes / 1024).toFixed(1);
        const mb = (bytes / 1024 / 1024).toFixed(2);
        return row(store, bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`);
      }).join('');

    const problemaLinha = (label, lista, key, impacto = '') =>
      `<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid #1a1a1a;">
         <div style="flex:1; min-width:0;">
           <div style="color:#b0b0b0;">${label}</div>
           ${lista.length && impacto ? `<div style="color:#888; font-size:0.72rem; margin-top:3px; line-height:1.4;">${impacto}</div>` : ''}
         </div>
         <span style="flex-shrink:0; display:flex; align-items:center; gap:6px;">
           <strong style="${lista.length ? 'color:#f87171;' : 'color:#a3e635;'}">${lista.length}</strong>
           ${lista.length ? btnDet(key) : ''}
         </span>
       </div>`;

    el.innerHTML = `
      <div class="cards-row" style="margin-bottom:20px;">
        <div class="card"><div class="card-label">Registros totais</div><div class="card-value">${totaisStores}</div><div class="card-sub">${Object.keys(snap.counts).length} tabelas</div></div>
        <div class="card"><div class="card-label">Transações</div><div class="card-value">${snap.tx.total}</div><div class="card-sub">${snap.tx.validas} válidas · ${snap.tx.semCategoria} sem cat. · ${snap.tx.orfasReais} órfãs</div></div>
        <div class="card"><div class="card-label">Categorias</div><div class="card-value">${snap.cats.total}</div><div class="card-sub">${snap.cats.principais} principais · ${snap.cats.sub} sub · ${snap.cats.arquivadas} arquivadas</div></div>
        <div class="card"><div class="card-label">Saúde</div><div class="card-value" style="color:${saudeCor};">${saudeTexto}</div><div class="card-sub">${problemas} problema(s) detectado(s)</div></div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:16px; margin-bottom:20px;">
        <div style="${cardStyle}">
          <div style="${titleStyle}">Transações por tipo</div>
          ${Object.entries(snap.tx.porTipo).sort((a,b)=>b[1]-a[1]).map(([k,v]) => row(k, v)).join('') || '<div style="color:#888;">Sem dados</div>'}
        </div>
        <div style="${cardStyle}">
          <div style="${titleStyle}">Transações por status</div>
          ${Object.entries(snap.tx.porStatus).sort((a,b)=>b[1]-a[1]).map(([k,v]) => row(k, v)).join('') || '<div style="color:#888;">Sem dados</div>'}
        </div>
        <div style="${cardStyle}">
          <div style="${titleStyle}">Classificação de categorias em transações</div>
          ${row('Categoria válida', snap.tx.validas, 'color:#a3e635;')}
          ${row('Sem categoria (transferências)', snap.tx.semCategoria, 'color:#fbbf24;')}
          ${row('Strings internas (Pagamento Fatura / Saldo Inicial / Rendimento)', snap.tx.stringsInternas, 'color:#60a5fa;')}
          ${row('Órfãs reais', snap.tx.orfasReais, 'color:#f87171;')}
        </div>
        <div style="${cardStyle}">
          <div style="${titleStyle}">Backup</div>
          ${ultimoBackupHTML}
          ${row('Backups registrados', this._getHistory().length)}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px; margin-bottom:20px;">
        <div style="${cardStyle}">
          <div style="${titleStyle}">Integridade referencial</div>
          ${row('Transações sem membro', snap.tx.txSemMembro)}
          ${row('Transações sem conta válida', snap.tx.txSemConta, snap.tx.txSemConta ? 'color:#f87171;' : '')}
          ${row('Transações com cartão inválido', snap.tx.txCartaoInvalido, snap.tx.txCartaoInvalido ? 'color:#f87171;' : '')}
          ${row('Categorias duplicadas (nome+tipo)', snap.cats.duplicadas, snap.cats.duplicadas ? 'color:#f87171;' : '')}
        </div>
        <div style="${cardStyle}">
          <div style="${titleStyle}">Problemas estruturais</div>
          ${problemaLinha('Transações duplicadas (data+valor+descrição+conta+tipo)', snap.duplicatas, 'duplicatas', 'Afeta saldo, dashboard, relatórios e extratos. Cada cópia extra é contada novamente.')}
          ${problemaLinha('Grupos de parcelamento com inconsistência', snap.parcelamentosProblemas, 'parcelamentos', 'Afeta a tela Compras Parceladas, o Comprometimento Futuro e a contagem de parcelas ativas. Não afeta saldo.')}
          ${problemaLinha('Séries recorrentes com inconsistência', snap.recorrentesProblemas, 'recorrentes', 'Afeta a projeção de fluxo de caixa e a tela de Transações. Não afeta saldo.')}
          ${problemaLinha('Investimentos com inconsistência', snap.investProblemas, 'investimentos', 'Afeta a tela Investimentos, o Patrimônio Líquido e o histórico de posições.')}
          ${problemaLinha('Faturas com inconsistência', snap.faturaProblemas, 'faturas', 'Afeta o saldo total: transações travadas são ignoradas por calculateBalance. Saldo fica maior que o real.')}
          ${problemaLinha('Transações de cartão com conta divergente', snap.cartaoDivergencias, 'cartaoDivergencias', 'Afeta a tela Detalhes da Conta e o agrupamento de faturas. A fatura pode aparecer na conta errada.')}
          ${problemaLinha('Transações com cartão inexistente', snap.cartaoOrfaos, 'cartaoOrfaos', 'Afeta filtros de cartão e a tela Detalhes da Conta. A transação deixa de aparecer agrupada na fatura.')}
          ${problemaLinha('Transações com data inválida', snap.datasInvalidas, 'datas', 'Afeta ordenações, filtros por período e agrupamentos mensais.')}
          ${problemaLinha('Transações com valor inválido', snap.valoresInvalidos, 'valores', 'Afeta saldo, todos os totais agregados, dashboard e relatórios.')}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
        <div style="${cardStyle}">
          <div style="${titleStyle}">Contagem por tabela</div>
          ${Object.entries(snap.counts).map(([k,v]) => row(k, v)).join('')}
        </div>
        <div style="${cardStyle}">
          <div style="${titleStyle}">Tamanho estimado por tabela</div>
          ${sizeRows}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
        <div style="${cardStyle}">
          <div style="${titleStyle}">Órfãs reais por nome</div>
          ${orfasLista}
        </div>
        <div style="${cardStyle}">
          <div style="${titleStyle}">Crescimento vs snapshot anterior</div>
          ${crescimentoHTML}
        </div>
      </div>
    `;
  },

  // -------------------------------------------------------------------
  // Coleta
  // -------------------------------------------------------------------
  async _collectSnapshot() {
    const stores = (App.dbSchema && App.dbSchema.ALL_STORES) || [
      'transactions', 'categories', 'members', 'accounts', 'creditCards',
      'investments', 'investmentHistory', 'patrimony', 'goals', 'wishes',
      'receipts', 'receiptFolders', 'budgets', 'loans', 'transactionTemplates',
      'vehicles', 'vehicleExpenses', 'previdencia', 'fontesPagadoras',
      'planosOrcamentarios', 'indicatorHistory', 'notifications',
      'accountHistory', 'creditLimitHistory', 'manualIncomes', 'locais', 'payrolls'
    ];

    const counts = {};
    const storeData = {};
    for (const s of stores) {
      try {
        const all = await App.db.getAll(s);
        counts[s] = all.length;
        storeData[s] = all;
      } catch (e) {
        counts[s] = 0;
        storeData[s] = [];
      }
    }

    const txAll = storeData.transactions;
    const cats  = storeData.categories;

    // Categorias
    const catsPrincipais = cats.filter(c => !c.parent_id);
    const catsSub        = cats.filter(c => !!c.parent_id);
    const catsArquivadas = cats.filter(c => c.archived);
    const byNameType = new Map();
    cats.forEach(c => {
      const key = `${(c.name || '').toLowerCase().trim()}|||${c.type || 'expense'}`;
      byNameType.set(key, (byNameType.get(key) || 0) + 1);
    });
    const catsDuplicadas = [...byNameType.values()].filter(n => n > 1).length;

    // Órfãs
    const nomesCatsValidos = new Set(cats.map(c => (c.name || '').toLowerCase().trim()));
    const STRINGS_INTERNAS = new Set(['pagamento fatura', 'saldo inicial', 'rendimento']);

    const txPorTipo = {};
    const txPorStatus = {};
    txAll.forEach(t => {
      txPorTipo[t.type] = (txPorTipo[t.type] || 0) + 1;
      const st = t.status || 'sem status';
      txPorStatus[st] = (txPorStatus[st] || 0) + 1;
    });

    let semCategoria = 0, orfasReais = 0, stringsInternas = 0, validas = 0;
    const orfasPorNome = new Map();
    for (const t of txAll) {
      const cat = typeof t.category === 'string' ? t.category.trim() : '';
      if (!cat) { semCategoria++; continue; }
      const key = cat.toLowerCase();
      if (nomesCatsValidos.has(key)) { validas++; continue; }
      if (STRINGS_INTERNAS.has(key)) { stringsInternas++; continue; }
      orfasReais++;
      orfasPorNome.set(cat, (orfasPorNome.get(cat) || 0) + 1);
    }

    // Integridade referencial
    const memberIds  = new Set(storeData.members.map(m => m.id));
    const accountIds = new Set(storeData.accounts.map(a => a.id));
    const cardIds    = new Set(storeData.creditCards.map(c => c.id));
    let txSemMembro = 0, txSemConta = 0, txCartaoInvalido = 0;
    for (const t of txAll) {
      if (!t.member_id) txSemMembro++;
      if (!t.account_id || !accountIds.has(t.account_id)) txSemConta++;
      if (t.credit_card_id && !cardIds.has(t.credit_card_id)) txCartaoInvalido++;
    }

    // Duplicatas
    const dupKey = new Map();
    for (const t of txAll) {
      const key = [
        (t.date || '').slice(0, 10),
        String(t.amount || 0),
        (t.description || '').trim().toLowerCase(),
        t.account_id || '',
        t.type || ''
      ].join('|');
      if (!dupKey.has(key)) dupKey.set(key, []);
      dupKey.get(key).push(t);
    }
    const duplicatas = [...dupKey.values()].filter(arr => arr.length > 1);

    // Parcelamentos
    const parcelamentosProblemas = [];
    const gruposParc = new Map();
    for (const t of txAll) {
      if (t.installment_id && t.installments > 1) {
        if (!gruposParc.has(t.installment_id)) gruposParc.set(t.installment_id, []);
        gruposParc.get(t.installment_id).push(t);
      }
    }
    for (const [gid, arr] of gruposParc) {
      const total = Math.max(...arr.map(t => parseInt(t.installments) || 0));
      const numeros = new Set(arr.map(t => parseInt(t.installment_number) || 0));
      const esperado = new Set(Array.from({ length: total }, (_, i) => i + 1));
      const faltando = [...esperado].filter(n => !numeros.has(n));
      const fora = [...numeros].filter(n => n < 1 || n > total);
      if (faltando.length || fora.length) {
        parcelamentosProblemas.push({ grupo: gid, total, presentes: numeros.size, faltando, fora });
      }
    }

    // Recorrentes
    const recorrentesProblemas = [];
    const gruposRec = new Map();
    for (const t of txAll) {
      if (t.is_recurring_series && t.description) {
        const key = `${t.description.trim().toLowerCase()}|||${t.member_id || ''}`;
        if (!gruposRec.has(key)) gruposRec.set(key, []);
        gruposRec.get(key).push(t);
      }
    }
    for (const [key, arr] of gruposRec) {
      const declarado = Math.max(...arr.map(t => parseInt(t.recurring_times) || 0));
      if (declarado > 0 && arr.length > declarado) {
        recorrentesProblemas.push({ chave: key, declarado, encontrados: arr.length });
      }
    }

    // Investimentos
    const investProblemas = [];
    const invIds = new Set(storeData.investments.map(i => i.id));
    for (const h of storeData.investmentHistory) {
      if (!invIds.has(h.investment_id)) investProblemas.push({ tipo: 'history_orfao', id: h.id, ref: h.investment_id });
    }
    for (const t of txAll) {
      if (t.investment_id && !invIds.has(t.investment_id)) {
        investProblemas.push({ tipo: 'tx_invest_invalido', id: t.id, ref: t.investment_id });
      }
    }
    for (const inv of storeData.investments) {
      const hist = storeData.investmentHistory
        .filter(h => h.investment_id === inv.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (hist.length) {
        const ultimo = parseFloat(hist[hist.length - 1].value) || 0;
        const atual = parseFloat(inv.current_value) || 0;
        if (Math.abs(ultimo - atual) > 0.01) {
          investProblemas.push({ tipo: 'current_value_divergente', id: inv.id, nome: inv.name, historico: ultimo, atual });
        }
      }
    }

    // Faturas
    const faturaProblemas = [];
    const pagamentos = txAll.filter(t => t.category === 'Pagamento Fatura' && t.type === 'expense');
    const travadas = txAll.filter(t => t.invoice_locked === true);
    for (const t of travadas) {
      const mes = (t.date || '').slice(0, 7);
      const achou = pagamentos.some(p => (p.description || '').includes(mes));
      if (!achou) faturaProblemas.push({ tipo: 'travada_sem_pagamento', id: t.id, mes });
    }
    for (const p of pagamentos) {
      const match = (p.description || '').match(/(\d{4}-\d{2})/);
      if (match) {
        const mes = match[1];
        const achou = travadas.some(t => (t.date || '').slice(0, 7) === mes);
        if (!achou) faturaProblemas.push({ tipo: 'pagamento_sem_travadas', id: p.id, mes });
      }
    }

    // ---- Divergência entre account_id da transação e account_id do cartão ----
    // Cenário do bug "Fatura XP aparece na conta Nubank": transações de cartão
    // cujo account_id ficou preso à conta antiga após o cartão trocar de conta.
    const cartaoDivergencias = [];
    const cartaoOrfaos = [];
    const _cardAccountMap = new Map(storeData.creditCards.map(c => [c.id, c.account_id || null]));
    const _cardNameMap = new Map(storeData.creditCards.map(c => [c.id, c.name || '(sem nome)']));
    const _accNameMap = Object.fromEntries(storeData.accounts.map(a => [a.id, a.name || '(sem nome)']));

    for (const t of txAll) {
      if (!t.credit_card_id) continue;

      if (!_cardAccountMap.has(t.credit_card_id)) {
        cartaoOrfaos.push({
          id: t.id,
          data: (t.date || '').slice(0, 10),
          descricao: t.description || t.category || '',
          valor: t.amount,
          cartao_id: t.credit_card_id,
          account_id: t.account_id || '',
          conta_atual: _accNameMap[t.account_id] || '(conta inexistente)'
        });
        continue;
      }

      const expectedAccId = _cardAccountMap.get(t.credit_card_id);
      if (!expectedAccId) continue;
      if (t.account_id === expectedAccId) continue;

      cartaoDivergencias.push({
        id: t.id,
        data: (t.date || '').slice(0, 10),
        descricao: t.description || t.category || '',
        valor: t.amount,
        cartao: _cardNameMap.get(t.credit_card_id),
        cartao_id: t.credit_card_id,
        conta_atual: _accNameMap[t.account_id] || '(conta inexistente)',
        conta_correta: _accNameMap[expectedAccId] || '(conta inexistente)',
        account_id_atual: t.account_id || '',
        account_id_correto: expectedAccId
      });
    }

    // Datas inválidas
    const datasInvalidas = [];
    const hoje = new Date();
    const limiteFuturo = new Date(hoje.getFullYear() + 5, hoje.getMonth(), hoje.getDate());
    for (const t of txAll) {
      const d = (t.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { datasInvalidas.push({ id: t.id, data: t.date }); continue; }
      const dt = new Date(d + 'T12:00:00');
      if (isNaN(dt.getTime()) || dt.getFullYear() < 2000 || dt > limiteFuturo) {
        datasInvalidas.push({ id: t.id, data: t.date });
      }
    }

    // Valores inválidos
    const valoresInvalidos = [];
    for (const t of txAll) {
      const v = parseFloat(t.amount);
      if (!isFinite(v) || v === 0 || v < 0) valoresInvalidos.push({ id: t.id, valor: t.amount, tipo: t.type });
    }

    return {
      geradoEm: new Date().toISOString(),
      counts,
      cats: {
        total: cats.length,
        principais: catsPrincipais.length,
        sub: catsSub.length,
        arquivadas: catsArquivadas.length,
        duplicadas: catsDuplicadas
      },
      tx: {
        total: txAll.length,
        porTipo: txPorTipo,
        porStatus: txPorStatus,
        semCategoria, orfasReais, stringsInternas, validas,
        txSemMembro, txSemConta, txCartaoInvalido
      },
      orfasPorNome,
      duplicatas,
      parcelamentosProblemas,
      recorrentesProblemas,
      investProblemas,
      faturaProblemas,
      cartaoDivergencias,
      cartaoOrfaos,
      datasInvalidas,
      valoresInvalidos
    };
  },

  // -------------------------------------------------------------------
  // Tamanho estimado por store
  // -------------------------------------------------------------------
  async _estimateSizes() {
    const stores = (App.dbSchema && App.dbSchema.ALL_STORES) || [
      'transactions', 'categories', 'members', 'accounts', 'creditCards',
      'investments', 'investmentHistory', 'patrimony', 'goals', 'wishes',
      'receipts', 'receiptFolders', 'budgets', 'loans', 'transactionTemplates',
      'vehicles', 'vehicleExpenses', 'previdencia', 'fontesPagadoras',
      'planosOrcamentarios', 'indicatorHistory', 'notifications',
      'accountHistory', 'creditLimitHistory', 'manualIncomes', 'locais', 'payrolls'
    ];
    const sizes = {};
    for (const s of stores) {
      const all = await App.db.getAll(s);
      let bytes = 0;
      // Amostragem para stores grandes
      if (all.length > 500) {
        const amostra = all.slice(0, 100);
        const mediaAmostra = amostra.reduce((sum, x) => sum + JSON.stringify(x).length, 0) / amostra.length;
        bytes = Math.round(mediaAmostra * all.length);
      } else {
        bytes = all.reduce((sum, x) => sum + JSON.stringify(x).length, 0);
      }
      sizes[s] = bytes;
    }
    return sizes;
  },

  // -------------------------------------------------------------------
  // Histórico de crescimento
  // -------------------------------------------------------------------
  _getHistory() {
    try { return JSON.parse(localStorage.getItem(this._historyKey) || '[]'); }
    catch (e) { return []; }
  },

  _pushHistory(snap) {
    const history = this._getHistory();
    history.push({
      ts: snap.geradoEm,
      counts: { ...snap.counts }
    });
    while (history.length > this._historyMax) history.shift();
    localStorage.setItem(this._historyKey, JSON.stringify(history));
  },

  _computeGrowth(snap) {
    const history = this._getHistory();
    if (history.length < 2) return null;
    const anterior = history[history.length - 2];
    const changes = {};
    for (const store of Object.keys(snap.counts)) {
      const antes = anterior.counts[store] || 0;
      const agora = snap.counts[store] || 0;
      changes[store] = { antes, agora, delta: agora - antes };
    }
    return { ts: anterior.ts, changes };
  },

  clearHistory() {
    App.utils.confirm('Limpar histórico de crescimento? Apenas as contagens são apagadas; nenhum dado financeiro é afetado.', () => {
      localStorage.removeItem(this._historyKey);
      App.utils.showToast('Histórico de métricas limpo.');
      this.load();
    });
  },

  // -------------------------------------------------------------------
  // Detalhes por problema
  // -------------------------------------------------------------------
  showDetails(key) {
    const s = this._lastSnapshot;
    if (!s) return;
    const map = {
      duplicatas: { titulo: 'Transações duplicadas', lista: s.duplicatas.flat(), impacto: 'Afeta saldo, dashboard, relatórios e extratos. Cada cópia extra é contada novamente.' },
      parcelamentos: { titulo: 'Grupos de parcelamento com problema', lista: s.parcelamentosProblemas, impacto: 'Afeta a tela Compras Parceladas, o Comprometimento Futuro e a contagem de parcelas ativas. Não afeta saldo.' },
      recorrentes: { titulo: 'Séries recorrentes com problema', lista: s.recorrentesProblemas, impacto: 'Afeta a projeção de fluxo de caixa e a tela de Transações. Não afeta saldo.' },
      investimentos: { titulo: 'Problemas em investimentos', lista: s.investProblemas, impacto: 'Afeta a tela Investimentos, o Patrimônio Líquido e o histórico de posições.' },
      faturas: { titulo: 'Problemas em faturas', lista: s.faturaProblemas, impacto: 'Afeta o saldo total: transações travadas são ignoradas por calculateBalance. Saldo fica maior que o real.' },
      cartaoDivergencias: { titulo: 'Transações de cartão com conta divergente', lista: s.cartaoDivergencias, impacto: 'Afeta a tela Detalhes da Conta e o agrupamento de faturas. A fatura pode aparecer na conta errada.' },
      cartaoOrfaos: { titulo: 'Transações com cartão inexistente', lista: s.cartaoOrfaos, impacto: 'Afeta filtros de cartão e a tela Detalhes da Conta. A transação deixa de aparecer agrupada na fatura.' },
      datas: { titulo: 'Transações com data inválida', lista: s.datasInvalidas, impacto: 'Afeta ordenações, filtros por período e agrupamentos mensais.' },
      valores: { titulo: 'Transações com valor inválido', lista: s.valoresInvalidos, impacto: 'Afeta saldo, todos os totais agregados, dashboard e relatórios.' }
    };
    const info = map[key];
    if (!info) return;

    const tbody = document.getElementById('cardDetailTableBody');
    const titleEl = document.getElementById('cardDetailTitle');
    const filterDiv = document.getElementById('cardDetailFilters');
    const totalEl = document.getElementById('cardDetailTotal');

    if (!tbody || !titleEl) return;
    titleEl.textContent = info.titulo;

    if (filterDiv) {
      const impactoHtml = (info.lista.length > 0 && info.impacto)
        ? `<div style="padding:10px 14px; background:rgba(96,165,250,0.08); border:1px solid rgba(96,165,250,0.25); border-radius:8px; font-size:0.8rem; color:var(--text); line-height:1.4; margin-bottom:10px;">
             <strong style="color:#60a5fa;">Impacto:</strong> ${info.impacto}
           </div>`
        : '';

      if (key === 'cartaoDivergencias' && info.lista.length > 0) {
        filterDiv.style.display = 'block';
        filterDiv.innerHTML = impactoHtml + `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; background:rgba(248,113,113,0.08); border:1px solid rgba(248,113,113,0.25); border-radius:8px;">
            <div style="font-size:0.85rem; color:var(--text);">
              <strong style="color:#f87171;">${info.lista.length}</strong> transação(ões) com conta divergente do cartão.
              O botão abaixo migra todas para a conta correta do cartão.
            </div>
            <button class="btn btn-primary btn-sm" onclick="App.metrics.fixCardAccountDivergences()" style="white-space:nowrap;">🔧 Corrigir todas</button>
          </div>
        `;
      } else if (key === 'cartaoOrfaos' && info.lista.length > 0) {
        filterDiv.style.display = 'block';
        filterDiv.innerHTML = impactoHtml + `
          <div style="padding:12px 16px; background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.25); border-radius:8px; font-size:0.85rem; color:var(--text);">
            <strong style="color:#fbbf24;">${info.lista.length}</strong> transação(ões) apontam para cartões que não existem mais.
            Revise os cartões excluídos ou edite cada transação manualmente.
          </div>
        `;
      } else if (info.lista.length > 0) {
        filterDiv.style.display = 'block';
        filterDiv.innerHTML = impactoHtml;
      } else {
        filterDiv.style.display = 'none';
        filterDiv.innerHTML = '';
      }
    }

    let html = '';
    if (info.lista.length === 0) {
      html = '<tr><td colspan="5" style="text-align:center; color:#888; padding:24px;">Nenhum problema encontrado.</td></tr>';
    } else {
      html = info.lista.slice(0, 500).map(item => {
        const linhas = Object.entries(item)
          .map(([k, v]) => `<div style="font-size:0.75rem; color:#888;"><strong style="color:#c9ced5;">${k}</strong>: ${Array.isArray(v) ? v.join(', ') : v}</div>`)
          .join('');
        return `<tr><td colspan="5" style="padding:10px; border-bottom:1px solid #1a1a1a;">${linhas}</td></tr>`;
      }).join('');
      if (info.lista.length > 500) {
        html += `<tr><td colspan="5" style="text-align:center; color:#888; padding:12px;">Mostrando 500 de ${info.lista.length}</td></tr>`;
      }
    }
    tbody.innerHTML = html;
    if (totalEl) totalEl.innerHTML = `Total: <strong>${info.lista.length}</strong>`;

    App.ui.openModal('modalCardDetail');
  },

  // -------------------------------------------------------------------
  // Correção em 1 clique das divergências cartão × conta
  // -------------------------------------------------------------------
  async fixCardAccountDivergences() {
    const s = this._lastSnapshot;
    if (!s || !s.cartaoDivergencias || s.cartaoDivergencias.length === 0) {
      App.utils.showToast('Nenhuma divergência para corrigir.', 'info');
      return;
    }

    const total = s.cartaoDivergencias.length;
    App.utils.confirm(
      `Corrigir ${total} transação(ões) para que herdem o account_id correto do cartão?`,
      async () => {
        try {
          const allAccounts = await App.db.getAll('accounts');
          const accNameMap = Object.fromEntries(allAccounts.map(a => [a.id, a.name || '']));

          const toFix = [];
          for (const item of s.cartaoDivergencias) {
            const tx = await App.db.getById('transactions', item.id);
            if (!tx) continue;
            tx.account_id = item.account_id_correto;
            tx.account_name = accNameMap[item.account_id_correto] || tx.account_name || '';
            tx.updatedAt = new Date().toISOString();
            toFix.push(tx);
          }

          if (toFix.length > 0) {
            await App.db.putMany('transactions', toFix);
          }

          App.transactions.invalidateCache?.();
          App.cache.totalBalance = null;
          App.cache.accounts = null;
          App.cache.creditCards = null;

          App.ui.closeModal('modalCardDetail');
          App.utils.showToast(`${toFix.length} transação(ões) corrigida(s).`);

          await this.load();
          if (App.saldos) await App.saldos.load();
          if (App.transactions) App.transactions.load();
          if (App.dashboard) App.dashboard.refresh();
          if (App.creditCards) App.creditCards.load();
          if (App.installments) App.installments.load();
          if (App.analytics) App.analytics.refresh();
        } catch (e) {
          console.error('Erro ao corrigir divergências de cartão:', e);
          App.utils.showToast('Erro ao corrigir divergências.', 'error');
        }
      }
    );
  },

  // -------------------------------------------------------------------
  // Auto-checagem no boot
  // -------------------------------------------------------------------
  async checkHealth() {
    try {
      const snap = await this._collectSnapshot();
      const problemas = snap.duplicatas.length
        + snap.parcelamentosProblemas.length
        + snap.recorrentesProblemas.length
        + snap.investProblemas.length
        + snap.faturaProblemas.length
        + snap.datasInvalidas.length
        + snap.valoresInvalidos.length
        + snap.tx.orfasReais
        + snap.tx.txSemConta
        + snap.tx.txCartaoInvalido
        + snap.cartaoDivergencias.length
        + snap.cartaoOrfaos.length;

      if (problemas > 0) {
        const msg = `🔍 ${problemas} problema(s) de integridade detectado(s). Abra Administração → Métricas para revisar.`;
        App.utils.addAlert(msg, 'warning', true);
      }
      return problemas;
    } catch (e) {
      console.error('Erro na auto-checagem de métricas:', e);
      return 0;
    }
  },

  // -------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------
  exportTXT() {
    const s = this._lastSnapshot;
    if (!s) {
      App.utils.showToast('Abra a página Métricas primeiro.', 'error');
      return;
    }
    const sep = '='.repeat(80);
    const sepMenor = '-'.repeat(80);
    const linhas = [];

    linhas.push(sep);
    linhas.push('MÉTRICAS DO BANCO DE DADOS – Contas Online');
    linhas.push(`Gerado em: ${new Date(s.geradoEm).toLocaleString('pt-BR')}`);
    linhas.push(sep);
    linhas.push('');

    linhas.push('CONTAGEM POR TABELA');
    linhas.push(sepMenor);
    Object.entries(s.counts).forEach(([k, v]) => linhas.push(`  ${k.padEnd(28, ' ')} : ${v}`));
    linhas.push('');

    linhas.push('CATEGORIAS');
    linhas.push(sepMenor);
    linhas.push(`  Total                      : ${s.cats.total}`);
    linhas.push(`  Principais                 : ${s.cats.principais}`);
    linhas.push(`  Subcategorias              : ${s.cats.sub}`);
    linhas.push(`  Arquivadas                 : ${s.cats.arquivadas}`);
    linhas.push(`  Duplicadas (nome+tipo)     : ${s.cats.duplicadas}`);
    linhas.push('');

    linhas.push('TRANSAÇÕES');
    linhas.push(sepMenor);
    linhas.push(`  Total                      : ${s.tx.total}`);
    linhas.push(`  Categoria válida           : ${s.tx.validas}`);
    linhas.push(`  Sem categoria              : ${s.tx.semCategoria}`);
    linhas.push(`  Strings internas           : ${s.tx.stringsInternas}`);
    linhas.push(`  Órfãs reais                : ${s.tx.orfasReais}`);
    linhas.push(`  Sem membro                 : ${s.tx.txSemMembro}`);
    linhas.push(`  Sem conta válida           : ${s.tx.txSemConta}`);
    linhas.push(`  Cartão inválido            : ${s.tx.txCartaoInvalido}`);
    linhas.push('');
    linhas.push('  Por tipo:');
    Object.entries(s.tx.porTipo).forEach(([k, v]) => linhas.push(`    ${k.padEnd(24, ' ')} : ${v}`));
    linhas.push('');
    linhas.push('  Por status:');
    Object.entries(s.tx.porStatus).forEach(([k, v]) => linhas.push(`    ${k.padEnd(24, ' ')} : ${v}`));
    linhas.push('');

    linhas.push('PROBLEMAS ESTRUTURAIS');
    linhas.push(sepMenor);
    linhas.push(`  Duplicatas                 : ${s.duplicatas.length}`);
    linhas.push(`  Parcelamentos              : ${s.parcelamentosProblemas.length}`);
    linhas.push(`  Recorrentes                : ${s.recorrentesProblemas.length}`);
    linhas.push(`  Investimentos              : ${s.investProblemas.length}`);
    linhas.push(`  Faturas                    : ${s.faturaProblemas.length}`);
    linhas.push(`  Cartão c/ conta divergente : ${s.cartaoDivergencias.length}`);
    linhas.push(`  Cartão inexistente         : ${s.cartaoOrfaos.length}`);
    linhas.push(`  Datas inválidas            : ${s.datasInvalidas.length}`);
    linhas.push(`  Valores inválidos          : ${s.valoresInvalidos.length}`);
    linhas.push('');

    linhas.push('ÓRFÃS REAIS POR NOME');
    linhas.push(sepMenor);
    const orf = [...s.orfasPorNome.entries()].sort((a, b) => b[1] - a[1]);
    if (orf.length === 0) {
      linhas.push('  (nenhuma)');
    } else {
      orf.forEach(([nome, qtd]) => linhas.push(`  ${nome.padEnd(40, ' ')} : ${qtd}`));
    }
    linhas.push('');

    linhas.push('HISTÓRICO DE CRESCIMENTO (últimos snapshots)');
    linhas.push(sepMenor);
    const history = this._getHistory();
    history.slice(-10).forEach(h => {
      const totalTx = (h.counts && h.counts.transactions) || 0;
      linhas.push(`  ${new Date(h.ts).toLocaleString('pt-BR').padEnd(22, ' ')} : transações=${totalTx}`);
    });
    linhas.push('');

    linhas.push(sep);
    linhas.push('FIM');
    linhas.push(sep);

    const blob = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' });
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `metricas_${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    App.utils.showToast('Métricas exportadas.');
  }
};

  function toggleNavGroup(btn) {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    if (sidebar && sidebar.classList.contains('mini')) {
      sidebar.classList.remove('mini');
      if (main) main.classList.remove('expanded');
    }
    // Fecha todos os outros grupos
    document.querySelectorAll('.nav-group-title').forEach(b => {
      if (b !== btn) {
        b.classList.remove('expanded');
        const otherItems = b.nextElementSibling;
        if (otherItems && otherItems.classList.contains('nav-group-items')) {
          otherItems.style.display = 'none';
        }
      }
    });
    // Alterna o grupo clicado
    const items = btn.nextElementSibling;
    if (items && items.classList.contains('nav-group-items')) {
      if (items.style.display === 'none' || items.style.display === '') {
        items.style.display = 'block';
        btn.classList.add('expanded');
      } else {
        items.style.display = 'none';
        btn.classList.remove('expanded');
      }
    }
  }