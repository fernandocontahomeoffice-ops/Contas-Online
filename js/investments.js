// =====================================================================
// ARQUIVO: investments.js
// Parcelamentos, Investimentos, Fontes Pagadoras, Search
// =====================================================================
var App = window.App || {};

  // =======================================================================
  // Parcelamentos (exclui despesas fixas) – otimizado com range de 10 anos
  // =======================================================================
  App.installments = {
    currentMonthStart: null,
    _allMonthsFilter: 'active',

    async load() {
    try {
      // A nova interface de parcelamentos usa apenas a visualização mensal
      if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
      await this.renderMonthlyView();
    } catch (e) {
      console.error(e);
      App.utils.showToast('Erro ao carregar parcelamentos.', 'error');
    }
  },

  // Retorna o HTML do logo do banco/cartão para exibir na coluna "Cartão / Fonte".
  // Usa App.creditCards.getBankLogo(), que já é utilizado nas telas de Saldos e
  // Detalhes da Conta. Se o logo não for encontrado ou a imagem falhar, cai de
  // volta para a primeira letra do nome (comportamento antigo).
  _renderCardLogo(cardName) {
    if (!cardName) return '';
    if (App.bankLogos && typeof App.bankLogos.renderLogoHtml === 'function') {
      return App.bankLogos.renderLogoHtml(cardName);
    }
    return String(cardName).charAt(0).toUpperCase();
  },

  // Retorna o HTML da pilha de logos quando a compra usa mais de um cartão/fonte.
  // Para uma única fonte, delega para _renderCardLogo (comportamento original).
  _renderCardLogos(cardNames) {
    const list = Array.isArray(cardNames) ? cardNames.filter(Boolean) : [];
    if (list.length === 0) return '';
    if (list.length === 1) {
      return `<div class="card-logo">${this._renderCardLogo(list[0])}</div>`;
    }
    const itemsHtml = list.map((nome, idx) => {
      const logo = this._renderCardLogo(nome);
      // z-index decrescente: o primeiro da esquerda fica por cima
      const z = list.length - idx;
      return `<div class="card-logo" style="z-index:${z};" title="${nome}">${logo}</div>`;
    }).join('');
    return `<div class="card-logo-stack">${itemsHtml}</div>`;
  },

      async renderMonthlyView() {
      if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
      const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);

      const labelEl = document.getElementById('installmentsMonthLabel');
      if (labelEl) labelEl.textContent = `Ref. ${cycle.refMonth}`;

      const monthInput = document.getElementById('installmentsMonthPicker');
      if (monthInput) {
        const d = new Date(this.currentMonthStart + 'T12:00:00');
        monthInput.value = d.toISOString().slice(0, 7);
      }

      const cards = App.cache.creditCards || await App.db.getAll('creditCards');
      if (!App.cache.creditCards) App.cache.creditCards = cards;
      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      if (!App.cache.accounts) App.cache.accounts = accounts;
      const members = App.cache.members || await App.db.getAll('members');
      if (!App.cache.members) App.cache.members = members;

      const startRange = App.utils.addMonths(App.utils.todayISO(), -60);
      const endRange = '2099-12-31';
      const allTx = await App.db.getTransactionsInRange(startRange, endRange);

      const todasParcelas = allTx.filter(t => t.type === 'expense' && t.installments > 1 && t.expense_type !== 'fixed' && !t.is_recurring_series);
      const parcelasAtivas = todasParcelas.filter(t => !t.hide_from_installments);

      const getEffectiveDate = (t) => {
        if (t.credit_card_id && (t.type === 'expense' || t.type === 'refund')) {
          const card = cards.find(c => c.id === t.credit_card_id);
          if (card) {
            try {
              const period = App.cardInvoice.getInvoicePeriodForDate(card, t.date.slice(0,10));
              if (period && period.due) return period.due.slice(0,10);
            } catch (e) {}
          }
        }
        return t.date.slice(0,10);
      };

      const startOnly = cycle.start.slice(0,10);
      const endOnly = cycle.end.slice(0,10);

      const parcelas = todasParcelas.filter(t => {
        const eff = getEffectiveDate(t);
        return eff >= startOnly && eff <= endOnly;
      });

      const parcelasAtivasDoMes = parcelasAtivas.filter(t => {
        const eff = getEffectiveDate(t);
        return eff >= startOnly && eff <= endOnly;
      });

      const totalParcelas = parcelasAtivasDoMes.reduce((s, t) => s + parseFloat(t.amount), 0);
      const confirmadas = parcelasAtivasDoMes.filter(t => t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);
      const pendentes = parcelasAtivasDoMes.filter(t => t.status === 'pending').reduce((s, t) => s + parseFloat(t.amount), 0);
      const totalLancamentos = parcelasAtivasDoMes.length;

      // Cards de resumo mensal
      const summaryEl = document.getElementById('installmentsMonthlySummary');
      if (summaryEl) {
        const pctConfirmadas = totalParcelas > 0 ? (confirmadas / totalParcelas) * 100 : 0;
        summaryEl.innerHTML = `
          <div class="card">
            <div class="card-label">Total do mês</div>
            <div class="card-value">${App.utils.formatCurrency(totalParcelas)}</div>
            <div class="card-subtitle">${totalLancamentos} lançamentos</div>
            <div class="card-icon"><i data-lucide="wallet"></i></div>
          </div>
          <div class="card green">
            <div class="card-label">Pagas</div>
            <div class="card-value">${App.utils.formatCurrency(confirmadas)}</div>
            <div class="card-subtitle">${pctConfirmadas.toFixed(0)}% do mês</div>
            <div class="circle-progress" style="background: radial-gradient(circle, #15191e 58%, transparent 60%), conic-gradient(#54df86 ${pctConfirmadas * 3.6}deg, #263028 0deg)">${pctConfirmadas.toFixed(0)}%</div>
          </div>
          <div class="card red">
            <div class="card-label">Pendentes</div>
            <div class="card-value">${App.utils.formatCurrency(pendentes)}</div>
            <div class="card-subtitle">${parcelasAtivasDoMes.filter(t => t.status === 'pending').length} parcelas</div>
            <div class="circle-progress red-progress" style="background: radial-gradient(circle, #17191c 58%, transparent 60%), conic-gradient(#ff5d5d ${(100 - pctConfirmadas) * 3.6}deg, #3a2527 0deg)">${(100 - pctConfirmadas).toFixed(0)}%</div>
          </div>
          <div class="card purple">
            <div class="card-label">Compras ativas</div>
            <div class="card-value">${this._getActivePurchasesCount(todasParcelas)}</div>
            <div class="card-subtitle">${this._getTotalInstallmentsCount(todasParcelas)} lançamentos</div>
            <div class="card-icon"><i data-lucide="shopping-bag"></i></div>
          </div>
        `;
        lucide.createIcons({ attrs: { stroke: 'currentColor', 'stroke-width': '2', width: '24', height: '24' } });
      }

      // Comprometimento futuro
      const futureParcelas = parcelasAtivas.filter(t => getEffectiveDate(t) >= startOnly && getEffectiveDate(t) <= '2100-01-01');
      const futureTotal = futureParcelas.reduce((s, t) => s + parseFloat(t.amount), 0);
      const futureMonths = [...new Set(futureParcelas.map(t => getEffectiveDate(t).slice(0,7)))].sort();
      const commitmentEl = document.getElementById('installmentsCommitment');
      if (commitmentEl) {
        commitmentEl.innerHTML = `
          <div style="display:grid; grid-template-columns: 200px 1fr; gap: 20px;">
            <div>
              <div class="total-label">Total restante</div>
              <div class="total-value" style="color:#54df86; font-size:22px; margin-top:8px;">${App.utils.formatCurrency(futureTotal)}</div>
              <div class="total-small" style="color:#a1a8b2; font-size:10px; margin-top:7px;">${futureParcelas.length} parcelas futuras</div>
              <div class="committed-box" style="margin-top:14px; background:#161a1f; border:1px solid #282e35; border-radius:6px; padding:10px 12px; width:185px;">
                <small style="display:block; color:#a3abb5; font-size:10px;">Total comprometido</small>
                <strong style="display:block; font-size:15px; margin-top:5px; color:#fff;">${App.utils.formatCurrency(futureTotal + totalParcelas)}</strong>
                <span style="display:block; font-size:9px; color:#7e8791; margin-top:3px;">Este mês + futuros</span>
              </div>
            </div>
            <div class="month-bars">
              ${futureMonths.slice(0, 6).map((mes, idx) => {
                const mesTotal = futureParcelas.filter(t => getEffectiveDate(t).slice(0,7) === mes).reduce((s,t) => s + parseFloat(t.amount), 0);
                const maxTotal = Math.max(...futureMonths.slice(0,6).map(m => futureParcelas.filter(t => getEffectiveDate(t).slice(0,7) === m).reduce((s,t) => s + parseFloat(t.amount), 0)), 1);
                const pct = (mesTotal / maxTotal) * 100;
                const data = new Date(mes + '-01T12:00:00');
                const label = data.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
                return `
                  <div class="bar-row">
                    <div class="bar-label">${label}</div>
                    <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:#56d985;"></div></div>
                    <div class="bar-value">${App.utils.formatCurrency(mesTotal)}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <button class="see-all-months" onclick="App.installments.openAllMonths()">
            <span>Ver todos os meses</span>
            <span class="arrow-down">▼</span>
          </button>
        `;
      }

      // Resumo de status
      const statusEl = document.getElementById('installmentsStatusSummary');
      if (statusEl) {
        const ativas = todasParcelas.filter(t => !t.hide_from_installments).length;
        const ultima = todasParcelas.filter(t => !t.hide_from_installments && t.installment_number === t.installments).length;
        const penultima = todasParcelas.filter(t => !t.hide_from_installments && t.installment_number === t.installments - 1).length;
        const atrasadas = todasParcelas.filter(t => !t.hide_from_installments && t.status === 'pending' && t.date.slice(0,10) < App.utils.todayISO()).length;
        const totalTodas = todasParcelas.length || 1;
        statusEl.innerHTML = `
          <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px;">
            <div class="status-card blue">
              <div class="status-top"><i data-lucide="circle-check"></i> Ativas</div>
              <div class="status-number">${ativas}</div>
              <div class="status-percent">${Math.round((ativas / totalTodas) * 100)}%</div>
            </div>
            <div class="status-card yellow">
              <div class="status-top"><i data-lucide="flame"></i> Última parcela</div>
              <div class="status-number">${ultima}</div>
              <div class="status-percent">${Math.round((ultima / totalTodas) * 100)}%</div>
            </div>
            <div class="status-card orange">
              <div class="status-top"><i data-lucide="bookmark"></i> Penúltima parcela</div>
              <div class="status-number">${penultima}</div>
              <div class="status-percent">${Math.round((penultima / totalTodas) * 100)}%</div>
            </div>
            <div class="status-card red">
              <div class="status-top"><i data-lucide="clock"></i> Atrasadas</div>
              <div class="status-number">${atrasadas}</div>
              <div class="status-percent">${Math.round((atrasadas / totalTodas) * 100)}%</div>
            </div>
          </div>
          <div class="status-alert" style="margin-top:14px; min-height:37px; border:1px solid #234c83; background:#101d30; border-radius:6px; display:flex; align-items:center; padding:0 13px; gap:10px; font-size:10px; color:#d1d9e2;">
            <i data-lucide="info" style="color:#5598ff; font-size:18px;"></i>
            <span>${ultima} compras na última parcela e ${penultima} na penúltima.</span>
            <a href="#" style="margin-left:auto; color:#5598ff; text-decoration:none; font-size:9px;">Ver detalhes →</a>
          </div>
        `;
        lucide.createIcons({ attrs: { stroke: 'currentColor', 'stroke-width': '2', width: '24', height: '24' } });
      }

          const tbody = document.getElementById('installmentsMonthlyTableBody');
      const empty = document.getElementById('installmentsMonthlyEmpty');
      if (tbody && empty) {
        if (parcelas.length > 0) {
          empty.style.display = 'none';

          // ===== Agrupa parcelas por compra (descrição base + data de compra + categoria) =====
          const gruposCompra = {};
          parcelas.forEach(t => {
            const descBase = (t.description || '').split(' - Parcela')[0].trim() || t.category || 'Parcela';
            const purchaseDate = t.purchase_date || t.date.slice(0, 10);
            const catKey = t.category || 'Outros';
            const key = `${descBase}__${purchaseDate}__${catKey}`;
            if (!gruposCompra[key]) gruposCompra[key] = [];
            gruposCompra[key].push(t);
          });

          // ===== Monta as linhas (individuais ou unificadas) =====
          const linhas = Object.values(gruposCompra).map(grupo => {
            grupo.sort((a, b) => getEffectiveDate(a).localeCompare(getEffectiveDate(b)));

            const primeiro = grupo[0];
            const descricaoLimpa = (primeiro.description || '').split(' - Parcela')[0].trim() || primeiro.category || 'Parcela';
            const categoriaCompra = primeiro.category || 'Outros';
            const effectiveDate = getEffectiveDate(primeiro);
            const memberName = primeiro.member_name || (primeiro.member_splits && primeiro.member_splits.length ? primeiro.member_splits.map(s => (members.find(m => m.id === s.member_id)?.name || s.member_id)).join(' + ') : '');

            // Verifica se é compra dividida entre cartões (2+ cartões diferentes no mesmo grupo)
            const cardsUnicos = new Set(grupo.filter(t => t.credit_card_id).map(t => t.credit_card_id));
            const ehDivididoEntreCartoes = cardsUnicos.size > 1;

            if (!ehDivididoEntreCartoes) {
              // ===== Linha individual (comportamento original) =====
              const t = primeiro;
              const fonte = t.credit_card_id ? (cards.find(c => c.id === t.credit_card_id)?.name || 'Cartão') : (t.account_name || 'Conta');
              const parcelaLabel = `${t.installment_number} de ${t.installments}`;
              let parcelaSufixo = '';
              if (t.installment_number === t.installments) parcelaSufixo = ' 🔥';
              else if (t.installment_number === t.installments - 1) parcelaSufixo = ' 🙌🏻';
              const situacaoBadge = t.hide_from_installments ? '<span class="badge ignored">Ignorada</span>' : '<span class="badge active">Ativa</span>';
              const statusBadge = t.status === 'confirmed' ? '<span class="badge paid">✓ Paga</span>' : '<span class="badge" style="color:#ffbc50; background:#34270f;">⏳ Pendente</span>';
              return {
                sortDate: effectiveDate,
                html: `
                  <tr>
                    <td>${App.utils.formatDateTime(effectiveDate)}${t.credit_card_id ? ' 🏦' : ''}</td>
                    <td><div class="purchase"><div class="purchase-icon"><i data-lucide="shopping-cart"></i></div><div><div class="purchase-name">${descricaoLimpa}</div><div class="purchase-type">${categoriaCompra}</div></div></div></td>
                    <td>${memberName}</td>
                    <td><div class="card-source"><div class="card-logo">${this._renderCardLogo(fonte)}</div><div><div class="card-name">${fonte}</div><div class="card-number"></div></div></div></td>
                    <td><div class="installment-main">${parcelaLabel}${parcelaSufixo}</div><div class="installment-sub">${t.installments - t.installment_number} restantes</div><div class="installment-progress"><span style="width:${(t.installment_number / t.installments) * 100}%"></span></div></td>
                    <td class="value">${App.utils.formatCurrency(t.amount)}</td>
                    <td>${situacaoBadge}</td>
                    <td>${statusBadge}</td>
                    <td class="action-cell"><button class="row-action" onclick="App.installments.showDetail('${t.installment_id || t.id}')"><i data-lucide="more-vertical"></i></button></td>
                  </tr>
                `
              };
            }

            // ===== Linha unificada (compra dividida entre cartões) =====
            const valorTotal = grupo.reduce((s, t) => s + parseFloat(t.amount), 0);
            const maxInstallments = Math.max(...grupo.map(t => t.installments));
            const serieLonga = grupo.reduce((maior, t) => (t.installments > maior.installments ? t : maior), grupo[0]);
            const parcelaAtual = serieLonga.installment_number;

            // Junta os nomes dos cartões únicos, mantendo a ordem de aparição
            const cardsUsados = [];
            grupo.forEach(t => {
              if (t.credit_card_id) {
                const nome = cards.find(c => c.id === t.credit_card_id)?.name || 'Cartão';
                if (!cardsUsados.includes(nome)) cardsUsados.push(nome);
              } else if (t.account_name && !cardsUsados.includes(t.account_name)) {
                cardsUsados.push(t.account_name);
              }
            });
            const fonte = cardsUsados.length > 0 ? cardsUsados.join(' + ') : 'Conta';
            // Lista de nomes para a pilha de logos (usa todos os cartões/fontes envolvidos).
            const fontesParaLogo = cardsUsados.length > 0 ? cardsUsados : ['Conta'];

            const parcelaLabel = `${parcelaAtual} de ${maxInstallments}`;
            let parcelaSufixo = '';
            if (parcelaAtual === maxInstallments) parcelaSufixo = ' 🔥';
            else if (parcelaAtual === maxInstallments - 1) parcelaSufixo = ' 🙌🏻';

            const todasOcultas = grupo.every(t => t.hide_from_installments);
            const situacaoBadge = todasOcultas ? '<span class="badge ignored">Ignorada</span>' : '<span class="badge active">Ativa</span>';

            const todasPagas = grupo.every(t => t.status === 'confirmed');
            const statusBadge = todasPagas ? '<span class="badge paid">✓ Paga</span>' : '<span class="badge" style="color:#ffbc50; background:#34270f;">⏳ Pendente</span>';

            const detailId = serieLonga.installment_id || serieLonga.id;

            return {
              sortDate: effectiveDate,
              html: `
                <tr>
                  <td>${App.utils.formatDateTime(effectiveDate)} 🏦</td>
                  <td><div class="purchase"><div class="purchase-icon"><i data-lucide="shopping-cart"></i></div><div><div class="purchase-name">${descricaoLimpa}</div><div class="purchase-type">${categoriaCompra}</div></div></div></td>
                  <td>${memberName}</td>
                  <td><div class="card-source">${this._renderCardLogos(fontesParaLogo)}<div><div class="card-name">${fonte}</div><div class="card-number"></div></div></div></td>
                  <td><div class="installment-main">${parcelaLabel}${parcelaSufixo}</div><div class="installment-sub">${maxInstallments - parcelaAtual} restantes</div><div class="installment-progress"><span style="width:${(parcelaAtual / maxInstallments) * 100}%"></span></div></td>
                  <td class="value">${App.utils.formatCurrency(valorTotal)}</td>
                  <td>${situacaoBadge}</td>
                  <td>${statusBadge}</td>
                  <td class="action-cell"><button class="row-action" onclick="App.installments.showDetail('${detailId}')"><i data-lucide="more-vertical"></i></button></td>
                </tr>
              `
            };
          });

          tbody.innerHTML = linhas
            .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
            .map(l => l.html)
            .join('');
          lucide.createIcons({ attrs: { stroke: 'currentColor', 'stroke-width': '2', width: '24', height: '24' } });
        } else {
          tbody.innerHTML = '';
          empty.style.display = 'block';
        }
      }
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
      const month = document.getElementById('installmentsMonthPicker')?.value;
      if (month) {
        const [y, m] = month.split('-');
        this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate;
        this.load();
      }
    },

    async simulateInstallments() {
      try {
        await this.openSimulationModal();
      } catch (e) {
        console.error('Erro ao abrir modal de simulação:', e);
        App.utils.showToast('Erro ao abrir simulação.', 'error');
      }
    },

    async openSimulationModal() {
      const members = App.cache.members || await App.db.getAll('members');
      if (!App.cache.members) App.cache.members = members;
      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      if (!App.cache.accounts) App.cache.accounts = accounts;

      const selMembro = document.getElementById('simMembro');
      if (selMembro) {
        selMembro.innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
      }

      const selConta = document.getElementById('simConta');
      if (selConta) {
        selConta.innerHTML = accounts.filter(a => !a.archived).map(a => `<option value="${a.id}">${a.name}</option>`).join('');
      }

      const mesInput = document.getElementById('simMes');
      if (mesInput) {
        mesInput.value = (this.currentMonthStart || App.utils.currentMonth().startDate).slice(0, 7);
      }

      App.ui.openModal('modalSimulate');
    },

    async saveSimulation(e) {
      e.preventDefault();
      try {
        const valor = parseFloat(document.getElementById('simValor').value);
        const qtd = parseInt(document.getElementById('simQtd').value, 10);
        const memberId = document.getElementById('simMembro').value;
        const accountId = document.getElementById('simConta').value;
        const baseMonth = document.getElementById('simMes').value;

        if (isNaN(valor) || valor <= 0) {
          App.utils.showToast('Valor inválido.', 'error');
          return false;
        }
        if (isNaN(qtd) || qtd < 1 || qtd > 720) {
          App.utils.showToast('Quantidade inválida (máx. 720).', 'error');
          return false;
        }
        if (!memberId || !accountId || !baseMonth) {
          App.utils.showToast('Preencha todos os campos.', 'error');
          return false;
        }

        const startDate = baseMonth + '-01';

        const members = App.cache.members || await App.db.getAll('members');
        if (!App.cache.members) App.cache.members = members;
        const accounts = App.cache.accounts || await App.db.getAll('accounts');
        if (!App.cache.accounts) App.cache.accounts = accounts;
        const member = members.find(m => m.id === memberId);
        const account = accounts.find(a => a.id === accountId);

        const groupId = App.utils.generateId();
        const parcelas = [];
        for (let i = 0; i < qtd; i++) {
          const dataParcela = App.utils.addMonths(startDate, i);
          parcelas.push({
            id: App.utils.generateId(),
            type: 'expense',
            amount: valor,
            category: 'Outros',
            description: 'Simulação de Parcela',
            date: dataParcela,
            account_id: account.id,
            account_name: account.name,
            account_to_id: null,
            account_to_name: null,
            member_id: member.id,
            member_name: member.name,
            credit_card_id: null,
            payment_method: 'cash',
            classification: 'necessary',
            receipt_url: '',
            purchase_date: App.utils.todayISO(),
            installment_id: groupId,
            installments: qtd,
            installment_number: i + 1,
            recurring: false,
            vacation: false,
            status: 'pending',
            reconciled: false,
            ignore_from_total: false,
            simulated: true,
            expense_type: 'installment',
            transfer_subtype: '',
            created_at: new Date().toISOString(),
            position: Date.now()
          });
        }

        await App.db.putMany('transactions', parcelas);
        App.ui.closeModal('modalSimulate');
        App.utils.showToast(`✅ ${qtd} parcelas simuladas criadas!`);
        this.load();
      } catch (e) {
        console.error('Erro ao salvar simulação:', e);
        App.utils.showToast('Erro ao salvar simulação.', 'error');
      }
      return false;
    },

    async deleteSimulatedInstallments() {
      try {
        App.utils.confirm('Excluir todas as parcelas simuladas?', async () => {
          const allTx = await App.db.getAll('transactions');
          const simuladas = allTx.filter(t => t.simulated === true);
          if (simuladas.length === 0) {
            App.utils.showToast('Nenhuma parcela simulada encontrada.', 'info');
            return;
          }

          for (const tx of simuladas) {
            await App.db.delete('transactions', tx.id);
          }

          App.utils.showToast(`🗑️ ${simuladas.length} parcelas simuladas excluídas!`);
          this.load();
        });
      } catch (e) {
        console.error('Erro ao excluir simulação:', e);
        App.utils.showToast('Erro ao excluir simulação.', 'error');
      }
    },

    async showDetail(installmentId) {
      const startDate = App.utils.addMonths(App.utils.todayISO(), -120);
      const endDate = '2099-12-31';
      const txAll = await App.db.getTransactionsInRange(startDate, endDate);
      
      // 1. Tenta localizar a transação específica (quando chamada passando o id da parcela)
      const targetTx = txAll.find(t => t.id === installmentId);
      // 2. Se encontrou, usa o installment_id da transação para achar o grupo; senão mantém o id recebido (modo antigo)
      const groupId = targetTx ? targetTx.installment_id : installmentId;
      
      const group = txAll.filter(t => t.type === 'expense' && (t.installment_id === groupId || t.id === groupId) && t.expense_type !== 'fixed' && !t.is_recurring_series).sort((a,b) => a.installment_number - b.installment_number);
      if (!group.length) return;
      
      const first = group[0];
      const creditCards = App.cache.creditCards || await App.db.getAll('creditCards');
      if (!App.cache.creditCards) App.cache.creditCards = creditCards;
      const cardNames = Object.fromEntries(creditCards.map(c => [c.id, c.name]));
      const total = first.amount * first.installments;

      // 3. Define o número da parcela a ser exibido no card "Parcelas"
      //    Prioridade: transação clicada -> última parcela com status 'confirmed' (fallback).
      const currentTx = group.find(t => t.id === installmentId);
      const currentNumber = currentTx
        ? currentTx.installment_number
        : (group.filter(t => t.status === 'confirmed').length || first.installments);

      // 4. Total de parcelas realmente efetivadas (para valor restante)
      const paidCount = group.filter(t => t.status === 'confirmed').length;
      const remainingValue = group.filter(t => t.status !== 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);

      const cardIds = [...new Set(group.map(t => t.credit_card_id).filter(Boolean))];
      const cardsStr = cardIds.length ? cardIds.map(id => cardNames[id] || 'Cartão').join(', ') : 'Nenhum';
      // Limpa o nome removendo sufixos de parcela: " 1/3", "- Parcela 1 de 3", "- Parcela 1/3" etc.
      const cleanName = (first.description || first.category || 'Compra parcelada')
        .replace(/\s+\d+\/\d+$/, '')                         // remove " 6/12"
        .replace(/\s*-\s*Parcela\s+\d+\s+de\s+\d+\s*$/i, '') // remove "- Parcela 1 de 3"
        .replace(/\s*-\s*Parcela\s+\d+\/\d+\s*$/i, '')       // remove "- Parcela 1/3"
        .trim();

      // Função auxiliar para obter a data de exibição: vencimento da fatura se for cartão de crédito, senão data original
      const getDisplayDate = (t) => {
        if (t.credit_card_id) {
          const card = creditCards.find(c => c.id === t.credit_card_id);
          if (card) {
            try {
              const period = App.cardInvoice.getInvoicePeriodForDate(card, t.date.slice(0,10));
              if (period && period.due) {
                return App.utils.formatDateTime(period.due);
              }
            } catch (e) {
              // Fallback silencioso para a data original
            }
          }
        }
        return App.utils.formatDateTime(t.date);
      };

      let html = `<div class="cards-row">
        <div class="card"><div class="card-label">Descrição</div><div class="card-value" style="font-size:1rem;">${first.description||first.category||'Compra parcelada'}</div></div>
        <div class="card"><div class="card-label">Total</div><div class="card-value">${App.utils.formatCurrency(total)}</div></div>
        <div class="card"><div class="card-label">Cartão(ões)</div><div class="card-value" style="font-size:1rem;">${cardsStr}</div></div></div>
      <div class="cards-row"><div class="card"><div class="card-label">Data da Compra</div><div class="card-value" style="font-size:1rem;">${App.utils.formatDateTime(first.purchase_date || first.date)}</div></div>
        <div class="card"><div class="card-label">Parcelas</div><div class="card-value">${currentNumber}/${first.installments}</div></div>
        <div class="card"><div class="card-label">Valor Restante</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(remainingValue)}</div></div></div>
      <div style="margin:16px 0;display:flex;gap:8px;">
         <button class="btn btn-primary btn-sm" onclick="App.installments.addToPatrimony('${cleanName.replace(/'/g, "\\'")}', '${first.installment_id || first.id}')">🏠 Incluir no Patrimônio</button>
        <button class="btn btn-sm ${first.hide_from_installments ? 'btn-danger' : 'btn-outline'}" onclick="App.installments.toggleHideFromMonthly('${first.installment_id || first.id}')">${first.hide_from_installments ? '👁️ Exibir no Total' : '🙈 Ocultar do Total'}</button>
      </div>
      <div style="margin:12px 0;">
        <div class="progress-bar-bg" style="height: 20px; border-radius: 10px;">
          <div class="progress-bar-fill" style="width:${Math.round((paidCount / first.installments) * 100)}%; height: 100%; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.75rem; font-weight: 600; background: linear-gradient(90deg, var(--income), #2e7d32);">
            ${Math.round((paidCount / first.installments) * 100)}% pago
          </div>
        </div>
      </div>
      <div class="table-container"><table><thead><tr><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Membro</th><th>Status</th></tr></thead><tbody>
      ${group.map(t => `<tr><td>${t.installment_number}/${t.installments}</td><td>${getDisplayDate(t)}</td><td>${App.utils.formatCurrency(t.amount)}</td><td>${t.member_name||''}</td><td>${t.status === 'confirmed' ? '<span style="color:var(--income);">✅ Pago</span>' : '<span style="color:var(--expense);">⏳ Pendente</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
      document.getElementById('installmentDetailContent').innerHTML = html;
      App.ui.openModal('modalInstallmentDetail');
    },

    async toggleHideFromMonthly(groupId) {
      const startDate = App.utils.addMonths(App.utils.todayISO(), -120);
      const endDate = '2099-12-31';
      const txAll = await App.db.getTransactionsInRange(startDate, endDate);
      const grupo = txAll.filter(t => t.type === 'expense' && (t.installment_id === groupId || t.id === groupId) && !t.is_recurring_series);
      if (!grupo.length) {
        App.utils.showToast('Não foi possível localizar as parcelas.', 'error');
        return;
      }
      const novaSituacao = !grupo[0].hide_from_installments;
      for (const t of grupo) {
        t.hide_from_installments = novaSituacao;
        await App.db.put('transactions', t);
      }
      App.utils.showToast(novaSituacao ? 'Compra ocultada do total mensal.' : 'Compra exibida no total mensal.');
      this.load();
      App.ui.closeModal('modalInstallmentDetail');
    },

      async addToPatrimony(name, installmentId) {
      try {
        // Busca todas as transações do grupo para calcular o valor total real
        const allTx = await App.db.getAll('transactions');
        let grupo = allTx.filter(t =>
          t.type === 'expense' &&
          (t.installment_id === installmentId || t.id === installmentId)
        );

        // Fallback: se não encontrou pelo ID, tenta agrupar pela descrição base
        if (grupo.length === 0 && name) {
          const descricaoBase = name.replace(/\s+\d+\/\d+$/, '').trim().toLowerCase();
          grupo = allTx.filter(t =>
            t.type === 'expense' &&
            t.installments > 1 &&
            (t.description || '').toLowerCase().startsWith(descricaoBase)
          );
        }

        if (grupo.length === 0) {
          App.utils.showToast('Não foi possível encontrar as parcelas desta compra.', 'error');
          return;
        }

        const total = grupo.reduce((soma, t) => soma + parseFloat(t.amount), 0);

        if (total <= 0) {
          App.utils.showToast('Não foi possível calcular o valor total da compra.', 'error');
          return;
        }

        // Permite ao usuário ajustar o nome antes de confirmar
        const nomePadrao = name
          .replace(/\s+\d+\/\d+$/, '')
          .replace(/\s*-\s*Parcela\s+\d+\s+de\s+\d+\s*$/i, '')
          .replace(/\s*-\s*Parcela\s+\d+\/\d+\s*$/i, '')
          .trim();

        App.utils.prompt(
          `Nome do item no patrimônio:`,
          nomePadrao,
          async (nomeFinal) => {
            if (!nomeFinal || nomeFinal.trim() === '') {
              App.utils.showToast('Nome não pode ser vazio.', 'error');
              return;
            }

            App.utils.confirm(
              `Incluir "${nomeFinal.trim()}" no patrimônio com valor total ${App.utils.formatCurrency(total)}?`,
              async () => {
                await App.db.put('patrimony', {
                  id: App.utils.generateId(),
                  name: nomeFinal.trim(),
                  type: 'asset',
                  value: total,
                  date: App.utils.todayISO(),
                  description: 'Adicionado via compra parcelada (valor total)',
                  createdAt: new Date().toISOString()
                });
                App.utils.showToast('Incluído no patrimônio!');
                App.ui.closeModal('modalInstallmentDetail');
                if (typeof App.patrimony?.load === 'function') {
                  await App.patrimony.load();
                }
              }
            );
          },
          () => {
            App.utils.showToast('Inclusão cancelada.', 'info');
          }
        );
      } catch (e) {
        console.error('Erro ao adicionar ao patrimônio:', e);
        App.utils.showToast('Erro ao adicionar ao patrimônio.', 'error');
      }
    },
    showRendaTooltip(event, income, parcels, percent) {
      // Remove tooltip anterior se existir
      this.hideRendaTooltip();

      const card = event.currentTarget;
      const cardRect = card.getBoundingClientRect();
      const percentual = income > 0 ? (parcels / income * 100).toFixed(1) : '0.0';
      const colorPercent = percent > 30 ? '#c62828' : percent > 15 ? '#f57c00' : '#2e7d32';
      const colorBar = percent > 30 ? '#c62828' : percent > 15 ? '#f57c00' : '#2e7d32';
      const tooltip = document.createElement('div');
      tooltip.id = 'renda-tooltip';
      tooltip.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          <div style="display:flex; justify-content:space-between; gap:16px;">
            <span style="color:var(--text-light);">Receita Mensal</span>
            <strong>${App.utils.formatCurrency(income)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; gap:16px;">
            <span style="color:var(--text-light);">Total Parcelas</span>
            <strong>${App.utils.formatCurrency(parcels)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; gap:16px;">
            <span style="color:var(--text-light);">Comprometimento</span>
            <strong style="color:${colorPercent}">${percentual}%</strong>
          </div>
          <div class="progress-bar-bg" style="height:4px; margin-top:4px;">
            <div class="progress-bar-fill" style="width:${Math.min(percent, 100)}%; background:${colorBar};"></div>
          </div>
        </div>
      `;
      Object.assign(tooltip.style, {
        position: 'fixed',
        left: (cardRect.right + 12) + 'px',
        top: (cardRect.top + cardRect.height / 2) + 'px',
        transform: 'translateY(-50%)',
        background: 'rgba(30, 30, 30, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '14px 18px',
        zIndex: '9999',
        boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        fontSize: '0.85rem',
        maxWidth: '260px',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity 0.2s ease'
      });
      document.body.appendChild(tooltip);
      // Força o browser a aplicar o estilo inicial e depois anima a opacidade
      requestAnimationFrame(() => {
        tooltip.style.opacity = '1';
      });
    },

    hideRendaTooltip() {
      const tooltip = document.getElementById('renda-tooltip');
      if (tooltip) {
        tooltip.style.opacity = '0';
        setTimeout(() => {
          if (tooltip.parentNode) tooltip.remove();
        }, 200);
      }
    },

    _getActivePurchasesCount(todasParcelas) {
      const grupos = new Set(
        todasParcelas
          .filter(t => !t.hide_from_installments)
          .map(t => t.installment_id || t.id)
      );
      return grupos.size;
    },

    _getTotalInstallmentsCount(todasParcelas) {
      return todasParcelas.filter(t => !t.hide_from_installments).length;
    },

    async openAllMonths() {
      App.ui.navigateTo('all-installments');
    },

    setAllMonthsFilter(filter) {
      this._allMonthsFilter = (filter === 'history') ? 'history' : 'active';
      this.renderAllMonthsPage();
    },

    async renderAllMonthsPage() {
      try {
        const startDate = App.utils.addMonths(App.utils.todayISO(), -120);
        const endDate = '2099-12-31';
        const txAll = await App.db.getTransactionsInRange(startDate, endDate);
        const groups = {};
        txAll.filter(t => t.type === 'expense' && t.installments > 1 && t.expense_type !== 'fixed' && !t.is_recurring_series).forEach(t => {
          // Prioriza purchase_name para agrupar compras divididas em cartões diferentes
          const key = t.purchase_name || t.installment_id || t.id;
          if (!groups[key]) groups[key] = [];
          groups[key].push(t);
        });

        const allRows = Object.values(groups).map(group => {
          group.sort((a, b) => a.installment_number - b.installment_number);
          const first = group[0];
          const total = first.amount * first.installments;
          const paid = group.filter(t => t.status === 'confirmed').length;
          const remaining = first.installments - paid;
          const remainingValue = group.filter(t => t.status !== 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);
          // Data da compra: prioriza o campo purchase_date; se não existir, usa
          // a data da primeira parcela como fallback (comportamento antigo).
          const purchaseDate = (first.purchase_date && first.purchase_date.slice(0, 10))
            || (first.date ? first.date.slice(0, 10) : '');
          return {
            id: first.installment_id || first.id,
            description: first.description || first.category || 'Compra parcelada',
            purchaseDate,
            total,
            totalInstallments: first.installments,
            paid,
            remaining,
            remainingValue,
            progress: (paid / first.installments) * 100,
            hide_from_installments: first.hide_from_installments || false
          };
        }).sort((a, b) => b.remainingValue - a.remainingValue);

        // Status: ativa = ainda tem parcela não paga; histórico = totalmente quitada
        const activeAll = allRows.filter(r => r.remaining > 0);
        const historyAll = allRows.filter(r => r.remaining === 0);

        const currentFilter = this._allMonthsFilter === 'history' ? 'history' : 'active';
        const rows = currentFilter === 'history' ? historyAll : activeAll;

        const currentMonth = App.utils.currentMonth();
        const monthTx = await App.db.getTransactionsInRange(currentMonth.start, currentMonth.end, { status: 'confirmed' });
        const monthlyIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);

        const filteredActiveRows = rows.filter(r => !r.hide_from_installments);
        const totalRemaining = filteredActiveRows.reduce((s, r) => s + r.remainingValue, 0);
        const totalMonthlyParcels = filteredActiveRows.reduce((s, r) => s + (r.totalInstallments > 0 ? r.total / r.totalInstallments : 0), 0);
        const totalIncomePercent = monthlyIncome > 0 ? (totalMonthlyParcels / monthlyIncome) * 100 : 0;

        let thisMonthTotal = 0;
        let thisMonthPaid = 0;
        let thisMonthPending = 0;
        Object.values(groups).forEach(group => {
          if (group[0] && group[0].hide_from_installments) return;
          const isHistory = group.every(t => t.status === 'confirmed');
          if (currentFilter === 'active' && isHistory) return;
          if (currentFilter === 'history' && !isHistory) return;
          group.forEach(t => {
            const dateOnly = t.date.slice(0, 10);
            if (dateOnly >= currentMonth.start && dateOnly <= currentMonth.end) {
              const val = parseFloat(t.amount);
              thisMonthTotal += val;
              if (t.status === 'confirmed') {
                thisMonthPaid += val;
              } else {
                thisMonthPending += val;
              }
            }
          });
        });

        const rowsHtml = rows.map(r => {
          const monthlyParcel = r.totalInstallments > 0 ? r.total / r.totalInstallments : 0;
          const incomePercent = monthlyIncome > 0 ? (monthlyParcel / monthlyIncome) * 100 : 0;
          const percentColor = incomePercent > 10 ? 'color:#c62828;' : (incomePercent > 5 ? 'color:#f57c00;' : '');
          const isHistoryRow = r.remaining === 0;
          const statusBadge = isHistoryRow
            ? '<span class="badge" style="background:rgba(96,165,250,0.12); color:#60a5fa; border:1px solid rgba(96,165,250,0.3); padding:3px 10px; border-radius:12px; font-size:0.72rem; font-weight:600;">📜 Histórico</span>'
            : '<span class="badge" style="background:rgba(34,197,94,0.12); color:#22c55e; border:1px solid rgba(34,197,94,0.3); padding:3px 10px; border-radius:12px; font-size:0.72rem; font-weight:600;">● Ativa</span>';
          const purchaseDateLabel = r.purchaseDate ? App.utils.formatDate(r.purchaseDate) : '—';
          return `<tr style="cursor:pointer;" onclick="App.installments.showDetail('${r.id}')">
            <td>${r.description.split(' - Parcela')[0].trim()}</td>
            <td style="white-space:nowrap; color:var(--text-muted); font-size:0.82rem;">${purchaseDateLabel}</td>
            <td>${statusBadge}</td>
            <td class="text-right">${App.utils.formatCurrency(r.total)}</td>
            <td>${r.totalInstallments}</td>
            <td>${r.paid}</td>
            <td>${r.remaining}</td>
            <td class="text-right">${App.utils.formatCurrency(r.remainingValue)}</td>
            <td class="text-center" style="font-weight:600;">${Math.round(r.progress)}%</td>
            <td class="text-right">${App.utils.formatCurrency(monthlyParcel)}</td>
            <td class="text-right" style="${percentColor}font-weight:600;">${monthlyIncome > 0 ? incomePercent.toFixed(1) + '%' : 'N/A'}</td>
            <td><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r.progress}%"></div></div></td>
          </tr>`;
        }).join('') || `<tr><td colspan="12" style="text-align:center; padding:24px; color:var(--text-muted);">${currentFilter === 'history' ? 'Nenhuma compra totalmente quitada no histórico.' : 'Nenhuma compra ativa no momento.'}</td></tr>`;

        const content = document.getElementById('allInstallmentsContent');
        if (!content) return;

        const emptyStateHint = rows.length === 0
          ? `<div style="text-align:center; padding:32px; color:var(--text-muted); font-size:0.85rem;">
               ${currentFilter === 'active'
                 ? '💡 Quando você quitar todas as parcelas de uma compra, ela migra automaticamente para o Histórico.'
                 : '💡 Nenhuma compra quitada ainda. Continue pagando as parcelas para alimentar o histórico.'}
             </div>`
          : '';

        content.innerHTML = `
          <div style="display:flex; gap:8px; margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid var(--border); align-items:center;">
            <button class="btn btn-sm ${currentFilter === 'active' ? 'btn-primary' : 'btn-outline'}" onclick="App.installments.setAllMonthsFilter('active')" style="display:flex; align-items:center; gap:6px;">
              ● Ativas <span style="background:${currentFilter === 'active' ? 'rgba(10,10,10,0.25)' : 'rgba(255,255,255,0.08)'}; padding:2px 8px; border-radius:10px; font-size:0.72rem;">${activeAll.length}</span>
            </button>
            <button class="btn btn-sm ${currentFilter === 'history' ? 'btn-primary' : 'btn-outline'}" onclick="App.installments.setAllMonthsFilter('history')" style="display:flex; align-items:center; gap:6px;">
              📜 Histórico <span style="background:${currentFilter === 'history' ? 'rgba(10,10,10,0.25)' : 'rgba(255,255,255,0.08)'}; padding:2px 8px; border-radius:10px; font-size:0.72rem;">${historyAll.length}</span>
            </button>
            <span style="margin-left:auto; font-size:0.78rem; color:var(--text-muted);">
              ${currentFilter === 'active' ? 'Compras com parcelas a pagar' : 'Compras totalmente quitadas'}
            </span>
          </div>

          ${rows.length > 0 ? `
          <div class="cards-row">
            <div class="card"><div class="card-label">${currentFilter === 'active' ? 'Total a Pagar' : 'Total Quitado'}</div><div class="card-value" style="color:${currentFilter === 'active' ? '#c62828' : '#22c55e'};">${App.utils.formatCurrency(totalRemaining)}</div></div>
            <div class="card"><div class="card-label">${currentFilter === 'active' ? 'Compras Ativas' : 'Compras no Histórico'}</div><div class="card-value">${rows.length}</div></div>
            <div class="card"><div class="card-label">Parcelas Mensais</div><div class="card-value">${App.utils.formatCurrency(totalMonthlyParcels)}</div></div>
            <div class="card" onmouseenter="App.installments.showRendaTooltip(event, ${monthlyIncome}, ${totalMonthlyParcels}, ${totalIncomePercent})" onmouseleave="App.installments.hideRendaTooltip()" style="cursor: default;">
              <div class="card-label">% da Renda</div>
              <div class="card-value" style="color:${totalIncomePercent > 30 ? '#c62828' : totalIncomePercent > 15 ? '#f57c00' : '#2e7d32'}">${monthlyIncome > 0 ? totalIncomePercent.toFixed(1) + '%' : 'N/A'}</div>
            </div>
            <div class="card"><div class="card-label">Total este Mês</div><div class="card-value">${App.utils.formatCurrency(thisMonthTotal)}</div><div class="card-sub" style="font-size:0.75rem;">Pago: ${App.utils.formatCurrency(thisMonthPaid)} | Pendente: ${App.utils.formatCurrency(thisMonthPending)}</div></div>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Descrição</th><th>Data da Compra</th><th>Status</th><th>Total</th><th>Parcelas</th><th>Pagas</th><th>Restam</th><th>Valor Restante</th><th>% Pago</th><th>Parcela Mensal</th><th>% da Renda</th><th>Progresso</th></tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>` : `${emptyStateHint}`}
        `;
      } catch (e) {
        console.error(e);
        App.utils.showToast('Erro ao carregar todas as compras.', 'error');
      }
    }
  };

  // =======================================================================
  // Investimentos – otimizado
  // =======================================================================
  App.investments = {
    currentMonthStart: null,
    _detailEvolutionChart: null,
    _evoChart: null,
    _viewMode: 'ativos',  // 'ativos' ou 'conta'
    async load() {
      try {
        if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().start;
        const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
        document.getElementById('invCycleLabel').textContent = `Ref. ${cycle.refMonth}`;
        const invs = await App.db.getAll('investments');
        const accounts = App.cache.accounts || await App.db.getAll('accounts');
        if (!App.cache.accounts) App.cache.accounts = accounts;

        // Sanitização: corrige automaticamente investimentos com conta inválida
        let sanitized = false;
        const defaultAccount = accounts.find(a => a.name === 'XP Investimentos') || accounts.find(a => a.type === 'investment') || accounts[0];
        if (defaultAccount) {
          for (const inv of invs) {
            if (!inv.account_id || !accounts.some(a => a.id === inv.account_id)) {
              inv.account_id = defaultAccount.id;
              await App.db.put('investments', inv);
              sanitized = true;
            }
          }
          if (sanitized) {
            App.cache.accounts = null; // força recarregar cache se necessário
            console.warn('Investimentos com conta inválida foram corrigidos automaticamente.');
          }
        }

        // 🔁 Saneamento automático de históricos e transações órfãs
        await this.sanitizeAllInvestments();

        if (this._viewMode === 'conta') {
          await this.renderByAccount(invs, accounts);
        } else {
          await this.render(invs, accounts);
          await this.renderCards(invs);
        }
      } catch (e) { console.error(e); }
    },

    async sanitizeAllInvestments() {
      try {
        const allInvestments = await App.db.getAll('investments');
        const allTx = await App.db.getAll('transactions');
        const allHistory = await App.db.getAll('investmentHistory');

        for (const inv of allInvestments) {
          // Transações válidas para este investimento
          const transacoesValidas = allTx.filter(t => {
            const relacionada = t.investment_id === inv.id || 
              (t.description && t.description.toLowerCase().includes(inv.name.toLowerCase().trim()));
            if (!relacionada) return false;

            const isAporte = t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte');
            const isResgate = t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate');
            const isSaldoInicial = t.category === 'Saldo Inicial';
            const isRendimento = t.description?.startsWith('Rendimento:') || t.description?.startsWith('Prejuízo:');
            const isGenerica = t.type === 'income' || t.type === 'expense';
            const isAjuste = t.type === 'adjustment' && t.category === 'Ajuste de Saldo';

            return isAporte || isResgate || isSaldoInicial || isRendimento || isGenerica || isAjuste;
          });

          // Remove transações órfãs (investment_id preenchido, mas não está na lista de válidas)
          const transacoesComInvestId = allTx.filter(t => t.investment_id === inv.id);
          for (const tx of transacoesComInvestId) {
            if (!transacoesValidas.includes(tx)) {
              await App.db.delete('transactions', tx.id);
              console.log(`🧹 Transação órfã removida: ${tx.description}`);
            }
          }

          // Exclui histórico antigo do investimento
          const historyAntigo = allHistory.filter(h => h.investment_id === inv.id);
          for (const h of historyAntigo) {
            await App.db.delete('investmentHistory', h.id);
          }

          // Recalcula histórico com transações válidas
          const txOrdenadas = transacoesValidas.sort((a, b) => a.date.localeCompare(b.date));
          let saldo = 0;
          let capitalInicial = 0;
          let totalAportes = 0;
          let totalResgates = 0;
          let totalRendimentos = 0;
          let totalPrejuizos = 0;
          let totalAjustes = 0;
          const novoHistory = [];

          for (const tx of txOrdenadas) {
            const valor = parseFloat(tx.amount) || 0;
            let tipo = 'rendimento';
            let valorMov = 0;

            if (tx.category === 'Saldo Inicial') {
              tipo = 'saldo_inicial';
              saldo = valor;
              capitalInicial = valor;
              valorMov = valor;
            } else if (tx.type === 'contribution' || (tx.type === 'transfer' && tx.transfer_subtype === 'aporte')) {
              tipo = 'aporte';
              saldo += valor;
              totalAportes += valor;
              valorMov = valor;
            } else if (tx.type === 'withdrawal' || (tx.type === 'transfer' && tx.transfer_subtype === 'resgate')) {
              tipo = 'resgate';
              saldo -= valor;
              totalResgates += valor;
              valorMov = -valor;
            } else if (tx.description?.startsWith('Rendimento:')) {
              tipo = 'rendimento';
              saldo += valor;
              totalRendimentos += valor;
              valorMov = valor;
            } else if (tx.description?.startsWith('Prejuízo:')) {
              tipo = 'prejuizo';
              saldo -= valor;
              totalPrejuizos += valor;
              valorMov = -valor;
            } else if (tx.type === 'income') {
              tipo = 'rendimento';
              saldo += valor;
              totalRendimentos += valor;
              valorMov = valor;
            } else if (tx.type === 'expense') {
              tipo = 'prejuizo';
              saldo -= valor;
              totalPrejuizos += valor;
              valorMov = -valor;
            } else if (tx.type === 'adjustment') {
              tipo = 'ajuste';
              const variacaoAjuste = typeof tx.variation === 'number' ? tx.variation : valor;
              saldo += variacaoAjuste;
              totalAjustes += variacaoAjuste;
              valorMov = variacaoAjuste;
            } else {
              continue;
            }

            novoHistory.push({
              id: App.utils.generateId(),
              investment_id: inv.id,
              date: tx.date,
              value: saldo,
              note: tx.description || '',
              type: tipo
            });
          }

          // Salva o novo histórico
          if (novoHistory.length > 0) {
            await App.db.putMany('investmentHistory', novoHistory);
          }

          // Atualiza o investimento: amount_invested = capital inicial, current_value = valor atual líquido
          inv.amount_invested = capitalInicial;
          inv.current_value = capitalInicial + totalAportes - totalResgates + totalRendimentos - totalPrejuizos + totalAjustes;
          await App.db.put('investments', inv);
        }

        console.log('✅ Saneamento de investimentos concluído automaticamente.');
      } catch (e) {
        console.error('Erro no saneamento automático:', e);
      }
    },

    async render(invs, accounts) {
      const tbody = document.getElementById('investmentsTableBody'), empty = document.getElementById('investmentsEmpty');
      if (!invs.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
      empty.style.display='none';

      // Busca todas as transações para calcular rendimento real
      const allTx = await App.db.getAll('transactions');

      tbody.innerHTML = invs.map(i=>{
        const acc = accounts.find(a=>a.id===i.account_id);
        const invested = parseFloat(i.amount_invested)||0, current = parseFloat(i.current_value)||0;

        // Calcula rendimento real (rendimentos - prejuízos)
        let rendimentoReal = 0;
        allTx.filter(t => t.investment_id === i.id && (t.description?.startsWith('Rendimento:') || t.description?.startsWith('Prejuízo:')))
          .forEach(t => {
            const valor = parseFloat(t.amount) || 0;
            if (t.type === 'income') rendimentoReal += valor;
            else if (t.type === 'expense') rendimentoReal -= valor;
          });

        const pct = invested ? ((rendimentoReal / invested) * 100).toFixed(1) : 0;
        return `<tr style="cursor:pointer" onclick="App.investments.showDetail('${i.id}')"><td><strong>${i.name}</strong></td><td>${i.type}</td><td>${acc?.name||''}</td><td class="text-right">${App.utils.formatCurrency(invested)}</td><td class="text-right">${App.utils.formatCurrency(current)}</td><td class="text-right" style="color:${rendimentoReal>=0?'#2e7d32':'#c62828'};">${rendimentoReal>=0?'+':''}${App.utils.formatCurrency(rendimentoReal)} (${pct}%)</td><td class="text-center actions-cell" onclick="event.stopPropagation()"><button class="icon-btn" onclick="App.investments.edit('${i.id}')">✏️</button><button class="icon-btn" onclick="App.investments.showEvolution('${i.id}')">📈</button><button class="icon-btn delete" onclick="App.investments.remove('${i.id}')">🗑️</button></td></tr>`;
      }).join('');
    },
    async renderCards(invs) {
      const container = document.getElementById('investmentCards');
      if (!container) return;
      const invested = invs.reduce((s,i)=>s+(parseFloat(i.amount_invested)||0),0);
      const current = invs.reduce((s,i)=>s+(parseFloat(i.current_value)||0),0);

      // Busca todas as transações para calcular rendimento real
      const allTx = await App.db.getAll('transactions');
      let rendimentoTotal = 0;
      invs.forEach(i => {
        allTx.filter(t => t.investment_id === i.id && (t.description?.startsWith('Rendimento:') || t.description?.startsWith('Prejuízo:')))
          .forEach(t => {
            const valor = parseFloat(t.amount) || 0;
            if (t.type === 'income') rendimentoTotal += valor;
            else if (t.type === 'expense') rendimentoTotal -= valor;
          });
      });

      const profit = rendimentoTotal; // rendimento real, não inclui aportes/resgates
      let html = `<div class="card"><div class="card-label">Total Investido</div><div class="card-value">${App.utils.formatCurrency(invested)}</div></div>`;
      html += `<div class="card"><div class="card-label">Valor Atual</div><div class="card-value">${App.utils.formatCurrency(current)}</div></div>`;
      html += `<div class="card clickable" onclick="App.investments.showRendimentosHistory()"><div class="card-label">Rendimento</div><div class="card-value" style="color:${profit>=0?'#2e7d32':'#c62828'};">${profit>=0?'+':''}${App.utils.formatCurrency(profit)}</div></div>`;
      html += `<div class="card clickable" onclick="App.ui.navigateTo('projection')"><div class="card-label">📈 Projeção</div><div class="card-value">→</div><div class="card-sub">Ver projeção de investimentos</div></div>`;
      html += invs.map(i=>{
        const cur = parseFloat(i.current_value)||0, inv = parseFloat(i.amount_invested)||0;
        // Rendimento individual para o card
        let rendimentoIndividual = 0;
        allTx.filter(t => t.investment_id === i.id && (t.description?.startsWith('Rendimento:') || t.description?.startsWith('Prejuízo:')))
          .forEach(t => {
            const valor = parseFloat(t.amount) || 0;
            if (t.type === 'income') rendimentoIndividual += valor;
            else if (t.type === 'expense') rendimentoIndividual -= valor;
          });
        const arrow = rendimentoIndividual>=0?'↑':'↓', color = rendimentoIndividual>=0?'#2e7d32':'#c62828';
        return `<div class="card clickable" onclick="App.investments.showDetail('${i.id}')"><div class="card-label">${i.name} <span style="color:${color};">${arrow}</span></div><div class="card-value">${App.utils.formatCurrency(cur)}</div><div class="card-sub">${i.type}</div></div>`;
      }).join('');
      container.innerHTML = html;
    },
    async showDetail(invId) {
    this._currentDetailId = invId;
    this._historyFilter = 'all';   // ← garante que o histórico sempre inicie sem filtro
    const inv = await App.db.getById('investments', invId);
    if (!inv) return;
      const startRange = inv.start_date || App.utils.addMonths(App.utils.todayISO(), -240);
      const endRange = '2099-12-31';
      const txAll = await App.db.getTransactionsInRange(startRange, endRange);
      const cycle = App.utils.monthRangeFromDate(App.investments.currentMonthStart);

      // Aportes no ciclo: inclui contributions + transferências de aporte
      const periodCont = txAll.filter(t =>
        (t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte')) &&
        t.investment_id === invId &&
        t.date >= cycle.start && t.date <= cycle.end &&
        t.status === 'confirmed'
      ).reduce((s, t) => s + parseFloat(t.amount), 0);

      // Resgates no ciclo: inclui withdrawals + transferências de resgate
      const periodWith = txAll.filter(t =>
        (t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate')) &&
        t.investment_id === invId &&
        t.date >= cycle.start && t.date <= cycle.end &&
        t.status === 'confirmed'
      ).reduce((s, t) => s + parseFloat(t.amount), 0);

            const positionHistory = await App.db.getAll('investmentHistory');
      const invHistory = positionHistory.filter(h => h.investment_id === invId).sort((a, b) => a.date.localeCompare(b.date));
      const historyTableHTML = this.renderHistoryTable(inv.id, invHistory);

      // Movimentações: inclui todos os tipos relevantes
      const hist = txAll.filter(t =>
        t.investment_id === invId &&
        (
          t.type === 'contribution' ||
          t.type === 'withdrawal' ||
          (t.type === 'transfer' && (t.transfer_subtype === 'aporte' || t.transfer_subtype === 'resgate')) ||
          t.description?.startsWith('Rendimento:') ||
          t.description?.startsWith('Prejuízo:') ||
          t.category === 'Saldo Inicial'
        ) &&
        t.status === 'confirmed'
      ).sort((a, b) => a.date.localeCompare(b.date));

      let histHtml = hist.length ? hist.map(h => {
        let tipo = h.type;
        if (h.type === 'transfer') {
          tipo = h.transfer_subtype === 'aporte' ? 'Aporte' : 'Resgate';
        } else {
          tipo = h.type === 'contribution' ? 'Aporte' : h.type === 'withdrawal' ? 'Resgate' : h.type === 'income' ? 'Rendimento' : 'Prejuízo';
        }
        return `<tr><td>${App.utils.formatDateTime(h.date)}</td><td>${tipo}</td><td>${h.description||''}</td><td class="text-right">${App.utils.formatCurrency(h.amount)}</td></tr>`;
      }).join('') : '<tr><td colspan="4">Nenhuma movimentação</td></tr>';

      // Calcula rendimento real (somente rendimentos e prejuízos, excluindo aportes/resgates)
      let rendimentoReal = 0;
      const rendimentosTx = txAll.filter(t =>
        t.investment_id === invId &&
        (t.description?.startsWith('Rendimento:') || t.description?.startsWith('Prejuízo:')) &&
        t.status === 'confirmed'
      );
      rendimentosTx.forEach(t => {
        const valor = parseFloat(t.amount) || 0;
        if (t.type === 'income') rendimentoReal += valor;
        else if (t.type === 'expense') rendimentoReal -= valor;
      });

      const chartId = 'detailEvolutionChart';
      let html = `<div class="cards-row"><div class="card"><div class="card-label">Valor Investido</div><div class="card-value">${App.utils.formatCurrency(inv.amount_invested)}</div></div><div class="card"><div class="card-label">Valor Atual</div><div class="card-value">${App.utils.formatCurrency(inv.current_value)}</div></div><div class="card"><div class="card-label">Rend. Total</div><div class="card-value" style="color:${rendimentoReal >= 0 ? '#2e7d32' : '#c62828'};">${rendimentoReal >= 0 ? '+' : ''}${App.utils.formatCurrency(rendimentoReal)}</div></div></div>
      <div class="cards-row"><div class="card"><div class="card-label">Aportes no ciclo</div><div class="card-value">${App.utils.formatCurrency(periodCont)}</div></div><div class="card"><div class="card-label">Resgates no ciclo</div><div class="card-value">${App.utils.formatCurrency(periodWith)}</div></div></div>
      <div style="margin:16px 0;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="App.investments.quickAction('${invId}','contribution')">💰 Novo Aporte</button>
        <button class="btn btn-outline btn-sm" onclick="App.investments.quickAction('${invId}','withdrawal')">💸 Novo Resgate</button>
        <button class="btn btn-ghost btn-sm" onclick="App.investments.adjustInvestment('${invId}')">💰 Ajustar</button>
        <button class="btn btn-ghost btn-sm" onclick="App.investments.updatePosition('${invId}')">📊 Atualizar Posição</button>
        <button class="btn btn-ghost btn-sm" onclick="App.investments.registerPosition('${invId}')">📋 Registrar Posição</button>
      </div>
      <div class="detail-tabs" style="margin-top:20px;"><button class="btn btn-sm btn-outline" onclick="App.investments.switchDetailTab('evolution')">📈 Evolução</button><button class="btn btn-sm btn-outline active" onclick="App.investments.switchDetailTab('history')">📋 Histórico</button><button class="btn btn-sm btn-outline" onclick="App.investments.switchDetailTab('transactions')">💰 Movimentações</button></div>
      <div id="detailTabEvolution" class="detail-tab-content" style="display:none;"><div class="detail-chart"><h4 style="margin-bottom:12px;">📈 Evolução do Ativo</h4><div id="${chartId}" style="width: 100%; height: 380px; min-height: 300px;"></div></div></div>
      <div id="detailTabHistory" class="detail-tab-content" style="display:block;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h4 style="margin:0;">📋 Histórico de Posições</h4>
          <button class="btn btn-sm btn-ghost" onclick="App.investments.exportHistoryCSV('${inv.id}')">📥 Exportar CSV</button>
        </div>
        <div id="historyFilters" style="margin-bottom:10px; display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-xs btn-outline active" data-filter="all" onclick="App.investments.setHistoryFilter('all')">Todos</button>
          <button class="btn btn-xs btn-outline" data-filter="aporte" onclick="App.investments.setHistoryFilter('aporte')">Aportes</button>
          <button class="btn btn-xs btn-outline" data-filter="resgate" onclick="App.investments.setHistoryFilter('resgate')">Resgates</button>
          <button class="btn btn-xs btn-outline" data-filter="rendimento" onclick="App.investments.setHistoryFilter('rendimento')">Rendimentos</button>
          <button class="btn btn-xs btn-outline" data-filter="saldo_inicial" onclick="App.investments.setHistoryFilter('saldo_inicial')">Saldo Inicial</button>
        </div>
        <div class="table-container" style="max-height:350px;overflow-y:auto;" id="historyTableContainer">${historyTableHTML}</div>
      </div>
      <div id="detailTabTransactions" class="detail-tab-content" style="display:none;"><h4 style="margin-bottom:12px;">💰 Movimentações</h4><div class="table-container" style="max-height:300px;overflow-y:auto;"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th class="text-right">Valor</th></tr></thead><tbody>${histHtml}</tbody></table></div></div>`;
           const detailContainer = document.getElementById('investmentDetailContent');
      if (detailContainer) {
        detailContainer.innerHTML = html;
        document.getElementById('investmentDetailTitle').textContent = `📈 Detalhes: ${inv.name}`;
        App.ui.navigateTo('investment-detail');
        setTimeout(() => this.drawInlineChart(chartId, inv, hist), 100);
      }
    },

    _historyFilter: 'all',

    renderHistoryTable(invId, history) {
      if (!history || !history.length) return '<div class="empty-state">Nenhum histórico de posição</div>';

      let filtered = history;
      if (this._historyFilter && this._historyFilter !== 'all') {
        filtered = history.filter(h => {
          const note = (h.note || '').toLowerCase();
          switch (this._historyFilter) {
            case 'aporte': return note.includes('aporte');
            case 'resgate': return note.includes('resgate');
            case 'rendimento': return !note.includes('saldo inicial') && !note.includes('aporte') && !note.includes('resgate');
            case 'saldo_inicial': return note.includes('saldo inicial');
            default: return true;
          }
        });
      }

      if (!filtered.length) return '<div class="empty-state">Nenhum registro para o filtro selecionado.</div>';

      const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
      let previousValue = null;
      let totalAportes = 0;
      let totalResgates = 0;
      let totalRendimentos = 0;

          const rows = sorted.map((h, index) => {
        const currentValue = parseFloat(h.value) || 0;
        const previous = index > 0 ? parseFloat(sorted[index - 1].value) || 0 : 0;
        const diff = currentValue - previous;  // pode ser zero no primeiro registro

        // Usa o campo type se disponível; senão, infere a partir da observação e do sinal de diff
        const typeField = h.type || '';
        let tipo = 'Rendimento';
        let tipoClass = 'badge-income';
        let valorMov = diff; // padrão: diferença de saldo

               if (typeField === 'saldo_inicial') {
          tipo = 'Saldo Inicial';
          tipoClass = 'badge-transfer';
          valorMov = diff;
        } else if (typeField === 'aporte') {
          tipo = 'Aporte';
          tipoClass = 'badge-contribution';
          valorMov = diff;
          totalAportes += valorMov;
        } else if (typeField === 'resgate') {
          tipo = 'Resgate';
          tipoClass = 'badge-withdrawal';
          valorMov = diff;
          totalResgates += valorMov;
        } else if (typeField === 'rendimento') {
          tipo = 'Rendimento';
          tipoClass = 'badge-income';
          totalRendimentos += valorMov;
        } else if (typeField === 'prejuizo') {
          tipo = 'Prejuízo';
          tipoClass = 'badge-expense';
          totalRendimentos += valorMov;
        } else if (typeField === 'ajuste') {
          tipo = 'Ajuste';
          tipoClass = 'badge-transfer';
          valorMov = diff;
        } else {
          // Fallback: usa observação
          const note = (h.note || '').toLowerCase();
          if (note.includes('saldo inicial')) {
            tipo = 'Saldo Inicial';
            tipoClass = 'badge-transfer';
          } else if (note.includes('aporte')) {
            tipo = 'Aporte';
            tipoClass = 'badge-contribution';
            totalAportes += diff;
          } else if (note.includes('resgate')) {
            tipo = 'Resgate';
            tipoClass = 'badge-withdrawal';
            totalResgates += diff;
          } else if (diff < 0) {
            tipo = 'Prejuízo';
            tipoClass = 'badge-expense';
            totalRendimentos += diff;
          } else {
            tipo = 'Rendimento';
            tipoClass = 'badge-income';
            totalRendimentos += diff;
          }
        }

        const pct = previous !== 0 ? ((diff / previous) * 100).toFixed(2) : '—';
        const arrow = diff >= 0 ? '↑' : '↓';
        const colorClass = diff >= 0 ? 'income' : 'expense';
        const cor = diff >= 0 ? 'var(--income)' : 'var(--expense)';

        return `<tr class="history-row" data-type="${tipoClass}">
          <td>${App.utils.formatDateTime(h.date)}</td>
          <td><span class="badge ${tipoClass}">${tipo}</span></td>
          <td class="text-right ${colorClass}" style="color:${cor}; font-weight:600;">${diff >= 0 ? '+' : ''}${App.utils.formatCurrency(diff)}</td>
          <td class="text-right">${App.utils.formatCurrency(currentValue)}</td>
          <td class="text-right" style="color:${cor};">${arrow} ${pct}%</td>
          <td>${h.note || ''}</td>
        </tr>`;
      }).join('');

      const totalMov = totalAportes + totalResgates + totalRendimentos;
      const totalRow = `<tr class="total-row" style="font-weight:600; border-top:2px solid var(--border);">
        <td colspan="2"><strong>Totais</strong></td>
        <td class="text-right"><strong>${App.utils.formatCurrency(totalMov)}</strong></td>
        <td class="text-right"><strong>${App.utils.formatCurrency(sorted.length ? sorted[sorted.length - 1].value : 0)}</strong></td>
        <td></td>
        <td></td>
      </tr>`;

      return `<table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th>Valor Mov.</th>
            <th>Saldo</th>
            <th>% Período</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>${rows}${totalRow}</tbody>
      </table>`;
    },

    setHistoryFilter(filter) {
      this._historyFilter = filter;
      document.querySelectorAll('#historyFilters .btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      const container = document.getElementById('historyTableContainer');
      if (container) {
        this.db.getAll('investmentHistory').then(history => {
          const invId = this._currentDetailId || null;
          if (!invId) return;
          const filteredHistory = history.filter(h => h.investment_id === invId);
          container.innerHTML = this.renderHistoryTable(invId, filteredHistory);
        });
      }
    },

    exportHistoryCSV(invId) {
      this.db.getAll('investmentHistory').then(history => {
        const invHistory = history.filter(h => h.investment_id === invId).sort((a, b) => a.date.localeCompare(b.date));
        if (!invHistory.length) {
          App.utils.showToast('Nenhum histórico para exportar.', 'info');
          return;
        }
        let previousValue = null;
        const rows = invHistory.map(h => {
          const currentValue = parseFloat(h.value) || 0;
          const diff = previousValue !== null ? currentValue - previousValue : currentValue;
          previousValue = currentValue;
          let tipo = 'Rendimento';
          const note = (h.note || '').toLowerCase();
          if (note.includes('saldo inicial')) tipo = 'Saldo Inicial';
          else if (note.includes('aporte')) tipo = 'Aporte';
          else if (note.includes('resgate')) tipo = 'Resgate';
          else if (diff < 0) tipo = 'Prejuízo';
          return [
            App.utils.formatDateTime(h.date),
            tipo,
            App.utils.formatCurrency(diff),
            App.utils.formatCurrency(currentValue),
            h.note || ''
          ];
        });
        const headers = ['Data', 'Tipo', 'Valor Movimentado', 'Saldo', 'Observação'];
        App.utils.exportCSV(`historico_investimento_${invId}.csv`, headers, rows);
      });
    },
  async switchDetailTab(tab) {
    const container = document.getElementById('investmentDetailContent');
    if (!container) return;

    const allContents = container.querySelectorAll('.detail-tab-content');
    allContents.forEach(el => { el.style.display = 'none'; });
    const allButtons = container.querySelectorAll('.detail-tabs .btn');
    allButtons.forEach(btn => btn.classList.remove('active'));

    const tabMap = {
      evolution: { contentId: 'detailTabEvolution', buttonIndex: 1 },
      history: { contentId: 'detailTabHistory', buttonIndex: 2 },
      transactions: { contentId: 'detailTabTransactions', buttonIndex: 3 }
    };

    const target = tabMap[tab];
    if (!target) return;

    const contentEl = container.querySelector('#' + target.contentId);
    if (contentEl) contentEl.style.display = 'block';

    const buttonEl = container.querySelector(`.detail-tabs .btn:nth-child(${target.buttonIndex})`);
    if (buttonEl) buttonEl.classList.add('active');

    // Se a aba Evolução for ativada, inicializa/ajusta o gráfico ECharts
    if (tab === 'evolution' && this._currentDetailId) {
      const inv = await App.db.getById('investments', this._currentDetailId);
      if (inv) {
        const startRange = inv.start_date || App.utils.addMonths(App.utils.todayISO(), -240);
        const endRange = '2099-12-31';
        const txAll = await App.db.getTransactionsInRange(startRange, endRange);
        const hist = txAll.filter(t =>
          t.investment_id === this._currentDetailId &&
          (t.type === 'contribution' || t.type === 'withdrawal' ||
           (t.type === 'transfer' && (t.transfer_subtype === 'aporte' || t.transfer_subtype === 'resgate')) ||
           t.description?.startsWith('Rendimento:') || t.description?.startsWith('Prejuízo:'))
        ).sort((a, b) => a.date.localeCompare(b.date));

        // Aguarda um frame para o container estar visível antes de redimensionar
        setTimeout(() => {
          this.drawInlineChart('detailEvolutionChart', inv, hist);
          if (this._detailEvolutionChart) {
            this._detailEvolutionChart.resize();
          }
        }, 100);
      }
    }
  },
        drawInlineChart(chartId, inv, hist) {
      const container = document.getElementById(chartId);
      if (!container) return;
      const points = [{ date: inv.start_date || '2020-01-01', value: parseFloat(inv.amount_invested) || 0 }];
      let balance = points[0].value;
      hist.forEach(t => {
        if (t.category === 'Saldo Inicial') return;
        if (t.type === 'contribution' || t.type === 'income') balance += parseFloat(t.amount);
        else if (t.type === 'withdrawal' || t.type === 'expense') balance -= parseFloat(t.amount);
        points.push({ date: t.date, value: balance });
      });
      if (points.length && points[points.length - 1].date !== App.utils.todayISO()) {
        points.push({ date: App.utils.todayISO(), value: parseFloat(inv.current_value) || balance });
      }
      if (points.length < 2) { container.style.display = 'none'; return; }
      container.style.display = 'block';

      if (this._detailEvolutionChart) {
        this._detailEvolutionChart.dispose();
        this._detailEvolutionChart = null;
      }

      const chart = echarts.init(container);
      this._detailEvolutionChart = chart;

      const labels = points.map(p => App.utils.formatDate(p.date).slice(0, 5));
      const valores = points.map(p => p.value);

      const series = [];

      // Linha principal branca sobreposta
      series.push({
        type: 'line',
        data: valores,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#ffffff', width: 2.5 },
        itemStyle: { color: '#ffffff' },
        z: 10,
        emphasis: { disabled: true }
      });

      // Para cada segmento, cria uma série com cor e área próprias
      for (let i = 1; i < points.length; i++) {
        const anterior = points[i - 1].value;
        const atual = points[i].value;
        const difPct = anterior !== 0 ? ((atual - anterior) / Math.abs(anterior)) * 100 : 0;

        let corSegmento;
        if (atual >= anterior) {
          corSegmento = '#1e88e5'; // azul
        } else if (difPct <= -15) {
          corSegmento = '#e53935'; // vermelho
        } else if (difPct <= -5) {
          corSegmento = '#fb8c00'; // laranja
        } else {
          corSegmento = '#fbc02d'; // amarelo
        }

        // Série de linha para o segmento (apenas dois pontos)
        series.push({
          type: 'line',
          data: [
            { value: anterior, symbol: 'none' },
            { value: atual, symbol: 'none' }
          ],
          smooth: true,
          showSymbol: false,
          lineStyle: { color: corSegmento, width: 2.5, opacity: 0.8 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: corSegmento + '88' },
                { offset: 1, color: corSegmento + '00' }
              ]
            }
          },
          z: 1,
          silent: true,
          emphasis: { disabled: true }
        });
      }

      // Linha zero tracejada
      series.push({
        type: 'line',
        data: points.map(() => 0),
        showSymbol: false,
        lineStyle: { color: '#e53935', width: 1.5, type: 'dashed', opacity: 0.6 },
        z: 5,
        silent: true,
        emphasis: { disabled: true }
      });

      chart.setOption({
        animation: false,
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(20, 22, 28, 0.95)',
          borderColor: '#394552',
          borderWidth: 1,
          padding: [10, 14],
          textStyle: { color: '#e0e4ea', fontSize: 12 },
          formatter: function(params) {
            const p = params.find(item => item.seriesIndex === 0);
            if (!p) return '';
            return `<strong>${labels[p.dataIndex]}</strong><br/>` +
                   `<span style="color:#b0b8c4;">Valor:</span> ` +
                   `<strong>${App.utils.formatCurrency(p.value)}</strong>`;
          }
        },
        grid: {
          left: '30px',
          right: '30px',
          top: '30px',
          bottom: '35px',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#444c56' } },
          axisTick: { show: false },
          axisLabel: {
            color: '#8a94a0',
            fontSize: 10,
            interval: 'auto',
            rotate: 0,
            margin: 8
          }
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: '#8a94a0',
            fontSize: 10,
            formatter: val => App.utils.formatCurrency(val)
          },
          splitLine: {
            lineStyle: {
              color: 'rgba(255,255,255,0.06)',
              type: 'dashed'
            }
          }
        },
        series: series
      });

      const handleResize = () => {
        if (this._detailEvolutionChart) {
          this._detailEvolutionChart.resize();
        }
      };
      window.removeEventListener('resize', handleResize);
      window.addEventListener('resize', handleResize);
    },
    async registerPosition(invId) {
      const inv = await App.db.getById('investments', invId);
      if (!inv) return;
      
      const oldValue = parseFloat(inv.current_value) || 0;
      
      App.utils.prompt('Valor atual:', oldValue, async (val) => {
    const newVal = App.utils.parseFloatLocale(val);
    if (isNaN(newVal) || newVal < 0) {
      App.utils.showToast('Valor inválido.', 'error');
      return;
    }
        
        App.utils.prompt('Observação:', '', async (note) => {
          // Atualiza o valor atual do investimento
          const diff = newVal - oldValue;
          inv.current_value = newVal;
          await App.db.put('investments', inv);
          
          // Registra no histórico de posições
          await App.db.put('investmentHistory', {
            id: App.utils.generateId(),
            investment_id: invId,
            date: App.utils.todayISO(),
            value: newVal,
            note: note || 'Registro de posição'
          });
          
          // Se houver diferença, cria transação de rendimento/prejuízo
          if (diff !== 0) {
            const account = await App.db.getById('accounts', inv.account_id);
            if (account) {
              const desc = diff > 0 ? `Rendimento: ${inv.name}` : `Prejuízo: ${inv.name}`;
              await App.db.put('transactions', {
                id: App.utils.generateId(),
                type: diff > 0 ? 'income' : 'expense',
                amount: Math.abs(diff),
                category: 'Rendimento',
                account_id: inv.account_id,
                account_name: account.name,
                date: App.utils.todayISO(),
                description: desc,
                notes: note || '',
                investment_id: invId,
                status: 'confirmed',
                reconciled: false,
                ignore_from_total: false,
                createdAt: new Date().toISOString(),
                position: Date.now()
              });
            } else {
              App.utils.showToast('Conta do investimento não encontrada. Transação não gerada.', 'warning');
            }
          }
          
          App.utils.showToast('Posição registrada com sucesso!');
          App.investments.load();
          App.investments.showDetail(invId);
          App.dashboard.refresh();
          App.panel.refresh();
        });
      });
    },
    async adjustInvestment(invId) {
      const inv = await App.db.getById('investments', invId);
      if (!inv) {
        App.utils.showToast('Investimento não encontrado.', 'error');
        return;
      }

      document.getElementById('adjustInvestmentId').value = invId;
      document.getElementById('adjustInvestmentName').value = inv.name;
      document.getElementById('adjustInvestmentDate').value = App.utils.todayISO();
      document.getElementById('adjustInvestmentTime').value = new Date().toTimeString().slice(0,5);
            const currentValue = parseFloat(inv.current_value) || 0;
      const roundedValue = Math.round(currentValue * 100) / 100;
      document.getElementById('adjustInvestmentAmount').value = roundedValue.toFixed(2);
      document.getElementById('adjustInvestmentReason').value = '';

      App.ui.openModal('modalAdjustInvestment');
    },

    async saveInvestmentAdjustment(e) {
      e.preventDefault();
      const invId = document.getElementById('adjustInvestmentId').value;
      const inv = await App.db.getById('investments', invId);
      if (!inv) {
        App.utils.showToast('Investimento não encontrado.', 'error');
        return false;
      }

      const rawNewValue = document.getElementById('adjustInvestmentAmount').value;
      const newValue = parseFloat(rawNewValue.replace(',', '.'));
      if (isNaN(newValue) || newValue < 0) {
        App.utils.showFieldError(document.getElementById('adjustInvestmentAmount'), 'Informe um valor não negativo');
        return false;
      }

      const date = document.getElementById('adjustInvestmentDate').value;
      const time = document.getElementById('adjustInvestmentTime').value || '00:00';
      const fullDate = (time && time !== '00:00') ? date + 'T' + time + ':00' : date;
      const reason = document.getElementById('adjustInvestmentReason').value.trim();

      // Calcula diferença entre o valor atual desejado e o valor anterior
      const oldValue = parseFloat(inv.current_value) || 0;
      const amount = newValue - oldValue;

      if (amount === 0) {
        App.utils.showToast('Nenhuma alteração necessária.', 'info');
        return false;
      }

         // Verifica o modo escolhido no modal
      const modoSelecionado = document.querySelector('input[name="adjustMode"]:checked')?.value || 'transaction';

      if (modoSelecionado === 'initial') {
        // Atualiza a transação de saldo inicial correspondente
        const txSaldoInicial = (await App.db.getAll('transactions')).find(t =>
          t.investment_id === invId &&
          t.category === 'Saldo Inicial'
        );

        if (txSaldoInicial) {
          txSaldoInicial.amount = Math.round(newValue * 100) / 100;
          txSaldoInicial.ignore_from_total = true;
          await App.db.put('transactions', txSaldoInicial);
        } else {
          // Cria nova transação de saldo inicial
          const acc = await App.db.getById('accounts', inv.account_id);
          await App.db.put('transactions', {
            id: App.utils.generateId(),
            type: 'income',
            amount: Math.round(newValue * 100) / 100,
            category: 'Saldo Inicial',
            account_id: inv.account_id,
            account_name: acc?.name || '',
            account_to_id: null,
            account_to_name: null,
            date: fullDate,
            description: `Saldo Inicial ${inv.name}`,
            notes: reason || '',
            member_id: inv.member_id || '',
            member_name: (App.cache.members?.find(m => m.id === inv.member_id) || {}).name || '',
            credit_card_id: null,
            payment_method: 'adjustment',
            classification: 'necessary',
            receipt_url: '',
            investment_id: invId,
            loan_id: null,
            installments: 1,
            installment_number: 1,
            installment_id: null,
            recurring: false,
            vacation: false,
            status: 'confirmed',
            reconciled: false,
            ignore_from_total: true,
            createdAt: new Date().toISOString(),
            position: Date.now()
          });
        }

        // Atualiza o investimento
        inv.amount_invested = Math.round(newValue * 100) / 100;
        inv.current_value = inv.amount_invested;
        await App.db.put('investments', inv);

        // Registra no histórico do investimento
        await App.db.put('investmentHistory', {
          id: App.utils.generateId(),
          investment_id: invId,
          date: fullDate,
          value: inv.current_value,
          note: `Alteração de saldo inicial para ${App.utils.formatCurrency(inv.amount_invested)} (${reason || 'sem motivo'})`,
          type: 'ajuste'
        });
      } else {
        // Modo transaction: mantém lógica anterior
        // Atualiza o valor atual do investimento, arredondando para 2 casas decimais
        inv.current_value = Math.round(newValue * 100) / 100;
        await App.db.put('investments', inv);

        // Cria transação de ajuste (não afeta o saldo da conta)
        const type = 'adjustment';
        const absAmount = Math.abs(amount);
        const acc = await App.db.getById('accounts', inv.account_id);
        await App.db.put('transactions', {
          id: App.utils.generateId(),
          type: type,
          amount: absAmount,
          variation: amount,
          category: 'Ajuste de Saldo',
          account_id: inv.account_id,
          account_name: acc?.name || '',
          account_to_id: null,
          account_to_name: null,
          date: fullDate,
          description: `Ajuste de saldo - ${inv.name}`,
          notes: reason || '',
          member_id: inv.member_id || '',
          member_name: (App.cache.members?.find(m => m.id === inv.member_id) || {}).name || '',
          credit_card_id: null,
          payment_method: 'adjustment',
          classification: 'necessary',
          receipt_url: '',
          investment_id: invId,
          loan_id: null,
          installments: 1,
          installment_number: 1,
          installment_id: null,
          recurring: false,
          vacation: false,
          status: 'confirmed',
          reconciled: false,
          ignore_from_total: true,
          createdAt: new Date().toISOString(),
          position: Date.now()
        });

        // Registra no histórico do investimento
        await App.db.put('investmentHistory', {
          id: App.utils.generateId(),
          investment_id: invId,
          date: fullDate,
          value: newValue,
          note: `Ajuste de ${App.utils.formatCurrency(amount)} (${reason || 'sem motivo'})`,
          type: 'ajuste'
        });
      }

      App.ui.closeModal('modalAdjustInvestment');
      App.utils.showToast('Ajuste de investimento realizado!');

      // Recarrega investimentos e detalhes
      this.load();
      if (App.saldos) await App.saldos.load();

      // Invalida cache de transações para refletir a nova transação
      if (App.transactions) {
        App.transactions.invalidateCache?.();
        App.transactions.load?.();
      }

      // Atualiza cards e gráficos de outras seções
      if (App.dashboard) App.dashboard.refresh();
      if (App.panel) App.panel.refresh();
      if (App.analytics) App.analytics.refresh();
      if (App.installments) App.installments.load();
      if (App.patrimony) App.patrimony.load();

      // Atualiza detalhes do investimento
      App.investments.showDetail(invId);
      return false;
    },

   async quickAction(invId, actionType) {
    const inv = await App.db.getById('investments', invId);
    if (!inv) return;

    const isContribution = actionType === 'contribution';
    const label = isContribution ? 'Aporte' : 'Resgate';
    const contaInvest = inv.account_id;

    // Determina a conta normal (origem para aporte, destino para resgate)
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    if (!App.cache.accounts) App.cache.accounts = accounts;
    let contaNormal = accounts.find(a => a.id === inv.linked_account_id && a.id !== inv.account_id);
    if (!contaNormal) {
      contaNormal = accounts.find(a =>
        !a.archived &&
        ['checking','savings','wallet'].includes(a.type) &&
        a.id !== inv.account_id
      );
    }
    if (!contaNormal) {
      App.utils.showToast('Nenhuma conta corrente/poupança disponível para transferência.', 'error');
      return;
    }

    // Prompt 1: valor
    App.utils.prompt(`Valor do ${label} (R$):`, '', async (valorStr) => {
      const valor = App.utils.parseFloatLocale(valorStr);
      if (isNaN(valor) || valor <= 0) {
        App.utils.showToast('Valor inválido.', 'error');
        return;
      }

      // Prompt 2: observação
      App.utils.prompt('Observação (opcional):', '', async (obs) => {
        const dataAtual = App.utils.todayISO();
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const fullDate = `${dataAtual}T${timeStr}`;

        // Cria a transação de aporte/resgate
        const tx = {
          id: App.utils.generateId(),
          type: isContribution ? 'contribution' : 'withdrawal',
          amount: valor,
          category: label,
          description: `${label}: ${inv.name}`,
          date: fullDate,
          account_id: isContribution ? contaNormal.id : contaInvest,
          account_name: isContribution ? contaNormal.name : (accounts.find(a => a.id === contaInvest)?.name || ''),
          account_to_id: isContribution ? contaInvest : contaNormal.id,
          account_to_name: isContribution ? (accounts.find(a => a.id === contaInvest)?.name || '') : contaNormal.name,
          member_id: inv.member_id || contaNormal.member_id || '',
          member_name: (App.cache.members?.find(m => m.id === (inv.member_id || contaNormal.member_id))?.name || ''),
          investment_id: invId,
          payment_method: 'transfer',
          status: 'confirmed',
          reconciled: false,
          ignore_from_total: false,
          createdAt: new Date().toISOString(),
          position: Date.now()
        };
        await App.db.put('transactions', tx);

        // Atualiza o investimento (amount_invested e current_value)
        const oldCurrent = parseFloat(inv.current_value) || 0;
        if (isContribution) {
          inv.current_value = oldCurrent + valor;
        } else {
          inv.current_value = Math.max(0, oldCurrent - valor);
        }
        // amount_invested permanece inalterado (capital inicial fixo)
        await App.db.put('investments', inv);
                // Garante que o tipo do histórico seja consistente
        const tipoHist = isContribution ? 'aporte' : 'resgate';

                // Registra no histórico de posições com type
        const existingHist = await App.db.getAll('investmentHistory');
        const jaExiste = existingHist.some(h =>
          h.investment_id === invId &&
          h.date === dataAtual &&
          h.type === tipoHist
        );

        if (!jaExiste) {
          await App.db.put('investmentHistory', {
            id: App.utils.generateId(),
            investment_id: invId,
            date: dataAtual,
            value: inv.current_value,
            note: `${label}${obs ? ' - ' + obs : ''}`,
            type: tipoHist
          });
        }

        // Atualiza caches e interface
        App.cache.accounts = null;
        App.cache.totalBalance = null;
        await App.saldos.load();
        App.transactions.invalidateCache?.();
        App.transactions.load();
        App.dashboard.refresh();
        App.panel.refresh();
        App.investments.load();

        // Se o modal de detalhes estiver aberto, atualiza o conteúdo
        if (document.getElementById('modalInvestmentDetail')?.classList.contains('open')) {
          App.investments.showDetail(invId);
        }

        App.utils.showToast(`${label} registrado!`);
      });
    });
  },
    async updatePosition(invId) {
      const inv = await App.db.getById('investments', invId);
      if (!inv) return;
      
      const oldValue = parseFloat(inv.current_value) || 0;
      
        App.utils.prompt('Novo valor atual:', oldValue, async (val) => {
    const newVal = App.utils.parseFloatLocale(val);
    if (isNaN(newVal) || newVal < 0) {
      App.utils.showToast('Valor inválido.', 'error');
      return;
    }
        
        const diff = newVal - oldValue;
        inv.current_value = newVal;
        await App.db.put('investments', inv);
        
        await App.db.put('investmentHistory', {
          id: App.utils.generateId(),
          investment_id: invId,
          date: App.utils.todayISO(),
          value: newVal,
          note: 'Atualização de posição'
        });
        
        if (diff !== 0) {
          const account = await App.db.getById('accounts', inv.account_id);
          if (account) {
            const desc = diff > 0 ? `Rendimento: ${inv.name}` : `Prejuízo: ${inv.name}`;
            await App.db.put('transactions', {
              id: App.utils.generateId(),
              type: diff > 0 ? 'income' : 'expense',
              amount: Math.abs(diff),
              category: 'Rendimento',
              account_id: inv.account_id,
              account_name: account.name,
              date: App.utils.todayISO(),
              description: desc,
              notes: '',
              investment_id: invId,
              status: 'confirmed',
              reconciled: false,
              ignore_from_total: false,
              createdAt: new Date().toISOString(),
              position: Date.now()
            });
          } else {
            App.utils.showToast('Conta do investimento não encontrada. Rendimento não registrado.', 'warning');
          }
        }
        
        App.utils.showToast('Posição atualizada!');
        App.investments.load();
        App.ui.closeModal('modalInvestmentDetail');
        App.dashboard.refresh();
        App.panel.refresh();
      });
    },
    async showEvolution(invId) {
      const inv = await App.db.getById('investments',invId); if (!inv) return;
      const startRange = inv.start_date || App.utils.addMonths(App.utils.todayISO(), -240);
      const endRange = '2099-12-31';
      const txAll = await App.db.getTransactionsInRange(startRange, endRange);
      const related = txAll.filter(t=> (t.account_id===inv.account_id||t.account_to_id===inv.account_id) && ['contribution','withdrawal','income','expense'].includes(t.type) && (t.investment_id===invId || t.description?.includes(inv.name)) && t.status==='confirmed');
      related.sort((a,b)=>a.date.localeCompare(b.date));
      const points = []; let balance = parseFloat(inv.amount_invested)||0;
      points.push({date: inv.start_date || '2020-01-01', value: balance});
      related.forEach(t=>{ if (t.type==='contribution' || t.type==='income') balance += parseFloat(t.amount); else if (t.type==='withdrawal' || t.type==='expense') balance -= parseFloat(t.amount); points.push({date: t.date, value: balance}); });
      if (points.length && points[points.length-1].date !== App.utils.todayISO()) points.push({date: App.utils.todayISO(), value: inv.current_value||balance});
      const canvas = document.getElementById('evolutionSvg'); if (!canvas) return;
      if (this._evoChart) this._evoChart.destroy();
      this._evoChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: points.map(p => App.utils.formatDate(p.date).slice(0,5)),
          datasets: [{ data: points.map(p => p.value), borderColor: '#1565c0', pointRadius: 3, fill: false, segment: { borderColor: ctx => { const index = ctx.p0DataIndex; if (index === 0) return '#1565c0'; return points[index].value >= points[index-1].value ? '#1565c0' : '#ff4757'; } } }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
      document.getElementById('evolutionTitle').textContent = `Evolução: ${inv.name}`;
      App.ui.openModal('modalEvolution');
    },

    async showRendimentosHistory() {
      const startRange = App.utils.addMonths(App.utils.todayISO(), -240);
      const endRange = '2099-12-31';
      const txAll = await App.db.getTransactionsInRange(startRange, endRange);
      const rendimentos = txAll.filter(t =>
        t.type === 'income' &&
        (t.category === 'Rendimento' || (t.description && (t.description.startsWith('Rendimento:') || t.description.startsWith('Prejuízo:'))))
      ).sort((a,b) => a.date.localeCompare(b.date));

      if (rendimentos.length === 0) {
        App.utils.showToast('Nenhum rendimento registrado.', 'info');
        return;
      }

      let html = `<h3>Histórico de Rendimentos/Prejuízos</h3>
        <div class="table-container" style="max-height:400px;overflow-y:auto;">
          <table>
            <thead><tr><th>Data</th><th>Investimento</th><th class="text-right">Valor</th></tr></thead>
            <tbody>`;

      const investments = await App.db.getAll('investments');
      const invMap = new Map(investments.map(i => [i.name.toLowerCase(), i.name]));

      rendimentos.forEach(t => {
        let invName = t.description ? t.description.replace(/^(Rendimento|Prejuízo):\s*/, '') : '';
        if (!invName) invName = t.category || '—';
        const displayName = invMap.get(invName.toLowerCase()) || invName;
        html += `<tr>
          <td>${App.utils.formatDateTime(t.date)}</td>
          <td>${displayName}</td>
          <td class="text-right" style="color:${parseFloat(t.amount) >= 0 ? 'var(--income)' : 'var(--expense)'};">${App.utils.formatCurrency(t.amount)}</td>
        </tr>`;
      });

      html += '</tbody></table></div>';
      document.getElementById('detailContent').innerHTML = html;
      App.ui.openModal('modalInvestmentDetail');
    },
  async save(e) {
    e.preventDefault();
    try {
      const id = document.getElementById('invId').value;
      const name = document.getElementById('invName').value;
      const type = document.getElementById('invType').value;
      const amount_invested = parseFloat(document.getElementById('invAmountInvested').value);
      const current_value = parseFloat(document.getElementById('invCurrentValue').value);
      const account_id = document.getElementById('invAccount').value;
      const start_date = document.getElementById('invStartDate').value;
      const notes = document.getElementById('invNotes').value;

      if (!name || isNaN(amount_invested) || isNaN(current_value)) {
        App.utils.showToast('Preencha campos', 'error');
        return false;
      }
      if (!account_id) {
        App.utils.showToast('Selecione uma conta para o investimento.', 'error');
        return false;
      }

      const accounts = App.cache.accounts || await App.db.getAll('accounts');
      const accountExists = accounts.some(a => a.id === account_id);
      if (!accountExists) {
        App.utils.showToast('A conta selecionada não existe mais. Escolha outra.', 'error');
        return false;
      }

      // Guarda o investimento antigo (se edição) para detectar mudança de conta
      const oldInvestment = id ? await App.db.getById('investments', id) : null;
      const oldAccountId = oldInvestment ? oldInvestment.account_id : null;

      // Salva/atualiza o investimento
      const newId = id || App.utils.generateId();
      await App.db.put('investments', { id: newId, name, type, amount_invested, current_value, account_id, start_date, notes });

      // ===== NOVO: Cria transação de Saldo Inicial para novos investimentos =====
      if (!id) {
        const accInvest = accounts.find(a => a.id === account_id);
        const dataAporte = start_date || App.utils.todayISO();
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const fullDate = `${dataAporte}T${timeStr}`;

        await App.db.put('transactions', {
          id: App.utils.generateId(),
          type: 'income',
          amount: amount_invested,
          category: 'Saldo Inicial',
          account_id: account_id,
          account_name: accInvest ? accInvest.name : '',
          account_to_id: null,
          account_to_name: null,
          date: fullDate,
          description: `Saldo Inicial ${name}`,
          notes: notes || '',
          member_id: accInvest ? accInvest.member_id : '',
          member_name: (App.cache.members?.find(m => m.id === accInvest?.member_id)?.name || ''),
          credit_card_id: null,
          investment_id: newId,
          payment_method: '',
          status: 'confirmed',
          reconciled: false,
          ignore_from_total: true,
          createdAt: new Date().toISOString(),
          position: Date.now()
        });

        // Adiciona registro no histórico de posições
        await App.db.put('investmentHistory', {
          id: App.utils.generateId(),
          investment_id: newId,
          date: dataAporte,
          value: amount_invested,
          note: 'Saldo Inicial'
        });
      }
      // ===== FIM DO NOVO =====

      // Se for edição e a conta mudou, migra as transações vinculadas
      if (id && oldAccountId && oldAccountId !== account_id) {
        const newAccount = accounts.find(a => a.id === account_id);
        const allTx = await App.db.getAll('transactions');

        const relatedTx = allTx.filter(t =>
          t.investment_id === id ||
          (t.description && t.description.includes(name) && (t.category === 'Rendimento' || t.category === 'Prejuízo'))
        );

        for (const tx of relatedTx) {
          if (tx.type === 'contribution' || (tx.type === 'transfer' && tx.transfer_subtype === 'aporte')) {
            tx.account_to_id = account_id;
            tx.account_to_name = newAccount ? newAccount.name : '';
          }
          else if (tx.type === 'withdrawal' || (tx.type === 'transfer' && tx.transfer_subtype === 'resgate')) {
            tx.account_id = account_id;
            tx.account_name = newAccount ? newAccount.name : '';
          }
          else if (tx.type === 'income' || tx.type === 'expense') {
            tx.account_id = account_id;
            tx.account_name = newAccount ? newAccount.name : '';
          }
          await App.db.put('transactions', tx);
        }

        App.transactions.invalidateCache?.();
        await App.saldos.load();
      }

      // (Bloco removido intencionalmente)

      // Invalida caches e recarrega após possível nova transação
      App.transactions.invalidateCache?.();
      App.cache.accounts = null;
      App.cache.totalBalance = null;
      await App.saldos.load();

      App.ui.closeModal('modalInvestment');
      App.utils.showToast(id ? 'Atualizado!' : 'Criado!');
      this.load();
      App.panel.refresh();
      return false;
    } catch (erro) {
      console.error(erro);
      App.utils.showToast('Erro ao salvar investimento.', 'error');
      return false;
    }
  },
    async edit(id) { const i = await App.db.getById('investments',id); if(i) App.ui.openInvestmentModal(i); },
      async remove(id) {
    App.utils.confirm('Excluir investimento e TODAS as transações vinculadas a ele?', async () => {
      try {
        const invest = await App.db.getById('investments', id);
        const invName = invest ? invest.name : '';

        const allTx = await App.db.getAll('transactions');
        const relatedTx = allTx.filter(t => {
          // 1. Por investment_id
          if (t.investment_id === id) return true;
          // 2. Por descrição contendo o nome do investimento (rendimentos, aportes, resgates)
          if (invName && (t.description || '').toLowerCase().includes(invName.toLowerCase())) {
            const isFinancial = t.type === 'contribution' || t.type === 'withdrawal' ||
              (t.type === 'transfer' && (t.transfer_subtype === 'aporte' || t.transfer_subtype === 'resgate')) ||
              (t.description || '').startsWith('Rendimento:') || (t.description || '').startsWith('Prejuízo:') ||
              t.category === 'Saldo Inicial';
            if (isFinancial) return true;
          }
          return false;
        });

        for (const tx of relatedTx) {
          await App.db.delete('transactions', tx.id);
        }

        // Exclui histórico de posições do investimento
        const history = await App.db.getAll('investmentHistory');
        const relatedHistory = history.filter(h => h.investment_id === id);
        for (const h of relatedHistory) {
          await App.db.delete('investmentHistory', h.id);
        }

        // Exclui o investimento
        await App.db.delete('investments', id);

        // Atualiza caches e recarrega a interface
        App.cache.accounts = null;
        App.cache.totalBalance = null;
        await App.saldos.load();
        this.load();
        App.panel.refresh();
        App.dashboard.refresh();
        App.transactions.invalidateCache?.();
        App.transactions.load();
        App.utils.showToast('Investimento e transações vinculadas excluídos.');
      } catch (e) {
        console.error('Erro ao excluir investimento:', e);
        App.utils.showToast('Erro ao excluir investimento.', 'error');
      }
    });
  },
    prevMonth() { const d = new Date(this.currentMonthStart+'T12:00:00'); d.setMonth(d.getMonth()-1); this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0,10)).start; this.load(); },
    nextMonth() { const d = new Date(this.currentMonthStart+'T12:00:00'); d.setMonth(d.getMonth()+1); this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0,10)).start; this.load(); },
    gotoMonth() { const month = document.getElementById('invMonthPicker')?.value; if (month) { const [y,m] = month.split('-'); this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).start; this.load(); } },

    async renderSaldoChart() {
      const canvas = document.getElementById('investmentsSaldoChart');
      if (!canvas) return;

      const periodoSel = document.getElementById('investmentsChartPeriod');
      const periodoTipo = periodoSel?.value || '12';

      // Coleta histórico de posições e investimentos
      const allHistory = await App.db.getAll('investmentHistory');
      const allInvestments = await App.db.getAll('investments');

      if (!allInvestments.length) {
        canvas.style.display = 'none';
        return;
      }
      canvas.style.display = 'block';

      // Saldo atual somado (fallback para investimentos sem histórico)
      const saldoAtualTotal = allInvestments.reduce((s, inv) => s + (parseFloat(inv.current_value) || 0), 0);

      // Se não há histórico, cria um único ponto com o saldo atual
      if (!allHistory.length) {
        const hoje = App.utils.todayISO();
        const labelMes = new Date(hoje + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
        this._drawSaldoChart(canvas, [labelMes], [saldoAtualTotal]);
        this._renderSaldoDetail([]);
        return;
      }

      // Define intervalo de meses
      const hoje = new Date();
      let startDate, endDate;
      if (periodoTipo === 'all') {
        const datas = allHistory.map(h => new Date((h.date || '').slice(0, 10) + 'T12:00:00'));
        const minD = new Date(Math.min(...datas));
        startDate = new Date(minD.getFullYear(), minD.getMonth(), 1);
        endDate = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      } else {
        const meses = parseInt(periodoTipo, 10) || 12;
        startDate = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
        endDate = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      }

      // Constrói a lista de meses
      const meses = [];
      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        const cycle = App.utils.monthRangeFromDate(cursor.toISOString().slice(0, 10));
        meses.push(cycle);
        cursor.setMonth(cursor.getMonth() + 1);
      }

      // Agrupa histórico por investimento
      const historyPorInv = {};
      allHistory.forEach(h => {
        if (!h.investment_id) return;
        if (!historyPorInv[h.investment_id]) historyPorInv[h.investment_id] = [];
        historyPorInv[h.investment_id].push(h);
      });
      Object.values(historyPorInv).forEach(arr => arr.sort((a, b) => a.date.localeCompare(b.date)));

      // Para cada mês, para cada investimento, pega o último valor até o fim do mês
      const labels = [];
      const valores = [];

      for (const cycle of meses) {
        const fimMes = cycle.end.slice(0, 10);
        let saldoMes = 0;

        for (const inv of allInvestments) {
          const hist = historyPorInv[inv.id];
          if (!hist || !hist.length) {
            // Sem histórico: usa valor atual apenas se o mês for o mais recente
            if (cycle.start.slice(0, 7) === App.utils.currentMonth().startDate.slice(0, 7)) {
              saldoMes += parseFloat(inv.current_value) || 0;
            }
            continue;
          }
          // Encontra o último registro até o fim do mês
          let ultimo = null;
          for (const h of hist) {
            if ((h.date || '').slice(0, 10) <= fimMes) ultimo = h;
            else break;
          }
          if (ultimo) {
            saldoMes += parseFloat(ultimo.value) || 0;
          } else {
            // Nenhum registro até o fim do mês: usa saldo inicial do investimento (amount_invested)
            saldoMes += parseFloat(inv.amount_invested) || 0;
          }
        }

        const d = new Date(cycle.start + 'T12:00:00');
        const mesAbrev = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
        const anoCurto = String(d.getFullYear()).slice(2);
        labels.push(`${mesAbrev}/${anoCurto}`);
        valores.push(saldoMes);
      }

      this._drawSaldoChart(canvas, labels, valores);
      this._renderSaldoDetail(meses);
    },

    async _renderSaldoDetail(meses) {
      const container = document.getElementById('investmentsSaldoDetail');
      if (!container) return;

      if (!meses || !meses.length) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;color:#888;font-size:0.85rem;">Sem dados para exibir detalhamento.</div>';
        return;
      }

      // Ano de referência = ano do mês mais recente
      const mesRef = meses[meses.length - 1];
      const anoRef = parseInt(mesRef.start.slice(0, 4), 10);

      const allInvestments = await App.db.getAll('investments');
      const allHistory = await App.db.getAll('investmentHistory');
      const allAccounts = await App.db.getAll('accounts');
      const allTx = await App.db.getAll('transactions');
      const allMembers = App.cache.members || await App.db.getAll('members');

      const memberMap = Object.fromEntries(allMembers.map(m => [m.id, m.name]));
      const invMap = Object.fromEntries(allInvestments.map(i => [i.id, i.name]));

      // Monta os 12 meses do ano de referência
      const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const mesesAno = MESES_NOMES.map((nome, i) => {
        const start = `${anoRef}-${String(i + 1).padStart(2, '0')}-01`;
        const cycle = App.utils.monthRangeFromDate(start);
        return { nome, abrev: MESES_ABREV[i], index: i, cycle };
      });

      if (!allInvestments.length) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;color:#888;font-size:0.85rem;">Nenhum investimento cadastrado.</div>';
        return;
      }

      // ============================================================
      // 1) Saldos mensais por investimento (com 0 nos meses anteriores ao primeiro registro)
      // ============================================================
      const itens = allInvestments.map(inv => {
        const histInv = allHistory
          .filter(h => h.investment_id === inv.id)
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

        const primeiraData = (histInv.length > 0)
          ? (histInv[0].date || '').slice(0, 10)
          : ((inv.start_date || '').slice(0, 10) || null);

        const saldosMes = mesesAno.map(mes => {
          const fimMes = mes.cycle.end.slice(0, 10);
          if (primeiraData && fimMes < primeiraData) return 0;
          let saldo = parseFloat(inv.amount_invested) || 0;
          for (const h of histInv) {
            if ((h.date || '').slice(0, 10) <= fimMes) saldo = parseFloat(h.value) || 0;
            else break;
          }
          return saldo;
        });

        return { nome: inv.name, tipo: inv.type || '—', saldos: saldosMes };
      });

      const itensVisiveis = itens.filter(it => it.saldos.some(v => v !== 0));

      if (!itensVisiveis.length) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;color:#888;font-size:0.85rem;">Nenhum investimento com saldo no ano.</div>';
        return;
      }

      // Total em contas de investimentos
      const totalInvest = mesesAno.map((_, i) =>
        itensVisiveis.reduce((s, it) => s + (it.saldos[i] || 0), 0)
      );

      // ============================================================
      // 2) Saldo em contas NÃO-investimento (correntes, poupanças, carteiras)
      // ============================================================
      const contasNaoInv = allAccounts.filter(a =>
        !a.archived && a.type !== 'investment' && !a.exclude_from_total
      );
      const saldoContasMensal = mesesAno.map(mes => {
        const fimMes = mes.cycle.end.slice(0, 10);
        const txAte = allTx.filter(t => t.date.slice(0, 10) <= fimMes);
        return App.utils.calculateBalance(contasNaoInv, txAte);
      });

      // ============================================================
      // 3) Movimentações de aporte/resgate/rendimento do ano
      //    (quem movimentou, de/para qual investimento, valor, membro)
      // ============================================================
      const movsAno = allTx.filter(t => {
        const d = t.date.slice(0, 10);
        if (d < `${anoRef}-01-01` || d > `${anoRef}-12-31`) return false;
        if (t.status !== 'confirmed') return false;
        const isAporte = t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte');
        const isResgate = t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate');
        const isRend = (t.description || '').startsWith('Rendimento:');
        const isPrej = (t.description || '').startsWith('Prejuízo:');
        const isSaldoIni = t.category === 'Saldo Inicial';
        return isAporte || isResgate || isRend || isPrej || isSaldoIni;
      }).sort((a, b) => b.date.localeCompare(a.date));

      // Variação entre meses e %
      const variacaoMensal = totalInvest.map((v, i) => i === 0 ? 0 : v - totalInvest[i - 1]);
      const variacaoPct = totalInvest.map((v, i) => {
        if (i === 0) return 0;
        const prev = totalInvest[i - 1];
        if (prev === 0) return null;
        return ((v - prev) / Math.abs(prev)) * 100;
      });

      // Cabeçalho
      const headerCols = mesesAno.map(m => `<th style="text-align:right;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">${m.nome}</th>`).join('');

      const linhasItens = itensVisiveis.map(it => {
        const cells = it.saldos.map(v => {
          if (v === 0) return `<td class="text-right" style="padding:8px 10px;color:#3a3a3a;font-size:0.82rem;">—</td>`;
          return `<td class="text-right" style="padding:8px 10px;color:#e0e0e0;font-size:0.82rem;">${App.utils.formatCurrency(v)}</td>`;
        }).join('');
        return `<tr>
          <td style="text-align:left;padding:8px 10px;font-weight:500;font-size:0.85rem;color:#e0e0e0;">${it.nome}</td>
          ${cells}
        </tr>`;
      }).join('');

      const totalInvCells = totalInvest.map(v => `<td class="text-right" style="padding:10px;font-weight:700;color:#fff;font-size:0.85rem;">${App.utils.formatCurrency(v)}</td>`).join('');
      const saldoContasCells = saldoContasMensal.map(v => {
        const cor = v >= 0 ? '#a3e635' : '#f87171';
        return `<td class="text-right" style="padding:10px;font-weight:600;color:${cor};font-size:0.85rem;">${App.utils.formatCurrency(v)}</td>`;
      }).join('');
      const varCells = variacaoMensal.map(v => {
        if (v === 0) return `<td class="text-right" style="padding:8px 10px;color:#888;font-size:0.82rem;">—</td>`;
        const cor = v >= 0 ? 'var(--income)' : 'var(--expense)';
        return `<td class="text-right" style="padding:8px 10px;color:${cor};font-size:0.82rem;">${v >= 0 ? '+' : ''}${App.utils.formatCurrency(v)}</td>`;
      }).join('');
      const pctCells = variacaoPct.map(v => {
        if (v === null) return `<td class="text-right" style="padding:8px 10px;color:#888;font-size:0.82rem;">—</td>`;
        if (v === 0) return `<td class="text-right" style="padding:8px 10px;color:#888;font-size:0.82rem;">0,00%</td>`;
        const cor = v >= 0 ? 'var(--income)' : 'var(--expense)';
        return `<td class="text-right" style="padding:8px 10px;color:${cor};font-size:0.82rem;">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</td>`;
      }).join('');

      // ============================================================
      // 4) Tabela de movimentações (quem, quando, onde, quanto)
      // ============================================================
      const tipoLabel = (t) => {
        if (t.category === 'Saldo Inicial') return { label: 'Saldo Inicial', cor: '#60a5fa' };
        if (t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte')) return { label: 'Aporte', cor: '#a3e635' };
        if (t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate')) return { label: 'Resgate', cor: '#f87171' };
        if ((t.description || '').startsWith('Rendimento:')) return { label: 'Rendimento', cor: '#34d399' };
        if ((t.description || '').startsWith('Prejuízo:')) return { label: 'Prejuízo', cor: '#fbbf24' };
        return { label: t.type, cor: '#888' };
      };

      const linhasMovs = movsAno.map(t => {
        const info = tipoLabel(t);
        const nomeInvest = invMap[t.investment_id]
          || (t.description || '').replace(/^(Rendimento|Prejuízo|Aporte|Resgate|Saldo Inicial)[:\s-]*/i, '').replace(/\s*\(.*\)\s*$/, '')
          || '—';
        const membro = t.member_name || (t.member_id ? (memberMap[t.member_id] || '—') : '—');
        const valor = parseFloat(t.amount) || 0;
        const sinal = (info.label === 'Aporte' || info.label === 'Prejuízo') ? '-' : '+';
        const valorCor = (info.label === 'Aporte' || info.label === 'Prejuízo') ? 'var(--expense)' : 'var(--income)';
        return `<tr>
          <td style="padding:8px 10px;font-size:0.82rem;white-space:nowrap;">${App.utils.formatDate(t.date.slice(0, 10))}</td>
          <td style="padding:8px 10px;font-size:0.82rem;"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${info.cor}22;color:${info.cor};font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">${info.label}</span></td>
          <td style="padding:8px 10px;font-size:0.82rem;color:#e0e0e0;font-weight:500;">${nomeInvest}</td>
          <td style="padding:8px 10px;font-size:0.82rem;color:#b0b0b0;">${membro}</td>
          <td style="padding:8px 10px;font-size:0.82rem;color:#888;">${(t.notes || '').slice(0, 60)}</td>
          <td class="text-right" style="padding:8px 10px;font-size:0.85rem;color:${valorCor};font-weight:600;white-space:nowrap;">${sinal} ${App.utils.formatCurrency(valor)}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px;font-size:0.85rem;">Nenhuma movimentação em ' + anoRef + '</td></tr>';

      const html = `
        <div class="table-container" style="max-height:520px;overflow:auto;margin-top:8px;">
          <table style="min-width:1200px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);min-width:220px;">Indicador / Ano ${anoRef}</th>
                ${headerCols}
              </tr>
            </thead>
            <tbody>
              <tr style="background:#161616;">
                <td style="text-align:left;padding:10px;font-weight:700;color:#fff;font-size:0.85rem;">Total em contas de investimentos</td>
                ${totalInvCells}
              </tr>
              <tr style="background:#0f1620;">
                <td style="text-align:left;padding:10px;font-weight:700;color:#60a5fa;font-size:0.85rem;">Saldo em contas (não-investimento)</td>
                ${saldoContasCells}
              </tr>
              <tr style="background:#121212;">
                <td style="text-align:left;padding:10px;font-weight:500;color:#b0b0b0;font-size:0.82rem;">Variação entre Meses</td>
                ${varCells}
              </tr>
              <tr style="background:#0f0f0f;border-bottom:2px solid var(--border);">
                <td style="text-align:left;padding:10px;font-weight:500;color:#b0b0b0;font-size:0.82rem;">Variação em %</td>
                ${pctCells}
              </tr>
              <tr style="background:#0d0d0d;">
                <td colspan="13" style="text-align:left;padding:10px;font-weight:600;color:#a3e635;font-size:0.82rem;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);">Itens</td>
              </tr>
              ${linhasItens}
            </tbody>
          </table>
        </div>

        <div class="table-container" style="max-height:420px;overflow:auto;margin-top:20px;">
          <div style="padding:12px 14px;background:#0f0f0f;border-bottom:1px solid var(--border);">
            <div style="font-size:0.85rem;font-weight:600;color:#fff;">🔎 Movimentações em ${anoRef} — quem movimentou</div>
            <div style="font-size:0.72rem;color:#888;margin-top:3px;">Aportes, resgates, rendimentos, prejuízos e saldos iniciais do ano, com membro responsável</div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">Data</th>
                <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">Tipo</th>
                <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">Investimento</th>
                <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">Membro</th>
                <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">Observação</th>
                <th style="text-align:right;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">Valor</th>
              </tr>
            </thead>
            <tbody>
              ${linhasMovs}
            </tbody>
          </table>
        </div>
      `;

      container.innerHTML = html;
    },

    _drawSaldoChart(canvas, labels, valores) {
      if (this._saldoChart) this._saldoChart.destroy();

      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 320);
      gradient.addColorStop(0, 'rgba(0,212,170,0.35)');
      gradient.addColorStop(1, 'rgba(0,212,170,0)');

      this._saldoChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Saldo Investido',
            data: valores,
            borderColor: '#00d4aa',
            backgroundColor: gradient,
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#00d4aa',
            pointHoverBorderColor: '#0f151b',
            pointHoverBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              ticks: { color: '#888', autoSkip: true, maxRotation: 0, autoSkipPadding: 12 },
              grid: { color: '#1f1f1f' }
            },
            y: {
              ticks: {
                color: '#888',
                callback: v => App.utils.formatCurrency(v)
              },
              grid: { color: '#1f1f1f' }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => `Saldo: ${App.utils.formatCurrency(ctx.raw)}`
              }
            }
          }
        }
      });
    },
    switchView(mode) {
      this._viewMode = mode;
      const btnAtivos = document.getElementById('invViewAtivos');
      const btnConta = document.getElementById('invViewConta');
      const btnGrafico = document.getElementById('invViewGrafico');
      if (btnAtivos) {
        btnAtivos.style.background = mode === 'ativos' ? 'var(--primary)' : '';
        btnAtivos.style.color = mode === 'ativos' ? '#0a0a0a' : '';
      }
      if (btnConta) {
        btnConta.style.background = mode === 'conta' ? 'var(--primary)' : '';
        btnConta.style.color = mode === 'conta' ? '#0a0a0a' : '';
      }
      if (btnGrafico) {
        btnGrafico.style.background = mode === 'grafico' ? 'var(--primary)' : '';
        btnGrafico.style.color = mode === 'grafico' ? '#0a0a0a' : '';
      }
      const chartContainer = document.getElementById('investmentsChartContainer');
      const tableContainer = document.getElementById('investmentsTableContainer');
      const cardsRow = document.getElementById('investmentCards');
      if (mode === 'grafico') {
        if (chartContainer) chartContainer.style.display = 'block';
        if (tableContainer) tableContainer.style.display = 'none';
        if (cardsRow) cardsRow.style.display = 'none';
        this.renderSaldoChart();
        return;
      } else {
        if (chartContainer) chartContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.display = '';
        if (cardsRow) cardsRow.style.display = '';
      }
      this.load();
    },
    async renderByAccount(invs, accounts) {
      const container = document.getElementById('investmentCards');
      const tbody = document.getElementById('investmentsTableBody');
      const empty = document.getElementById('investmentsEmpty');
      const accountMap = {};

      accounts.filter(a => a.type === 'investment').forEach(a => {
        accountMap[a.id] = { account: a, investments: [], totalInvested: 0, totalCurrent: 0 };
      });

      invs.forEach(inv => {
        if (accountMap[inv.account_id]) {
          accountMap[inv.account_id].investments.push(inv);
          accountMap[inv.account_id].totalInvested += parseFloat(inv.amount_invested) || 0;
          accountMap[inv.account_id].totalCurrent += parseFloat(inv.current_value) || 0;
        } else {
          if (!accountMap['__outros__']) {
            accountMap['__outros__'] = { account: { name: 'Outras Contas', investment_type: '' }, investments: [], totalInvested: 0, totalCurrent: 0 };
          }
          accountMap['__outros__'].investments.push(inv);
          accountMap['__outros__'].totalInvested += parseFloat(inv.amount_invested) || 0;
          accountMap['__outros__'].totalCurrent += parseFloat(inv.current_value) || 0;
        }
      });

      // Busca todas as transações para montar a tabela unificada
      const allTx = await App.db.getAll('transactions');

      // Filtra todas as transações de aporte/resgate relacionadas a contas de investimento
      const investmentAccountIds = new Set(accounts.filter(a => a.type === 'investment').map(a => a.id));
      const transacoes = allTx.filter(t => {
        const tipoAporte = t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte');
        const tipoResgate = t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate');
        return (tipoAporte || tipoResgate) && (investmentAccountIds.has(t.account_id) || investmentAccountIds.has(t.account_to_id));
      }).sort((a, b) => b.date.localeCompare(a.date)); // mais recentes primeiro

      let html = '';
      if (transacoes.length > 0) {
        const rows = transacoes.map(t => {
          const isAporte = t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte');
          const tipo = isAporte ? 'Aporte' : 'Resgate';
          const origem = isAporte ? (t.account_name || '—') : (t.account_name || '—');
          const destino = isAporte ? (t.account_to_name || '—') : (t.account_to_name || '—');
          const sinal = isAporte ? '+' : '-';
          const cor = isAporte ? 'var(--income)' : 'var(--expense)';

          return `<tr>
            <td>${App.utils.formatDateTime(t.date)}</td>
            <td>${tipo}</td>
            <td>${t.description || ''}</td>
            <td>${origem}</td>
            <td>${destino}</td>
            <td class="text-right" style="color:${cor};">${sinal} ${App.utils.formatCurrency(t.amount)}</td>
          </tr>`;
        }).join('');

        html = `<div class="table-container">
          <table>
            <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Origem</th><th>Destino</th><th class="text-right">Valor</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      } else {
        html = '<div class="empty-state">Nenhuma movimentação de aporte/resgate encontrada.</div>';
      }

      if (container) {
        container.innerHTML = html;
      }

      if (tbody) {
        tbody.innerHTML = '';
      }
      if (empty) empty.style.display = 'none';
    }
  };

  // =======================================================================
  // Patrimônio – sem alterações relevantes
  // =======================================================================
  App.patrimony = {
    currentMonthStart: null,
    async load() {
      if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().start;
      const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
      document.getElementById('patCycleLabel').textContent = `Ref. ${cycle.refMonth}`;
      const items = await App.db.getAll('patrimony'); this.render(items); this.renderCards(items);
    },
    render(items) {
      const tbody = document.getElementById('patrimonyTableBody'), empty = document.getElementById('patrimonyEmpty');
      if (!items.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
      empty.style.display='none';
      tbody.innerHTML = items.map(p=>`<tr style="cursor:pointer" onclick="App.patrimony.showDetail('${p.id}')"><td>${p.name}</td><td>${p.type==='asset'?'Bem':'Dívida'}</td><td class="text-right" style="font-weight:600;">${App.utils.formatCurrency(p.value)}</td><td>${p.description||'-'}</td><td>${App.utils.formatDate(p.date)}</td><td class="text-center actions-cell" onclick="event.stopPropagation()"><button class="icon-btn" onclick="App.patrimony.edit('${p.id}')">✏️</button><button class="icon-btn delete" onclick="App.patrimony.remove('${p.id}')">🗑️</button></td></tr>`).join('');
    },
    renderCards(items) {
      const container = document.getElementById('patrimonyCards'); if (!container) return;
      const assets = items.filter(p=>p.type==='asset').reduce((s,p)=>s+(parseFloat(p.value)||0),0);
      const liabilities = items.filter(p=>p.type==='liability').reduce((s,p)=>s+(parseFloat(p.value)||0),0);
      container.innerHTML = `<div class="card"><div class="card-label">Bens</div><div class="card-value" style="color:#2e7d32;">${App.utils.formatCurrency(assets)}</div></div><div class="card"><div class="card-label">Dívidas</div><div class="card-value" style="color:#c62828;">${App.utils.formatCurrency(liabilities)}</div></div><div class="card"><div class="card-label">Líquido</div><div class="card-value">${App.utils.formatCurrency(assets-liabilities)}</div></div>`;
    },
    async showDetail(id) { const p = await App.db.getById('patrimony', id); if (p) App.utils.confirm(`Detalhes do ${p.type==='asset'?'Bem':'Dívida'} "${p.name}":\nValor: ${App.utils.formatCurrency(p.value)}\nData: ${App.utils.formatDate(p.date)}\nDescrição: ${p.description||'Nenhuma'}`, null, null); },
    async save(e) {
      e.preventDefault();
      const id = document.getElementById('patId').value, name = document.getElementById('patName').value;
      const type = document.getElementById('patType').value, value = parseFloat(document.getElementById('patValue').value);
      const date = document.getElementById('patDate').value, description = document.getElementById('patDescription').value;
      if (!name||isNaN(value)) { App.utils.showToast('Preencha campos','error'); return false; }
      await App.db.put('patrimony', { id: id||App.utils.generateId(), name, type, value, date, description });
      App.ui.closeModal('modalPatrimony'); App.utils.showToast(id?'Atualizado!':'Criado!'); this.load(); return false;
    },
    async edit(id) { const p = await App.db.getById('patrimony',id); if(p) App.ui.openPatrimonyModal(p); },
    async remove(id) { App.utils.confirm('Excluir item do patrimônio?', async () => { await App.db.delete('patrimony',id); this.load(); }); },
    prevMonth() { const d = new Date(this.currentMonthStart+'T12:00:00'); d.setMonth(d.getMonth()-1); this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0,10)).start; this.load(); },
    nextMonth() { const d = new Date(this.currentMonthStart+'T12:00:00'); d.setMonth(d.getMonth()+1); this.currentMonthStart = App.utils.monthRangeFromDate(d.toISOString().slice(0,10)).start; this.load(); },
    gotoMonth() { const month = document.getElementById('patMonthPicker')?.value; if (month) { const [y,m] = month.split('-'); this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).start; this.load(); } }
  };

  // =======================================================================
  // Membros (com suporte à divisão automática do Casal)
  // =======================================================================
  App.members = {
    async load() {
      const members = App.cache.members || await App.db.getAll('members');
      if (!App.cache.members) App.cache.members = members;
      const container = document.getElementById('membersCards');
      if (!members.length) { container.innerHTML = '<p>Nenhum membro cadastrado.</p>'; return; }
      container.innerHTML = members.map(m => `<div class="card" style="border-left: 4px solid ${m.color};"><div class="card-label" style="display:flex; justify-content:space-between; align-items:center;"><span style="display:flex; align-items:center; gap:8px;"><span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; background:${m.color}20; font-size:1.4rem;">${m.avatar || '👤'}</span><span>${m.name}</span></span><span><button class="icon-btn" onclick="App.members.verDetalhes('${m.id}')" title="Ver detalhes">📊</button><button class="icon-btn" onclick="App.members.edit('${m.id}')">✏️</button><button class="icon-btn delete" onclick="App.members.remove('${m.id}')">🗑️</button></span></div><div class="card-sub">Limite de endividamento: ${m.debt_limit || 30}%</div></div>`).join('');
    },
    async save(e) {
      e.preventDefault();
      const id = document.getElementById('memId').value, name = document.getElementById('memName').value;
      const color = document.getElementById('memColor').value, debt_limit = parseInt(document.getElementById('memDebtLimit').value)||30;
      if (!name) { App.utils.showToast('Nome obrigatório','error'); return false; }
      // Coletar split_members
      const splitContainer = document.getElementById('memSplitMembers');
      const split_to = [];
      if (splitContainer && name === 'Casal') {
        const rows = splitContainer.querySelectorAll('.form-row');
        rows.forEach(row => {
          const sel = row.querySelector('.splitMemberSelect');
          const ratioInput = row.querySelector('.splitMemberRatio');
          if (sel && ratioInput) {
            split_to.push({ id: sel.value, ratio: parseInt(ratioInput.value) || 0 });
          }
        });
      }
      const selectedAvatar = document.querySelector('#memberAvatarPalette .avatar-swatch.selected')?.dataset?.avatar || '👤';
      const member = { id: id||App.utils.generateId(), name, color, debt_limit, split_to, avatar: selectedAvatar };
      await App.db.put('members', member);
      App.cache.members = null;
      App.ui.closeModal('modalMember'); App.utils.showToast(id?'Atualizado!':'Criado!'); this.load(); App.dashboard.refresh(); return false;
    },
    async edit(id) { const m = await App.db.getById('members',id); if(m) App.ui.openMemberModal(m); },
    async remove(id) { App.utils.confirm('Excluir membro?', async () => { await App.db.delete('members',id); App.cache.members = null; this.load(); }); },
    selectColor(color) { document.getElementById('memColor').value = color; document.querySelectorAll('#memberColorPalette .color-swatch').forEach(el => el.classList.remove('selected')); const swatch = document.querySelector(`#memberColorPalette .color-swatch[data-color="${color}"]`); if (swatch) swatch.classList.add('selected'); },
    selectAvatar(avatar) {
      document.querySelectorAll('#memberAvatarPalette .avatar-swatch').forEach(el => el.classList.remove('selected'));
      const swatch = document.querySelector(`#memberAvatarPalette .avatar-swatch[data-avatar="${avatar}"]`);
      if (swatch) swatch.classList.add('selected');
    },

    addSplitMember() {
      const container = document.getElementById('memSplitMembers');
      const members = App.cache.members || [];
      const idx = container.querySelectorAll('.form-row').length;
      const html = `<div class="form-row" style="margin-bottom:6px;">
        <select class="splitMemberSelect" data-index="${idx}" style="flex:1;">${members.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select>
        <input type="number" class="splitMemberRatio" data-index="${idx}" value="50" min="1" max="99" style="width:70px;">%
        <button type="button" class="btn btn-ghost btn-sm" onclick="App.members.removeSplitMember(${idx})">✕</button>
      </div>`;
      container.insertAdjacentHTML('beforeend', html);
    },
    removeSplitMember(idx) {
      const container = document.getElementById('memSplitMembers');
      const rows = container.querySelectorAll('.form-row');
      if (rows[idx]) rows[idx].remove();
    },

    async verDetalhes(memberId) {
      const member = await App.db.getById('members', memberId);
      if (!member) return;

      // Busca todas as transações do membro (incluindo splits)
      const allTx = await App.db.getAll('transactions');
      const txDoMembro = allTx.filter(t => {
        if (t.member_id === memberId) return true;
        if (t.member_splits && t.member_splits.some(sp => sp.member_id === memberId)) return true;
        return false;
      });

      // Calcula métricas
      const metricas = await this.calcularMetricas(member, txDoMembro, allTx);

      // Monta o conteúdo do modal
            const content = document.getElementById('modalMemberDetailContent');
      if (!content) return;

      content.innerHTML = `
        <div class="cards-row" style="margin-bottom:16px;">
          <div class="card"><div class="card-label">👤 Membro</div><div class="card-value">${member.name}</div></div>
          <div class="card"><div class="card-label">📅 Cadastro</div><div class="card-value">${metricas.tempoCadastro}</div></div>
          <div class="card"><div class="card-label">Situação</div><div class="card-value">${metricas.situacao}</div></div>
        </div>
        <div class="cards-row" style="margin-bottom:16px;">
          <div class="card"><div class="card-label">📥 Receitas (12m)</div><div class="card-value" style="color:var(--income);">${App.utils.formatCurrency(metricas.receitas12m)}</div></div>
          <div class="card"><div class="card-label">📤 Despesas (12m)</div><div class="card-value" style="color:var(--expense);">${App.utils.formatCurrency(metricas.despesas12m)}</div></div>
          <div class="card"><div class="card-label">⚖️ Saldo (12m)</div><div class="card-value" style="color:${metricas.saldo12m >= 0 ? 'var(--income)' : 'var(--expense)'};">${App.utils.formatCurrency(metricas.saldo12m)}</div></div>
        </div>
        <div class="cards-row" style="margin-bottom:16px;">
          <div class="card"><div class="card-label">🛒 Última Compra</div><div class="card-value">${metricas.ultimaCompra || '—'}</div></div>
          <div class="card"><div class="card-label">📊 Média Mensal de Compras</div><div class="card-value">${metricas.mediaComprasMes}</div></div>
          <div class="card"><div class="card-label">💸 Gasto Médio Mensal</div><div class="card-value">${App.utils.formatCurrency(metricas.gastoMedioMensal)}</div></div>
        </div>
        <div class="cards-row" style="margin-bottom:16px;">
          <div class="card"><div class="card-label">📈 Maior Categoria</div><div class="card-value">${metricas.maiorCategoria}</div></div>
          <div class="card"><div class="card-label">💚 Saúde Financeira</div><div class="card-value">${metricas.saudeFinanceira}%</div></div>
          <div class="card"><div class="card-label">💳 Parcelas Ativas</div><div class="card-value">${metricas.parcelasAtivas}</div></div>
        </div>
        <h3>📋 Resumo de Contas e Cartões</h3>
        <div class="table-container" style="margin-bottom:16px;">
          <table><thead><tr><th>Tipo</th><th>Nome</th><th class="text-right">Valor</th></tr></thead><tbody>
            ${metricas.contas.map(c => `<tr><td>Conta</td><td>${c.name}</td><td class="text-right">${App.utils.formatCurrency(c.saldo)}</td></tr>`).join('')}
            ${metricas.cartoes.map(c => `<tr><td>Cartão</td><td>${c.name}</td><td class="text-right">${App.utils.formatCurrency(c.gastoAtual)}</td></tr>`).join('')}
          </tbody></table>
        </div>
      `;

      App.ui.openModal('modalMemberDetail');
    },

    async calcularMetricas(member, txDoMembro, allTx) {
      const today = new Date();
      const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      const firstDate = txDoMembro.length > 0 ? new Date(Math.min(...txDoMembro.map(t => new Date(t.date.slice(0, 10) + 'T12:00:00')))) : null;
      const tempoCadastro = firstDate ? this.formatarTempo(today - firstDate) : 'Sem transações';
      const situacao = txDoMembro.length > 0 ? 'Ativo' : 'Sem atividade';

      const despesas = txDoMembro.filter(t => t.type === 'expense' && t.status === 'confirmed');
      const receitas = txDoMembro.filter(t => t.type === 'income' && t.status === 'confirmed');

      const despesas12m = despesas.filter(t => new Date(t.date) >= oneYearAgo).reduce((s, t) => s + parseFloat(t.amount), 0);
      const receitas12m = receitas.filter(t => new Date(t.date) >= oneYearAgo).reduce((s, t) => s + parseFloat(t.amount), 0);
      const saldo12m = receitas12m - despesas12m;

      // Última compra (despesa mais recente)
      const ultimaCompra = despesas.length > 0 ? despesas.sort((a, b) => b.date.localeCompare(a.date))[0] : null;
      const ultimaCompraStr = ultimaCompra ? `${App.utils.formatDate(ultimaCompra.date)} — ${ultimaCompra.description || ultimaCompra.category}` : null;

      // Média de compras por mês (últimos 12 meses)
      const mesesAtivos = new Set(despesas.filter(t => new Date(t.date) >= oneYearAgo).map(t => t.date.slice(0, 7)));
      const mediaComprasMes = mesesAtivos.size > 0 ? (despesas.filter(t => new Date(t.date) >= oneYearAgo).length / mesesAtivos.size).toFixed(1) : '0';

      // Gasto médio mensal (últimos 12 meses)
      const gastoMedioMensal = mesesAtivos.size > 0 ? despesas12m / mesesAtivos.size : 0;

      // Maior categoria (últimos 12 meses)
      const gastosPorCat = {};
      despesas.filter(t => new Date(t.date) >= oneYearAgo).forEach(t => {
        gastosPorCat[t.category] = (gastosPorCat[t.category] || 0) + parseFloat(t.amount);
      });
      const maiorCategoria = Object.entries(gastosPorCat).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Nenhuma';

      // Saúde financeira (baseado em comprometimento de renda)
      const rendaMensal = receitas12m / 12;
      const gastoMensal = despesas12m / 12;
      const saudeFinanceira = rendaMensal > 0 ? Math.max(0, Math.min(100, Math.round((1 - (gastoMensal / rendaMensal)) * 100))) : 0;

      // Parcelas ativas
      const parcelasAtivas = despesas.filter(t => t.installments > 1 && t.status === 'confirmed' && t.date >= today.toISOString().slice(0, 10)).length;

      // Contas e cartões do membro
      const contas = await App.db.getAll('accounts');
      const cartoes = await App.db.getAll('creditCards');
      const contasDoMembro = contas.filter(a => a.member_id === member.id);
      const cartoesDoMembro = cartoes.filter(c => c.member_id === member.id);

      // Calcula saldo das contas (aproximado)
      const saldoContas = [];
      for (const acc of contasDoMembro) {
        const txConta = allTx.filter(t => (t.account_id === acc.id || t.account_to_id === acc.id) && t.status === 'confirmed');
        let saldo = acc.initial_balance || 0;
        txConta.forEach(t => {
          const amt = parseFloat(t.amount);
          if (t.account_id === acc.id) {
            if (t.type === 'income' || t.type === 'refund') saldo += amt;
            else if (t.type === 'expense') saldo -= amt;
            else if (t.type === 'transfer' || t.type === 'contribution') saldo -= amt;
          } else if (t.account_to_id === acc.id) {
            if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') saldo += amt;
          }
        });
        saldoContas.push({ name: acc.name, saldo });
      }

      const cartoesInfo = [];
      for (const card of cartoesDoMembro) {
        const gastoAtual = allTx.filter(t => t.credit_card_id === card.id && (t.type === 'expense' || t.type === 'refund') && t.status === 'confirmed').reduce((s, t) => s + parseFloat(t.amount), 0);
        cartoesInfo.push({ name: card.name, gastoAtual });
      }

      return {
        tempoCadastro,
        situacao,
        ultimaCompra: ultimaCompraStr,
        mediaComprasMes,
        gastoMedioMensal,
        maiorCategoria,
        saudeFinanceira,
        receitas12m,
        despesas12m,
        saldo12m,
        parcelasAtivas,
        contas: saldoContas,
        cartoes: cartoesInfo
      };
    },

    formatarTempo(milliseconds) {
      const dias = Math.floor(milliseconds / (1000 * 60 * 60 * 24));
      const anos = Math.floor(dias / 365);
      const meses = Math.floor((dias % 365) / 30);
      const diasRestantes = (dias % 365) % 30;
      return `${anos > 0 ? anos + ' ano(s) ' : ''}${meses > 0 ? meses + ' mês(es) ' : ''}${diasRestantes} dia(s)`;
    }
  };

  // =======================================================================
  // Contas – otimizado com intervalo longo (20 anos)
  // =======================================================================
  App.accounts = {
    _sortCol: 'name', _sortAsc: true,
    async load() {
      try {
        if (App.creditCards && typeof App.creditCards.ensureExtendedLogos === 'function') {
          await App.creditCards.ensureExtendedLogos();
        }
        const accounts = App.cache.accounts || await App.db.getAll('accounts');
        if (!App.cache.accounts) App.cache.accounts = accounts;
        const members = App.cache.members || await App.db.getAll('members');
        if (!App.cache.members) App.cache.members = members;
        const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
        const today = App.utils.todayISO();
        const startDate = App.utils.addMonths(today, -240);
        const txAll = await App.db.getTransactionsInRange(startDate, '2099-12-31');
        const balanceMap = {}, txCountMap = {};
        accounts.forEach(a => { balanceMap[a.id] = a.initial_balance || 0; txCountMap[a.id] = 0; });
        txAll.forEach(t => {
          if (t.date <= today && t.status === 'confirmed' && !t.invoice_locked && !t.credit_card_id) {
            const amt = parseFloat(t.amount);
            if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
            else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
            else if (t.type === 'transfer' || t.type === 'contribution') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
            else if (t.type === 'withdrawal') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
          }
          txCountMap[t.account_id] = (txCountMap[t.account_id] || 0) + 1;
          if (t.account_to_id) txCountMap[t.account_to_id] = (txCountMap[t.account_to_id] || 0) + 1;
        });
        const usageSorted = Object.entries(txCountMap).sort((a,b) => b[1]-a[1]);
        const top3 = new Set(usageSorted.slice(0, 3).map(e => e[0]));
        const activeAccounts = accounts.filter(a => !a.archived);
        const archivedAccounts = accounts.filter(a => a.archived);
        const self = this;

        const buildTableHTML = (accts) => {
          let sorted = [...accts];
          if (self._sortCol === 'name') sorted.sort((a,b) => a.name.localeCompare(b.name) * (self._sortAsc ? 1 : -1));
          else if (self._sortCol === 'type') sorted.sort((a,b) => a.type.localeCompare(b.type) * (self._sortAsc ? 1 : -1));
          else if (self._sortCol === 'balance') sorted.sort((a,b) => ((balanceMap[a.id]||0) - (balanceMap[b.id]||0)) * (self._sortAsc ? 1 : -1));
          else if (self._sortCol === 'usage') sorted.sort((a,b) => ((txCountMap[a.id]||0) - (txCountMap[b.id]||0)) * (self._sortAsc ? 1 : -1));
          const rows = sorted.map(a => {
            const balance = balanceMap[a.id] || 0;
            const lightning = top3.has(a.id) ? '<span class="account-lightning" title="Conta mais usada">⚡</span>' : '';
            const logoBadge = App.bankLogos ? `<span class="account-table-logo">${App.bankLogos.renderLogoHtml(a)}</span>` : '';
            return `<tr><td><span class="category-clickable account-name-cell" onclick="App.accountDetail.load('${a.id}')">${logoBadge}<span>${a.name}${lightning}</span></span></td><td>${a.type==='checking'?'Corrente':a.type==='savings'?'Poupança':a.type==='investment'?'Investimento':a.type==='loan'?'Empréstimo':a.type==='other'?(a.other_type||'Outro'):'Carteira'}</td><td>${memberMap[a.member_id]||''}</td><td class="text-right">${App.utils.formatCurrency(balance)}</td><td class="text-center">${txCountMap[a.id]||0} transações</td><td class="text-center"><input type="checkbox" class="excludeCheck" value="${a.id}" ${a.exclude_from_total?'checked':''} onchange="App.accounts.toggleExclude('${a.id}')"></td><td class="text-center actions-cell"><button class="icon-btn" onclick="App.accounts.toggleArchive('${a.id}')">${a.archived?'📂':'✅'}</button><button class="icon-btn" onclick="App.accounts.edit('${a.id}')">✏️</button><button class="icon-btn" onclick="App.accounts.adjustBalance('${a.id}')" title="Ajustar saldo">💰</button><button class="icon-btn" onclick="App.accounts.showHistory('${a.id}')">📋</button><button class="icon-btn delete" onclick="App.accounts.remove('${a.id}')">🗑️</button></td></tr>`;
          }).join('') || '<tr><td colspan="7">Nenhuma conta</td></tr>';
          const arrows = { name: self._sortCol==='name'?(self._sortAsc?' ▲':' ▼'):'', type: self._sortCol==='type'?(self._sortAsc?' ▲':' ▼'):'', balance: self._sortCol==='balance'?(self._sortAsc?' ▲':' ▼'):'', usage: self._sortCol==='usage'?(self._sortAsc?' ▲':' ▼'):'' };
          return `<table><thead><tr><th class="sortable" onclick="App.accounts.sortBy('name')">Nome${arrows.name}</th><th class="sortable" onclick="App.accounts.sortBy('type')">Tipo${arrows.type}</th><th>Membro</th><th class="text-right sortable" onclick="App.accounts.sortBy('balance')">Saldo${arrows.balance}</th><th class="text-center sortable" onclick="App.accounts.sortBy('usage')">Uso${arrows.usage}</th><th class="text-center">Ocultar</th><th class="text-center">Ações</th></tr></thead><tbody>${rows}</tbody></table>`;
        };
        document.getElementById('activeAccountsTable').innerHTML = buildTableHTML(activeAccounts);
        document.getElementById('archivedAccountsTable').innerHTML = buildTableHTML(archivedAccounts);
      } catch (e) { console.error(e); }
    },
    sortBy(col) { if (this._sortCol === col) this._sortAsc = !this._sortAsc; else { this._sortCol = col; this._sortAsc = true; } this.load(); },
    async toggleExclude(id) { const a = await App.db.getById('accounts', id); if (!a) return; a.exclude_from_total = !a.exclude_from_total; await App.db.put('accounts', a); App.cache.accounts = null; this.load(); },
      async save(e) {
    e.preventDefault();
    const id = document.getElementById('accId').value;
    const name = document.getElementById('accName').value;
    const type = document.getElementById('accType').value;
    const member_id = document.getElementById('accMember').value;
    const archived = document.getElementById('accArchived').checked;
    const exclude_from_total = document.getElementById('accExcludeFromTotal').checked;
    const initial_balance = parseFloat(document.getElementById('accInitialBalance').value) || 0;
    const other_type = type === 'other' ? (document.getElementById('accOtherType').value.trim() || 'Outro') : null;
    const investment_type = type === 'investment' ? (document.getElementById('accInvestmentType')?.value || '') : '';

    // --- Campos de vínculo (podem não existir se o modal não tiver o bloco) ---
    const linkedSelect = document.getElementById('accLinkedInvestmentSelect');
    const createCheck = document.getElementById('accCreateInvestmentCheckbox');
    const newInvNameInput = document.getElementById('accNewInvestmentName');

    if (!name) { App.utils.showToast('Nome obrigatório','error'); return false; }

    // Processamento do vínculo (antes de salvar a conta)
    let linkedInvestmentId = null;
    if ((type === 'checking' || type === 'savings') && linkedSelect && createCheck) {
      if (createCheck.checked) {
        // Criar nova conta de investimento
        const newInvName = newInvNameInput ? newInvNameInput.value.trim() : '';
        if (!newInvName) {
          App.utils.showToast('Informe o nome da nova conta de investimento.', 'error');
          return false;
        }
        const newInvAccount = {
          id: App.utils.generateId(),
          name: newInvName,
          type: 'investment',
          member_id: member_id,
          archived: false,
          balance: 0,
          initial_balance: 0,
          exclude_from_total: false,
          other_type: null,
          investment_type: '',
          linked_account_id: null  // será preenchido depois
        };
        await App.db.put('accounts', newInvAccount);
        linkedInvestmentId = newInvAccount.id;
        // Vincular bidirecionalmente
        newInvAccount.linked_account_id = id || null; // será atualizado após salvar a conta corrente
        await App.db.put('accounts', newInvAccount);
      } else {
        // Usar conta selecionada
        linkedInvestmentId = linkedSelect.value || null;
      }
    }

    const bank_ispb = document.getElementById('accBank')?.value || '';
    const account = {
      id: id || App.utils.generateId(),
      name,
      bank_ispb,
      type,
      member_id,
      archived,
      balance: 0,
      initial_balance,
      exclude_from_total,
      other_type,
      investment_type,
      linked_investment_account_id: linkedInvestmentId  // pode ser null
    };

    await App.db.put('accounts', account);
    App.cache.accounts = null;

    // Se criou nova conta de investimento, atualizar o linked_account_id nela
    if (linkedInvestmentId && createCheck && createCheck.checked) {
      const invAcc = await App.db.getById('accounts', linkedInvestmentId);
      if (invAcc) {
        invAcc.linked_account_id = account.id;
        await App.db.put('accounts', invAcc);
      }
    } else if (linkedInvestmentId && !createCheck.checked) {
      // Atualizar a conta de investimento selecionada para apontar para esta conta corrente
      const invAcc = await App.db.getById('accounts', linkedInvestmentId);
      if (invAcc) {
        invAcc.linked_account_id = account.id;
        await App.db.put('accounts', invAcc);
      }
    }

    const wasArchived = id ? (await App.db.getById('accounts', id))?.archived : null;
    if (id && wasArchived !== undefined && wasArchived !== archived) {
      await App.db.put('accountHistory', { id: App.utils.generateId(), account_id: id, action: archived ? 'deactivated' : 'activated', date: App.utils.todayISO(), observation: '' });
    }

    // -- Sincroniza transação de saldo inicial (mantido igual) --
    const finalAccountId = id || account.id;
    const finalInitial = initial_balance;
    const allTx = await App.db.getAll('transactions');
    const existingTx = allTx.find(t =>
      t.account_id === finalAccountId &&
      t.description === `Saldo Inicial ${name}`
    );

    if (finalInitial !== 0) {
      if (existingTx) {
        existingTx.amount = finalInitial;
        existingTx.ignore_from_total = true;
        await App.db.put('transactions', existingTx);
      } else {
        const accObj = (App.cache.accounts || await App.db.getAll('accounts')).find(a => a.id === finalAccountId);
        await App.db.put('transactions', {
          id: App.utils.generateId(),
          type: 'income',
          amount: finalInitial,
          category: 'Saldo Inicial',
          account_id: finalAccountId,
          account_name: accObj?.name || name,
          date: App.utils.todayISO(),
          description: `Saldo Inicial ${name}`,
          notes: '',
          member_id: member_id || '',
          member_name: (App.cache.members?.find(m => m.id === member_id) || {}).name || '',
          status: 'confirmed',
          reconciled: false,
          ignore_from_total: true,
          createdAt: new Date().toISOString(),
          position: Date.now()
        });
      }
    } else {
      if (existingTx) {
        await App.db.delete('transactions', existingTx.id);
      }
    }

    App.ui.closeModal('modalAccount');
    App.utils.showToast(id ? 'Atualizada!' : 'Criada!');
    this.load();
    if (App.fab.getCurrentPage() === 'account-detail' && App.accountDetail.currentId === finalAccountId) {
      App.accountDetail.render();
    }
    return false;
  },
    async edit(id) { const a = await App.db.getById('accounts',id); if(a) App.ui.openAccountModal(a); },
    async toggleArchive(id) {
      const a = await App.db.getById('accounts', id); if (!a) return;
      App.utils.prompt('Motivo do arquivamento:', '', async (obs) => {
        a.archived = !a.archived;
        await App.db.put('accounts', a);
        App.cache.accounts = null;
        await App.db.put('accountHistory', { id: App.utils.generateId(), account_id: id, action: a.archived ? 'deactivated' : 'activated', date: App.utils.todayISO(), observation: obs || '' });
        this.load();
      });
    },
    async showHistory(id) {
      const account = await App.db.getById('accounts', id); if (!account) return;
      const history = await App.db.getAll('accountHistory'); const accountHistory = history.filter(h => h.account_id === id).sort((a,b) => b.date.localeCompare(a.date));
      let html = `<h3>Histórico de ${account.name}</h3>`;
      if (accountHistory.length) { html += '<table><thead><tr><th>Data</th><th>Ação</th><th>Observação</th></tr></thead><tbody>'; accountHistory.forEach(h => html += `<tr><td>${App.utils.formatDate(h.date)}</td><td>${h.action==='activated'?'✅ Ativada':'📁 Arquivada'}</td><td>${h.observation||'-'}</td></tr>`); html += '</tbody></table>'; }
      else html += '<p>Nenhuma alteração registrada.</p>';
      document.getElementById('accountHistoryContent').innerHTML = html; App.ui.openModal('modalAccountHistory');
    },
    async remove(id) { App.utils.confirm('Excluir conta?', async () => { await App.db.delete('accounts',id); App.cache.accounts = null; this.load(); }); },

    async adjustBalance(accountId) {
      const account = await App.db.getById('accounts', accountId);
      if (!account) {
        App.utils.showToast('Conta não encontrada.', 'error');
        return;
      }

      document.getElementById('adjustAccountId').value = accountId;
      document.getElementById('adjustAccountName').value = account.name;
      document.getElementById('adjustDate').value = App.utils.todayISO();
      document.getElementById('adjustTime').value = new Date().toTimeString().slice(0,5);
      document.getElementById('adjustAmount').value = '';
      document.getElementById('adjustReason').value = '';

      App.ui.openModal('modalAdjustBalance');
    },

    async saveAdjustment(e) {
      e.preventDefault();
      const accountId = document.getElementById('adjustAccountId').value;
      const account = await App.db.getById('accounts', accountId);
      if (!account) {
        App.utils.showToast('Conta não encontrada.', 'error');
        return false;
      }

      const rawAmount = document.getElementById('adjustAmount').value;
      const amount = parseFloat(rawAmount.replace(',', '.'));
      if (isNaN(amount) || amount === 0) {
        App.utils.showFieldError(document.getElementById('adjustAmount'), 'Informe um valor válido');
        return false;
      }

      const date = document.getElementById('adjustDate').value;
      const time = document.getElementById('adjustTime').value || '00:00';
      const fullDate = (time && time !== '00:00') ? date + 'T' + time + ':00' : date;
      const reason = document.getElementById('adjustReason').value.trim();

      // Calcula saldo antes do ajuste (usando lógica existente)
      const startDate = App.utils.addMonths(App.utils.todayISO(), -240);
      const txAll = await App.db.getTransactionsInRange(startDate, '2099-12-31');
      const balanceBefore = await this._calculateAccountBalance(accountId, txAll);

      // Determina tipo: positivo = income, negativo = expense
      const type = amount > 0 ? 'income' : 'expense';
      const absAmount = Math.abs(amount);

      // Cria transação de ajuste
      const tx = {
        id: App.utils.generateId(),
        type: type,
        amount: absAmount,
        category: 'Ajuste de Saldo',
        account_id: accountId,
        account_name: account.name,
        account_to_id: null,
        account_to_name: null,
        date: fullDate,
        description: `Ajuste de saldo${reason ? ' - ' + reason : ''}`,
        notes: reason || '',
        member_id: account.member_id || '',
        member_name: (App.cache.members?.find(m => m.id === account.member_id) || {}).name || '',
        credit_card_id: null,
        payment_method: 'adjustment',
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
        createdAt: new Date().toISOString(),
        position: Date.now()
      };
      await App.db.put('transactions', tx);

      // Calcula saldo depois do ajuste
      const updatedTxAll = await App.db.getTransactionsInRange(startDate, '2099-12-31');
      const balanceAfter = await this._calculateAccountBalance(accountId, updatedTxAll);

      // Registra no histórico de auditoria
      await App.db.put('accountHistory', {
        id: App.utils.generateId(),
        account_id: accountId,
        action: 'balance_adjustment',
        date: App.utils.todayISO(),
        observation: `Ajuste de ${App.utils.formatCurrency(amount)} (${reason || 'sem motivo'}). Saldo anterior: ${App.utils.formatCurrency(balanceBefore)}, saldo posterior: ${App.utils.formatCurrency(balanceAfter)}`
      });

      App.ui.closeModal('modalAdjustBalance');
      App.utils.showToast('Ajuste de saldo realizado!');
      this.load();
      if (App.saldos) await App.saldos.load();
      if (App.transactions) App.transactions.invalidateCache?.();
      return false;
    },

    async _calculateAccountBalance(accountId, txAll) {
      const account = await App.db.getById('accounts', accountId);
      if (!account) return 0;
      let balance = account.initial_balance || 0;
      const filtered = txAll.filter(t => t.status === 'confirmed' && !t.ignore_from_total);
      for (const t of filtered) {
        const amt = parseFloat(t.amount);
        if (t.credit_card_id) continue; // cartão não afeta conta diretamente
        if (t.account_id === accountId) {
          if (t.type === 'income' || t.type === 'refund') balance += amt;
          else if (t.type === 'expense') balance -= amt;
          else if (t.type === 'transfer' || t.type === 'contribution') balance -= amt;
        } else if (t.account_to_id === accountId) {
          if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') balance += amt;
        }
      }
      return balance;
    },

    archiveSelected() {
      const checkboxes = document.querySelectorAll('#activeAccountsTable input[type="checkbox"]:checked');
      if (!checkboxes.length) { App.utils.showToast('Selecione contas para arquivar','error'); return; }
      App.utils.confirm('Arquivar contas selecionadas?', async () => {
        for (const cb of checkboxes) { const a = await App.db.getById('accounts', cb.value); if (a) { a.archived = true; await App.db.put('accounts', a); } }
        App.cache.accounts = null; this.load();
      });
    },
    unarchiveSelected() {
      const checkboxes = document.querySelectorAll('#archivedAccountsTable input[type="checkbox"]:checked');
      if (!checkboxes.length) { App.utils.showToast('Selecione contas para desarquivar','error'); return; }
      App.utils.confirm('Desarquivar contas selecionadas?', async () => {
        for (const cb of checkboxes) { const a = await App.db.getById('accounts', cb.value); if (a) { a.archived = false; await App.db.put('accounts', a); } }
        App.cache.accounts = null; this.load();
      });
    }
  };

  // =======================================================================
  // Detalhes da Conta – otimizado com range de 20 anos
  // =======================================================================
  App.accountDetail = {
    currentId: null, _sortCol: 'date', _sortAsc: false, _transactions: [],
    async load(accountId) { this.currentId = accountId; App.ui.navigateTo('account-detail'); },
    switchTab(tab) {
      this._currentDetailTab = tab;
      const tabs = document.querySelectorAll('#page-account-detail .detail-tabs .btn');
      tabs.forEach(b => b.classList.remove('active'));
      if (tab === 'transacoes') tabs[0]?.classList.add('active');
      else if (tab === 'transferencias') tabs[1]?.classList.add('active');
      else if (tab === 'investimentos') tabs[2]?.classList.add('active');
      this.render();
    },
    async render() {
      const account = await App.db.getById('accounts', this.currentId); if (!account) return;
      const today = App.utils.todayISO();
      const startDate = App.utils.addMonths(today, -240);
      const txAll = await App.db.getTransactionsInRange(startDate, '2099-12-31');
      const cards = App.cache.creditCards || await App.db.getAll('creditCards');
      if (!App.cache.creditCards) App.cache.creditCards = cards;
      const cardIdsOfThisAccount = new Set(cards.filter(c => c.account_id === this.currentId).map(c => c.id));

      const accountTx = txAll.filter(t => {
        if (t.status !== 'confirmed') return false;
        if (t.account_id === this.currentId || t.account_to_id === this.currentId) return true;
        // Fallback defensivo: transações de cartão são validadas pelo account_id do cartão
        if (t.credit_card_id && cardIdsOfThisAccount.has(t.credit_card_id)) return true;
        return false;
      });
      const accountTxForBalance = accountTx.filter(t => !t.ignore_from_total);
      this._transactions = accountTx;
      this._allTxForInvoiceCheck = txAll;
      let balance = account.initial_balance || 0;
      accountTxForBalance.forEach(t => {
        if (t.date > today) return;
        if (t.credit_card_id) return;
        const amt = parseFloat(t.amount);
        if (t.account_id === this.currentId) {
          if (t.type === 'income' || t.type === 'refund') balance += amt;
          else if (t.type === 'expense') balance -= amt;
          else if (t.type === 'transfer' || t.type === 'contribution') balance -= amt;
        } else if (t.account_to_id === this.currentId) {
          if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') balance += amt;
        }
      });
      // Função auxiliar para gerar HTML do logo do banco
      const renderBankLogo = (acc) => {
        if (App.bankLogos && typeof App.bankLogos.renderLogoHtml === 'function') {
          return App.bankLogos.renderLogoHtml(acc);
        }
        return acc.name.charAt(0).toUpperCase();
      };

      // Verificar vínculo com conta de investimento
      let linkedInvestmentBalance = null;
      let linkedInvestmentName = null;
      let linkedInvestmentLogo = '';
      if (account.linked_investment_account_id) {
        const linkedAcc = await App.db.getById('accounts', account.linked_investment_account_id);
        if (linkedAcc) {
          linkedInvestmentName = linkedAcc.name;
          linkedInvestmentLogo = renderBankLogo(linkedAcc);
          const linkedTx = txAll.filter(t => (t.account_id === linkedAcc.id || t.account_to_id === linkedAcc.id) && t.status === 'confirmed');
          let linkedBalance = linkedAcc.initial_balance || 0;
          linkedTx.forEach(t => {
            if (t.date > today) return;
            if (t.credit_card_id) return;
            const amt = parseFloat(t.amount);
            if (t.account_id === linkedAcc.id) {
              if (t.type === 'income' || t.type === 'refund') linkedBalance += amt;
              else if (t.type === 'expense') linkedBalance -= amt;
              else if (t.type === 'transfer' || t.type === 'contribution') linkedBalance -= amt;
            } else if (t.account_to_id === linkedAcc.id) {
              if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') linkedBalance += amt;
            }
          });
          linkedInvestmentBalance = linkedBalance;
        }
      }

      // Monta os cards principais com logo
      const mainLogo = renderBankLogo(account);
      let html = `<div class="cards-row">
        <div class="card" style="display:flex; align-items:center; gap:12px;">
          <div style="flex-shrink:0; width:42px; height:42px; border-radius:8px; background:#ffffff; padding:4px; border:1px solid rgba(128,128,128,0.22); box-sizing:border-box; display:flex; align-items:center; justify-content:center; overflow:hidden;">
            ${mainLogo}
          </div>
          <div>
            <div class="card-label">Conta</div>
            <div class="card-value">${account.name}</div>
          </div>
        </div>
        <div class="card"><div class="card-label">Saldo Inicial</div><div class="card-value">${App.utils.formatCurrency(account.initial_balance||0)}</div></div>
        <div class="card"><div class="card-label">Saldo Atual</div><div class="card-value">${App.utils.formatCurrency(balance)}</div></div>`;

      // Card elaborado da conta vinculada (sem botões de atalho)
      if (linkedInvestmentBalance !== null) {
        html += `<div class="card" style="border-left: 4px solid var(--contribution); display:flex; align-items:center; gap:12px; background:linear-gradient(145deg, rgba(96,165,250,0.05), rgba(96,165,250,0.02));">
          <div style="flex-shrink:0; width:42px; height:42px; border-radius:8px; background:#ffffff; padding:4px; border:1px solid rgba(128,128,128,0.22); box-sizing:border-box; display:flex; align-items:center; justify-content:center; overflow:hidden;">
            ${linkedInvestmentLogo}
          </div>
          <div style="flex:1;">
            <div class="card-label" style="color: var(--contribution);">Conta de Investimento Vinculada</div>
            <div class="card-value" style="font-size:1.2rem;">${linkedInvestmentName || ''}</div>
            <div class="card-sub" style="display:flex; align-items:center; gap:6px;">
              <span>Saldo:</span>
              <strong style="color: ${linkedInvestmentBalance >= 0 ? 'var(--income)' : 'var(--expense)'};">${App.utils.formatCurrency(linkedInvestmentBalance)}</strong>
            </div>
          </div>
        </div>`;
      }

      html += `</div>`;

      // Abas: Transações, Transferências (todas as contas), Investimentos (só investment)
      html += `<div class="detail-tabs" style="margin:16px 0;">
        <button class="btn btn-sm btn-outline active" onclick="App.accountDetail.switchTab('transacoes')">📊 Transações</button>
        <button class="btn btn-sm btn-outline" onclick="App.accountDetail.switchTab('transferencias')">🔁 Transferências</button>`;
      if (account.type === 'investment') {
        html += `<button class="btn btn-sm btn-outline" onclick="App.accountDetail.switchTab('investimentos')">📈 Investimentos</button>`;
      }
      html += `</div>`;
      // Mantém a aba atual; se ainda não houver aba definida, usa 'transacoes'
      if (!this._currentDetailTab) {
        this._currentDetailTab = 'transacoes';
      }

      if (this._currentDetailTab === 'transferencias') {
        const transferTx = this._transactions.filter(t =>
          ['transfer', 'contribution', 'withdrawal'].includes(t.type) &&
          (t.account_id === this.currentId || t.account_to_id === this.currentId)
        );
        const accounts = App.cache.accounts || await App.db.getAll('accounts');
        const accMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
        const typeNames = { transfer: 'Transferência', contribution: 'Aporte', withdrawal: 'Resgate' };

        const rows = transferTx.sort((a,b) => b.date.localeCompare(a.date)).map(t => {
          const isOutgoing = t.account_id === this.currentId;
          const partnerId = isOutgoing ? t.account_to_id : t.account_id;
          const partnerName = accMap[partnerId] || partnerId || '—';
          const amount = parseFloat(t.amount);

          const subtype = t.transfer_subtype || '';
          let subtypeLabel = '';
          if (t.type === 'transfer' && subtype === 'aporte') subtypeLabel = ' · Aporte';
          else if (t.type === 'transfer' && subtype === 'resgate') subtypeLabel = ' · Resgate';
          else if (t.type === 'contribution') subtypeLabel = ' · Aporte';
          else if (t.type === 'withdrawal') subtypeLabel = ' · Resgate';

          const cor    = isOutgoing ? '#ef4444' : '#22c55e';
          const bg     = isOutgoing ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)';
          const borda  = isOutgoing ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)';
          const seta   = isOutgoing ? '↑' : '↓';
          const sinal  = isOutgoing ? '−' : '+';
          const rotulo = isOutgoing ? 'Enviado' : 'Recebido';
          const setaConta = isOutgoing ? '→' : '←';

          return `<tr>
            <td style="white-space:nowrap;">${App.utils.formatDateTime(t.date)}</td>
            <td>
              <span style="display:inline-block; padding:3px 10px; border-radius:12px; font-size:0.72rem; font-weight:600; background:${bg}; color:${cor}; border:1px solid ${borda}; white-space:nowrap;">
                ${seta} ${rotulo}
              </span>
            </td>
            <td>${typeNames[t.type] || t.type}${subtypeLabel}</td>
            <td>${setaConta} ${partnerName}</td>
            <td class="text-right" style="color:${cor}; font-weight:600; white-space:nowrap;">${sinal} ${App.utils.formatCurrency(amount)}</td>
            <td>${t.description || ''}</td>
          </tr>`;
        }).join('');

        html += `<div class="table-container">
          <table>
            <thead><tr><th>Data</th><th>Direção</th><th>Tipo</th><th>Conta Parceira</th><th class="text-right">Valor</th><th>Descrição</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center; color:#888; padding:24px;">Nenhuma transferência encontrada</td></tr>'}</tbody>
          </table>
        </div>`;
        document.getElementById('accountDetailContent').innerHTML = html;
      } else if (this._currentDetailTab === 'investimentos' && account.type === 'investment') {
        const invs = (await App.db.getAll('investments')).filter(inv => inv.account_id === account.id);
        let investimentosHtml = '';

        if (invs.length > 0) {
          // Cria cards para cada investimento
          investimentosHtml = `<div class="cards-row" style="margin-bottom:20px;">`;
          invs.forEach(inv => {
            const invested = parseFloat(inv.amount_invested) || 0;
            const current = parseFloat(inv.current_value) || 0;
            const profit = current - invested;
            const pct = invested ? ((profit / invested) * 100).toFixed(1) : 0;
            const rentColor = profit >= 0 ? '#2e7d32' : '#c62828';
            investimentosHtml += `
              <div class="card clickable" style="cursor:pointer;" onclick="App.investments.showDetail('${inv.id}')">
                <div class="card-label">${inv.name}</div>
                <div class="card-value" style="font-size:1.2rem;">${App.utils.formatCurrency(current)}</div>
                <div class="card-sub" style="display:flex; justify-content:space-between; align-items:center;">
                  <span>${inv.type}</span>
                  <span style="color:${rentColor}; font-weight:600;">${profit >= 0 ? '+' : ''}${App.utils.formatCurrency(profit)} (${pct}%)</span>
                </div>
                <div class="progress-bar-bg" style="margin-top:6px;">
                  <div class="progress-bar-fill" style="width:${Math.min(Math.abs(pct), 100)}%; background:${profit >= 0 ? '#a3e635' : '#f87171'};"></div>
                </div>
              </div>`;
          });
          investimentosHtml += `</div>`;

          // Tabela resumida abaixo dos cards
          const rows = invs.map(inv => {
            const invested = parseFloat(inv.amount_invested) || 0;
            const current = parseFloat(inv.current_value) || 0;
            const profit = current - invested;
            const pct = invested ? ((profit / invested) * 100).toFixed(1) : 0;
            return `<tr style="cursor:pointer" onclick="App.investments.showDetail('${inv.id}')">
              <td>${inv.name}</td>
              <td>${inv.type}</td>
              <td class="text-right">${App.utils.formatCurrency(current)}</td>
              <td class="text-right" style="color:${profit >= 0 ? '#2e7d32' : '#c62828'};">${profit >= 0 ? '+' : ''}${App.utils.formatCurrency(profit)} (${pct}%)</td>
            </tr>`;
          }).join('');
          investimentosHtml += `<div class="table-container">
            <table>
              <thead><tr><th>Nome</th><th>Tipo</th><th class="text-right">Valor Atual</th><th class="text-right">Rendimento</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
        } else {
          investimentosHtml = `<div class="empty-state">Nenhum investimento nesta conta</div>`;
        }

        html += investimentosHtml;
        document.getElementById('accountDetailContent').innerHTML = html;
      } else {
        // Aba Transações (padrão)
        html += `<div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
          <span style="font-weight:600;">Ordenar por:</span>
          <select id="accountDetailSortOrder" onchange="App.accountDetail.changeSortOrder()">
            <option value="desc" ${!this._sortAsc && this._sortCol==='date' ? 'selected' : ''}>Mais recente</option>
            <option value="asc" ${this._sortAsc && this._sortCol==='date' ? 'selected' : ''}>Mais antigo</option>
          </select>
        </div>`;
        html += `<div class="table-container"><table><thead><tr><th>Data</th><th>Tipo</th><th>Histórico</th><th class="text-right">Valor</th><th class="text-right">Saldo</th></tr></thead><tbody id="accountDetailTbody"></tbody></table></div>`;
        document.getElementById('accountDetailContent').innerHTML = html;
        this.renderTable(account.initial_balance||0);
      }
    },
    sortBy(col) { if (this._sortCol === col) this._sortAsc = !this._sortAsc; else { this._sortCol = col; this._sortAsc = true; } this.render(); },
   changeSortOrder() {
    const sel = document.getElementById('accountDetailSortOrder');
    if (sel) {
      this._sortAsc = sel.value === 'asc';
      this._sortCol = 'date';
    }
    this.render();
  },
      async renderTable(initialBalance) {
      const tbody = document.getElementById('accountDetailTbody'); if (!tbody) return;
      let data = [...this._transactions];

      // Se a ordenação for por saldo, mantém o comportamento original (sem agrupamento)
      if (this._sortCol === 'saldo') {
        let running = initialBalance;
        data = data.map(t => {
          const amt = parseFloat(t.amount);
          if (t.account_id === this.currentId) {
            if (t.type==='income'||t.type==='refund') running += amt; else running -= amt;
          } else running += amt;
          return { ...t, _saldo: running };
        }).sort((a,b) => (a._saldo - b._saldo) * (this._sortAsc ? 1 : -1));
        let runningBalance = initialBalance;
        const today = App.utils.todayISO();
        tbody.innerHTML = data.map(t => {
          const amt = parseFloat(t.amount);
          let sign = '';
          if (t.date <= today) {
            if (t.account_id === this.currentId) {
              if (t.type === 'income' || t.type === 'refund') { runningBalance += amt; sign = '+'; }
              else { runningBalance -= amt; sign = '-'; }
            } else { runningBalance += amt; sign = '+'; }
          } else { sign = t.account_id === this.currentId ? '-' : '+'; }
          const typeNames = {income:'Receita',expense:'Despesa',transfer:'Transferência',contribution:'Aporte',withdrawal:'Resgate',refund:'Estorno',adjustment:'Ajuste'};
          return `<tr><td>${App.utils.formatDateTime(t.date)}</td><td>${typeNames[t.type] || t.type}</td><td>${t.description||t.category||''}</td><td class="text-right">${sign} ${App.utils.formatCurrency(amt)}</td><td class="text-right">${App.utils.formatCurrency(runningBalance)}</td></tr>`;
        }).join('');
        return;
      }

      // Verifica se o módulo de fatura está disponível para agrupamento
      if (!App.cardInvoice || typeof App.cardInvoice.getInvoicePeriodForDate !== 'function') {
        // Fallback: exibe transações individuais normalmente
        if (this._sortCol === 'date') data.sort((a,b) => a.date.localeCompare(b.date) * (this._sortAsc ? 1 : -1));
        let runningBalance = initialBalance;
        const today = App.utils.todayISO();
        tbody.innerHTML = data.map(t => {
          const amt = parseFloat(t.amount);
          let sign = '';
          if (t.date <= today) {
            if (t.account_id === this.currentId) {
              if (t.type === 'income' || t.type === 'refund') { runningBalance += amt; sign = '+'; }
              else { runningBalance -= amt; sign = '-'; }
            } else { runningBalance += amt; sign = '+'; }
          } else { sign = t.account_id === this.currentId ? '-' : '+'; }
          return `<tr><td>${App.utils.formatDateTime(t.date)}</td><td>${t.type}: ${t.description||t.category||''}</td><td class="text-right">${sign} ${App.utils.formatCurrency(amt)}</td><td class="text-right">${App.utils.formatCurrency(runningBalance)}</td></tr>`;
        }).join('');
        return;
      }

      // Para ordenação por data (padrão): agrupa transações de cartão por fatura (apenas crédito)
      const cards = App.cache.creditCards || await App.db.getAll('creditCards');
      if (!App.cache.creditCards) App.cache.creditCards = cards;

      // Separa transações: cartão de crédito, pré-pago e sem cartão
      const creditCardTx = data.filter(t => {
        if (!t.credit_card_id || (t.type !== 'expense' && t.type !== 'refund')) return false;
        const card = cards.find(c => c.id === t.credit_card_id);
        return card && card.card_type !== 'prepaid';
      });
      const prepaidCardTx = data.filter(t => {
        if (!t.credit_card_id || (t.type !== 'expense' && t.type !== 'refund')) return false;
        const card = cards.find(c => c.id === t.credit_card_id);
        return card && card.card_type === 'prepaid';
      });
      const otherTx = data.filter(t => !t.credit_card_id || (t.type !== 'expense' && t.type !== 'refund'));
      // Transações de cartão pré-pago são tratadas como outras (individuais)
      const allOtherTx = otherTx.concat(prepaidCardTx);

            // Agrupa apenas as transações de cartão de crédito por período de fatura
      const invoiceGroups = {};
      for (const t of creditCardTx) {
        const card = cards.find(c => c.id === t.credit_card_id);
        if (!card) continue;
        let dueDate = '';
        let invoiceLabel = '';
        let dueMonth = '';
        try {
          const period = App.cardInvoice.getInvoicePeriodForDate(card, t.date.slice(0,10));
          dueDate = period.due.slice(0,10);
          dueMonth = period.due.slice(0,7);
          invoiceLabel = `Fatura ${card.name} ${dueMonth}`;
        } catch (e) {
          dueDate = t.date.slice(0,10);
          dueMonth = dueDate.slice(0,7);
          invoiceLabel = `Fatura ${card.name}`;
        }
        const key = `${t.credit_card_id}|${dueMonth}`;
        if (!invoiceGroups[key]) {
          invoiceGroups[key] = {
            cardId: t.credit_card_id,
            cardName: card.name,
            dueDate,
            dueMonth,
            invoiceLabel,
            transactions: [],
            total: 0
          };
        }
        invoiceGroups[key].transactions.push(t);
        const amt = parseFloat(t.amount);
        invoiceGroups[key].total += (t.type === 'expense') ? amt : -amt;
      }

      // Mapa de faturas pagas: chave cardId|dueMonth
      const pagosMap = new Map();
      const revertedPagosMap = new Map();
      const allTxForInvoiceCheck = this._allTxForInvoiceCheck || data;
      const pagamentos = allTxForInvoiceCheck.filter(t =>
        t.type === 'expense' &&
        t.category === 'Pagamento Fatura' &&
        !t.reverted
      );
      pagamentos.forEach(p => {
        const match = p.description?.match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
        if (match) {
          const nomeCartao = match[1].trim();
          const mes = match[2];
          const card = cards.find(c => c.name.toLowerCase() === nomeCartao.toLowerCase());
          if (card) {
            pagosMap.set(`${card.id}|${mes}`, true);
          }
        }
      });

      const pagamentosRevertidos = allTxForInvoiceCheck.filter(t =>
        t.type === 'expense' &&
        t.category === 'Pagamento Fatura' &&
        t.reverted === true
      );
      pagamentosRevertidos.forEach(p => {
        let cid = p.invoice_card_id || null;
        let dm = p.invoice_due_month || null;
        if (!cid || !dm) {
          const match = (p.description || '').match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
          if (!match) return;
          dm = match[2];
          const nomeNorm = match[1].trim().toLowerCase();
          let card = cards.find(c => c.name.toLowerCase() === nomeNorm);
          if (!card) {
            card = cards.find(c => {
              const n = c.name.toLowerCase();
              return n && (n.includes(nomeNorm) || nomeNorm.includes(n));
            });
          }
          if (!card) return;
          cid = card.id;
        }
        revertedPagosMap.set(`${cid}|${dm}`, true);
      });

      // Combina faturas agrupadas (exibidas sem afetar saldo) e transações individuais.
      // Faturas já pagas NÃO geram linha agrupada – apenas a transação de pagamento aparece.
      const rows = [];
      for (const [key, group] of Object.entries(invoiceGroups)) {
        const chavePagamento = `${group.cardId}|${group.dueMonth}`;
        if (!pagosMap.has(chavePagamento)) {
          rows.push({
            date: group.dueDate,
            isGroup: true,
            group: group
          });
        }
      }
      allOtherTx.forEach(t => {
        rows.push({
          date: t.date,
          isGroup: false,
          tx: t
        });
      });
      rows.sort((a, b) => (this._sortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));

      let runningBalance = initialBalance;
      const today = App.utils.todayISO();
      let html = '';

      for (const row of rows) {
        if (row.isGroup) {
          const g = row.group;
          const sign = g.total >= 0 ? '-' : '+';
          const displayDate = App.utils.formatDate(g.dueDate);
          const _revKey = `${g.cardId}|${g.dueMonth}`;
          const isReopened = revertedPagosMap.has(_revKey) && !pagosMap.has(_revKey);
          const rowStyle = isReopened ? 'background:rgba(96,165,250,0.10); border-left:3px solid #60a5fa;' : '';
          const reopenedBadge = isReopened ? ' <span class="badge badge-transfer" style="margin-left:6px;">🔄 Reaberto</span>' : '';
          html += `<tr style="${rowStyle}">
            <td>${displayDate}</td>
            <td>Despesa</td>
            <td>${g.invoiceLabel} (${g.transactions.length} compras)${reopenedBadge}</td>
            <td class="text-right" style="color:${g.total >= 0 ? 'var(--expense)' : 'var(--income)'};">${sign} ${App.utils.formatCurrency(Math.abs(g.total))}</td>
            <td class="text-right">${App.utils.formatCurrency(runningBalance)}</td>
          </tr>`;
        } else {
          const t = row.tx;
          const amt = parseFloat(t.amount);
          let sign = '';
          if (t.date.slice(0,10) <= today) {
            if (t.account_id === this.currentId) {
              if (t.type === 'income' || t.type === 'refund') { runningBalance += amt; sign = '+'; }
              else { runningBalance -= amt; sign = '-'; }
            } else {
              runningBalance += amt; sign = '+';
            }
          } else {
            sign = t.account_id === this.currentId ? '-' : '+';
          }
          let tipoExibicao = t.type;
          let descricaoExibicao = t.description || t.category || '';
          let badgeDirecao = '';

          const isEntrada = (t.account_to_id === this.currentId) ||
                            (t.account_id === this.currentId &&
                              (t.type === 'income' || t.type === 'refund'));

          if (t.type === 'expense' && t.category === 'Pagamento Fatura') {
            tipoExibicao = 'Pagamento Fatura';
            const _m = (t.description || '').match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
            if (_m) {
              const _nome = _m[1].trim();
              const _mes = _m[2];
              const _norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const _card = cards.find(c => _norm(c.name) === _norm(_nome));
              if (_card) {
                const _period = App.cardInvoice.getInvoicePeriodForMonth(_card, _mes);
                descricaoExibicao = `<span style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="event.stopPropagation();App.cardInvoice.open('${_card.id}', { start: '${_period.start}', end: '${_period.end}', due: '${_period.due}' })">${t.description}</span>`;
              }
            }
            descricaoExibicao += ` <button class="icon-btn" title="Reverter pagamento da fatura" onclick="event.stopPropagation();App.creditCards.revertInvoicePayment('${t.id}')" style="margin-left:6px;">↩️</button>`;
          } else {
            const typeNames = {income:'Receita',expense:'Despesa',transfer:'Transferência',contribution:'Aporte',withdrawal:'Resgate',refund:'Estorno',adjustment:'Ajuste'};
            tipoExibicao = typeNames[t.type] || t.type;
          }

          // Badge de direção (↑ saída / ↓ entrada) para destacar o que entra e o que sai
          {
            const cor   = isEntrada ? '#22c55e' : '#ef4444';
            const bg    = isEntrada ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)';
            const borda = isEntrada ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
            const seta  = isEntrada ? '↓' : '↑';
            const rotulo = isEntrada ? 'Entrada' : 'Saída';
            badgeDirecao = `<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.68rem; font-weight:600; background:${bg}; color:${cor}; border:1px solid ${borda}; white-space:nowrap; margin-right:6px;">${seta} ${rotulo}</span>`;
          }

          html += `<tr>
            <td>${App.utils.formatDateTime(t.date)}</td>
            <td>${badgeDirecao}${tipoExibicao}</td>
            <td>${descricaoExibicao}</td>
            <td class="text-right" style="color:${isEntrada ? '#22c55e' : '#ef4444'}; font-weight:600;">${sign} ${App.utils.formatCurrency(amt)}</td>
            <td class="text-right">${App.utils.formatCurrency(runningBalance)}</td>
          </tr>`;
        }
      }

      tbody.innerHTML = html;
    }
  };

  // =======================================================================
  // Histórico de Faturas – otimizado com getTransactionsInRange
  // =======================================================================
  App.cardHistory = {
    currentMonthStart: null,
    async load() {
      if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
      const cycle = App.utils.monthRangeFromDate(this.currentMonthStart);
      document.getElementById('historyCycleLabel').textContent = cycle.refMonth;
      const monthInput = document.getElementById('historyMonthPicker');
      if (monthInput) {
        const d = new Date(this.currentMonthStart + 'T12:00:00');
        monthInput.value = d.toISOString().slice(0, 7);
      }
      const cards = App.cache.creditCards || await App.db.getAll('creditCards');
      if (!App.cache.creditCards) App.cache.creditCards = cards;
      const cardId = document.getElementById('historyCard').value;
      const filteredCards = cardId === 'all' ? cards : cards.filter(c => c.id === cardId);
      const sel = document.getElementById('historyCard');
      if (sel.options.length <= 1) sel.innerHTML = '<option value="all">Todos cartões</option>' + cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

      const txAll = await App.db.getTransactionsInRange(cycle.start, cycle.end, { memberId: App.state.globalMemberFilter || null });

      // Histórico amplo de pagamentos de fatura (últimos 5 anos) para calcular a média paga por cartão
      const inicioHistorico = App.utils.addMonths(App.utils.todayISO(), -60);
      const txHistorico = await App.db.getTransactionsInRange(inicioHistorico, App.utils.todayISO());

      const _norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const mesCiclo = cycle.start.slice(0, 7);

      // Pré-processa uma única vez todos os pagamentos de fatura válidos
      const pagamentosGlobais = txHistorico
        .filter(p => p.category === 'Pagamento Fatura' && p.type === 'expense' && !p.reverted)
        .map(p => {
          const m = (p.description || '').match(/Pagamento Fatura (.+?) (\d{4}-\d{2})/);
          return m ? { nomeNorm: _norm(m[1]), mes: m[2], date: p.date, amount: parseFloat(p.amount) || 0 } : null;
        })
        .filter(Boolean);

      const rows = [];
      for (const card of filteredCards) {
        const expenses = txAll.filter(t => t.credit_card_id === card.id && t.type === 'expense');
        const refunds = txAll.filter(t => t.credit_card_id === card.id && t.type === 'refund');
        const totalGastos = expenses.reduce((s, t) => s + parseFloat(t.amount), 0);
        const totalRefunds = refunds.reduce((s, t) => s + parseFloat(t.amount), 0);
        const fatura = totalGastos - totalRefunds;

        // Vencimento calculado para o ciclo em exibição
        let vencimento = null;
        try {
          const period = App.cardInvoice.getInvoicePeriodForMonth(card, mesCiclo);
          vencimento = period.due;
        } catch (e) { vencimento = null; }

        // Data em que a fatura desse ciclo foi paga (procura pagamento cujo mês = mês do vencimento)
        let dataPagamento = null;
        if (vencimento) {
          const mesVenc = vencimento.slice(0, 7);
          const cardNorm = _norm(card.name);
          const pag = pagamentosGlobais.find(p => p.mes === mesVenc && (p.nomeNorm.includes(cardNorm) || cardNorm.includes(p.nomeNorm)));
          if (pag) dataPagamento = pag.date;
        }

        // Média paga por cartão: considera todos os pagamentos históricos desse cartão
        const cardNorm = _norm(card.name);
        const pagamentosDoCartao = pagamentosGlobais.filter(p => p.nomeNorm.includes(cardNorm) || cardNorm.includes(p.nomeNorm));
        const mediaPaga = pagamentosDoCartao.length > 0
          ? pagamentosDoCartao.reduce((s, p) => s + p.amount, 0) / pagamentosDoCartao.length
          : 0;

        rows.push({
          cardId: card.id,
          card: card.name,
          limit: card.limit,
          gastos: totalGastos,
          pagamentos: totalRefunds,
          fatura,
          vencimento,
          dataPagamento,
          mediaPaga,
          pagamentosCount: pagamentosDoCartao.length,
          cycleRefMonth: cycle.refMonth
        });
      }

      document.getElementById('historyTableBody').innerHTML = rows.map(r => {
        const vencCell = r.vencimento ? App.utils.formatDate(r.vencimento) : '—';
        const pagCell = r.dataPagamento
          ? App.utils.formatDateTime(r.dataPagamento)
          : '<span style="color:#f87171;">Em aberto</span>';
        const mediaCell = r.pagamentosCount > 0
          ? `<span style="color:#60a5fa;" title="Baseado em ${r.pagamentosCount} pagamento(s)">${App.utils.formatCurrency(r.mediaPaga)}</span>`
          : '—';
        return `<tr style="cursor:pointer" onclick="App.cardInvoice.open('${r.cardId}')">
          <td>${r.card}</td>
          <td>${r.cycleRefMonth}</td>
          <td>${vencCell}</td>
          <td>${pagCell}</td>
          <td>${App.utils.formatCurrency(r.limit)}</td>
          <td>${App.utils.formatCurrency(r.gastos)}</td>
          <td>${App.utils.formatCurrency(r.pagamentos)}</td>
          <td class="text-right">${App.utils.formatCurrency(r.fatura)}</td>
          <td class="text-right">${mediaCell}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="9">Nenhum dado</td></tr>';
    },
    prevMonth() {
      const input = document.getElementById('historyMonthPicker');
      if (!input || !input.value) return;
      const [y, m] = input.value.split('-').map(Number);
      const d = new Date(y, m - 1, 1);
      d.setMonth(d.getMonth() - 1);
      const newMonth = d.toISOString().slice(0, 7);
      input.value = newMonth;
      this.currentMonthStart = App.utils.monthRangeFromDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`).startDate;
      this.load();
    },
    nextMonth() {
      const input = document.getElementById('historyMonthPicker');
      if (!input || !input.value) return;
      const [y, m] = input.value.split('-').map(Number);
      const d = new Date(y, m - 1, 1);
      d.setMonth(d.getMonth() + 1);
      const newMonth = d.toISOString().slice(0, 7);
      input.value = newMonth;
      this.currentMonthStart = App.utils.monthRangeFromDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`).startDate;
      this.load();
    },
    gotoMonth(month) {
      const monthStr = typeof month === 'string' ? month : document.getElementById('historyMonthPicker')?.value;
      if (!monthStr) return;
      const [y, m] = monthStr.split('-');
      this.currentMonthStart = App.utils.monthRangeFromDate(`${y}-${m}-15`).startDate;
      this.load();
    }
  };

  // =======================================================================
  // Empréstimos – sem alterações
  // =======================================================================
  App.loans = {
    _lastPersonClick: { time: 0, x: 0, y: 0 },

    async load() {
      try {
        const loans = await App.db.getAll('loans');
        const sumExtras = (l) => (Array.isArray(l.extra_entries) ? l.extra_entries : [])
          .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

        // Agrupa por PESSOA (case-insensitive), não por empréstimo
        const personMap = new Map();
        for (const l of loans) {
          const rawName = (l.person || '').trim();
          if (!rawName) continue;
          const key = rawName.toLowerCase();
          if (!personMap.has(key)) personMap.set(key, { name: rawName, loans: [] });
          personMap.get(key).loans.push(l);
        }

        const summary = [];
        for (const { name, loans: arr } of personMap.values()) {
          arr.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
          const first = arr[0];
          const total = arr.reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
          const totalPaid = arr.filter(l => l.status === 'paid')
            .reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
          const remaining = total - totalPaid;
          const paidCount = arr.filter(l => l.status === 'paid').length;
          const allPaid = paidCount === arr.length;

          const pendentes = arr.filter(l => l.status !== 'paid' && (l.due_date || l.date));
          const proximoVenc = pendentes.length > 0
            ? pendentes.map(l => (l.due_date || l.date).slice(0, 10)).sort()[0]
            : null;

          const tipos = new Set(arr.map(l => l.type));
          const tipo = tipos.size === 1 ? first.type : 'mixed';

          const gruposUnicos = [...new Set(arr.map(l => l.loan_group_id || l.id))];

          summary.push({
            person: name,
            amount: total,
            totalPaid,
            remaining,
            date: first.date,
            due_date: proximoVenc,
            type: tipo,
            status: allPaid ? 'paid' : 'pending',
            paidCount,
            totalCount: arr.length,
            totalInstallments: arr.length,
            loanCount: gruposUnicos.length,
            gruposUnicos,
            payment_mode: first.payment_mode || 'account'
          });
        }

        // Ordena: pendentes primeiro, depois mais recentes no topo
        summary.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'paid' ? 1 : -1;
          return (b.date || '').localeCompare(a.date || '');
        });

        // Cards de resumo
        const totalEmprestado = summary.filter(s => s.type === 'lent').reduce((s, x) => s + x.amount, 0);
        const receivableRemaining = summary.filter(s => s.type === 'lent').reduce((s, x) => s + Math.max(0, x.remaining), 0);
        const payableRemaining = summary.filter(s => s.type === 'borrowed').reduce((s, x) => s + Math.max(0, x.remaining), 0);
        const totalDevendo = summary.filter(s => s.type === 'borrowed').reduce((s, x) => s + x.amount, 0);

        document.getElementById('loansSummary').innerHTML = `
          <div class="card clickable" onclick="App.loanDetail.openReceivable()">
            <div class="card-label">💰 Emprestado</div>
            <div class="card-value">${App.utils.formatCurrency(totalEmprestado)}</div>
          </div>
          <div class="card clickable" onclick="App.loanDetail.openReceivable()">
            <div class="card-label">📤 A receber</div>
            <div class="card-value" style="color:${receivableRemaining>0?'#f57c00':'#2e7d32'};">${App.utils.formatCurrency(receivableRemaining)}</div>
          </div>
          <div class="card clickable" onclick="App.loanDetail.openPayable()">
            <div class="card-label">📥 Devendo</div>
            <div class="card-value" style="color:${payableRemaining>0?'#c62828':'#2e7d32'};">${App.utils.formatCurrency(payableRemaining)}</div>
          </div>
          <div class="card clickable" onclick="App.loanDetail.openPayable()">
            <div class="card-label">💸 Total peguei</div>
            <div class="card-value">${App.utils.formatCurrency(totalDevendo)}</div>
          </div>
          <div class="card clickable" onclick="App.ui.navigateTo('receipts')">
            <div class="card-label">🧾 Comprovantes</div>
            <div class="card-value">→</div>
          </div>
        `;

        // Tabela: uma linha por pessoa
        const tbody = document.getElementById('loansTableBody');
        const escapeAttr = (str) => String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        if (!summary.length) {
          tbody.innerHTML = '<tr><td colspan="8">Nenhum empréstimo</td></tr>';
          return;
        }

        tbody.innerHTML = summary.map(s => {
          const personAttr = escapeAttr(s.person);
          const statusLabel = s.status === 'paid' ? 'Pago' : 'Pendente';
          const statusClass = s.status === 'paid' ? 'badge-income' : 'badge-expense';
          const tipoLabel = s.type === 'lent' ? 'Emprestei' : s.type === 'borrowed' ? 'Peguei' : 'Misto';
          const tipoColor = s.type === 'lent' ? '#fbbf24' : s.type === 'borrowed' ? '#60a5fa' : '#888';

          // Empréstimo mais recente do grupo (último item após ordenação por data)
          const recentGroupKey = s.gruposUnicos[s.gruposUnicos.length - 1] || '';
          const recentGroupAttr = escapeAttr(recentGroupKey);

          return `<tr style="cursor:pointer;" onclick="App.loans.handleLoanRowClick(event, '${recentGroupAttr}', '${personAttr}')">
            <td class="loan-person-cell" data-person="${personAttr}" style="cursor:pointer;" title="Ver histórico desta pessoa"
                onclick="event.stopPropagation();App.loans.openPersonHistory('${personAttr}', event)">
              <span style="color:var(--primary); text-decoration:underline; font-weight:500;">${s.person}</span>
              <span style="font-size:0.72rem; color:${tipoColor}; margin-left:6px;">${tipoLabel}</span>
            </td>
            <td class="text-center"><span style="font-weight:600;">${s.loanCount}</span> <span style="color:var(--text-muted); font-size:0.8rem;">empr.</span></td>
            <td class="text-right">${App.utils.formatCurrency(s.amount)}</td>
            <td class="text-right" style="color:#22c55e;">${App.utils.formatCurrency(s.totalPaid)}</td>
            <td class="text-right" style="color:${s.remaining > 0.005 ? '#c62828' : '#22c55e'}; font-weight:600;">${App.utils.formatCurrency(Math.max(0, s.remaining))}</td>
            <td>${s.due_date ? App.utils.formatDate(s.due_date) : '—'}</td>
            <td><span class="${statusClass}">${statusLabel}</span></td>
            <td class="text-center loan-actions-cell" onclick="event.stopPropagation()">
              <button class="icon-btn" title="Marcar todos como pagos" onclick="App.loans.markPersonPaid('${personAttr}')">✅</button>
              <button class="icon-btn" title="Editar empréstimo mais recente" onclick="App.loans.editPersonLoan('${recentGroupAttr}')">✏️</button>
              <button class="icon-btn delete" title="Excluir todos os empréstimos" onclick="App.loans.removePerson('${personAttr}')">🗑️</button>
            </td>
          </tr>`;
        }).join('');

        // Alerta de vencimento próximo (uma vez por pessoa)
        const today = App.utils.todayISO();
        const nextMonth = App.utils.addMonths(today, 1);
        for (const s of summary) {
          if (s.status !== 'paid' && s.due_date && s.due_date >= today && s.due_date <= nextMonth) {
            App.utils.addAlert(`🔔 Empréstimo "${s.person}" vence em ${App.utils.formatDate(s.due_date)} (${App.utils.formatCurrency(s.remaining)})`, 'warning');
          }
        }
      } catch (e) { console.error(e); }
    },
    onPaymentModeChange() {
      const mode = document.getElementById('loanPaymentMode')?.value || 'account';
      const accountFields = document.getElementById('loanAccountFields');
      if (accountFields) {
        accountFields.style.display = mode === 'account' ? 'block' : 'none';
      }
    },
    async save(e) {
      e.preventDefault();
      const id = document.getElementById('loanId').value, person = document.getElementById('loanPerson').value, amount = parseFloat(document.getElementById('loanAmount').value);
      const account_id = document.getElementById('loanAccount').value;
      const date = document.getElementById('loanDate').value, due_date = document.getElementById('loanDueDate').value, end_date = document.getElementById('loanEndDate')?.value || '';
      const type = document.getElementById('loanType').value, notes = document.getElementById('loanNotes').value;
      const installments = parseInt(document.getElementById('loanInstallments')?.value) || 1, interest = parseFloat(document.getElementById('loanInterest')?.value) || 0;
      const monthly = document.getElementById('loanMonthly')?.checked || false;
      const payment_mode = document.getElementById('loanPaymentMode')?.value || 'account';
      if (!person || isNaN(amount) || amount<=0) { App.utils.showToast('Preencha campos obrigatórios','error'); return false; }
      const credit_card_id = document.getElementById('loanCreditCard')?.value || null;
      if (payment_mode === 'account' && !account_id && !credit_card_id) { App.utils.showToast('Selecione uma conta ou cartão de crédito','error'); return false; }
      const totalWithInterest = amount * (1 + interest/100);

      // Garante que exista uma única conta unificada de empréstimos
      const accounts = await App.db.getAll('accounts');
      const LOAN_ACCOUNT_NAME = 'Empréstimos';
      let loanAccount = accounts.find(a => a.name === LOAN_ACCOUNT_NAME && a.type === 'loan');
      if (!loanAccount) {
        loanAccount = {
          id: App.utils.generateId(),
          name: LOAN_ACCOUNT_NAME,
          type: 'loan',
          member_id: '',
          archived: true,
          balance: 0,
          initial_balance: 0,
          exclude_from_total: true
        };
        await App.db.put('accounts', loanAccount);
        App.cache.accounts = null;
      }
      const loanAccountId = loanAccount.id;

      // Cria as parcelas (se houver) – APENAS UMA VEZ
      if (installments > 1) {
        const groupId = App.utils.generateId();
        for (let i=0; i<installments; i++) {
          const newDate = monthly ? App.utils.addMonths(date, i) : date;
          const instDueDate = monthly ? App.utils.addMonths(due_date || date, i) : due_date;
          await App.db.put('loans', {
            id: App.utils.generateId(),
            person,
            amount: totalWithInterest/installments,
            date: newDate,
            due_date: instDueDate,
            end_date,
            type,
            status:'pending',
            notes,
            loan_group_id: groupId,
            account_id: account_id,
            loan_account_id: loanAccountId,
            payment_mode
          });
        }
      } else {
        await App.db.put('loans', {
          id: App.utils.generateId(),
          person,
          amount: totalWithInterest,
          date,
          due_date,
          end_date,
          type,
          status:'pending',
          notes,
          account_id: account_id,
          loan_account_id: loanAccountId,
          payment_mode
        });
      }

      App.ui.closeModal('modalLoan'); App.utils.showToast('Empréstimo criado!'); this.load(); App.saldos.load(); return false;
    },
      async markPaid(groupKey) {
      const all = await App.db.getAll('loans');
      const group = all.filter(l => (l.loan_group_id === groupKey || l.id === groupKey));
      if (!group.length) return;
      const first = group[0];
      const paymentMode = String(first.payment_mode || 'account').toLowerCase();
      const totalPaid = group.reduce((s, l) => s + parseFloat(l.amount), 0);

      // === MODO MANUAL: apenas registra a data, NÃO abre seleção de conta ===
      if (paymentMode === 'manual') {
        App.loanDetail.openPaymentDateModal(
          `Data do pagamento total de ${App.utils.formatCurrency(totalPaid)} para ${first.person}:`,
          async (date) => {
            if (!date) return;
            for (const l of group) {
              l.status = 'paid';
              l.paid_date = date;
              await App.db.put('loans', l);
            }
            App.utils.showToast('Empréstimo marcado como pago (manual).');
            this.load();
            App.saldos.load();
          }
        );
        return; // interrompe aqui – não executa o restante
      }

      // === MODO CONTA: fluxo automático com seleção de conta ===
      await App.saldos.load();
      const accounts = App.cache.accounts || await App.db.getAll('accounts');

      // Garante que a conta unificada de empréstimos existe
      const LOAN_ACCOUNT_NAME = 'Empréstimos';
      let loanAccount = accounts.find(a => a.name === LOAN_ACCOUNT_NAME && a.type === 'loan');
      if (!loanAccount) {
        loanAccount = {
          id: App.utils.generateId(),
          name: LOAN_ACCOUNT_NAME,
          type: 'loan',
          member_id: '',
          archived: true,
          balance: 0,
          initial_balance: 0,
          exclude_from_total: true
        };
        await App.db.put('accounts', loanAccount);
        App.cache.accounts = null;
      }

      // Calcula saldo real de cada conta (mesmo método do App.accounts.load)
      const today = App.utils.todayISO();
      const startDate = App.utils.addMonths(today, -240);
      const txAll = await App.db.getTransactionsInRange(startDate, today);
      const balanceMap = {};
      accounts.forEach(a => { balanceMap[a.id] = (a.initial_balance || 0); });
      txAll.forEach(t => {
        if (t.status !== 'confirmed' || t.ignore_from_total) return;
        const amt = parseFloat(t.amount);
        if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
        else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
        else if (t.type === 'transfer' || t.type === 'contribution') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
        else if (t.type === 'withdrawal') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
      });

      const availableAccounts = accounts
        .filter(a => !a.archived && ['checking','savings','wallet'].includes(a.type))
        .map(a => ({ ...a, balance: balanceMap[a.id] || 0 }))
        .sort((a, b) => (b.balance || 0) - (a.balance || 0));

      if (availableAccounts.length === 0) {
        App.utils.showToast('Nenhuma conta disponível para pagamento.', 'error');
        return;
      }

           App.utils.selectAccount(availableAccounts, async (selectedAccount) => {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const fullDate = `${App.utils.todayISO()}T${timeStr}`;
        const isLent = first.type === 'lent';

        // Direção CORRETA da transferência:
        // - Emprestei (lent): dinheiro volta da conta unificada para a conta selecionada (entrada)
        // - Peguei emprestado (borrowed): dinheiro sai da conta selecionada para a conta unificada (saída)
        const srcAccId = isLent ? loanAccount.id : selectedAccount.id;
        const dstAccId = isLent ? selectedAccount.id : loanAccount.id;

        const srcAcc = accounts.find(a => a.id === srcAccId) || loanAccount;
        const dstAcc = accounts.find(a => a.id === dstAccId) || loanAccount;

        await App.db.put('transactions', {
          id: App.utils.generateId(),
          type: 'transfer',
          amount: totalPaid,
          category: '',
          account_id: srcAccId,
          account_name: srcAcc?.name || '',
          account_to_id: dstAccId,
          account_to_name: dstAcc?.name || '',
          date: fullDate,
          description: `Pagamento empréstimo: ${first.person}`,
          notes: '',
          member_id: '',
          member_name: '',
          credit_card_id: '',
          payment_method: 'transfer',
          status: 'confirmed',
          reconciled: false,
          ignore_from_total: false,
          createdAt: new Date().toISOString(),
          position: Date.now(),
          transfer_subtype: 'loan_payment'
        });

        // Marca parcelas
        for (const l of group) { l.status = 'paid'; l.paid_date = App.utils.todayISO(); await App.db.put('loans', l); }
        this.load(); App.saldos.load();
        App.utils.showToast('Marcado como pago!');
      }, async () => {
        // Ignorar e seguir manual: apenas registra a data de pagamento, sem movimentação bancária
        const today = App.utils.todayISO();
        for (const l of group) {
          l.status = 'paid';
          l.paid_date = today;
          await App.db.put('loans', l);
        }
        this.load();
        App.saldos.load();
        App.utils.showToast('Empréstimo marcado como pago (manual).');
      });
    },
    async edit(id) { const l = await App.db.getById('loans',id); if(l) App.ui.openLoanModal(l); },
    async remove(groupKey) { App.utils.confirm('Excluir empréstimo?', async () => { const all = await App.db.getAll('loans'); const group = all.filter(l => (l.loan_group_id === groupKey || l.id === groupKey)); for (const l of group) await App.db.delete('loans', l.id); this.load(); }); },

    // ============================================================
    // Histórico de empréstimos por pessoa
    // ============================================================
    _protocol(groupKey) {
      // Protocolo curto e determinístico derivado do groupKey
      const s = String(groupKey || '');
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
      }
      const abs = Math.abs(hash).toString(36).toUpperCase().padStart(6, '0').slice(-6);
      return `EMP-${abs}`;
    },

    // Handler da linha inteira dos Empréstimos:
    // - Cliques em botões, na célula da pessoa ou na célula de ações são ignorados
    //   (esses elementos têm handlers próprios com stopPropagation).
    // - Qualquer outro clique na linha abre direto os Detalhes do empréstimo mais recente.
    handleLoanRowClick(event, groupKey, personName) {
      const tgt = event.target;
      if (!tgt) return;
      if (tgt.closest && tgt.closest('button')) return;
      if (tgt.closest && tgt.closest('.loan-person-cell')) return;
      if (tgt.closest && tgt.closest('.loan-actions-cell')) return;
      if (groupKey) App.loanDetail.open(groupKey);
    },

    // Marca TODOS os empréstimos pendentes de uma pessoa como pagos.
    // Abre o modal de data (permanece na página atual) e atualiza todos os lançamentos pendentes.
    async markPersonPaid(personName) {
      try {
        const all = await App.db.getAll('loans');
        const target = (personName || '').trim().toLowerCase();
        const personLoans = all.filter(l => (l.person || '').trim().toLowerCase() === target);
        if (personLoans.length === 0) {
          App.utils.showToast('Nenhum empréstimo encontrado.', 'error');
          return;
        }
        const pendingLoans = personLoans.filter(l => l.status !== 'paid');
        if (pendingLoans.length === 0) {
          App.utils.showToast('Todos os empréstimos desta pessoa já estão pagos.', 'info');
          return;
        }
        const totalValue = pendingLoans.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
        App.loanDetail.openPaymentDateModal(
          `Data do pagamento total de ${App.utils.formatCurrency(totalValue)} para ${personName}:`,
          async (date) => {
            if (!date) return;
            for (const l of pendingLoans) {
              l.status = 'paid';
              l.paid_date = date;
              await App.db.put('loans', l);
            }
            this.load();
            App.saldos.load();
            App.utils.showToast(`${pendingLoans.length} lançamento(s) marcados como pagos.`);
          }
        );
      } catch (e) {
        console.error('Erro ao marcar pessoa como paga:', e);
        App.utils.showToast('Erro ao processar.', 'error');
      }
    },

    // Abre o modal de edição do empréstimo mais recente (permanece na página atual).
    async editPersonLoan(groupKey) {
      if (!groupKey) {
        App.utils.showToast('Nenhum empréstimo para editar.', 'error');
        return;
      }
      const loan = await App.db.getById('loans', groupKey);
      if (loan) {
        App.ui.openLoanModal(loan);
      } else {
        App.utils.showToast('Empréstimo não encontrado.', 'error');
      }
    },

    // Exclui TODOS os lançamentos de empréstimo de uma pessoa (com confirmação).
    async removePerson(personName) {
      try {
        const all = await App.db.getAll('loans');
        const target = (personName || '').trim().toLowerCase();
        const personLoans = all.filter(l => (l.person || '').trim().toLowerCase() === target);
        if (personLoans.length === 0) {
          App.utils.showToast('Nenhum empréstimo encontrado.', 'error');
          return;
        }
        App.utils.confirm(
          `Excluir todos os ${personLoans.length} lançamento(s) de empréstimo de "${personName}"?`,
          async () => {
            for (const l of personLoans) {
              await App.db.delete('loans', l.id);
            }
            this.load();
            App.utils.showToast('Empréstimos excluídos.');
          }
        );
      } catch (e) {
        console.error('Erro ao excluir empréstimos:', e);
        App.utils.showToast('Erro ao excluir.', 'error');
      }
    },

    // Abre o Histórico de Empréstimos já filtrado pela pessoa escolhida
    async openPersonHistory(personName, event) {
      // Registra o clique para bloquear cliques fantasma subsequentes
      this._lastPersonClick = {
        time: Date.now(),
        x: (event && typeof event.clientX === 'number') ? event.clientX : 0,
        y: (event && typeof event.clientY === 'number') ? event.clientY : 0
      };

      const nome = personName || 'all';

      // Garante que o detalhe do empréstimo não vai "reaparecer" depois
      if (App.loanDetail) {
        App.loanDetail.currentLoanId = null;
        App.loanDetail.currentMode = 'single';
        App.loanDetail._fromHistory = false;
      }

      this._pendingPersonFilter = nome;

      // Se já estiver na tela de histórico, apenas re-renderiza com o novo filtro
      if (App.ui._currentPage === 'loan-history') {
        const sel = document.getElementById('lhPersonFilter');
        if (sel) {
          await new Promise(r => setTimeout(r, 0));
          sel.value = nome;
        }
        await this.loadPersonHistory();
        this._pendingPersonFilter = 'all';
        return;
      }

      // Caso contrário, navega para o histórico. O loader da página consome _pendingPersonFilter.
      App.ui.navigateTo('loan-history');
    },

    _clearLoanHistoryFilters() {
      const p = document.getElementById('lhPersonFilter'); if (p) p.value = 'all';
      const t = document.getElementById('lhTypeFilter'); if (t) t.value = 'all';
      const s = document.getElementById('lhStatusFilter'); if (s) s.value = 'all';
      const q = document.getElementById('lhSearchInput'); if (q) q.value = '';
      this._pendingPersonFilter = 'all';
      this.loadPersonHistory();
    },

    async loadPersonHistory() {
      // Sempre que o Histórico é renderizado, o detalhe deve ser "esquecido"
      if (App.loanDetail) {
        App.loanDetail._fromHistory = false;
        App.loanDetail.currentLoanId = null;
      }
      try {
        const all = await App.db.getAll('loans');

        // Popula o select de pessoas (uma única vez)
        const personSel = document.getElementById('lhPersonFilter');
        if (personSel) {
          const nomesUnicos = [...new Set(all.map(l => l.person).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR'));
          const currentVal = personSel.value;
          personSel.innerHTML = '<option value="all">Todas as pessoas</option>' +
            nomesUnicos.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');

          // Aplica filtro pendente (quando vem de um clique em pessoa específica)
          if (this._pendingPersonFilter && this._pendingPersonFilter !== 'all') {
            personSel.value = this._pendingPersonFilter;
            this._pendingPersonFilter = 'all';
          } else if (currentVal && nomesUnicos.includes(currentVal)) {
            personSel.value = currentVal;
          } else {
            personSel.value = 'all';
          }
        }

        const personFilter = document.getElementById('lhPersonFilter')?.value || 'all';
        const typeFilter = document.getElementById('lhTypeFilter')?.value || 'all';
        const statusFilter = document.getElementById('lhStatusFilter')?.value || 'all';
        const searchTerm = (document.getElementById('lhSearchInput')?.value || '').toLowerCase().trim();

        // Filtra por pessoa (se aplicável)
        let base = all;
        if (personFilter !== 'all') {
          base = base.filter(l => (l.person || '') === personFilter);
        }

        // Agrupa por groupKey
        const grupos = {};
        for (const l of base) {
          const key = l.loan_group_id || l.id;
          if (!grupos[key]) grupos[key] = [];
          grupos[key].push(l);
        }

        const sumExtras = (l) => (Array.isArray(l.extra_entries) ? l.extra_entries : [])
          .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

        let linhas = Object.entries(grupos).map(([key, group]) => {
          group.sort((a, b) => {
            const da = a.original_due_date || a.due_date || a.date || '';
            const db = b.original_due_date || b.due_date || b.date || '';
            return da.localeCompare(db);
          });

          const first = group[0];
          const total = group.reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
          const pago = group.filter(l => l.status === 'paid')
            .reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
          const restante = total - pago;
          const pagasCount = group.filter(l => l.status === 'paid').length;
          const totalParcelas = group.length;

          const datas = group.map(l => (l.original_due_date || l.due_date || l.date || '').slice(0, 10)).filter(Boolean).sort();
          const primeiro = datas[0] || '';
          const ultimo = datas[datas.length - 1] || '';
          const mesIni = primeiro ? primeiro.slice(0, 7).split('-').reverse().join('/') : '—';
          const mesFim = ultimo ? ultimo.slice(0, 7).split('-').reverse().join('/') : '—';

          let statusKey = 'pending';
          let statusLabel = '⏳ Pendente';
          let statusColor = '#f59e0b';
          if (pagasCount === totalParcelas) {
            statusKey = 'paid';
            statusLabel = '✅ Pago';
            statusColor = '#22c55e';
          } else if (pagasCount > 0) {
            statusKey = 'progress';
            statusLabel = '🔄 Em andamento';
            statusColor = '#60a5fa';
          }

          const tipoLabel = first.type === 'lent' ? 'Concedido' : 'Peguei emprestado';
          const tipoColor = first.type === 'lent' ? '#fbbf24' : '#60a5fa';
          const protocolo = this._protocol(key);

          return {
            key, protocolo, pessoa: first.person || '—',
            total, pago, restante, pagasCount, totalParcelas,
            mesIni, mesFim, statusKey, statusLabel, statusColor,
            tipoLabel, tipoColor, tipoKey: first.type,
            data: first.date
          };
        });

        // Filtro por tipo
        if (typeFilter !== 'all') {
          linhas = linhas.filter(l => l.tipoKey === typeFilter);
        }

        // Filtro por status
        if (statusFilter !== 'all') {
          linhas = linhas.filter(l => l.statusKey === statusFilter);
        }

        // Filtro por busca (protocolo ou pessoa)
        if (searchTerm) {
          linhas = linhas.filter(l =>
            l.protocolo.toLowerCase().includes(searchTerm) ||
            l.pessoa.toLowerCase().includes(searchTerm)
          );
        }

        // Ordenação: mais recentes primeiro
        linhas.sort((a, b) => (b.mesIni || '').localeCompare(a.mesIni || ''));

        // Resumo
        const totalConcedido = linhas.filter(l => l.tipoKey === 'lent').reduce((s, l) => s + l.total, 0);
        const totalRecebido = linhas.filter(l => l.tipoKey === 'lent').reduce((s, l) => s + l.pago, 0);
        const totalPeguei = linhas.filter(l => l.tipoKey === 'borrowed').reduce((s, l) => s + l.total, 0);
        const totalPaguei = linhas.filter(l => l.tipoKey === 'borrowed').reduce((s, l) => s + l.pago, 0);
        const emAberto = linhas.reduce((s, l) => s + Math.max(0, l.restante), 0);

        const summaryEl = document.getElementById('loanHistorySummary');
        if (summaryEl) {
          summaryEl.innerHTML = `
            <div class="card" style="border-left:3px solid #fbbf24;">
              <div class="card-label">💰 Concedido</div>
              <div class="card-value" style="color:#fbbf24;">${App.utils.formatCurrency(totalConcedido)}</div>
              <div class="card-sub">Recebido: ${App.utils.formatCurrency(totalRecebido)}</div>
            </div>
            <div class="card" style="border-left:3px solid #60a5fa;">
              <div class="card-label">📥 Peguei emprestado</div>
              <div class="card-value" style="color:#60a5fa;">${App.utils.formatCurrency(totalPeguei)}</div>
              <div class="card-sub">Pago: ${App.utils.formatCurrency(totalPaguei)}</div>
            </div>
            <div class="card" style="border-left:3px solid #ef4444;">
              <div class="card-label">⚠️ Em aberto</div>
              <div class="card-value" style="color:#ef4444;">${App.utils.formatCurrency(emAberto)}</div>
              <div class="card-sub">${linhas.length} empréstimo(s) no filtro</div>
            </div>
          `;
        }

        // Tabela
        const tbody = document.getElementById('loanHistoryTableBody');
        const empty = document.getElementById('loanHistoryEmpty');

        if (!linhas.length) {
          if (tbody) tbody.innerHTML = '';
          if (empty) empty.style.display = 'block';
          return;
        }
        if (empty) empty.style.display = 'none';

        const pessoaSafe = (s) => String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

        if (tbody) {
          tbody.innerHTML = linhas.map(l => `
            <tr style="cursor:pointer;" onclick="App.loanDetail.open('${l.key}')">
              <td style="font-family:monospace; font-weight:700; color:var(--primary);">${l.protocolo}</td>
              <td>${l.pessoa}</td>
              <td>${App.utils.formatDate(l.data)}</td>
              <td>${l.mesIni} → ${l.mesFim}</td>
              <td>${l.totalParcelas}x <span style="color:var(--text-muted); font-size:0.78rem;">(${l.pagasCount} pagas)</span></td>
              <td><span style="color:${l.tipoColor}; font-weight:600; font-size:0.82rem;">${l.tipoLabel}</span></td>
              <td class="text-right" style="font-weight:600;">${App.utils.formatCurrency(l.total)}</td>
              <td class="text-right" style="color:${l.restante > 0.005 ? 'var(--expense)' : 'var(--income)'};">${App.utils.formatCurrency(Math.max(0, l.restante))}</td>
              <td style="color:${l.statusColor}; font-weight:600; font-size:0.82rem;">${l.statusLabel}</td>
            </tr>
          `).join('');
        }
      } catch (e) {
        console.error('Erro ao carregar histórico de empréstimos:', e);
        App.utils.showToast('Erro ao carregar histórico.', 'error');
      }
    }
  };

  // =======================================================================
  // Detalhes do Empréstimo – sem alterações
  // =======================================================================
App.loanDetail = {
    currentLoanId: null, currentMode: 'single',

    captureDetailsPNG() {
      const name = (this.currentLoanId || 'emprestimo').toString().slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, '_');
      const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      App.utils.capturePageAsPNG(null, `detalhes_emprestimo_${name}_${ts}.png`, { fullScreen: true });
    },

     async openInstallmentDetail(loanId) {
      const loan = await App.db.getById('loans', loanId);
      if (!loan) {
        App.utils.showToast('Parcela não encontrada.', 'error');
        return;
      }

      const allLoans = await App.db.getAll('loans');
      const group = allLoans
        .filter(l => (l.loan_group_id && l.loan_group_id === (loan.loan_group_id || loan.id)) || l.id === loan.id)
        .sort((a, b) => {
          const da = a.original_due_date || a.due_date || a.date;
          const db = b.original_due_date || b.due_date || b.date;
          return da.localeCompare(db);
        });

      const sumExtras = (l) => (Array.isArray(l.extra_entries) ? l.extra_entries : [])
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

      const totalGroup = group.reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
      const paidGroup = group.filter(l => l.status === 'paid')
        .reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
      const remainingGroup = totalGroup - paidGroup;
      const totalExtrasGroup = group.reduce((s, l) => s + sumExtras(l), 0);

      const idx = group.findIndex(l => l.id === loanId) + 1;
      const totalInstallments = group.length || 1;

      const interest = parseFloat(loan.interest) || 0;
      const baseAmount = interest > 0 ? (parseFloat(loan.amount) / (1 + interest / 100)) : parseFloat(loan.amount);
      const interestValue = parseFloat(loan.amount) - baseAmount;

      const isLent = loan.type === 'lent';
      const tipoLabel = isLent ? 'Emprestei' : 'Peguei emprestado';
      const tipoCor = isLent ? '#fbbf24' : '#60a5fa';
      const isPaid = loan.status === 'paid';
      const isExtended = !!loan.extended && !isPaid;

      const valorParcela = parseFloat(loan.amount) || 0;
      const valorBase = baseAmount;
      const valorJuros = interestValue;
      const dataVenc = loan.due_date || loan.date;
      const dataVencOriginal = loan.original_due_date || dataVenc;
      const dataPag = loan.paid_date;

      // Lançamentos adicionais desta parcela
      const extras = Array.isArray(loan.extra_entries) ? loan.extra_entries : [];
      const totalExtras = extras.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const valorTotalParcela = valorParcela + totalExtras;

      // Bloco de status com cor dinâmica
      const statusBg = isPaid ? 'rgba(163,230,53,0.15)' : (isExtended ? 'rgba(167,139,250,0.15)' : 'rgba(251,191,36,0.15)');
      const statusFg = isPaid ? '#a3e635' : (isExtended ? '#a78bfa' : '#fbbf24');
      const statusTxt = isPaid ? '✅ Paga' : (isExtended ? '🔄 Prorrogada' : '⏳ Pendente');

      const vencimentoHTML = isExtended
        ? `<tr><td style="padding:8px 0; color:var(--text-light);">Vencimento original</td><td style="padding:8px 0; text-align:right; color:var(--text-muted); text-decoration:line-through;">${App.utils.formatDate(dataVencOriginal)}</td></tr>
           <tr><td style="padding:8px 0; color:var(--text-light);">Vencimento prorrogado</td><td style="padding:8px 0; text-align:right; color:#a78bfa; font-weight:600;">${App.utils.formatDate(dataVenc)}</td></tr>`
        : `<tr><td style="padding:8px 0; color:var(--text-light);">Vencimento</td><td style="padding:8px 0; text-align:right; color:var(--text);">${dataVenc ? App.utils.formatDate(dataVenc) : '—'}</td></tr>`;

      const extensaoNotasHTML = isExtended && loan.extension_notes
        ? `<tr><td style="padding:8px 0; color:var(--text-light); vertical-align:top;">Motivo da prorrogação</td><td style="padding:8px 0; text-align:right; color:#a78bfa;">${loan.extension_notes}</td></tr>`
        : '';

      // Linhas dos lançamentos adicionais (padrão vermelho)
      const extrasRowsHTML = extras.map(e => `
        <tr>
          <td style="padding:6px 0; vertical-align:top;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#f87171; flex-shrink:0;"></span>
              <span style="color:var(--text); font-size:0.82rem; font-weight:500;">${e.description || 'Lançamento'}</span>
            </div>
            <div style="font-size:0.68rem; color:var(--text-muted); margin-left:12px; margin-top:2px;">${e.date ? App.utils.formatDate(e.date) : ''}</div>
          </td>
          <td style="padding:6px 0; text-align:right; vertical-align:top; white-space:nowrap;">
            <span style="color:#f87171; font-weight:600;">+ ${App.utils.formatCurrency(e.amount)}</span>
            ${!isPaid ? `<button type="button" class="icon-btn delete" style="margin-left:6px;" title="Remover lançamento" onclick="App.loanDetail.removeExtraEntry('${loan.id}', '${e.id}')">🗑️</button>` : ''}
          </td>
        </tr>
      `).join('');

      const extrasSectionHTML = `
        <div style="margin-top:16px; padding:12px 14px; background:rgba(248,113,113,0.06); border:1px solid rgba(248,113,113,0.22); border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${extras.length > 0 ? '8px' : '0'};">
            <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:#f87171; font-weight:700;">➕ Lançamentos Adicionais</div>
            ${!isPaid ? `<button type="button" class="btn btn-sm btn-outline" onclick="App.loanDetail.addExtraEntry('${loan.id}')" style="font-size:0.72rem; padding:3px 10px; border-color:rgba(248,113,113,0.4); color:#f87171;">+ Adicionar</button>` : ''}
          </div>
          ${extras.length > 0
            ? `<table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
                <tbody>${extrasRowsHTML}</tbody>
                <tfoot>
                  <tr style="border-top:1px solid rgba(248,113,113,0.3);">
                    <td style="padding:8px 0 0; color:var(--text-light); font-weight:600; font-size:0.8rem;">Total dos lançamentos</td>
                    <td style="padding:8px 0 0; text-align:right; color:#f87171; font-weight:700;">+ ${App.utils.formatCurrency(totalExtras)}</td>
                  </tr>
                </tfoot>
              </table>`
            : `<div style="font-size:0.78rem; color:var(--text-muted); padding:4px 0;">Nenhum lançamento adicional. Use o botão acima para incluir multas, taxas ou outros valores a esta parcela.</div>`
          }
        </div>
      `;

      const totalBaseGroup = group.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
      const totalExtrasGroupHTML = totalExtrasGroup > 0
        ? `<tr><td style="padding:8px 0; color:#f87171;">+ Lançamentos adicionais (período)</td><td style="padding:8px 0; text-align:right; color:#f87171; font-weight:600;">+ ${App.utils.formatCurrency(totalExtrasGroup)}</td></tr>`
        : '';

      const html = `
        <div style="display:flex; flex-direction:column; gap:0; padding:4px 0 8px;">
          <div style="text-align:center; margin-bottom:16px;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em;">Parcela ${idx} de ${totalInstallments}</div>
            <div style="font-size:1.4rem; font-weight:700; color:var(--text); margin-top:4px;">${App.utils.formatCurrency(valorTotalParcela)}</div>
            ${extras.length > 0
              ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">Parcela ${App.utils.formatCurrency(valorParcela)} + Lançamentos <span style="color:#f87171; font-weight:600;">${App.utils.formatCurrency(totalExtras)}</span></div>`
              : ''
            }
            <div style="display:inline-block; margin-top:8px; padding:3px 12px; background:${statusBg}; color:${statusFg}; border-radius:20px; font-size:0.75rem; font-weight:600;">
              ${statusTxt}
            </div>
          </div>

          <div style="text-align:left; font-size:0.85rem; margin-bottom:8px;">
            <div style="font-weight:600; color:var(--text); margin-bottom:2px;">${loan.person || '—'}</div>
            <div style="color:${tipoCor}; font-size:0.78rem; font-weight:500;">${tipoLabel}</div>
          </div>

          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <tbody>
              <tr><td style="padding:8px 0; color:var(--text-light);">Data da parcela</td><td style="padding:8px 0; text-align:right; color:var(--text);">${App.utils.formatDate(loan.date)}</td></tr>
              ${vencimentoHTML}
              <tr><td style="padding:8px 0; color:var(--text-light);">Valor base</td><td style="padding:8px 0; text-align:right; color:var(--text);">${App.utils.formatCurrency(valorBase)}</td></tr>
              ${interestValue > 0 ? `<tr><td style="padding:8px 0; color:var(--text-light);">Juros (${interest}%)</td><td style="padding:8px 0; text-align:right; color:#f87171;">+ ${App.utils.formatCurrency(valorJuros)}</td></tr>` : ''}
              <tr style="border-top:1px solid var(--border);"><td style="padding:8px 0; color:var(--text-light); font-weight:600;">Parcela (acordo)</td><td style="padding:8px 0; text-align:right; color:var(--text); font-weight:700;">${App.utils.formatCurrency(valorParcela)}</td></tr>
              ${totalExtras > 0 ? `<tr><td style="padding:8px 0; color:#f87171;">+ Lançamentos adicionais</td><td style="padding:8px 0; text-align:right; color:#f87171; font-weight:600;">+ ${App.utils.formatCurrency(totalExtras)}</td></tr>` : ''}
              <tr style="border-top:1px solid rgba(248,113,113,0.5); background:rgba(248,113,113,0.06);"><td style="padding:10px 8px; color:#f87171; font-weight:700; font-size:0.9rem;">VALOR TOTAL DA PARCELA</td><td style="padding:10px 8px; text-align:right; color:#f87171; font-weight:700; font-size:1rem;">${App.utils.formatCurrency(valorTotalParcela)}</td></tr>
              <tr><td style="padding:8px 0; color:var(--text-light);">Data do pagamento</td><td style="padding:8px 0; text-align:right; color:${isPaid ? '#a3e635' : 'var(--text-muted)'};">${dataPag ? App.utils.formatDate(dataPag) : 'Não paga'}</td></tr>
              <tr><td style="padding:8px 0; color:var(--text-light);">Forma de lançamento</td><td style="padding:8px 0; text-align:right; color:var(--text);">${loan.payment_mode === 'manual' ? 'Manual' : 'Conta'}</td></tr>
              ${loan.notes ? `<tr><td style="padding:8px 0; color:var(--text-light); vertical-align:top;">Notas</td><td style="padding:8px 0; text-align:right; color:var(--text);">${loan.notes}</td></tr>` : ''}
              ${extensaoNotasHTML}
              <tr style="border-top:1px solid var(--border);"><td style="padding:8px 0; color:var(--text-light);">Total concedido</td><td style="padding:8px 0; text-align:right; color:var(--text);">${App.utils.formatCurrency(totalBaseGroup)}</td></tr>
              ${totalExtrasGroupHTML}
              <tr><td style="padding:8px 0; color:var(--text-light);">Já pago</td><td style="padding:8px 0; text-align:right; color:#a3e635;">${App.utils.formatCurrency(paidGroup)}</td></tr>
              <tr><td style="padding:8px 0; color:var(--text-light); font-weight:600;">Restante</td><td style="padding:8px 0; text-align:right; color:${remainingGroup > 0 ? '#f87171' : '#a3e635'}; font-weight:700;">${App.utils.formatCurrency(remainingGroup)}</td></tr>
            </tbody>
          </table>

          ${extrasSectionHTML}

          <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end; flex-wrap:wrap;">
            ${!isPaid ? `<button type="button" class="btn btn-outline btn-sm" onclick="App.loanDetail.prorrogarInstallment('${loan.id}')">📅 Prorrogar</button>` : ''}
            ${!isPaid ? `<button type="button" class="btn btn-primary btn-sm" onclick="App.ui.closeModal('modalLoanInstallmentDetail'); App.loanDetail.payInstallment('${loan.id}')">💳 Registrar Pagamento</button>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" onclick="App.ui.closeModal('modalLoanInstallmentDetail')">Fechar</button>
          </div>
        </div>
      `;

      const target = document.getElementById('loanInstallmentDetailContent');
      if (!target) {
        console.error('[openInstallmentDetail] #loanInstallmentDetailContent não encontrado.');
        App.utils.showToast('Erro: container do modal não encontrado.', 'error');
        return;
      }
      target.innerHTML = html;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      App.ui.openModal('modalLoanInstallmentDetail');
    },

    async prorrogarInstallment(loanId) {
      const loan = await App.db.getById('loans', loanId);
      if (!loan) {
        App.utils.showToast('Parcela não encontrada.', 'error');
        return;
      }
      if (loan.status === 'paid') {
        App.utils.showToast('Parcela já paga não pode ser prorrogada.', 'warning');
        return;
      }

      const currentDue = loan.due_date || loan.date;
      const today = App.utils.todayISO();
      const defaultNewDate = App.utils.addMonths(currentDue, 1);

      const msgEl = document.getElementById('loanExtensionMessage');
      const originalEl = document.getElementById('loanExtensionOriginalDate');
      const dateEl = document.getElementById('loanExtensionNewDate');
      const notesEl = document.getElementById('loanExtensionNotes');
      const confirmBtn = document.getElementById('loanExtensionConfirmBtn');

      if (msgEl) {
        msgEl.innerHTML = `Prorrogar parcela de <strong>${App.utils.formatCurrency(loan.amount)}</strong> de <strong>${loan.person || ''}</strong>.`;
      }
      if (originalEl) {
        originalEl.value = App.utils.formatDate(loan.original_due_date || currentDue);
      }
      if (dateEl) {
        dateEl.value = defaultNewDate;
        dateEl.min = today;
      }
      if (notesEl) {
        notesEl.value = loan.extension_notes || '';
      }

      if (confirmBtn) {
        confirmBtn.onclick = async () => {
          const newDate = dateEl.value;
          const notes = (notesEl.value || '').trim();

          if (!newDate) {
            App.utils.showToast('Informe o novo vencimento.', 'error');
            return;
          }
          if (newDate <= currentDue) {
            App.utils.showToast('O novo vencimento deve ser posterior ao atual.', 'error');
            return;
          }

          const originalDue = loan.original_due_date || currentDue;
          const history = Array.isArray(loan.extension_history) ? loan.extension_history.slice() : [];
          history.push({
            at: new Date().toISOString(),
            from: currentDue,
            to: newDate,
            notes: notes
          });

          loan.original_due_date = originalDue;
          loan.due_date = newDate;
          loan.extended = true;
          loan.extension_notes = notes;
          loan.extension_history = history;
          loan.updatedAt = new Date().toISOString();

          await App.db.put('loans', loan);

          App.ui.closeModal('modalLoanExtension');
          App.utils.showToast('Parcela prorrogada!');

          await this.openInstallmentDetail(loanId);
          if (App.loans && typeof App.loans.load === 'function') App.loans.load();
        };
      }

      App.ui.openModal('modalLoanExtension');
    },

    async addExtraEntry(loanId) {
      const loan = await App.db.getById('loans', loanId);
      if (!loan) {
        App.utils.showToast('Parcela não encontrada.', 'error');
        return;
      }
      if (loan.status === 'paid') {
        App.utils.showToast('Parcela já paga não pode receber lançamentos.', 'warning');
        return;
      }

      const msgEl = document.getElementById('loanExtraEntryMessage');
      const descEl = document.getElementById('loanExtraEntryDescription');
      const amountEl = document.getElementById('loanExtraEntryAmount');
      const dateEl = document.getElementById('loanExtraEntryDate');
      const confirmBtn = document.getElementById('loanExtraEntryConfirmBtn');

      if (msgEl) {
        msgEl.innerHTML = `Adicionar lançamento à parcela de <strong>${App.utils.formatCurrency(loan.amount)}</strong> de <strong>${loan.person || ''}</strong>.`;
      }
      if (descEl) descEl.value = '';
      if (amountEl) amountEl.value = '';
      if (dateEl) dateEl.value = App.utils.todayISO();

      if (confirmBtn) {
        confirmBtn.onclick = async () => {
          const description = (descEl.value || '').trim();
          const amount = App.utils.parseFloatLocale(amountEl.value || '');
          const date = dateEl.value || App.utils.todayISO();

          if (!description) {
            App.utils.showToast('Informe a descrição do lançamento.', 'error');
            return;
          }
          if (isNaN(amount) || amount <= 0) {
            App.utils.showToast('Informe um valor válido.', 'error');
            return;
          }

          const entries = Array.isArray(loan.extra_entries) ? loan.extra_entries.slice() : [];
          entries.push({
            id: App.utils.generateId(),
            description: description,
            amount: Math.round(amount * 100) / 100,
            date: date,
            createdAt: new Date().toISOString()
          });
          loan.extra_entries = entries;
          loan.updatedAt = new Date().toISOString();

          await App.db.put('loans', loan);

          App.ui.closeModal('modalLoanExtraEntry');
          App.utils.showToast('Lançamento adicionado!');

          await this.openInstallmentDetail(loanId);
          if (App.loans && typeof App.loans.load === 'function') App.loans.load();
        };
      }

      App.ui.openModal('modalLoanExtraEntry');
    },

    async removeExtraEntry(loanId, entryId) {
      const loan = await App.db.getById('loans', loanId);
      if (!loan) return;
      if (loan.status === 'paid') {
        App.utils.showToast('Parcela já paga não pode ter lançamentos removidos.', 'warning');
        return;
      }

      App.utils.confirm('Remover este lançamento da parcela?', async () => {
        const entries = (Array.isArray(loan.extra_entries) ? loan.extra_entries : []).filter(e => e.id !== entryId);
        loan.extra_entries = entries;
        loan.updatedAt = new Date().toISOString();
        await App.db.put('loans', loan);

        App.utils.showToast('Lançamento removido.');
        await this.openInstallmentDetail(loanId);
        if (App.loans && typeof App.loans.load === 'function') App.loans.load();
      });
    },

    openPaymentDateModal(message, callback) {
      const modal = document.getElementById('modalLoanPayment');
      if (!modal) {
        // Fallback para o prompt genérico se o modal não existir
        App.utils.prompt('Data do pagamento (AAAA-MM-DD):', App.utils.todayISO(), callback);
        return;
      }
      const msgEl = document.getElementById('loanPaymentMessage');
      const dateEl = document.getElementById('loanPaymentDate');
      const confirmBtn = document.getElementById('loanPaymentConfirmBtn');
      if (msgEl) msgEl.textContent = message;
      if (dateEl) dateEl.value = App.utils.todayISO();
      if (confirmBtn) {
        confirmBtn.onclick = () => {

          const date = dateEl ? dateEl.value : '';
          if (!date) {
            App.utils.showToast('Informe a data do pagamento.', 'error');
            return;
          }
          App.ui.closeModal('modalLoanPayment');
          callback(date);
        };
      }
      App.ui.openModal('modalLoanPayment');
    },
    async open(groupKey) {
      this.currentLoanId = groupKey;
      this.currentMode = 'single';
      // Marca se veio do histórico ANTES de navegar (senão _currentPage já mudou)
      this._fromHistory = App.ui._currentPage === 'loan-history';
      App.ui.navigateTo('loan-detail');
      await this.render();
    },
    async openReceivable() { this.currentMode = 'receivable'; App.ui.navigateTo('loan-detail'); await this.renderReceivablePayable('lent', 'A Receber'); },
    async openPayable() { this.currentMode = 'payable'; App.ui.navigateTo('loan-detail'); await this.renderReceivablePayable('borrowed', 'Devendo'); },
       async payInstallment(loanId) {
      const loan = await App.db.getById('loans', loanId);
      if (!loan) return;

      const paymentMode = String(loan.payment_mode || 'account').toLowerCase();

      // Soma lançamentos adicionais ao valor da parcela
      const extrasTotal = (Array.isArray(loan.extra_entries) ? loan.extra_entries : [])
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const totalToPay = (parseFloat(loan.amount) || 0) + extrasTotal;

      // Sempre abre o modal de data dedicado
      this.openPaymentDateModal(
        `Data do pagamento da parcela de ${App.utils.formatCurrency(totalToPay)} para ${loan.person}:`,
        async (paymentDate) => {
          if (!paymentDate) return; // cancelado

          // 1. MODO MANUAL: apenas registra a data e marca como pago – NÃO abre seleção de conta
          if (paymentMode === 'manual') {
            loan.status = 'paid';
            loan.paid_date = paymentDate;
            await App.db.put('loans', loan);
            if (this.currentMode === 'single') {
              await this.render();
            } else {
              await this.renderReceivablePayable(
                this.currentMode === 'receivable' ? 'lent' : 'borrowed',
                this.currentMode === 'receivable' ? 'A Receber' : 'Devendo'
              );
            }
            App.loans.load();
            App.utils.showToast('Parcela paga (manual).');
            return;
          }

          // 2. MODO CONTA, via cartão de crédito: apenas marca como pago com a data informada
          if (loan.credit_card_id) {
            loan.status = 'paid';
            loan.paid_date = paymentDate;
            await App.db.put('loans', loan);
            if (this.currentMode === 'single') {
              await this.render();
            } else {
              await this.renderReceivablePayable(
                this.currentMode === 'receivable' ? 'lent' : 'borrowed',
                this.currentMode === 'receivable' ? 'A Receber' : 'Devendo'
              );
            }
            App.loans.load(); App.saldos.load();
            App.utils.showToast('Parcela paga!');
            return;
          }

          // 3. MODO CONTA, sem cartão: seleciona conta e cria transferência com a data informada
          await App.saldos.load();
          const accounts = App.cache.accounts || await App.db.getAll('accounts');
          const isLent = loan.type === 'lent';

          // Garante a conta unificada de empréstimos
          const LOAN_ACCOUNT_NAME = 'Empréstimos';
          let loanAccount = accounts.find(a => a.name === LOAN_ACCOUNT_NAME && a.type === 'loan');
          if (!loanAccount) {
            loanAccount = {
              id: App.utils.generateId(),
              name: LOAN_ACCOUNT_NAME,
              type: 'loan',
              member_id: '',
              archived: true,
              balance: 0,
              initial_balance: 0,
              exclude_from_total: true
            };
            await App.db.put('accounts', loanAccount);
            App.cache.accounts = null;
          }

          // Calcula saldo real de cada conta (mesmo método do App.accounts.load)
          const today = App.utils.todayISO();
          const startDate = App.utils.addMonths(today, -240);
          const txAll = await App.db.getTransactionsInRange(startDate, today);
          const balanceMap = {};
          accounts.forEach(a => { balanceMap[a.id] = (a.initial_balance || 0); });
          txAll.forEach(t => {
            if (t.status !== 'confirmed' || t.ignore_from_total) return;
            const amt = parseFloat(t.amount);
            if (t.type === 'income' || t.type === 'refund') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) + amt;
            else if (t.type === 'expense') balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt;
            else if (t.type === 'transfer' || t.type === 'contribution') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
            else if (t.type === 'withdrawal') { balanceMap[t.account_id] = (balanceMap[t.account_id] || 0) - amt; balanceMap[t.account_to_id] = (balanceMap[t.account_to_id] || 0) + amt; }
          });

          const availableAccounts = accounts
            .filter(a => !a.archived && ['checking','savings','wallet'].includes(a.type))
            .map(a => ({ ...a, balance: balanceMap[a.id] || 0 }))
            .sort((a, b) => (b.balance || 0) - (a.balance || 0));

          if (availableAccounts.length === 0) {
            App.utils.showToast('Nenhuma conta disponível para pagamento.', 'error');
            return;
          }

          App.utils.selectAccount(availableAccounts, async (selectedAccount) => {
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
            const fullDate = `${paymentDate}T${timeStr}`; // utiliza a data informada pelo usuário

            // Direção CORRETA da transferência:
            // - Emprestei (lent): dinheiro volta da conta unificada para a conta selecionada (entrada)
            // - Peguei emprestado (borrowed): dinheiro sai da conta selecionada para a conta unificada (saída)
            const srcAccId = isLent ? loanAccount.id : selectedAccount.id;
            const dstAccId = isLent ? selectedAccount.id : loanAccount.id;

            const srcAcc = accounts.find(a => a.id === srcAccId) || loanAccount;
            const dstAcc = accounts.find(a => a.id === dstAccId) || loanAccount;

            await App.db.put('transactions', {
              id: App.utils.generateId(),
              type: 'transfer',
              amount: totalToPay,
              category: '',
              account_id: srcAccId,
              account_name: srcAcc?.name || '',
              account_to_id: dstAccId,
              account_to_name: dstAcc?.name || '',
              date: fullDate,
              description: `Pagamento parcela: ${loan.person}`,
              notes: '',
              member_id: '',
              member_name: '',
              credit_card_id: '',
              payment_method: 'transfer',
              status: 'confirmed',
              reconciled: false,
              ignore_from_total: false,
              createdAt: new Date().toISOString(),
              position: Date.now(),
              transfer_subtype: 'loan_payment'
            });

            loan.status = 'paid';
            loan.paid_date = paymentDate; // usa a data informada
            await App.db.put('loans', loan);

            if (this.currentMode === 'single') {
              await this.render();
            } else {
              await this.renderReceivablePayable(
                this.currentMode === 'receivable' ? 'lent' : 'borrowed',
                this.currentMode === 'receivable' ? 'A Receber' : 'Devendo'
              );
            }
            App.loans.load(); App.saldos.load();
            App.utils.showToast('Parcela paga!');
          }, async () => {
            // Ignorar e seguir manual: registra apenas a data de pagamento, sem movimentação bancária
            loan.status = 'paid';
            loan.paid_date = paymentDate;
            await App.db.put('loans', loan);

            if (this.currentMode === 'single') {
              await this.render();
            } else {
              await this.renderReceivablePayable(
                this.currentMode === 'receivable' ? 'lent' : 'borrowed',
                this.currentMode === 'receivable' ? 'A Receber' : 'Devendo'
              );
            }
            App.loans.load();
            App.utils.showToast('Parcela marcada como paga (manual).');
          });
        }
      );
    },
    async render() {
      if (this.currentMode !== 'single') return;
      const allLoans = await App.db.getAll('loans');
      const group = allLoans
        .filter(l => (l.loan_group_id === this.currentLoanId || l.id === this.currentLoanId))
        .sort((a, b) => (a.installment_number || 0) - (b.installment_number || 0) || a.date.localeCompare(b.date));
      if (!group.length) return;

      const first = group[0];
      const sumExtras = (l) => (Array.isArray(l.extra_entries) ? l.extra_entries : [])
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const total = group.reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
      const paidCount = group.filter(l => l.status === 'paid').length;
      const totalPaid = group.filter(l => l.status === 'paid')
        .reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtras(l), 0);
      const remaining = total - totalPaid;

      let situacao = '⏳ Pendente';
      if (paidCount === 0) situacao = '⏳ Pendente';
      else if (paidCount === group.length) situacao = '✅ Pago';
      else situacao = '🔄 Em andamento';

      const tipoLabel = first.type === 'lent' ? 'Concedido' : 'Peguei emprestado';
      const _voltarHist = this._fromHistory
        ? `<button class="btn btn-outline btn-sm" style="margin-bottom:14px;" onclick="App.ui.navigateTo('loan-history')">⬅ Voltar ao Histórico</button>`
        : '';

      let html = `${_voltarHist}<div class="cards-row">
        <div class="card"><div class="card-label">Pessoa</div><div class="card-value">${first.person}</div></div>
        <div class="card"><div class="card-label">Valor Total</div><div class="card-value">${App.utils.formatCurrency(total)}</div></div>
        <div class="card"><div class="card-label">Tipo</div><div class="card-value">${tipoLabel}</div></div>
      </div>
      <div class="cards-row">
        <div class="card"><div class="card-label">Data Início</div><div class="card-value">${App.utils.formatDate(first.date)}</div></div>
        <div class="card"><div class="card-label">Situação</div><div class="card-value">${situacao}</div></div>
        <div class="card"><div class="card-label">Valor Restante</div><div class="card-value" style="color:${remaining > 0 ? '#c62828' : '#2e7d32'};">${App.utils.formatCurrency(Math.max(0, remaining))}</div></div>
      </div>
      <div class="card" style="margin-bottom:20px;"><div class="card-label">📝 Notas</div><div class="card-value" style="font-size:1rem;">${first.notes || 'Nenhuma observação registrada.'}</div></div>`;

      if (group.length > 1) {
        html += `<h3>📅 Parcelas</h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Nº</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Data de Pagamento</th>
              </tr>
            </thead>
            <tbody>
              ${group.map((l, i) => {
                const isPaid = l.status === 'paid';
                const isExtended = !!l.extended && !isPaid;
                const statusBadge = isPaid
                  ? '✅ Pago'
                  : (isExtended
                      ? '<span style="color:#a78bfa; font-weight:600;">🔄 Prorrogada</span>'
                      : `<span style="cursor:pointer;text-decoration:underline;" onclick="event.stopPropagation();App.loanDetail.payInstallment('${l.id}')">⏳ Pendente</span>`);
                const vencimentoCell = isExtended
                  ? `<span style="color:var(--text-muted); text-decoration:line-through; font-size:0.78rem;">${App.utils.formatDate(l.original_due_date || l.date)}</span> <span style="color:#a78bfa; font-size:0.78rem;">→</span> <span style="color:#a78bfa; font-weight:600;">${App.utils.formatDate(l.due_date || l.date)}</span>`
                  : App.utils.formatDate(l.due_date || l.date);
                const extrasCount = Array.isArray(l.extra_entries) ? l.extra_entries.length : 0;
                const extrasTotalRow = (Array.isArray(l.extra_entries) ? l.extra_entries : [])
                  .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
                const totalParcelaRow = (parseFloat(l.amount) || 0) + extrasTotalRow;
                return `
                <tr>
                  <td>${i + 1}/${group.length}</td>
                  <td>${vencimentoCell}</td>
                  <td>
                    <span style="cursor:pointer; text-decoration:underline dotted; color:var(--primary); font-weight:600;" title="Ver detalhes da parcela" onclick="App.loanDetail.openInstallmentDetail('${l.id}')">${App.utils.formatCurrency(totalParcelaRow)}</span>
                    ${extrasCount > 0 ? `<div style="font-size:0.68rem; color:var(--text-muted); margin-top:2px;">Acordo ${App.utils.formatCurrency(l.amount)} <span style="color:#f87171; font-weight:600;">+ ${App.utils.formatCurrency(extrasTotalRow)}</span></div>` : ''}
                  </td>
                  <td>${statusBadge}</td>
                  <td>${l.paid_date ? App.utils.formatDate(l.paid_date) : '-'}</td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>`;
      }

      document.getElementById('loanDetailContent').innerHTML = html;
    },
    async renderReceivablePayable(type, title) {
      const allLoans = await App.db.getAll('loans'); const groupMap = new Map();
      allLoans.filter(l => l.type === type).forEach(l => { const key = l.loan_group_id || l.id; if (!groupMap.has(key)) groupMap.set(key, []); groupMap.get(key).push(l); });
      const sumExtrasRec = (l) => (Array.isArray(l.extra_entries) ? l.extra_entries : [])
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      let html = `<h1>📋 ${title}</h1>`;
      for (const [key, group] of groupMap) {
        const first = group[0];
        const total = group.reduce((s,l) => s + (parseFloat(l.amount) || 0) + sumExtrasRec(l), 0);
        const totalPaid = group.filter(l => l.status === 'paid').reduce((s,l) => s + (parseFloat(l.amount) || 0) + sumExtrasRec(l), 0);
        const remaining = total - totalPaid;
        const paidCount = group.filter(l => l.status === 'paid').length;
        html += `<div class="card" style="cursor:pointer; margin-bottom:16px;" onclick="App.loanDetail.showGroupDetail('${key}')"><div class="card-label">${first.person}</div><div class="card-value">${App.utils.formatCurrency(remaining)} / ${App.utils.formatCurrency(total)}</div><div class="card-sub">${paidCount}/${group.length} parcelas pagas | Restante: ${App.utils.formatCurrency(Math.max(0,remaining))}</div>${paidCount!==group.length?`<div style="margin-top:8px;"><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();App.loanDetail.payAllGroup('${key}')">✅ Pagar Tudo</button></div>`:''}</div>`;
      }
      if (groupMap.size === 0) html += '<p>Nenhum empréstimo encontrado.</p>';
      document.getElementById('loanDetailContent').innerHTML = html;
    },
    async showGroupDetail(groupKey) { this.currentLoanId = groupKey; this.currentMode = 'single'; await this.render(); },
    async payAllGroup(groupKey) {
      const all = await App.db.getAll('loans');
      const group = all.filter(l => (l.loan_group_id === groupKey || l.id === groupKey));
      if (!group.length) return;
      const firstLoan = group[0];
      const paymentMode = String(firstLoan.payment_mode || 'account').toLowerCase();
      const sumExtrasGroup = (l) => (Array.isArray(l.extra_entries) ? l.extra_entries : [])
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const totalGroup = group.reduce((s, l) => s + (parseFloat(l.amount) || 0) + sumExtrasGroup(l), 0);

      // MODO MANUAL: apenas registra a data e marca todos como pagos
      if (paymentMode === 'manual') {
        App.loanDetail.openPaymentDateModal(
          `Data do pagamento total de ${App.utils.formatCurrency(totalGroup)} para ${firstLoan.person}:`,
          async (date) => {
            if (!date) return;
            for (const l of group) {
              l.status = 'paid';
              l.paid_date = date;
              await App.db.put('loans', l);
            }
            this.renderReceivablePayable(
              this.currentMode === 'receivable' ? 'lent' : 'borrowed',
              this.currentMode === 'receivable' ? 'A Receber' : 'Devendo'
            );
            App.loans.load();
            App.utils.showToast('Todas as parcelas pagas (manual).');
          }
        );
        return; // interrompe aqui – não executa o restante
      }

      // MODO CONTA: mantém a lógica original
      App.utils.confirm('Marcar todas as parcelas como pagas?', async () => {
        for (const l of group) {
          l.status = 'paid';
          l.paid_date = App.utils.todayISO();
          await App.db.put('loans', l);
        }
        this.renderReceivablePayable(
          this.currentMode === 'receivable' ? 'lent' : 'borrowed',
          this.currentMode === 'receivable' ? 'A Receber' : 'Devendo'
        );
        App.loans.load();
      });
    }
  };

  // =======================================================================
  // Metas – sem alterações
  // =======================================================================
  App.goals = {
    async load() {
      try {
        const goals = await App.db.getAll('goals');
        const txAll = await App.db.getAll('transactions');
        this.render(goals, txAll);
      } catch (e) { console.error(e); App.utils.showToast('Erro ao carregar metas.', 'error'); }
    },
    render(goals, txAll) {
      const tbody = document.getElementById('goalsTableBody');
      const cardsContainer = document.getElementById('goalsCards');
      if (!goals.length) { if (tbody) tbody.innerHTML = '<tr><td colspan="6">Nenhuma meta definida</td></tr>'; if (cardsContainer) cardsContainer.innerHTML = ''; return; }
      if (cardsContainer) cardsContainer.innerHTML = goals.map(g => {
        const saved = g.category_id ? txAll.filter(t=>t.category===g.category_id && t.type==='income' && t.status==='confirmed').reduce((s,t)=>s+parseFloat(t.amount),0) : (g.saved || 0);
        const progress = Math.min((saved / g.target_amount) * 100, 100);
        return `<div class="card clickable" onclick="App.goals.edit('${g.id}')"><div class="card-label">${g.name}</div><div class="card-value">${App.utils.formatCurrency(saved)} / ${App.utils.formatCurrency(g.target_amount)}</div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${progress}%"></div></div><div class="card-sub">Prazo: ${g.deadline ? App.utils.formatDate(g.deadline) : 'sem data'}</div></div>`;
      }).join('');
      if (tbody) tbody.innerHTML = goals.map(g => {
        const saved = g.category_id ? txAll.filter(t=>t.category===g.category_id && t.type==='income' && t.status==='confirmed').reduce((s,t)=>s+parseFloat(t.amount),0) : (g.saved || 0);
        return `<tr><td>${g.name}</td><td class="text-right">${App.utils.formatCurrency(g.target_amount)}</td><td class="text-right">${App.utils.formatCurrency(saved)}</td><td><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${Math.min((saved/g.target_amount)*100,100)}%"></div></div></td><td>${g.deadline ? App.utils.formatDate(g.deadline) : '-'}</td><td class="text-center actions-cell"><button class="icon-btn" onclick="App.goals.edit('${g.id}')">✏️</button><button class="icon-btn delete" onclick="App.goals.remove('${g.id}')">🗑️</button></td></tr>`;
      }).join('');
    },
    async save(e) { e.preventDefault(); const id=document.getElementById('goalId').value, name=document.getElementById('goalName').value, target_amount=parseFloat(document.getElementById('goalTarget').value), deadline=document.getElementById('goalDeadline').value, category_id=document.getElementById('goalCategory').value; if(!name||isNaN(target_amount)||target_amount<=0){App.utils.showToast('Preencha campos','error');return false;} await App.db.put('goals',{id:id||App.utils.generateId(),name,target_amount,deadline,category_id,saved:0}); App.ui.closeModal('modalGoal'); App.utils.showToast(id?'Meta atualizada!':'Meta criada!'); this.load(); return false; },
    async edit(id) { const g = await App.db.getById('goals',id); if(g) App.ui.openGoalModal(g); },
    async remove(id) { App.utils.confirm('Excluir meta?', async () => { await App.db.delete('goals',id); this.load(); }); }
  };

// =======================================================================
// Desejos – sem alterações
// =======================================================================
App.wishes = {
  async load() {
    try {
      const wishes = await App.db.getAll('wishes');
      const tbody = document.getElementById('wishesTableBody');
      if (!wishes.length) { tbody.innerHTML = '<tr><td colspan="6">Nenhum desejo registrado</td></tr>'; return; }
      tbody.innerHTML = wishes.map(w => `<tr><td>${w.name}</td><td class="text-right">${App.utils.formatCurrency(w.value)}</td><td>${App.utils.formatDate(w.desired_date)}</td><td class="text-right">${App.utils.formatCurrency(w.monthly_saving)}</td><td>${w.suggestion||''}</td><td class="text-center actions-cell"><button class="icon-btn" onclick="App.wishes.edit('${w.id}')">✏️</button><button class="icon-btn delete" onclick="App.wishes.remove('${w.id}')">🗑️</button></td></tr>`).join('');
    } catch (e) { console.error(e); App.utils.showToast('Erro ao carregar desejos.', 'error'); }
  },
  async save(e) { e.preventDefault(); const id=document.getElementById('wishId').value, name=document.getElementById('wishName').value, value=parseFloat(document.getElementById('wishValue').value), desired_date=document.getElementById('wishDate').value; if(!name||isNaN(value)||value<=0||!desired_date){App.utils.showToast('Preencha campos','error');return false;} await App.db.put('wishes',{id:id||App.utils.generateId(),name,value,desired_date,monthly_saving:0,suggestion:'Planeje sua economia mensal'}); App.ui.closeModal('modalWish'); App.utils.showToast(id?'Desejo atualizado!':'Desejo adicionado!'); this.load(); return false; },
  async edit(id) { const w = await App.db.getById('wishes',id); if(w) App.ui.openWishModal(w); },
  async remove(id) { App.utils.confirm('Excluir desejo?', async () => { await App.db.delete('wishes',id); this.load(); }); }
};

// =======================================================================
// Categorização – interface moderna com subcategorias expansíveis
// =======================================================================
App.categorization = {
  currentTab: 'expense',

  suggestUniqueColor() {
    const cats = App.cache.categories || [];
    const usedColors = new Set(cats.map(c => c.color?.toLowerCase()).filter(Boolean));
    const fallbackColors = [
      '#e67e22', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c',
      '#e74c3c', '#f1c40f', '#34495e', '#95a5a6', '#d35400',
      '#c0392b', '#16a085', '#8e44ad', '#27ae60', '#2980b9',
      '#f39c12', '#bdc3c7', '#7f8c8d', '#2c3e50', '#e91e63',
      '#00bcd4', '#ff5722', '#795548', '#607d8b', '#ff9800'
    ];
    for (let i = 0; i < 30; i++) {
      let candidate;
      if (i < fallbackColors.length) {
        candidate = fallbackColors[i];
      } else {
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        candidate = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
      }
      if (!usedColors.has(candidate.toLowerCase())) {
        console.log(`%c🎨 Cor única sugerida: ${candidate} %c(copie e cole no campo de cor)`, `color: ${candidate}; font-size: 16px; font-weight: bold;`, 'color: #888;');
        return candidate;
      }
    }
    const r = Math.floor(Math.random()*256), g = Math.floor(Math.random()*256), b = Math.floor(Math.random()*256);
    const fallback = '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
    console.log(`%c🎨 Cor única (aleatória): ${fallback}`, `color: ${fallback}; font-size: 16px;`);
    return fallback;
  },

  switchTab(type) {
    this.currentTab = type;
    document.getElementById('tabCatExpense').classList.toggle('active', type === 'expense');
    document.getElementById('tabCatIncome').classList.toggle('active', type === 'income');
    this.load();
  },

  async load() {
    const cats = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = cats;
    const allTx = await App.db.getAll('transactions');
    this.allCategories = cats;
    this.allTransactions = allTx;
    this.applyFilters();
  },

  applyFilters() {
    const cats = this.allCategories || [];
    const searchTerm = (document.getElementById('catSearch')?.value || '').toLowerCase();
    const classificationFilter = document.getElementById('catFilterClassification')?.value || 'all';
    const statusFilter = document.getElementById('catFilterStatus')?.value || 'active';

    let filtered = cats.filter(c => c.type === this.currentTab);

    if (searchTerm) {
      filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(searchTerm));
    }
    if (classificationFilter !== 'all') {
      filtered = filtered.filter(c => c.classification === classificationFilter);
    }
    if (statusFilter === 'active') {
      filtered = filtered.filter(c => !c.archived);
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter(c => c.archived);
    }

    const mainCats = filtered.filter(c => !c.parent_id);
    const subCats = filtered.filter(c => c.parent_id);

    const categoriesList = document.getElementById('categoriesList');
    if (!categoriesList) return;

    // Prepara mapa de subcategorias por categoria pai
    const subMap = new Map();
    subCats.forEach(sub => {
      if (!subMap.has(sub.parent_id)) subMap.set(sub.parent_id, []);
      subMap.get(sub.parent_id).push(sub);
    });

    // Conta transações por categoria (incluindo subcategorias)
    const countTransactionsForCat = (cat) => {
      const subs = subMap.get(cat.id) || [];
      const relevantNames = [cat.name, ...subs.map(s => s.name)];
      return (this.allTransactions || []).filter(t => t.category && relevantNames.includes(t.category)).length;
    };

    const html = mainCats.map(cat => {
      const subs = subMap.get(cat.id) || [];
      const isOpen = cat.id === this._openCategoryId;
      const expandClass = isOpen ? 'open' : '';
      const badgeClass = cat.classification === 'essential' ? 'cat-badge-essential' : cat.classification === 'necessary' ? 'cat-badge-necessary' : 'cat-badge-superfluous';
      const classificationLabel = cat.classification === 'essential' ? 'Essencial' : cat.classification === 'necessary' ? 'Necessário' : 'Supérfluo';
      const statusLabel = cat.archived ? 'Inativa' : 'Ativa';
      const iconClass = this._getIconClass(cat.name);
      const txCount = countTransactionsForCat(cat);

      const subHtml = subs.map(sub => {
        return `
          <div class="cat-subcategory">
            <div class="cat-sub-dot" style="background:${cat.color || '#f97316'};"></div>
            <div class="cat-sub-info">
              <div class="cat-sub-title">${sub.name}</div>
              <div class="cat-sub-desc">${sub.description || 'Sem descrição'}</div>
            </div>
            <div class="cat-movement-count">${sub.movement_count || 0} mov.</div>
            <div class="cat-sub-actions">
              <button class="cat-action-btn" title="Tornar categoria principal" onclick="event.stopPropagation(); App.categorization.promoteToMainCategory('${sub.id}')"><i class="fa-solid fa-arrow-up"></i></button>
              <button class="cat-action-btn" onclick="event.stopPropagation(); App.categorization.edit('${sub.id}')"><i class="fa-solid fa-pen"></i></button>
              <button class="cat-action-btn" style="color:#ef7777;" onclick="event.stopPropagation(); App.categorization.remove('${sub.id}')"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>`;
      }).join('');

      return `
        <div class="cat-category ${expandClass}" data-cat-id="${cat.id}">
          <div class="cat-row" onclick="App.categorization.toggleSubcategories('${cat.id}')">
            <div class="cat-name">
              <button class="cat-expand" onclick="event.stopPropagation(); App.categorization.toggleSubcategories('${cat.id}')"><i class="fa-solid fa-chevron-right"></i></button>
              <div class="cat-icon" style="background:${cat.color || '#cccccc'}; color:white;"><i class="${cat.icon || this._getIcon(cat.name)}"></i></div>
              <div class="cat-info">
                <div class="cat-name-text">${cat.name}</div>
                <div class="cat-desc">${cat.description || 'Sem descrição'}</div>
              </div>
            </div>
            <div><span class="cat-badge ${badgeClass}">${classificationLabel}</span></div>
            <div class="cat-subcount">${subs.length}</div>
            <div class="cat-txcount">${txCount}</div>
            <div class="cat-status">
              <button class="cat-switch ${cat.archived ? '' : 'active'}" onclick="event.stopPropagation(); App.categorization.toggleArchive(event, '${cat.id}')"></button>
              <span>${statusLabel}</span>
            </div>
            <div>
              <button class="cat-action-btn" onclick="event.stopPropagation(); App.categorization.openMenu(event, '${cat.id}')"><i class="fa-solid fa-ellipsis-vertical"></i></button>
            </div>
          </div>
          <div class="cat-subcategories">
            ${subHtml}
            <div class="cat-add-sub" onclick="App.categorization.addSubcategory('${cat.id}')"><i class="fa-solid fa-plus"></i> Adicionar subcategoria</div>
          </div>
        </div>`;
    }).join('');

    categoriesList.innerHTML = html;

    document.getElementById('catShowingCount').textContent = mainCats.length;
    document.getElementById('catTotalCount').textContent = cats.filter(c => c.type === this.currentTab && !c.parent_id).length;

    this.renderClassificationCards(cats);
    this.renderSummary(cats);
  },

  toggleSubcategories(catId) {
    const categoryElement = document.querySelector(`.cat-category[data-cat-id="${catId}"]`);
    if (categoryElement) {
      categoryElement.classList.toggle('open');
      this._openCategoryId = categoryElement.classList.contains('open') ? catId : null;
    }
  },

  _getIconClass(name) {
    const icons = {
      'Alimentação': 'icon-food',
      'Moradia': 'icon-home',
      'Transporte': 'icon-car',
      'Saúde': 'icon-health',
      'Lazer': 'icon-leisure',
      'Educação': 'icon-education'
    };
    return icons[name] || 'icon-food';
  },

  _getIcon(name) {
    const icons = {
      'Alimentação': 'fa-solid fa-utensils',
      'Moradia': 'fa-solid fa-house',
      'Transporte': 'fa-solid fa-car',
      'Saúde': 'fa-solid fa-heart-pulse',
      'Lazer': 'fa-solid fa-gamepad',
      'Educação': 'fa-solid fa-book-open'
    };
    return icons[name] || 'fa-solid fa-tag';
  },

  openMenu(event, catId) {
    event.stopPropagation();

    // Remove menu anterior se existir
    const existingMenu = document.getElementById('catActionMenu');
    if (existingMenu) existingMenu.remove();

    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.id = 'catActionMenu';
    menu.style.cssText = 'position:fixed; z-index:300; background:#17191a; border:1px solid #303437; border-radius:7px; padding:5px; box-shadow:0 15px 40px rgba(0,0,0,.45); min-width:175px;';
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${rect.right - 175}px`;

    const items = [
      { label: 'Editar categoria', icon: 'fa-solid fa-pen', action: () => this.edit(catId) },
      { label: 'Adicionar subcategoria', icon: 'fa-solid fa-plus', action: () => this.addSubcategory(catId) },
      { label: 'Transformar em subcategoria', icon: 'fa-solid fa-shuffle', action: () => this.transformToSubcategory(catId) },
      { label: 'Duplicar', icon: 'fa-regular fa-copy', action: () => App.utils.showToast('Duplicar em breve', 'info') },
      { label: 'Desativar/Ativar', icon: 'fa-solid fa-power-off', action: () => this.toggleArchive({ currentTarget: btn }, catId) },
      { label: 'Excluir', icon: 'fa-solid fa-trash', danger: true, action: () => this.remove(catId) }
    ];

    items.forEach(item => {
      const el = document.createElement('div');
      el.innerHTML = `<i class="${item.icon}"></i> <span>${item.label}</span>`;
      el.style.cssText = 'height:35px; display:flex; align-items:center; padding:0 10px; border-radius:5px; font-size:10px; gap:9px; cursor:pointer;';
      el.style.color = item.danger ? '#ef7777' : '#c8cdd1';
      el.querySelector('i').style.color = item.danger ? '#ef7777' : '#8d9499';

      el.addEventListener('mouseenter', () => el.style.background = '#25282a');
      el.addEventListener('mouseleave', () => el.style.background = 'transparent');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        item.action();
      });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);

    // Fecha ao clicar fora
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  availableIcons: [
    'fa-solid fa-utensils',
    'fa-solid fa-house',
    'fa-solid fa-car',
    'fa-solid fa-heart-pulse',
    'fa-solid fa-gamepad',
    'fa-solid fa-book-open',
    'fa-solid fa-paw',
    'fa-solid fa-cart-shopping',
    'fa-solid fa-gift',
    'fa-solid fa-mug-hot',
    'fa-solid fa-plane',
    'fa-solid fa-tag',
    'fa-solid fa-wallet',
    'fa-solid fa-chart-line',
    'fa-solid fa-building-columns',
    'fa-solid fa-screwdriver-wrench',
    'fa-solid fa-shield-halved',
    'fa-solid fa-graduation-cap',
    'fa-solid fa-briefcase',
    'fa-solid fa-dumbbell',
    'fa-solid fa-film',
    'fa-solid fa-music',
    'fa-solid fa-camera',
    'fa-solid fa-palette',
    'fa-solid fa-motorcycle',
    'fa-solid fa-bicycle',
    'fa-solid fa-bus',
    'fa-solid fa-train',
    'fa-solid fa-plane-departure',
    'fa-solid fa-ship',
    'fa-solid fa-phone',
    'fa-solid fa-envelope',
    'fa-solid fa-wifi',
    'fa-solid fa-key',
    'fa-solid fa-lock',
    'fa-solid fa-bell',
    'fa-solid fa-lightbulb',
    'fa-solid fa-futbol',
    'fa-solid fa-basketball',
    'fa-solid fa-swimmer',
    'fa-solid fa-running',
    'fa-solid fa-skiing',
    'fa-solid fa-hiking',
    'fa-solid fa-campground',
    'fa-solid fa-mountain',
    'fa-solid fa-tree',
    'fa-solid fa-leaf',
    'fa-solid fa-seedling',
    'fa-solid fa-water',
    'fa-solid fa-bolt',
    'fa-solid fa-fire',
    'fa-solid fa-star',
    'fa-solid fa-heart',
    'fa-solid fa-thumbs-up',
    'fa-solid fa-thumbs-down',
    'fa-solid fa-hand-holding-usd',
    'fa-solid fa-hand-holding-heart',
    'fa-solid fa-hand-sparkles',
  ],

  availableColors: [
    '#e67e22', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c',
    '#e74c3c', '#f1c40f', '#34495e', '#95a5a6', '#d35400',
    '#c0392b', '#16a085', '#8e44ad', '#27ae60', '#2980b9',
    '#f39c12', '#bdc3c7', '#7f8c8d', '#2c3e50', '#e91e63',
    '#00bcd4', '#ff5722', '#795548', '#607d8b', '#ff9800',
    '#4caf50', '#2196f3', '#ffeb3b', '#9c27b0', '#ffc107',
    '#03a9f4', '#8bc34a', '#ff5252', '#673ab7', '#cddc39',
  ],

  openCategoryModal(cat = null) {
    document.getElementById('categoryFormId').value = cat?.id || '';
    document.getElementById('categoryFormName').value = cat?.name || '';
    document.getElementById('categoryFormType').value = cat?.type || 'expense';
    document.getElementById('categoryFormClassification').value = cat?.classification || 'necessary';
    const parentSelect = document.getElementById('categoryFormParent');
    const tipoAtual = cat?.type || 'expense';
    parentSelect.innerHTML = '<option value="">Nenhuma (principal)</option>' +
      (this.allCategories || [])
        .filter(c => !c.parent_id && c.type === tipoAtual && c.id !== cat?.id)
        .map(c => `<option value="${c.id}" ${cat?.parent_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    document.getElementById('categoryFormType').addEventListener('change', () => {
      const type = document.getElementById('categoryFormType').value;
      parentSelect.innerHTML = '<option value="">Nenhuma (principal)</option>' +
        (this.allCategories || [])
          .filter(c => !c.parent_id && c.type === type && c.id !== cat?.id)
          .map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    });

    const iconsContainer = document.getElementById('categoryFormIcons');
    iconsContainer.innerHTML = this.availableIcons.map(icon => {
      const selected = cat?.icon === icon || (!cat?.icon && icon === this._getIcon(cat?.name));
      return `<div class="cat-icon-option ${selected ? 'selected' : ''}" data-icon="${icon}" onclick="App.categorization.selectIcon(this)" style="width:34px;height:34px;border-radius:8px;border:1px solid #444;display:flex;align-items:center;justify-content:center;cursor:pointer;background:${selected ? 'rgba(124,58,237,0.2)' : 'transparent'};">`
        + `<i class="${icon}"></i>`
        + `</div>`;
    }).join('');
    document.getElementById('categoryFormIcon').value = cat?.icon || this._getIcon(cat?.name);

    const colorsContainer = document.getElementById('categoryFormColors');
    colorsContainer.innerHTML = this.availableColors.map(color => {
      const selected = cat?.color === color || (!cat?.color && color === '#e67e22');
      return `<div class="cat-color-option ${selected ? 'selected' : ''}" data-color="${color}" onclick="App.categorization.selectColor(this)" style="width:28px;height:28px;border-radius:50%;background:${color};cursor:pointer;border:2px solid ${selected ? '#fff' : 'transparent'};"></div>`;
    }).join('');
    document.getElementById('categoryFormColor').value = cat?.color || '#e67e22';

    document.getElementById('modalCategoryFormTitle').textContent = cat ? 'Editar Categoria' : 'Nova Categoria';

    // Listeners removidos – agora usamos onclick inline nas opções

    const transformBtn = document.getElementById('btnTransformToSubcategory');
    if (transformBtn) {
      // Mostra o botão apenas para categorias principais (sem parent_id)
      transformBtn.style.display = (cat && !cat.parent_id) ? '' : 'none';
    }

    App.ui.openModal('modalCategoryForm');
  },

  selectIcon(element) {
    const iconsContainer = document.getElementById('categoryFormIcons');
    iconsContainer.querySelectorAll('.cat-icon-option').forEach(e => e.classList.remove('selected'));
    element.classList.add('selected');
    document.getElementById('categoryFormIcon').value = element.dataset.icon;
  },

  selectColor(element) {
    const colorsContainer = document.getElementById('categoryFormColors');
    colorsContainer.querySelectorAll('.cat-color-option').forEach(e => e.classList.remove('selected'));
    element.classList.add('selected');
    document.getElementById('categoryFormColor').value = element.dataset.color;
  },

  async saveCategoryModal(e) {
    e.preventDefault();
    const id = document.getElementById('categoryFormId').value;
    const name = document.getElementById('categoryFormName').value.trim();
    const type = document.getElementById('categoryFormType').value;
    const parent_id = document.getElementById('categoryFormParent').value || null;
    const classification = document.getElementById('categoryFormClassification').value;
    const icon = document.getElementById('categoryFormIcon').value;
    const color = document.getElementById('categoryFormColor').value;

    if (!name) {
      App.utils.showToast('Nome obrigatório', 'error');
      return false;
    }

    const categoryData = {
      id: id || App.utils.generateId(),
      name,
      type,
      classification,
      parent_id,
      icon,
      color,
      archived: false
    };
    await App.db.put('categories', categoryData);
    App.cache.categories = null;
    App.ui.closeModal('modalCategoryForm');
    App.utils.showToast(id ? 'Categoria atualizada!' : 'Categoria criada!');
    this.load();
    return false;
  },

  renderClassificationCards(cats) {
    const container = document.getElementById('catClassificationCards');
    if (!container) return;

    const expenseCats = cats.filter(c => c.type === 'expense' && !c.archived && !c.parent_id);
    const groups = {
      essential: expenseCats.filter(c => c.classification === 'essential'),
      necessary: expenseCats.filter(c => c.classification === 'necessary'),
      superfluous: expenseCats.filter(c => c.classification === 'superfluous')
    };

    const labels = {
      essential: { title: 'ESSENCIAL (50%)', icon: 'fa-thumbs-up', class: 'cat-essential', textColor: 'cat-classification-name', color: '#35d86e', desc: 'Necessidades básicas e essenciais' },
      necessary: { title: 'NECESSÁRIO (30%)', icon: 'fa-hand-point-right', class: 'cat-necessary', textColor: 'cat-classification-name', color: '#f1c232', desc: 'Importante para qualidade de vida' },
      superfluous: { title: 'SUPÉRFLUO (20%)', icon: 'fa-star', class: 'cat-superfluous', textColor: 'cat-classification-name', color: '#a77aff', desc: 'Desejos e gastos não essenciais' }
    };

    let html = '';
    Object.entries(groups).forEach(([key, items]) => {
      const label = labels[key];
      html += `
        <div class="cat-classification ${label.class}">
          <div class="cat-classification-header">
            <div class="cat-classification-name" style="color:${label.color}"><i class="fa-solid ${label.icon}"></i> ${label.title}</div>
            <div class="cat-class-count">${items.length} categorias</div>
          </div>
          <div class="cat-class-desc">${label.desc}</div>
          <div class="cat-class-icons">
            ${items.slice(0, 5).map(c => `<div class="cat-mini-icon"><i class="${this._getIcon(c.name)}"></i></div>`).join('')}
            ${items.length > 5 ? `<div class="cat-mini-icon cat-more-icon">+${items.length - 5}</div>` : ''}
          </div>
          <div class="cat-class-arrow"><i class="fa-solid fa-chevron-right"></i></div>
        </div>`;
    });

    container.innerHTML = html;
  },

  renderSummary(cats) {
    const expenseCats = cats.filter(c => c.type === 'expense' && !c.parent_id);
    const activeCats = expenseCats.filter(c => !c.archived);
    const subcats = cats.filter(c => c.type === 'expense' && c.parent_id);

    document.getElementById('sumTotalCats').textContent = expenseCats.length;
    document.getElementById('sumActiveCats').textContent = activeCats.length;
    document.getElementById('sumSubcats').textContent = subcats.length;
  },

  async edit(id) {
    const cat = await App.db.getById('categories', id);
    if (!cat) return;
    this.openCategoryModal(cat);
  },

  async transformToSubcategory(catId = null) {
    if (!catId) {
      catId = document.getElementById('categoryFormId')?.value;
    }
    if (!catId) {
      App.utils.showToast('Nenhuma categoria selecionada para transformar.', 'error');
      return;
    }

    this._pendingTransformCatId = catId;
    const allCats = this.allCategories || [];
    const mainCats = allCats.filter(c => !c.parent_id && c.id !== catId && c.type === this.currentTab);
    if (mainCats.length === 0) {
      App.utils.showToast('Não há categorias principais disponíveis para se tornar subcategoria.', 'error');
      return;
    }

    const listContainer = document.getElementById('selectParentCategoryList');
    const esc = (v) => App.utils.escapeHtml(v);
    listContainer.innerHTML = mainCats.map(cat => {
      return `<button class="btn btn-outline" style="text-align:left; padding:10px 12px;" onclick="App.categorization.confirmTransformToSubcategory('${esc(cat.id)}')">${esc(cat.name)}</button>`;
    }).join('');

    App.ui.openModal('modalSelectParentCategory');
  },

  async confirmTransformToSubcategory(newParentId) {
    const catId = this._pendingTransformCatId;
    if (!catId) return;

    const cat = await App.db.getById('categories', catId);
    if (!cat) {
      App.utils.showToast('Categoria não encontrada.', 'error');
      return;
    }

    cat.parent_id = newParentId;
    await App.db.put('categories', cat);
    App.cache.categories = null;

    App.ui.closeModal('modalSelectParentCategory');
    if (document.getElementById('modalCategoryForm')?.classList.contains('open')) {
      App.ui.closeModal('modalCategoryForm');
    }
    App.utils.showToast(`Categoria "${cat.name}" transformada em subcategoria.`);
    this.load();
  },

  async promoteToMainCategory(catId) {
    const cat = await App.db.getById('categories', catId);
    if (!cat) {
      App.utils.showToast('Subcategoria não encontrada.', 'error');
      return;
    }

    cat.parent_id = null;
    await App.db.put('categories', cat);
    App.cache.categories = null;

    App.utils.showToast(`Subcategoria "${cat.name}" agora é uma categoria principal.`);
    this.load();
  },

  addCategory() {
    this.openCategoryModal();
  },

  async addSubcategory(parentId) {
    const parent = await App.db.getById('categories', parentId);
    if (!parent) return;
    const name = prompt(`Nova subcategoria para ${parent.name}:`);
    if (!name) return;
    const palette = App.utils.generateAnalogousPalette(parent.color || '#95a5a6', 8);
    const color = palette[0];
    await App.db.put('categories', {
      id: App.utils.generateId(),
      name,
      type: parent.type,
      classification: parent.classification,
      parent_id: parentId,
      color,
      archived: false
    });
    App.cache.categories = null;
    App.utils.showToast('Subcategoria criada!');
    this.load();
  },

  async toggleArchive(event, id) {
    const cat = await App.db.getById('categories', id);
    if (!cat) return;
    cat.archived = !cat.archived;
    await App.db.put('categories', cat);
    App.cache.categories = null;
    const children = (await App.db.getAll('categories')).filter(c => c.parent_id === id);
    for (const child of children) {
      child.archived = cat.archived;
      await App.db.put('categories', child);
    }

    // Atualiza o switch imediatamente para proporcionar o efeito visual
       if (event && event.currentTarget) {
      const switchBtn = event.currentTarget;
      switchBtn.classList.toggle('active', !cat.archived);
      void switchBtn.offsetWidth; // força reflow para reiniciar a transição
      const statusSpan = switchBtn.parentElement.querySelector('span');
      if (statusSpan) statusSpan.textContent = cat.archived ? 'Inativa' : 'Ativa';
    }
    // Aguarda 400ms para o usuário ver a animação antes de recarregar
    setTimeout(() => this.load(), 400);
  },

  async remove(id) {
    const cat = await App.db.getById('categories', id);
    if (!cat) return;

    const todasCats = App.cache.categories || await App.db.getAll('categories');
    const filhos = todasCats.filter(c => c.parent_id === id);
    const nomesAfetados = new Set([cat.name, ...filhos.map(c => c.name)]);

    const txAll = await App.db.getAll('transactions');
    const txAfetadas = txAll.filter(t => t.category && nomesAfetados.has(t.category));

    // Sugere "Outros" do mesmo tipo da categoria sendo excluída
    const outros = todasCats.find(c =>
      c.name.toLowerCase().trim() === 'outros' &&
      c.type === cat.type &&
      c.id !== id &&
      !c.archived
    );

    const continuar = await new Promise((resolve) => {
      if (txAfetadas.length === 0) {
        App.utils.confirm(
          `Excluir a categoria "${cat.name}"${filhos.length ? ' e suas subcategorias' : ''}? Nenhuma transação será afetada.`,
          () => resolve(true),
          () => resolve(false)
        );
      } else {
        App.utils.confirm(
          `A categoria "${cat.name}" está sendo usada por ${txAfetadas.length} transação(ões).\n\n` +
          `Ao excluir, essas transações serão reatribuídas para "${outros ? outros.name : 'Outros'}" para não ficarem órfãs.\n\nContinuar?`,
          () => resolve(true),
          () => resolve(false)
        );
      }
    });
    if (!continuar) return;

    // Reatribui transações antes de apagar
    if (txAfetadas.length > 0 && outros) {
      for (const t of txAfetadas) {
        t.category = outros.name;
        t.updatedAt = new Date().toISOString();
        await App.db.put('transactions', t);
      }
    }

    // Remove categoria e filhas
    await App.db.delete('categories', id);
    for (const child of filhos) await App.db.delete('categories', child.id);
    App.cache.categories = null;
    App.transactions.invalidateCache?.();
    App.cache.totalBalance = null;

    App.utils.showToast(
      txAfetadas.length > 0
        ? `Categoria excluída. ${txAfetadas.length} transação(ões) reatribuída(s) para "${outros ? outros.name : 'Outros'}".`
        : 'Categoria excluída.'
    );

    await App.saldos.load();
    this.load();
    App.transactions.load();
    App.dashboard.refresh();
    App.panel.refresh();
    if (App.classification) App.classification.load();
    if (App.analytics) App.analytics.refresh();
  }
};

// =======================================================================
// Subcategorias – sem alterações
// =======================================================================
App.subcategories = {
  currentParentId: null,
  async load(parentId) { if (parentId) this.currentParentId = parentId; if (!this.currentParentId) { App.ui.navigateTo('categorization'); return; } const parent = await App.db.getById('categories', this.currentParentId); if (!parent) { App.ui.navigateTo('categorization'); return; } document.getElementById('subcategoryBreadcrumb').innerHTML = `<a href="#" onclick="App.ui.navigateTo('categorization')">🏷️ Categorias</a> > ${parent.name}`; const subs = (App.cache.categories || await App.db.getAll('categories')).filter(c => c.parent_id === this.currentParentId); document.getElementById('subcategoriesTableBody').innerHTML = subs.map(s => `<tr><td style="color:${s.color||'#fff'}">${s.name}</td><td><span class="color-swatch" style="background:${s.color||'#ccc'};display:inline-block;width:20px;height:20px;border-radius:4px;"></span></td><td>${s.archived?'📁 Arquivada':'✅ Ativa'}</td><td class="text-center"><button class="icon-btn" onclick="App.subcategories.edit('${s.id}')">✏️</button><button class="icon-btn" onclick="App.subcategories.toggleArchive('${s.id}')">${s.archived?'📤':'📥'}</button><button class="icon-btn delete" onclick="App.subcategories.remove('${s.id}')">🗑️</button></td></tr>`).join('') || '<tr><td colspan="4">Nenhuma subcategoria</td></tr>'; App.ui.navigateTo('subcategories'); },
  async edit(id) {
    const sub = await App.db.getById('categories', id);
    if (!sub) return;
    // Mostra sugestão de cor no console
    const suggestedColor = App.categorization.suggestUniqueColor();
    App.utils.prompt('Novo nome:', sub.name, async (name) => {
      if (name !== null && name.trim() !== '') {
        sub.name = name.trim();
      }
      App.utils.prompt(
        `Nova cor (hexadecimal):\nAtual: ${sub.color}\n💡 Sugestão no console: ${suggestedColor}`,
        sub.color || suggestedColor,
        async (newColor) => {
          if (newColor !== null && /^#[0-9a-fA-F]{6}$/.test(newColor.trim())) {
            sub.color = newColor.trim();
          } else if (newColor !== null) {
            App.utils.showToast('Cor inválida. Use formato #RRGGBB', 'error');
            return;
          }
          await App.db.put('categories', sub);
          App.cache.categories = null;
          this.load(this.currentParentId);
        }
      );
    });
  },
  async toggleArchive(id) { const sub = await App.db.getById('categories', id); if (!sub) return; sub.archived = !sub.archived; await App.db.put('categories', sub); App.cache.categories = null; this.load(this.currentParentId); },
  async remove(id) { App.utils.confirm('Excluir subcategoria?', async () => { await App.db.delete('categories', id); App.cache.categories = null; this.load(this.currentParentId); }); },
  goBack() { App.ui.navigateTo('categorization'); }
};

// =======================================================================
// Planejamento Financeiro (Múltiplos Planos, Vigência, Linha do Tempo & Acompanhamento)
// =======================================================================
App.planning = {
  currentMonthStart: null,
  currentPlanoId: null,
  currentView: 'list', // 'list' | 'detail' | 'acompanhamento'
  detailScope: 'month', // 'month' | 'full'
  acompScope: 'month', // 'month' | 'full'
  timelineYear: null,
  listStatusFilter: 'all',
  listSearch: '',
  _lastDetailEval: null,
  _lastAcompEval: null,
  _chartCombinado: null,
  _chartDist: null,
  _chartEvo: null,

  _engine() {
    return App.planningEngine;
  },

  _isLightMode() {
    return document.body.classList.contains('light-mode');
  },

  _buildCardInvoiceContext(cards) {
    const cardsMap = {};
    (cards || []).forEach(c => { cardsMap[c.id] = c; });
    const getInvoiceDueFn = (card, dateStr) => {
      if (App.cardInvoice && typeof App.cardInvoice.getInvoicePeriodForDate === 'function') {
        const p = App.cardInvoice.getInvoicePeriodForDate(card, dateStr);
        return p && p.due ? p.due.slice(0, 10) : dateStr;
      }
      return dateStr;
    };
    return { cardsMap, getInvoiceDueFn };
  },

  async _loadCoreData() {
    const [planosRaw, budgets, transactions, categories, cards] = await Promise.all([
      App.db.getAll('planosOrcamentarios'),
      App.db.getAll('budgets'),
      App.db.getAll('transactions'),
      App.cache.categories ? Promise.resolve(App.cache.categories) : App.db.getAll('categories'),
      App.cache.creditCards ? Promise.resolve(App.cache.creditCards) : App.db.getAll('creditCards')
    ]);
    if (!App.cache.categories) App.cache.categories = categories;
    if (!App.cache.creditCards) App.cache.creditCards = cards;
    return { planosRaw, budgets, transactions, categories, cards };
  },

  async load() {
    if (!this.currentMonthStart) this.currentMonthStart = App.utils.currentMonth().startDate;
    await this.initPlanos();

    const activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'page-planning-detail') {
      this.currentView = 'detail';
      await this.renderPlanDetail();
    } else if (activePage && activePage.id === 'page-acompanhamento') {
      this.currentView = 'acompanhamento';
      await this.renderAcompanhamento();
    } else {
      this.currentView = 'list';
      await this.renderPlanList();
    }
  },

  async refreshIfActive() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;
    if (activePage.id === 'page-planning') {
      await this.renderPlanList();
    } else if (activePage.id === 'page-planning-detail') {
      await this.initPlanos();
      await this.renderPlanDetail();
    } else if (activePage.id === 'page-acompanhamento') {
      await this.initPlanos();
      await this.renderAcompanhamento();
    }
  },

  async initPlanos() {
    const eng = this._engine();
    const todayYm = eng.currentMonthKey();
    let planos = await App.db.getAll('planosOrcamentarios');

    if (planos.length === 0) {
      const year = parseInt(todayYm.slice(0, 4), 10);
      const monthNum = parseInt(todayYm.slice(5, 7), 10);
      const isFirstHalf = monthNum <= 6;
      const startMonth = isFirstHalf ? `${year}-01` : `${year}-07`;
      const endMonth = isFirstHalf ? `${year}-06` : `${year}-12`;
      const defaultPlano = {
        id: App.utils.generateId(),
        nome: isFirstHalf ? `Orçamento 1º Semestre ${year}` : `Orçamento 2º Semestre ${year}`,
        descricao: 'Planejamento financeiro principal do período.',
        startMonth,
        endMonth,
        vigencia_inicio: startMonth,
        vigencia_fim: endMonth,
        metaReceitaMensal: 0,
        metaEconomiaPct: 20,
        arquivado: false,
        criado_em: new Date().toISOString(),
        ativo: true
      };
      await App.db.put('planosOrcamentarios', defaultPlano);
      planos = [defaultPlano];
    } else {
      // Migra planos legados sem vigência explícita
      for (const p of planos) {
        if (!p.startMonth || !p.endMonth) {
          const inferred = eng.inferPlanPeriod(p, parseInt(todayYm.slice(0, 4), 10));
          p.startMonth = inferred.startMonth;
          p.endMonth = inferred.endMonth;
          p.vigencia_inicio = inferred.startMonth;
          p.vigencia_fim = inferred.endMonth;
          await App.db.put('planosOrcamentarios', p);
        }
      }
    }

    // Garante que budgets órfãos sejam vinculados a um plano válido
    const allBudgets = await App.db.getAll('budgets');
    const validIds = new Set(planos.map(p => p.id));
    const fallbackPlan = eng.findActivePlanForMonth(planos, todayYm) || planos[0];
    for (const b of allBudgets) {
      if (!b.plano_id || !validIds.has(b.plano_id)) {
        b.plano_id = fallbackPlan.id;
        await App.db.put('budgets', b);
      }
    }

    const savedActive = localStorage.getItem('plano_ativo_id');
    const activeFromStorage = savedActive ? planos.find(p => p.id === savedActive) : null;
    const activeByDate = eng.findActivePlanForMonth(planos, todayYm);

    if (this.currentPlanoId && validIds.has(this.currentPlanoId)) {
      // keep current selection
    } else if (activeFromStorage) {
      this.currentPlanoId = activeFromStorage.id;
    } else if (activeByDate) {
      this.currentPlanoId = activeByDate.id;
      localStorage.setItem('plano_ativo_id', this.currentPlanoId);
    } else {
      this.currentPlanoId = planos[0].id;
      localStorage.setItem('plano_ativo_id', this.currentPlanoId);
    }

    if (!this.currentMonthStart) {
      this.currentMonthStart = App.utils.currentMonth().startDate;
    }
    if (!this.timelineYear) {
      this.timelineYear = parseInt(todayYm.slice(0, 4), 10);
    }
  },

  /**
   * Dados resumidos do plano vigente para exibição na Visão Geral e Analytics.
   */
  async getDashboardWidgetData(monthStartISO) {
    const eng = this._engine();
    if (!eng) return null;
    const targetYm = eng.normalizeMonthKey(monthStartISO) || eng.currentMonthKey();
    const { planosRaw, budgets, transactions, categories, cards } = await this._loadCoreData();
    if (!planosRaw || planosRaw.length === 0) return null;

    const activePlan = eng.findActivePlanForMonth(planosRaw, targetYm);
    if (!activePlan) {
      return { hasActivePlan: false, targetYm, targetLabel: eng.formatMonthShort(targetYm), totalPlans: planosRaw.length };
    }

    const { cardsMap, getInvoiceDueFn } = this._buildCardInvoiceContext(cards);
    const evaluation = eng.computePlanEvaluation({
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

    return {
      hasActivePlan: true,
      targetYm,
      targetLabel: eng.formatMonthShort(targetYm),
      plan: evaluation.plan,
      evaluation,
      totalPlans: planosRaw.length
    };
  },

  // ==================== TELA 1: LISTA DE PLANOS & LINHA DO TEMPO ====================
  async renderPlanList() {
    const container = document.getElementById('planningContent');
    if (!container) return;

    await this.initPlanos();
    const eng = this._engine();
    const esc = (v) => App.utils.escapeHtml(v == null ? '' : String(v));
    const todayYm = eng.currentMonthKey();
    const { planosRaw, budgets, transactions, categories, cards } = await this._loadCoreData();
    const { cardsMap, getInvoiceDueFn } = this._buildCardInvoiceContext(cards);
    const memberId = App.state.globalMemberFilter || null;

    const sortedPlans = eng.sortPlansChronologically(planosRaw, todayYm);
    const activeNow = eng.findActivePlanForMonth(sortedPlans, todayYm);
    const overlaps = eng.detectPlanOverlaps(sortedPlans, todayYm);
    const availableYears = eng.getAvailableTimelineYears(sortedPlans, todayYm);
    if (!availableYears.includes(this.timelineYear)) {
      this.timelineYear = parseInt(todayYm.slice(0, 4), 10);
    }
    const timeline = eng.buildYearTimeline(sortedPlans, this.timelineYear, todayYm);

    // Avalia cada plano no período completo para exibir números reais nos cards
    const evalByPlanId = {};
    for (const p of sortedPlans) {
      evalByPlanId[p.id] = eng.computePlanEvaluation({
        plan: p,
        budgets,
        transactions,
        categories,
        scope: 'full',
        targetMonth: todayYm,
        memberId,
        cardsMap,
        getInvoiceDueFn,
        refDateOrMonth: todayYm
      });
    }

    // Atualiza botão de acompanhamento rápido no header
    const headerAcompBtn = document.getElementById('planListAcompanhamentoBtn');
    if (headerAcompBtn) {
      headerAcompBtn.style.display = (activeNow || sortedPlans.length > 0) ? '' : 'none';
    }

    // 1. Banner do Plano em Vigor Hoje
    let heroHtml = '';
    if (activeNow) {
      const monthEval = eng.computePlanEvaluation({
        plan: activeNow,
        budgets,
        transactions,
        categories,
        scope: 'month',
        targetMonth: todayYm,
        memberId,
        cardsMap,
        getInvoiceDueFn,
        refDateOrMonth: todayYm
      });
      const fullEval = evalByPlanId[activeNow.id];
      const pctMonth = monthEval.totalPlannedExpenses > 0 ? Math.min(monthEval.expensePct, 100) : 0;
      const overMonth = monthEval.totalPlannedExpenses > 0 && monthEval.totalRealizedExpenses > monthEval.totalPlannedExpenses;

      heroHtml = `
        <div class="plan-hero-card">
          <div class="plan-hero-main">
            <div class="plan-hero-eyebrow">
              <span class="plan-status-dot tone-active"></span>
              <span>Plano em vigor em <strong>${esc(eng.formatMonthShort(todayYm))}</strong></span>
              <span class="plan-hero-sep">•</span>
              <span>Vigência: <strong>${esc(activeNow.periodLabel)}</strong> (${activeNow.durationMonths} ${activeNow.durationMonths === 1 ? 'mês' : 'meses'})</span>
            </div>
            <h2 class="plan-hero-title">${esc(activeNow.nome)}</h2>
            ${activeNow.descricao ? `<p class="plan-hero-desc">${esc(activeNow.descricao)}</p>` : ''}
            <div class="plan-hero-actions">
              <button type="button" class="btn btn-primary btn-sm" onclick="App.planning.openPlan('${esc(activeNow.id)}')">📋 Abrir Orçamento</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="App.planning.openAcompanhamentoForPlan('${esc(activeNow.id)}')">📊 Acompanhamento</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.planning.openPlanModal('${esc(activeNow.id)}')">✏️ Editar Vigência</button>
            </div>
          </div>
          <div class="plan-hero-metrics">
            <div class="plan-hero-metric">
              <span class="plan-metric-label">Mês atual (${esc(eng.formatMonthShort(todayYm))})</span>
              <div class="plan-metric-values tabular-nums">
                <strong>${App.utils.formatCurrency(monthEval.totalRealizedExpenses)}</strong>
                <span class="plan-metric-of">de ${App.utils.formatCurrency(monthEval.totalPlannedExpenses)}</span>
              </div>
              <div class="plan-status-bar"><div class="plan-status-fill ${overMonth ? 'over' : ''}" style="width:${pctMonth}%"></div></div>
              <span class="plan-metric-sub ${overMonth ? 'planning-over' : 'planning-ok'}">
                ${monthEval.totalPlannedExpenses > 0
                  ? (overMonth ? `Estouro de ${App.utils.formatCurrency(Math.abs(monthEval.expenseDiff))}` : `Restam ${App.utils.formatCurrency(monthEval.expenseDiff)} (${monthEval.expensePct}%)`)
                  : 'Defina os valores por categoria'}
              </span>
            </div>
            <div class="plan-hero-metric">
              <span class="plan-metric-label">Acumulado na vigência (${esc(activeNow.periodLabel)})</span>
              <div class="plan-metric-values tabular-nums">
                <strong>${App.utils.formatCurrency(fullEval.totalRealizedExpenses)}</strong>
                <span class="plan-metric-of">de ${App.utils.formatCurrency(fullEval.totalPlannedExpenses)}</span>
              </div>
              <div class="plan-status-bar"><div class="plan-status-fill ${fullEval.expensePct > 100 ? 'over' : ''}" style="width:${Math.min(fullEval.expensePct, 100)}%"></div></div>
              <span class="plan-metric-sub">
                Receitas no período: <strong class="tabular-nums">${App.utils.formatCurrency(fullEval.realizedIncome)}</strong>
                ${fullEval.overBudgetCategories.length > 0 ? ` • <span class="planning-over">${fullEval.overBudgetCategories.length} estourada(s)</span>` : ''}
              </span>
            </div>
          </div>
        </div>
      `;
    } else {
      heroHtml = `
        <div class="plan-hero-card plan-hero-empty">
          <div class="plan-hero-main">
            <div class="plan-hero-eyebrow">
              <span class="plan-status-dot tone-warning"></span>
              <span>Sem plano em vigor para <strong>${esc(eng.formatMonthShort(todayYm))}</strong></span>
            </div>
            <h2 class="plan-hero-title">Nenhum planejamento cobre o mês atual</h2>
            <p class="plan-hero-desc">Crie um plano financeiro definindo o período de vigência (ex.: Jan/${todayYm.slice(0,4)} a Dez/${todayYm.slice(0,4)}) para acompanhar suas despesas e metas em tempo real.</p>
          </div>
          <div class="plan-hero-actions">
            <button type="button" class="btn btn-primary btn-sm" onclick="App.planning.openPlanModal()">+ Criar Plano para ${esc(todayYm.slice(0,4))}</button>
          </div>
        </div>
      `;
    }

    // 2. Linha do Tempo Anual de Vigência (visão instantânea de qual plano valeu em cada mês)
    const yearButtonsHtml = availableYears.map(y => `
      <button type="button" class="plan-year-btn ${y === this.timelineYear ? 'active' : ''}" onclick="App.planning.setTimelineYear(${y})">${y}</button>
    `).join('');

    const monthHeaderCells = timeline.months.map(m => `
      <div class="plan-tl-month-head ${m.isCurrentMonth ? 'is-now' : ''} ${m.hasGap ? 'is-gap' : ''} ${m.hasOverlap ? 'is-overlap' : ''}"
           title="${m.primaryPlan ? `${m.shortLabel}/${timeline.year}: ${esc(m.primaryPlan.nome)}` : `${m.shortLabel}/${timeline.year}: Sem plano cadastrado`}">
        <span>${m.shortLabel}</span>
        ${m.isCurrentMonth ? '<i class="plan-tl-now-dot" title="Mês atual"></i>' : ''}
      </div>
    `).join('');

    let timelineBarsHtml = '';
    if (timeline.bars.length === 0) {
      timelineBarsHtml = `
        <div class="plan-tl-empty">
          Nenhum plano financeiro cobre meses de ${timeline.year}.
          <button type="button" class="plan-crumb-link" onclick="App.planning.openPlanModal(null, ${timeline.year})">Criar plano para ${timeline.year}</button>
        </div>
      `;
    } else {
      timelineBarsHtml = timeline.bars.map(bar => {
        const p = bar.plan;
        const ev = evalByPlanId[p.id];
        const tone = p.statusTone;
        const leftPct = ((bar.startCol - 1) / 12) * 100;
        const widthPct = (bar.spanCols / 12) * 100;
        const execLabel = ev && ev.totalPlannedExpenses > 0 ? `${ev.expensePct}%` : 'Sem metas';
        return `
          <div class="plan-tl-track">
            <button type="button"
              class="plan-tl-bar tone-${tone} ${bar.clippedLeft ? 'clipped-left' : ''} ${bar.clippedRight ? 'clipped-right' : ''}"
              style="left:${leftPct.toFixed(4)}%; width:${widthPct.toFixed(4)}%;"
              onclick="App.planning.openPlan('${esc(p.id)}')"
              title="${esc(p.nome)} (${esc(p.periodLabel)}) — ${esc(p.statusLabel)}">
              <span class="plan-tl-bar-name">${esc(p.nome)}</span>
              <span class="plan-tl-bar-period">${esc(p.periodLabel)} • ${esc(p.statusLabel)} (${execLabel})</span>
            </button>
          </div>
        `;
      }).join('');
    }

    const overlapWarningHtml = overlaps.length > 0 ? `
      <div class="plan-alert-strip tone-warning">
        <span>⚠️ <strong>Sobreposição de vigência detectada:</strong> ${overlaps.map(o =>
          `“${esc(o.planA.nome)}” e “${esc(o.planB.nome)}” cobrem <strong>${esc(o.label)}</strong>`
        ).join('; ')}. Ajuste as datas ou arquive o plano anterior.</span>
      </div>
    ` : '';

    const timelineHtml = `
      <div class="card plan-timeline-card">
        <div class="plan-timeline-head">
          <div>
            <h3>🗓️ Linha do Tempo de Vigência — ${timeline.year}</h3>
            <div class="plan-timeline-sub">
              ${timeline.coveredMonthsCount}/12 meses cobertos em ${timeline.year}
              ${timeline.gapMonthsCount > 0 ? ` • ${timeline.gapMonthsCount} mês(es) sem plano` : ' • Ano totalmente planejado'}
              ${timeline.overlapMonthsCount > 0 ? ` • <span class="planning-warning">${timeline.overlapMonthsCount} mês(es) com sobreposição</span>` : ''}
            </div>
          </div>
          <div class="plan-year-switcher">
            <button type="button" class="btn btn-outline btn-sm" onclick="App.planning.setTimelineYear(${this.timelineYear - 1})" title="Ano anterior">◀</button>
            ${yearButtonsHtml}
            <button type="button" class="btn btn-outline btn-sm" onclick="App.planning.setTimelineYear(${this.timelineYear + 1})" title="Próximo ano">▶</button>
          </div>
        </div>
        <div class="plan-tl-grid">
          <div class="plan-tl-months">${monthHeaderCells}</div>
          <div class="plan-tl-rows">${timelineBarsHtml}</div>
        </div>
        ${overlapWarningHtml}
      </div>
    `;

    // 3. Filtros + Grade de Planos Financeiros
    const counts = {
      all: sortedPlans.length,
      em_vigor: sortedPlans.filter(p => p.status === 'em_vigor').length,
      agendado: sortedPlans.filter(p => p.status === 'agendado').length,
      encerrado: sortedPlans.filter(p => p.status === 'encerrado').length,
      arquivado: sortedPlans.filter(p => p.status === 'arquivado').length
    };

    const q = (this.listSearch || '').trim().toLowerCase();
    const filteredPlans = sortedPlans.filter(p => {
      if (this.listStatusFilter !== 'all' && p.status !== this.listStatusFilter) return false;
      if (q && !(`${p.nome} ${p.periodLabel} ${p.descricao}`.toLowerCase().includes(q))) return false;
      return true;
    });

    const filterTabs = [
      { id: 'all', label: `Todos (${counts.all})` },
      { id: 'em_vigor', label: `Em vigor (${counts.em_vigor})` },
      { id: 'agendado', label: `Agendados (${counts.agendado})` },
      { id: 'encerrado', label: `Encerrados (${counts.encerrado})` },
      { id: 'arquivado', label: `Arquivados (${counts.arquivado})` }
    ].map(tab => `
      <button type="button" class="plan-filter-tab ${this.listStatusFilter === tab.id ? 'active' : ''}" onclick="App.planning.setListStatusFilter('${tab.id}')">${tab.label}</button>
    `).join('');

    let cardsHtml = '';
    if (filteredPlans.length === 0) {
      cardsHtml = `
        <div class="card plan-empty-list">
          <p>Nenhum plano financeiro encontrado com os filtros selecionados.</p>
          <button type="button" class="btn btn-primary btn-sm" onclick="App.planning.openPlanModal()">+ Criar Novo Plano</button>
        </div>
      `;
    } else {
      cardsHtml = `<div class="plan-cards-grid">${filteredPlans.map(p => {
        const ev = evalByPlanId[p.id];
        const over = ev.totalPlannedExpenses > 0 && ev.totalRealizedExpenses > ev.totalPlannedExpenses;
        const barPct = ev.totalPlannedExpenses > 0 ? Math.min(ev.expensePct, 100) : 0;
        const isCurrent = activeNow && activeNow.id === p.id;
        return `
          <article class="card plan-card ${isCurrent ? 'is-current-plan' : ''} tone-${p.statusTone}">
            <div class="plan-card-top">
              <div class="plan-card-status">
                <span class="plan-status-dot tone-${p.statusTone}"></span>
                <span class="plan-status-text tone-${p.statusTone}">${esc(p.statusLabel)}</span>
                <span class="plan-card-duration">• ${p.durationMonths} ${p.durationMonths === 1 ? 'mês' : 'meses'}</span>
              </div>
              <div class="plan-card-quick-icons">
                <button type="button" class="icon-btn" onclick="App.planning.openPlanModal('${esc(p.id)}')" title="Editar plano">✏️</button>
                <button type="button" class="icon-btn" onclick="App.planning.duplicatePlan('${esc(p.id)}')" title="Duplicar plano">📋</button>
                <button type="button" class="icon-btn delete" onclick="App.planning.deletePlanById('${esc(p.id)}')" title="Excluir plano">🗑️</button>
              </div>
            </div>

            <div class="plan-card-body" onclick="App.planning.openPlan('${esc(p.id)}')">
              <h3 class="plan-card-name">${esc(p.nome)}</h3>
              <div class="plan-card-period">🗓️ Vigência: <strong>${esc(p.periodLabel)}</strong></div>
              ${p.descricao ? `<p class="plan-card-desc">${esc(p.descricao)}</p>` : ''}

              <div class="plan-card-stats">
                <div>
                  <span class="plan-stat-label">Orçado no período</span>
                  <strong class="plan-stat-val tabular-nums">${App.utils.formatCurrency(ev.totalPlannedExpenses)}</strong>
                </div>
                <div>
                  <span class="plan-stat-label">Realizado</span>
                  <strong class="plan-stat-val tabular-nums ${over ? 'planning-over' : ''}">${App.utils.formatCurrency(ev.totalRealizedExpenses)}</strong>
                </div>
                <div>
                  <span class="plan-stat-label">Receitas</span>
                  <strong class="plan-stat-val tabular-nums planning-ok">${App.utils.formatCurrency(ev.realizedIncome)}</strong>
                </div>
              </div>

              <div class="plan-card-progress">
                <div class="plan-card-progress-meta">
                  <span>${ev.budgetedCount} categoria(s) orçada(s)</span>
                  <span class="tabular-nums ${over ? 'planning-over' : ''}">${ev.totalPlannedExpenses > 0 ? `${ev.expensePct}% executado` : 'Orçamento em aberto'}</span>
                </div>
                <div class="plan-status-bar"><div class="plan-status-fill ${over ? 'over' : ''}" style="width:${barPct}%"></div></div>
              </div>
            </div>

            <div class="plan-card-footer">
              <button type="button" class="btn btn-outline btn-sm" onclick="App.planning.openPlan('${esc(p.id)}')">Abrir Orçamento</button>
              <button type="button" class="btn btn-primary btn-sm" onclick="App.planning.openAcompanhamentoForPlan('${esc(p.id)}')">📊 Acompanhamento</button>
            </div>
          </article>
        `;
      }).join('')}</div>`;
    }

    container.innerHTML = `
      ${heroHtml}
      ${timelineHtml}
      <div class="plan-list-toolbar">
        <div class="plan-filter-tabs">${filterTabs}</div>
        <input type="text" class="plan-search-input" id="planListSearchInput" value="${esc(this.listSearch)}" placeholder="Buscar plano por nome ou período..." oninput="App.planning.setListSearch(this.value)">
      </div>
      ${cardsHtml}
    `;
  },

  setTimelineYear(year) {
    this.timelineYear = parseInt(year, 10);
    this.renderPlanList();
  },

  setListStatusFilter(status) {
    this.listStatusFilter = status || 'all';
    this.renderPlanList();
  },

  setListSearch(value) {
    this.listSearch = value || '';
    this.renderPlanList();
    const input = document.getElementById('planListSearchInput');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  },

  async openPlan(planoId) {
    const eng = this._engine();
    const raw = await App.db.getById('planosOrcamentarios', planoId);
    if (!raw) return;
    const norm = eng.normalizePlan(raw);
    this.currentPlanoId = norm.id;
    localStorage.setItem('plano_ativo_id', norm.id);

    // Se o mês atual selecionado não estiver dentro da vigência do plano, ajusta automaticamente
    const curYm = eng.normalizeMonthKey(this.currentMonthStart);
    const todayYm = eng.currentMonthKey();
    if (!curYm || !norm.months.includes(curYm)) {
      const targetYm = norm.months.includes(todayYm) ? todayYm : norm.startMonth;
      this.currentMonthStart = eng.monthStartISO(targetYm);
    }

    this.currentView = 'detail';
    App.ui.navigateTo('planning-detail');
  },

  async openAcompanhamentoForPlan(planoId) {
    const eng = this._engine();
    const raw = await App.db.getById('planosOrcamentarios', planoId);
    if (!raw) return;
    const norm = eng.normalizePlan(raw);
    this.currentPlanoId = norm.id;
    localStorage.setItem('plano_ativo_id', norm.id);

    const todayYm = eng.currentMonthKey();
    const curYm = eng.normalizeMonthKey(this.currentMonthStart);
    if (!curYm || !norm.months.includes(curYm)) {
      const targetYm = norm.months.includes(todayYm) ? todayYm : norm.startMonth;
      this.currentMonthStart = eng.monthStartISO(targetYm);
    }

    // Se o plano estiver encerrado ou agendado, abre por padrão no Acumulado do Plano
    this.acompScope = norm.status === 'em_vigor' ? 'month' : 'full';
    this.currentView = 'acompanhamento';
    App.ui.navigateTo('acompanhamento');
  },

  async openActiveAcompanhamento() {
    await this.initPlanos();
    const eng = this._engine();
    const planos = await App.db.getAll('planosOrcamentarios');
    const active = eng.findActivePlanForMonth(planos, eng.currentMonthKey()) || planos[0];
    if (!active) {
      App.utils.showToast('Crie um plano financeiro primeiro.', 'error');
      return;
    }
    await this.openAcompanhamentoForPlan(active.id);
  },

  async switchPlan(planoId, stayInAcomp = false) {
    if (!planoId) return;
    if (stayInAcomp) {
      await this.openAcompanhamentoForPlan(planoId);
    } else {
      await this.openPlan(planoId);
    }
  },

  async backToList() {
    this._destroyCharts();
    this.currentView = 'list';
    App.ui.navigateTo('planning');
  },

  // ==================== MODAL CRIAR / EDITAR PLANO ====================
  async openPlanModal(planoId = null, defaultYear = null) {
    const eng = this._engine();
    const planos = await App.db.getAll('planosOrcamentarios');
    const esc = (v) => App.utils.escapeHtml(v == null ? '' : String(v));

    const idEl = document.getElementById('planoFormId');
    const titleEl = document.getElementById('modalPlanoTitle');
    const nomeEl = document.getElementById('planoFormNome');
    const startEl = document.getElementById('planoFormStart');
    const endEl = document.getElementById('planoFormEnd');
    const recEl = document.getElementById('planoFormMetaReceita');
    const ecoEl = document.getElementById('planoFormMetaEconomia');
    const descEl = document.getElementById('planoFormDescricao');
    const arqEl = document.getElementById('planoFormArquivado');
    const seedGroup = document.getElementById('planoFormSeedGroup');
    const copyGroup = document.getElementById('planoFormCopySourceGroup');
    const seedModeEl = document.getElementById('planoFormSeedMode');
    const copySourceEl = document.getElementById('planoFormCopySource');

    if (copySourceEl) {
      copySourceEl.innerHTML = planos.map(p => {
        const np = eng.normalizePlan(p);
        return `<option value="${esc(np.id)}">${esc(np.nome)} (${esc(np.periodLabel)})</option>`;
      }).join('');
    }

    if (planoId) {
      const raw = planos.find(p => p.id === planoId);
      if (!raw) return;
      const np = eng.normalizePlan(raw);
      idEl.value = np.id;
      titleEl.textContent = 'Editar Plano Financeiro';
      nomeEl.value = np.nome;
      startEl.value = np.startMonth;
      endEl.value = np.endMonth;
      recEl.value = np.metaReceitaMensal || '';
      ecoEl.value = np.metaEconomiaPct || '';
      descEl.value = np.descricao || '';
      arqEl.checked = Boolean(np.arquivado);
      if (seedGroup) seedGroup.style.display = 'none';
      if (copyGroup) copyGroup.style.display = 'none';
    } else {
      const year = defaultYear || parseInt(eng.currentMonthKey().slice(0, 4), 10);
      idEl.value = '';
      titleEl.textContent = 'Novo Plano Financeiro';
      nomeEl.value = `Planejamento Financeiro ${year}`;
      startEl.value = `${year}-01`;
      endEl.value = `${year}-12`;
      recEl.value = '';
      ecoEl.value = '20';
      descEl.value = '';
      arqEl.checked = false;
      if (seedGroup) seedGroup.style.display = '';
      if (seedModeEl) seedModeEl.value = 'empty';
      if (copyGroup) copyGroup.style.display = 'none';
    }

    this.updateModalPeriodPreview();
    App.ui.openModal('modalPlanoOrcamentario');
  },

  toggleModalSeedSource() {
    const mode = document.getElementById('planoFormSeedMode')?.value;
    const copyGroup = document.getElementById('planoFormCopySourceGroup');
    if (copyGroup) {
      copyGroup.style.display = mode === 'copy' ? '' : 'none';
    }
  },

  updateModalPeriodPreview() {
    const eng = this._engine();
    const startVal = document.getElementById('planoFormStart')?.value;
    const endVal = document.getElementById('planoFormEnd')?.value;
    const previewEl = document.getElementById('planoFormPeriodPreview');
    if (!previewEl) return;

    if (!startVal || !endVal) {
      previewEl.innerHTML = '';
      return;
    }
    if (startVal > endVal) {
      previewEl.innerHTML = `<span class="planning-over">⚠️ O mês final deve ser igual ou posterior ao mês inicial.</span>`;
      return;
    }
    const months = eng.enumerateMonths(startVal, endVal);
    const status = eng.computePlanStatus({ startMonth: startVal, endMonth: endVal }, eng.currentMonthKey());
    const meta = eng.statusMeta(status);
    previewEl.innerHTML = `
      <span>Vigência: <strong>${eng.formatPeriodLabel(startVal, endVal)}</strong> (${months.length} ${months.length === 1 ? 'mês' : 'meses'})</span>
      <span>•</span>
      <span class="plan-status-text tone-${meta.tone}">${meta.label}</span>
    `;
  },

  async savePlanModal(event) {
    if (event) event.preventDefault();
    const eng = this._engine();

    const id = document.getElementById('planoFormId')?.value || '';
    const nome = (document.getElementById('planoFormNome')?.value || '').trim();
    const startMonth = document.getElementById('planoFormStart')?.value;
    const endMonth = document.getElementById('planoFormEnd')?.value;
    const metaReceitaMensal = Math.max(0, parseFloat(document.getElementById('planoFormMetaReceita')?.value) || 0);
    const metaEconomiaPct = Math.max(0, Math.min(100, parseFloat(document.getElementById('planoFormMetaEconomia')?.value) || 0));
    const descricao = (document.getElementById('planoFormDescricao')?.value || '').trim();
    const arquivado = Boolean(document.getElementById('planoFormArquivado')?.checked);
    const seedMode = document.getElementById('planoFormSeedMode')?.value || 'empty';
    const copySourceId = document.getElementById('planoFormCopySource')?.value || '';

    if (!nome) {
      App.utils.showToast('Informe o nome do plano.', 'error');
      return false;
    }
    if (!startMonth || !endMonth || startMonth > endMonth) {
      App.utils.showToast('Período de vigência inválido.', 'error');
      return false;
    }

    const existing = id ? await App.db.getById('planosOrcamentarios', id) : null;
    const record = {
      ...(existing || {}),
      id: existing ? existing.id : App.utils.generateId(),
      nome,
      descricao,
      startMonth,
      endMonth,
      vigencia_inicio: startMonth,
      vigencia_fim: endMonth,
      metaReceitaMensal,
      metaEconomiaPct,
      arquivado,
      ativo: !arquivado && eng.computePlanStatus({ startMonth, endMonth }, eng.currentMonthKey()) === 'em_vigor',
      criado_em: existing?.criado_em || new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    };

    await App.db.put('planosOrcamentarios', record);

    // Preenchimento inicial de categorias ao criar novo plano
    if (!existing && seedMode !== 'empty') {
      const targetMonths = eng.enumerateMonths(startMonth, endMonth);
      let baseCategoryAmounts = {};

      if (seedMode === 'average') {
        const { transactions, categories, cards } = await this._loadCoreData();
        const { cardsMap, getInvoiceDueFn } = this._buildCardInvoiceContext(cards);
        const avgResult = eng.computeCategoryAverages({
          transactions,
          categories,
          beforeMonth: eng.currentMonthKey(),
          lookbackMonths: 3,
          memberId: App.state.globalMemberFilter || null,
          cardsMap,
          getInvoiceDueFn
        });
        baseCategoryAmounts = avgResult.averages;
      } else if (seedMode === 'copy' && copySourceId) {
        const allBudgets = await App.db.getAll('budgets');
        const sourceBudgets = allBudgets.filter(b => b.plano_id === copySourceId);
        // Usa o mês mais recente com orçamentos no plano de origem como referência
        const monthsFound = Array.from(new Set(sourceBudgets.map(b => eng.normalizeMonthKey(b.cycle_start)).filter(Boolean))).sort();
        const refYm = monthsFound[monthsFound.length - 1];
        if (refYm) {
          const map = eng.getMonthBudgetsMap(sourceBudgets, copySourceId, refYm);
          for (const [cat, bud] of Object.entries(map)) {
            baseCategoryAmounts[cat] = bud.amount;
          }
        }
      }

      const toInsert = [];
      for (const ym of targetMonths) {
        const bounds = eng.monthBounds(ym);
        for (const [category, amount] of Object.entries(baseCategoryAmounts)) {
          if (amount > 0) {
            toInsert.push({
              id: App.utils.generateId(),
              category,
              amount,
              cycle_start: bounds.start,
              cycle_end: bounds.end,
              plano_id: record.id
            });
          }
        }
      }
      if (toInsert.length > 0) {
        await App.db.putMany('budgets', toInsert);
      }
    }

    this.currentPlanoId = record.id;
    localStorage.setItem('plano_ativo_id', record.id);
    this.timelineYear = parseInt(startMonth.slice(0, 4), 10);

    App.ui.closeModal('modalPlanoOrcamentario');
    App.utils.showToast(existing ? `Plano "${nome}" atualizado!` : `Plano "${nome}" criado (${eng.formatPeriodLabel(startMonth, endMonth)})!`);

    if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
    await this.load();
    return false;
  },

  async duplicatePlan(planoId) {
    const eng = this._engine();
    const raw = await App.db.getById('planosOrcamentarios', planoId);
    if (!raw) return;
    const np = eng.normalizePlan(raw);
    const nextStart = eng.addMonthsToKey(np.endMonth, 1);
    const nextEnd = eng.addMonthsToKey(nextStart, Math.max(0, np.durationMonths - 1));

    const copy = {
      id: App.utils.generateId(),
      nome: `${np.nome} (Cópia)`,
      descricao: np.descricao || '',
      startMonth: nextStart,
      endMonth: nextEnd,
      vigencia_inicio: nextStart,
      vigencia_fim: nextEnd,
      metaReceitaMensal: np.metaReceitaMensal,
      metaEconomiaPct: np.metaEconomiaPct,
      arquivado: false,
      ativo: false,
      criado_em: new Date().toISOString()
    };

    await App.db.put('planosOrcamentarios', copy);

    // Replica os valores do último mês preenchido do plano original para todos os meses do novo plano
    const allBudgets = await App.db.getAll('budgets');
    const sourceBudgets = allBudgets.filter(b => b.plano_id === np.id);
    const monthsFound = Array.from(new Set(sourceBudgets.map(b => eng.normalizeMonthKey(b.cycle_start)).filter(Boolean))).sort();
    const refYm = monthsFound[monthsFound.length - 1];
    if (refYm) {
      const refMap = eng.getMonthBudgetsMap(sourceBudgets, np.id, refYm);
      const newMonths = eng.enumerateMonths(nextStart, nextEnd);
      const toInsert = [];
      for (const ym of newMonths) {
        const bounds = eng.monthBounds(ym);
        for (const [category, bud] of Object.entries(refMap)) {
          toInsert.push({
            id: App.utils.generateId(),
            category,
            amount: bud.amount,
            cycle_start: bounds.start,
            cycle_end: bounds.end,
            plano_id: copy.id
          });
        }
      }
      if (toInsert.length > 0) await App.db.putMany('budgets', toInsert);
    }

    this.timelineYear = parseInt(nextStart.slice(0, 4), 10);
    App.utils.showToast(`Plano duplicado para ${eng.formatPeriodLabel(nextStart, nextEnd)}!`);
    await this.renderPlanList();
    if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
  },

  async deletePlanById(planoId) {
    const planos = await App.db.getAll('planosOrcamentarios');
    if (planos.length <= 1) {
      App.utils.showToast('Mantenha ao menos um plano orçamentário cadastrado.', 'error');
      return;
    }
    const plano = planos.find(p => p.id === planoId);
    if (!plano) return;

    App.utils.confirm(`Excluir o plano "${plano.nome}" e todos os orçamentos vinculados a ele?`, async () => {
      const budgets = await App.db.getAll('budgets');
      for (const b of budgets.filter(b => b.plano_id === plano.id)) {
        await App.db.delete('budgets', b.id);
      }
      await App.db.delete('planosOrcamentarios', plano.id);

      if (this.currentPlanoId === plano.id) {
        const remaining = planos.filter(p => p.id !== plano.id);
        this.currentPlanoId = remaining[0]?.id || null;
        if (this.currentPlanoId) localStorage.setItem('plano_ativo_id', this.currentPlanoId);
      }
      App.utils.showToast(`Plano "${plano.nome}" excluído.`);
      await this.renderPlanList();
      if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
    });
  },

  // Mantém aliases retrocompatíveis
  async criarPlano() { return this.openPlanModal(); },
  async excluirPlano() {
    if (this.currentPlanoId) return this.deletePlanById(this.currentPlanoId);
  },

  // ==================== TELA 2: DETALHE DO PLANO / ORÇAMENTO ====================
  setDetailScope(scope) {
    this.detailScope = scope === 'full' ? 'full' : 'month';
    this.renderPlanDetail();
  },

  async renderPlanDetail() {
    await this.initPlanos();
    const eng = this._engine();
    const esc = (v) => App.utils.escapeHtml(v == null ? '' : String(v));
    const todayYm = eng.currentMonthKey();

    const { planosRaw, budgets, transactions, categories, cards } = await this._loadCoreData();
    const rawPlano = planosRaw.find(p => p.id === this.currentPlanoId) || planosRaw[0];
    if (!rawPlano) {
      this.backToList();
      return;
    }
    this.currentPlanoId = rawPlano.id;
    const plano = eng.normalizePlan(rawPlano, todayYm);

    // Cabeçalho & Plan Switcher
    const titleEl = document.getElementById('planDetailTitle');
    const crumbEl = document.getElementById('planDetailBreadcrumbName');
    const vigEl = document.getElementById('planDetailVigenciaMeta');
    const switcherEl = document.getElementById('planDetailPlanSwitcher');

    if (titleEl) titleEl.textContent = plano.nome;
    if (crumbEl) crumbEl.textContent = plano.nome;
    if (vigEl) {
      vigEl.innerHTML = `<span class="plan-status-dot tone-${plano.statusTone}"></span> <span>${esc(plano.statusLabel)}</span> <span>•</span> <strong>${esc(plano.periodLabel)}</strong>`;
    }
    if (switcherEl) {
      const sorted = eng.sortPlansChronologically(planosRaw, todayYm);
      switcherEl.innerHTML = sorted.map(p =>
        `<option value="${esc(p.id)}" ${p.id === plano.id ? 'selected' : ''}>${esc(p.nome)} (${esc(p.periodLabel)})</option>`
      ).join('');
    }

    // Controles de escopo e mês
    const monthBtn = document.getElementById('planScopeMonthBtn');
    const fullBtn = document.getElementById('planScopeFullBtn');
    const monthCtrls = document.getElementById('planDetailMonthControls');
    const quickForm = document.getElementById('planDetailQuickForm');
    if (monthBtn) monthBtn.classList.toggle('active', this.detailScope === 'month');
    if (fullBtn) fullBtn.classList.toggle('active', this.detailScope === 'full');
    if (monthCtrls) monthCtrls.style.display = this.detailScope === 'month' ? 'flex' : 'none';
    if (quickForm) quickForm.style.display = this.detailScope === 'month' ? '' : 'none';

    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || todayYm;
    const cycleLabelEl = document.getElementById('planDetailCycleLabel');
    const monthPickerEl = document.getElementById('planDetailMonthPicker');
    const formHintEl = document.getElementById('planDetailFormHint');

    if (cycleLabelEl) cycleLabelEl.textContent = eng.formatMonthLong(targetYm);
    if (monthPickerEl) monthPickerEl.value = targetYm;
    if (formHintEl) formHintEl.textContent = `• ${eng.formatMonthShort(targetYm)}`;

    // Avalia plano com dados reais
    const { cardsMap, getInvoiceDueFn } = this._buildCardInvoiceContext(cards);
    const evaluation = eng.computePlanEvaluation({
      plan: plano,
      budgets,
      transactions,
      categories,
      scope: this.detailScope,
      targetMonth: targetYm,
      memberId: App.state.globalMemberFilter || null,
      cardsMap,
      getInvoiceDueFn,
      refDateOrMonth: todayYm
    });
    this._lastDetailEval = evaluation;

    // Faixa rápida dos meses de vigência do plano
    const stripEl = document.getElementById('planDetailMonthStrip');
    if (stripEl) {
      stripEl.innerHTML = evaluation.monthlySeries.map(ms => {
        const isSelected = this.detailScope === 'month' && ms.ym === targetYm;
        const isNow = ms.ym === todayYm;
        const over = ms.planned > 0 && ms.realized > ms.planned;
        return `
          <button type="button"
            class="plan-month-chip ${isSelected ? 'active' : ''} ${ms.hasBudget ? 'has-budget' : ''} ${over ? 'is-over' : ''} ${isNow ? 'is-now' : ''}"
            onclick="App.planning.selectPlanMonth('${ms.ym}')"
            title="${ms.label}: Orçado ${App.utils.formatCurrency(ms.planned)} | Realizado ${App.utils.formatCurrency(ms.realized)}">
            <span>${ms.label}</span>
            <small class="tabular-nums">${ms.hasBudget ? `${ms.adherencePct}%` : '—'}</small>
          </button>
        `;
      }).join('');
    }

    // Banner contextual (fora da vigência ou sugestão do mês anterior)
    const bannerEl = document.getElementById('planDetailBanner');
    if (bannerEl) {
      const alerts = [];
      if (this.detailScope === 'month' && !plano.months.includes(targetYm)) {
        alerts.push(`
          <div class="plan-alert-strip tone-warning">
            <span>⚠️ O mês selecionado (<strong>${esc(eng.formatMonthShort(targetYm))}</strong>) está fora da vigência deste plano (<strong>${esc(plano.periodLabel)}</strong>).</span>
            <button type="button" class="btn btn-outline btn-sm" onclick="App.planning.selectPlanMonth('${plano.months.includes(todayYm) ? todayYm : plano.startMonth}')">Ir para a vigência</button>
          </div>
        `);
      }
      if (evaluation.usingFallbackBudgets && evaluation.fallbackSourceMonth) {
        alerts.push(`
          <div class="plan-alert-strip tone-info">
            <span>💡 Exibindo referência de <strong>${esc(eng.formatMonthShort(evaluation.fallbackSourceMonth))}</strong> pois ${esc(eng.formatMonthShort(targetYm))} ainda não possui orçamentos salvos.</span>
            <button type="button" class="btn btn-primary btn-sm" onclick="App.planning.copyPrevious()">📋 Salvar cópia para ${esc(eng.formatMonthShort(targetYm))}</button>
          </div>
        `);
      }
      bannerEl.innerHTML = alerts.join('');
    }

    // KPIs de resumo
    const summaryEl = document.getElementById('planDetailSummary');
    if (summaryEl) {
      const over = evaluation.totalPlannedExpenses > 0 && evaluation.totalRealizedExpenses > evaluation.totalPlannedExpenses;
      const incMetaLabel = evaluation.plannedIncome > 0
        ? `Meta: ${App.utils.formatCurrency(evaluation.plannedIncome)}`
        : 'Defina a meta de receita no plano';
      const savingsClass = evaluation.realizedSavings >= 0 ? 'planning-ok' : 'planning-over';

      summaryEl.innerHTML = `
        <div class="card plan-kpi-card">
          <div class="card-label">Orçamento de Despesas (${esc(evaluation.scopeLabel)})</div>
          <div class="card-value tabular-nums">${App.utils.formatCurrency(evaluation.totalPlannedExpenses)}</div>
          <div class="card-sub">${evaluation.budgetedCount} categoria(s) planejada(s)</div>
        </div>
        <div class="card plan-kpi-card">
          <div class="card-label">Despesas Realizadas</div>
          <div class="card-value tabular-nums ${over ? 'planning-over' : ''}">${App.utils.formatCurrency(evaluation.totalRealizedExpenses)}</div>
          <div class="card-sub">${evaluation.totalPlannedExpenses > 0 ? `${evaluation.expensePct}% do orçamento consumido` : 'Aguardando orçamento'}</div>
        </div>
        <div class="card plan-kpi-card">
          <div class="card-label">Saldo do Orçamento</div>
          <div class="card-value tabular-nums ${evaluation.expenseDiff >= 0 ? 'planning-ok' : 'planning-over'}">${evaluation.expenseDiff >= 0 ? App.utils.formatCurrency(evaluation.expenseDiff) : '-' + App.utils.formatCurrency(Math.abs(evaluation.expenseDiff))}</div>
          <div class="card-sub">${evaluation.overBudgetCategories.length > 0 ? `${evaluation.overBudgetCategories.length} categoria(s) estourada(s)` : 'Nenhuma categoria estourada'}</div>
        </div>
        <div class="card plan-kpi-card">
          <div class="card-label">Receitas & Economia Real</div>
          <div class="card-value tabular-nums ${savingsClass}">${App.utils.formatCurrency(evaluation.realizedSavings)}</div>
          <div class="card-sub">Receita: <strong class="tabular-nums">${App.utils.formatCurrency(evaluation.realizedIncome)}</strong> (${incMetaLabel})</div>
        </div>
      `;
    }

    // Popula select de categorias do formulário
    const catSelect = document.getElementById('planDetailCategory');
    if (catSelect) {
      const catLookup = eng.buildCategoryLookup(categories);
      catSelect.innerHTML = catLookup.topLevelCategories
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`)
        .join('');
    }

    this.filterDetailTable();
  },

  filterDetailTable() {
    const tbody = document.getElementById('planDetailTableBody');
    const evaluation = this._lastDetailEval;
    if (!tbody || !evaluation) return;

    const esc = (v) => App.utils.escapeHtml(v == null ? '' : String(v));
    const q = (document.getElementById('planDetailSearch')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('planDetailStatusFilter')?.value || 'all';

    const rows = evaluation.categories.filter(row => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (statusFilter === 'budgeted' && row.planned <= 0) return false;
      if (statusFilter === 'attention' && row.status !== 'over' && row.status !== 'warning') return false;
      if (statusFilter === 'unplanned' && row.status !== 'unplanned') return false;
      return true;
    });

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--text-muted);">Nenhuma categoria encontrada para o filtro atual.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const safeName = esc(row.name).replace(/'/g, '&#39;');
      const statusClass = row.status === 'over' ? 'planning-over'
        : row.status === 'warning' || row.status === 'unplanned' ? 'planning-warning'
        : row.status === 'ok' ? 'planning-ok' : '';
      const barWidth = typeof row.pct === 'number' ? Math.min(row.pct, 100) : (row.realized > 0 ? 100 : 0);
      const barClass = row.status === 'over' || row.status === 'unplanned' ? 'over' : (row.status === 'warning' ? 'warning' : '');
      const diffText = row.planned > 0
        ? (row.diff >= 0 ? `Restam ${App.utils.formatCurrency(row.diff)}` : `Estouro de ${App.utils.formatCurrency(Math.abs(row.diff))}`)
        : (row.realized > 0 ? `-${App.utils.formatCurrency(row.realized)}` : '—');
      const pctText = typeof row.pct === 'number' ? `${row.pct}%` : (row.realized > 0 ? 'Sem meta' : '0%');

      const actionBtns = this.detailScope === 'month' ? `
        <button type="button" class="icon-btn" onclick="App.planning.addBudgetForCategory('${safeName}')" title="Definir ou editar valor planejado">✏️</button>
        <button type="button" class="icon-btn" onclick="App.planning.openCategoryTransactions('${safeName}', 'detail')" title="Ver lançamentos reais (${row.txCount})">🔍</button>
        ${row.categoryId ? `<button type="button" class="icon-btn" onclick="App.planning.editCategoryColor('${esc(row.categoryId)}', event)" title="Alterar cor da categoria">🎨</button>` : ''}
        ${row.planned > 0 && !evaluation.usingFallbackBudgets ? `<button type="button" class="icon-btn delete" onclick="App.planning.removeBudgetForCategory('${safeName}')" title="Remover orçamento desta categoria no mês">🗑️</button>` : ''}
      ` : `
        <button type="button" class="icon-btn" onclick="App.planning.openCategoryTransactions('${safeName}', 'detail')" title="Ver lançamentos reais (${row.txCount})">🔍</button>
      `;

      return `
        <tr>
          <td>
            <button type="button" class="plan-cat-btn" onclick="App.planning.openCategoryTransactions('${safeName}', 'detail')">
              <span class="plan-cat-swatch" style="background:${esc(row.color)};"></span>
              <span>${esc(row.name)}</span>
              ${row.txCount > 0 ? `<small class="plan-cat-count">${row.txCount} lanç.</small>` : ''}
            </button>
          </td>
          <td class="text-right tabular-nums">${App.utils.formatCurrency(row.planned)}</td>
          <td class="text-right tabular-nums">${App.utils.formatCurrency(row.realized)}</td>
          <td class="text-right tabular-nums ${row.planned > 0 ? (row.diff >= 0 ? 'planning-ok' : 'planning-over') : (row.realized > 0 ? 'planning-warning' : '')}">${diffText}</td>
          <td>
            <div class="plan-progress-cell">
              <div class="plan-progress-top">
                <span class="${statusClass}">${esc(row.statusLabel)}</span>
                <span class="tabular-nums">${pctText}</span>
              </div>
              <div class="plan-status-bar"><div class="plan-status-fill ${barClass}" style="width:${barWidth}%"></div></div>
            </div>
          </td>
          <td class="text-center" style="white-space:nowrap;">${actionBtns}</td>
        </tr>
      `;
    }).join('');
  },

  async _upsertBudgetForMonth(planId, category, amount, ym) {
    const eng = this._engine();
    const bounds = eng.monthBounds(ym);
    if (!bounds) return;
    const allBudgets = await App.db.getAll('budgets');
    const matches = allBudgets.filter(b =>
      b.plano_id === planId &&
      b.category === category &&
      eng.normalizeMonthKey(b.cycle_start) === ym
    );

    if (matches.length > 0) {
      const primary = matches[0];
      primary.amount = amount;
      primary.cycle_start = bounds.start;
      primary.cycle_end = bounds.end;
      await App.db.put('budgets', primary);
      // Limpa duplicados legados da mesma categoria/mês/plano
      for (let i = 1; i < matches.length; i++) {
        await App.db.delete('budgets', matches[i].id);
      }
    } else {
      await App.db.put('budgets', {
        id: App.utils.generateId(),
        category,
        amount,
        cycle_start: bounds.start,
        cycle_end: bounds.end,
        plano_id: planId
      });
    }
  },

  async addBudget() {
    const eng = this._engine();
    const catEl = document.getElementById('planDetailCategory');
    const amtEl = document.getElementById('planDetailAmount');
    const applyAllEl = document.getElementById('planDetailApplyAll');

    const category = catEl ? catEl.value : '';
    const amount = parseFloat(amtEl ? amtEl.value : '');
    if (!category || isNaN(amount) || amount <= 0) {
      App.utils.showToast('Selecione uma categoria e informe um valor maior que zero.', 'error');
      return;
    }

    const rawPlano = await App.db.getById('planosOrcamentarios', this.currentPlanoId);
    const plano = rawPlano ? eng.normalizePlan(rawPlano) : null;
    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || eng.currentMonthKey();

    if (applyAllEl && applyAllEl.checked && plano) {
      for (const ym of plano.months) {
        await this._upsertBudgetForMonth(this.currentPlanoId, category, amount, ym);
      }
      App.utils.showToast(`Orçamento de "${category}" aplicado em todos os ${plano.durationMonths} meses do plano!`);
    } else {
      await this._upsertBudgetForMonth(this.currentPlanoId, category, amount, targetYm);
      App.utils.showToast(`Orçamento de "${category}" salvo para ${eng.formatMonthShort(targetYm)}!`);
    }

    if (amtEl) amtEl.value = '';
    if (applyAllEl) applyAllEl.checked = false;
    await this.renderPlanDetail();
    if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
  },

  async addBudgetForCategory(categoryName) {
    const eng = this._engine();
    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || eng.currentMonthKey();
    const budgets = await App.db.getAll('budgets');
    const monthMap = eng.getMonthBudgetsMap(budgets, this.currentPlanoId, targetYm);
    const existing = monthMap[categoryName];
    const defaultValue = existing ? existing.amount : '';
    const title = existing
      ? `Novo orçamento para "${categoryName}" em ${eng.formatMonthShort(targetYm)} (atual: ${App.utils.formatCurrency(existing.amount)})`
      : `Valor planejado para "${categoryName}" em ${eng.formatMonthShort(targetYm)}`;

    App.utils.prompt(title, defaultValue, async (amountStr) => {
      const val = parseFloat(String(amountStr).replace(',', '.'));
      if (isNaN(val) || val <= 0) {
        App.utils.showToast('Informe um valor válido maior que zero.', 'error');
        return;
      }
      await this._upsertBudgetForMonth(this.currentPlanoId, categoryName, val, targetYm);
      App.utils.showToast(`Orçamento de "${categoryName}" atualizado!`);
      await this.renderPlanDetail();
      if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
    });
  },

  async removeBudgetForCategory(categoryName) {
    const eng = this._engine();
    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || eng.currentMonthKey();
    App.utils.confirm(
      `Remover o orçamento de "${categoryName}" em ${eng.formatMonthShort(targetYm)}? A categoria e seus lançamentos não serão excluídos.`,
      async () => {
        const budgets = await App.db.getAll('budgets');
        const matches = budgets.filter(b =>
          b.plano_id === this.currentPlanoId &&
          b.category === categoryName &&
          eng.normalizeMonthKey(b.cycle_start) === targetYm
        );
        for (const b of matches) {
          await App.db.delete('budgets', b.id);
        }
        App.utils.showToast(`Orçamento de "${categoryName}" removido deste mês.`);
        await this.renderPlanDetail();
        if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
      }
    );
  },

  async fillFromRealAverage() {
    const eng = this._engine();
    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || eng.currentMonthKey();
    const { transactions, categories, cards } = await this._loadCoreData();
    const { cardsMap, getInvoiceDueFn } = this._buildCardInvoiceContext(cards);

    const avgData = eng.computeCategoryAverages({
      transactions,
      categories,
      beforeMonth: targetYm,
      lookbackMonths: 3,
      memberId: App.state.globalMemberFilter || null,
      cardsMap,
      getInvoiceDueFn
    });

    const entries = Object.entries(avgData.averages);
    if (entries.length === 0) {
      App.utils.showToast('Não há despesas nos últimos 3 meses para calcular a média.', 'error');
      return;
    }

    App.utils.confirm(
      `Preencher ${entries.length} categoria(s) em ${eng.formatMonthShort(targetYm)} com base na média real de ${avgData.monthsWithData} mês(es) anterior(es)?`,
      async () => {
        for (const [category, avgAmount] of entries) {
          await this._upsertBudgetForMonth(this.currentPlanoId, category, avgAmount, targetYm);
        }
        this.detailScope = 'month';
        App.utils.showToast(`Orçamento preenchido com a média real de ${entries.length} categorias!`);
        await this.renderPlanDetail();
        if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
      }
    );
  },

  async copyPrevious() {
    const eng = this._engine();
    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || eng.currentMonthKey();
    const prevYm = eng.addMonthsToKey(targetYm, -1);
    const budgets = await App.db.getAll('budgets');
    const prevMap = eng.getMonthBudgetsMap(budgets, this.currentPlanoId, prevYm);
    const entries = Object.entries(prevMap);

    if (entries.length === 0) {
      App.utils.showToast(`Nenhum orçamento encontrado em ${eng.formatMonthShort(prevYm)}.`, 'error');
      return;
    }

    for (const [category, bud] of entries) {
      await this._upsertBudgetForMonth(this.currentPlanoId, category, bud.amount, targetYm);
    }
    this.detailScope = 'month';
    App.utils.showToast(`${entries.length} categoria(s) copiada(s) de ${eng.formatMonthShort(prevYm)} para ${eng.formatMonthShort(targetYm)}!`);
    await this.renderPlanDetail();
    if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
  },

  async applyMonthToAllPlanMonths() {
    const eng = this._engine();
    const rawPlano = await App.db.getById('planosOrcamentarios', this.currentPlanoId);
    if (!rawPlano) return;
    const plano = eng.normalizePlan(rawPlano);
    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || plano.startMonth;
    const budgets = await App.db.getAll('budgets');
    const curMap = eng.getMonthBudgetsMap(budgets, plano.id, targetYm);
    const entries = Object.entries(curMap);

    if (entries.length === 0) {
      App.utils.showToast(`Defina ao menos uma categoria em ${eng.formatMonthShort(targetYm)} antes de replicar.`, 'error');
      return;
    }

    App.utils.confirm(
      `Aplicar os ${entries.length} valores de ${eng.formatMonthShort(targetYm)} para todos os ${plano.durationMonths} meses da vigência (${plano.periodLabel})?`,
      async () => {
        for (const ym of plano.months) {
          for (const [category, bud] of entries) {
            await this._upsertBudgetForMonth(plano.id, category, bud.amount, ym);
          }
        }
        App.utils.showToast(`Orçamento replicado para toda a vigência (${plano.periodLabel})!`);
        await this.renderPlanDetail();
        if (App.dashboard && App.dashboard.refresh) App.dashboard.refresh();
      }
    );
  },

  selectPlanMonth(ym) {
    const eng = this._engine();
    this.currentMonthStart = eng.monthStartISO(ym);
    this.detailScope = 'month';
    this.renderPlanDetail();
  },

  prevMonth(isAcomp = false) {
    const eng = this._engine();
    const curYm = eng.normalizeMonthKey(this.currentMonthStart) || eng.currentMonthKey();
    this.currentMonthStart = eng.monthStartISO(eng.addMonthsToKey(curYm, -1));
    if (isAcomp) this.renderAcompanhamento();
    else this.renderPlanDetail();
  },

  nextMonth(isAcomp = false) {
    const eng = this._engine();
    const curYm = eng.normalizeMonthKey(this.currentMonthStart) || eng.currentMonthKey();
    this.currentMonthStart = eng.monthStartISO(eng.addMonthsToKey(curYm, 1));
    if (isAcomp) this.renderAcompanhamento();
    else this.renderPlanDetail();
  },

  gotoMonth(isAcomp = false) {
    const eng = this._engine();
    const input = document.getElementById(isAcomp ? 'acompMonthPicker' : 'planDetailMonthPicker');
    if (input && input.value) {
      this.currentMonthStart = eng.monthStartISO(input.value);
      if (isAcomp) this.renderAcompanhamento();
      else this.renderPlanDetail();
    }
  },

  openCategoryTransactions(categoryName, source = 'detail') {
    const evaluation = source === 'acompanhamento' ? this._lastAcompEval : this._lastDetailEval;
    if (!evaluation) return;
    const row = evaluation.categories.find(c => c.name === categoryName);
    if (!row) return;

    const esc = (v) => App.utils.escapeHtml(v == null ? '' : String(v));
    const titleEl = document.getElementById('modalPlanCatTxTitle');
    const summaryEl = document.getElementById('modalPlanCatTxSummary');
    const tbody = document.getElementById('modalPlanCatTxBody');
    const addBtn = document.getElementById('modalPlanCatAddTxBtn');

    if (titleEl) titleEl.textContent = `${row.name} — ${evaluation.scopeLabel}`;
    if (summaryEl) {
      const diffCls = row.planned > 0 ? (row.diff >= 0 ? 'planning-ok' : 'planning-over') : 'planning-warning';
      summaryEl.innerHTML = `
        <div><span>Planejado:</span> <strong class="tabular-nums">${App.utils.formatCurrency(row.planned)}</strong></div>
        <div><span>Realizado:</span> <strong class="tabular-nums">${App.utils.formatCurrency(row.realized)}</strong></div>
        <div><span>Diferença:</span> <strong class="tabular-nums ${diffCls}">${App.utils.formatCurrency(row.diff)}</strong></div>
        <div><span>Lançamentos:</span> <strong class="tabular-nums">${row.txCount}</strong></div>
      `;
    }

    if (tbody) {
      if (row.transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--text-muted);">Nenhum lançamento encontrado para esta categoria em ${esc(evaluation.scopeLabel)}.</td></tr>`;
      } else {
        tbody.innerHTML = row.transactions.map(t => {
          const isRefund = t.type === 'refund';
          const stLabel = t.status === 'confirmed' ? 'Confirmado' : 'Pendente';
          const stCls = t.status === 'confirmed' ? 'planning-ok' : 'planning-warning';
          return `
            <tr class="clickable" onclick="App.planning.editTransactionFromDrilldown('${esc(t.id)}')" title="Clique para editar este lançamento">
              <td class="tabular-nums">${App.utils.formatDate((t._effectiveDate || t.date || '').slice(0, 10))}</td>
              <td>${esc(t.description || t.category || 'Sem descrição')}</td>
              <td><span class="${stCls}">${stLabel}</span></td>
              <td class="text-right tabular-nums ${isRefund ? 'planning-ok' : ''}">${isRefund ? '+' : ''}${App.utils.formatCurrency(parseFloat(t.amount) || 0)}</td>
            </tr>
          `;
        }).join('');
      }
    }

    if (addBtn) {
      addBtn.onclick = () => {
        App.ui.closeModal('modalPlanCategoryTx');
        this.openQuickExpenseModal(row.name);
      };
    }

    App.ui.openModal('modalPlanCategoryTx');
  },

  editTransactionFromDrilldown(txId) {
    App.ui.closeModal('modalPlanCategoryTx');
    if (App.transactions && typeof App.transactions.openModal === 'function') {
      App.transactions.openModal(txId);
    }
  },

  openQuickExpenseModal(categoryName = null) {
    if (App.transactions && typeof App.transactions.openModal === 'function') {
      App.transactions.openModal(null, 'expense');
      if (categoryName) {
        setTimeout(() => {
          const catEl = document.getElementById('txCategory');
          if (catEl) catEl.value = categoryName;
        }, 120);
      }
    }
  },

  async editCategoryColor(catId, event) {
    if (event) event.stopPropagation();
    const cat = await App.db.getById('categories', catId);
    if (!cat) return;

    const existing = document.getElementById('colorPopover');
    if (existing) existing.remove();

    const isLight = this._isLightMode();
    const popover = document.createElement('div');
    popover.id = 'colorPopover';
    popover.style.cssText = `
      position: fixed; z-index: 300;
      background: ${isLight ? '#ffffff' : '#1a1a1a'};
      border: 1px solid ${isLight ? '#d8d8d8' : '#333'};
      border-radius: 8px; padding: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,${isLight ? '0.16' : '0.6'});
      display: flex; flex-direction: column; gap: 10px;
    `;
    const rect = event ? event.target.getBoundingClientRect() : { left: 200, bottom: 200 };
    popover.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
    popover.style.top = Math.min(rect.bottom + 8, window.innerHeight - 240) + 'px';

    const title = document.createElement('div');
    title.textContent = `Cor de "${cat.name}"`;
    title.style.cssText = `color: ${isLight ? '#181818' : '#e0e0e0'}; font-size: 0.85rem; font-weight: 600;`;

    const palette = document.createElement('div');
    palette.style.cssText = 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px;';

    const colors = [
      '#e67e22', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c', '#e74c3c',
      '#f1c40f', '#34495e', '#d35400', '#c0392b', '#16a085', '#8e44ad',
      '#27ae60', '#2980b9', '#f39c12', '#e91e63', '#00bcd4', '#ff5722',
      '#795548', '#607d8b', '#0e6854', '#107a63', '#2563eb', '#64748b'
    ];

    colors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.style.cssText = `
        width: 26px; height: 26px; border-radius: 50%; cursor: pointer;
        background: ${color}; border: 2px solid ${cat.color === color ? (isLight ? '#181818' : '#fff') : 'transparent'};
      `;
      swatch.title = color;
      swatch.addEventListener('click', async () => {
        cat.color = color;
        await App.db.put('categories', cat);
        App.cache.categories = null;
        popover.remove();
        App.utils.showToast(`Cor de "${cat.name}" atualizada!`);
        await this.renderPlanDetail();
      });
      palette.appendChild(swatch);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Cancelar';
    closeBtn.className = 'btn btn-sm btn-ghost';
    closeBtn.style.cssText = 'align-self: flex-end;';
    closeBtn.addEventListener('click', () => popover.remove());

    const closeListener = (e) => {
      if (!popover.contains(e.target)) {
        popover.remove();
        document.removeEventListener('click', closeListener);
      }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 0);

    popover.appendChild(title);
    popover.appendChild(palette);
    popover.appendChild(closeBtn);
    document.body.appendChild(popover);
  },

  // ==================== TELA 3: ACOMPANHAMENTO DO PLANO ====================
  setAcompScope(scope) {
    this.acompScope = scope === 'full' ? 'full' : 'month';
    this.renderAcompanhamento();
  },

  _destroyCharts() {
    if (this._chartCombinado) {
      this._chartCombinado.destroy();
      this._chartCombinado = null;
    }
    if (this._chartDist) {
      this._chartDist.destroy();
      this._chartDist = null;
    }
    if (this._chartEvo) {
      this._chartEvo.destroy();
      this._chartEvo = null;
    }
  },

  async renderAcompanhamento() {
    await this.initPlanos();
    const eng = this._engine();
    const esc = (v) => App.utils.escapeHtml(v == null ? '' : String(v));
    const todayYm = eng.currentMonthKey();
    const isLight = this._isLightMode();

    const { planosRaw, budgets, transactions, categories, cards } = await this._loadCoreData();
    const rawPlano = planosRaw.find(p => p.id === this.currentPlanoId) || planosRaw[0];
    if (!rawPlano) {
      this.backToList();
      return;
    }
    this.currentPlanoId = rawPlano.id;
    const plano = eng.normalizePlan(rawPlano, todayYm);

    // Cabeçalho & Switcher
    const crumbPlanEl = document.getElementById('acompBreadcrumbPlan');
    const vigEl = document.getElementById('acompVigenciaMeta');
    const switcherEl = document.getElementById('acompPlanSwitcher');
    if (crumbPlanEl) crumbPlanEl.textContent = plano.nome;
    if (vigEl) {
      vigEl.innerHTML = `<span class="plan-status-dot tone-${plano.statusTone}"></span> <span>${esc(plano.statusLabel)}</span> <span>•</span> <strong>${esc(plano.periodLabel)}</strong>`;
    }
    if (switcherEl) {
      const sorted = eng.sortPlansChronologically(planosRaw, todayYm);
      switcherEl.innerHTML = sorted.map(p =>
        `<option value="${esc(p.id)}" ${p.id === plano.id ? 'selected' : ''}>${esc(p.nome)} (${esc(p.periodLabel)})</option>`
      ).join('');
    }

    // Controles de escopo
    const monthBtn = document.getElementById('acompScopeMonthBtn');
    const fullBtn = document.getElementById('acompScopeFullBtn');
    const monthCtrls = document.getElementById('acompMonthControls');
    if (monthBtn) monthBtn.classList.toggle('active', this.acompScope === 'month');
    if (fullBtn) fullBtn.classList.toggle('active', this.acompScope === 'full');
    if (monthCtrls) monthCtrls.style.display = this.acompScope === 'month' ? 'flex' : 'none';

    const targetYm = eng.normalizeMonthKey(this.currentMonthStart) || todayYm;
    const cycleLabelEl = document.getElementById('acompCycleLabel');
    const monthPickerEl = document.getElementById('acompMonthPicker');
    if (cycleLabelEl) cycleLabelEl.textContent = eng.formatMonthLong(targetYm);
    if (monthPickerEl) monthPickerEl.value = targetYm;

    const { cardsMap, getInvoiceDueFn } = this._buildCardInvoiceContext(cards);
    const evaluation = eng.computePlanEvaluation({
      plan: plano,
      budgets,
      transactions,
      categories,
      scope: this.acompScope,
      targetMonth: targetYm,
      memberId: App.state.globalMemberFilter || null,
      cardsMap,
      getInvoiceDueFn,
      refDateOrMonth: todayYm
    });
    this._lastAcompEval = evaluation;

    const hintEl = document.getElementById('acompPeriodSummaryHint');
    if (hintEl) {
      hintEl.textContent = this.acompScope === 'full'
        ? `Visão consolidada de ${plano.periodLabel} (${plano.durationMonths} meses)`
        : `Analisando ${eng.formatMonthLong(targetYm)} dentro do plano ${plano.nome}`;
    }

    // 4 KPIs Reais
    const resumoEl = document.getElementById('acompanhamentoResumo');
    if (resumoEl) {
      const over = evaluation.totalPlannedExpenses > 0 && evaluation.totalRealizedExpenses > evaluation.totalPlannedExpenses;
      const pctCls = evaluation.expensePct > 100 ? 'planning-over' : evaluation.expensePct >= 85 ? 'planning-warning' : 'planning-ok';
      const savCls = evaluation.realizedSavings >= 0 ? 'planning-ok' : 'planning-over';
      const overNames = evaluation.overBudgetCategories.slice(0, 3).map(c => `${esc(c.name)} (${c.pct}%)`).join(', ');

      resumoEl.innerHTML = `
        <div class="card plan-kpi-card">
          <div class="card-label">Despesa Planejada vs. Realizada</div>
          <div class="card-value tabular-nums ${over ? 'planning-over' : ''}">${App.utils.formatCurrency(evaluation.totalRealizedExpenses)}</div>
          <div class="card-sub">Planejado: <strong class="tabular-nums">${App.utils.formatCurrency(evaluation.totalPlannedExpenses)}</strong> • <span class="${pctCls} tabular-nums">${evaluation.expensePct}%</span></div>
        </div>
        <div class="card plan-kpi-card">
          <div class="card-label">Receitas Realizadas</div>
          <div class="card-value tabular-nums planning-ok">${App.utils.formatCurrency(evaluation.realizedIncome)}</div>
          <div class="card-sub">${evaluation.plannedIncome > 0 ? `Meta: ${App.utils.formatCurrency(evaluation.plannedIncome)}` : 'Sem meta de receita definida'}</div>
        </div>
        <div class="card plan-kpi-card">
          <div class="card-label">Economia / Saldo Líquido</div>
          <div class="card-value tabular-nums ${savCls}">${App.utils.formatCurrency(evaluation.realizedSavings)}</div>
          <div class="card-sub">Taxa de poupança: <strong class="tabular-nums">${evaluation.savingsRatePct}%</strong>${plano.metaEconomiaPct > 0 ? ` (meta ${plano.metaEconomiaPct}%)` : ''}</div>
        </div>
        <div class="card plan-kpi-card">
          <div class="card-label">Saúde das Categorias</div>
          <div class="card-value tabular-nums ${evaluation.overBudgetCategories.length > 0 ? 'planning-over' : 'planning-ok'}">${evaluation.overBudgetCategories.length} estourada(s)</div>
          <div class="card-sub">${overNames || (evaluation.unplannedSpendCategories.length > 0 ? `${evaluation.unplannedSpendCategories.length} gasto(s) fora do plano` : 'Todas dentro da meta')}</div>
        </div>
      `;
    }

    // Cores adaptativas ao tema (Dark vs Light Contas Online)
    const tickColor = isLight ? '#555555' : '#9ca3af';
    const gridColor = isLight ? '#eaeaea' : '#242424';
    const legendColor = isLight ? '#333333' : '#d1d5db';
    const plannedBarColor = isLight ? '#cbd5e1' : '#3f4856';
    const realizedOkColor = isLight ? '#0e6854' : '#a3e635';
    const realizedOverColor = isLight ? '#d23a01' : '#ef4444';
    const incomeLineColor = isLight ? '#0066cc' : '#38bdf8';

    this._destroyCharts();

    const activeRows = evaluation.categories.filter(c => c.planned > 0 || c.realized > 0);
    const topRows = activeRows.slice(0, 10);

    const barSub = document.getElementById('acompBarSub');
    if (barSub) barSub.textContent = `${evaluation.scopeLabel} • Top ${topRows.length} categorias`;

    // Gráfico 1: Barras Horizontais — Planejado vs Realizado por Categoria
    const ctxComb = document.getElementById('acompanhamentoCombinadoChart');
    if (ctxComb) {
      this._chartCombinado = new Chart(ctxComb, {
        type: 'bar',
        data: {
          labels: topRows.length ? topRows.map(r => r.name) : ['Sem dados'],
          datasets: [
            {
              label: 'Planejado',
              data: topRows.length ? topRows.map(r => r.planned) : [0],
              backgroundColor: plannedBarColor,
              borderRadius: 4,
              barPercentage: 0.78
            },
            {
              label: 'Realizado',
              data: topRows.length ? topRows.map(r => r.realized) : [0],
              backgroundColor: topRows.length ? topRows.map(r => (r.planned > 0 && r.realized > r.planned) ? realizedOverColor : realizedOkColor) : [realizedOkColor],
              borderRadius: 4,
              barPercentage: 0.78
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          scales: {
            x: {
              ticks: { color: tickColor, callback: v => App.utils.formatCurrency(v) },
              grid: { color: gridColor }
            },
            y: {
              ticks: { color: legendColor, font: { size: 11, weight: '600' } },
              grid: { display: false }
            }
          },
          plugins: {
            datalabels: { display: false },
            legend: { labels: { color: legendColor, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${App.utils.formatCurrency(ctx.raw)}`
              }
            }
          }
        }
      });
    }

    // Gráfico 2: Rosca — Participação das Despesas Realizadas
    const realizedRows = activeRows.filter(r => r.realized > 0).sort((a, b) => b.realized - a.realized);
    const donutSub = document.getElementById('acompDonutSub');
    if (donutSub) donutSub.textContent = `Total: ${App.utils.formatCurrency(evaluation.totalRealizedExpenses)}`;

    const ctxDist = document.getElementById('acompanhamentoDistChart');
    if (ctxDist) {
      this._chartDist = new Chart(ctxDist, {
        type: 'doughnut',
        data: {
          labels: realizedRows.length ? realizedRows.map(r => r.name) : ['Sem despesas'],
          datasets: [{
            data: realizedRows.length ? realizedRows.map(r => r.realized) : [1],
            backgroundColor: realizedRows.length ? realizedRows.map(r => r.color) : [gridColor],
            borderColor: isLight ? '#ffffff' : '#141414',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          cutout: '64%',
          plugins: {
            datalabels: { display: false },
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => realizedRows.length ? `${ctx.label}: ${App.utils.formatCurrency(ctx.raw)}` : 'Nenhuma despesa registrada'
              }
            }
          }
        }
      });
    }

    const legendEl = document.getElementById('acompanhamentoCombinadoLegend');
    if (legendEl) {
      if (activeRows.length === 0) {
        legendEl.innerHTML = `<div style="color:var(--text-muted); font-size:0.84rem;">Nenhuma categoria com valor planejado ou realizado em ${esc(evaluation.scopeLabel)}.</div>`;
      } else {
        legendEl.innerHTML = activeRows.slice(0, 8).map(item => {
          const pctStr = typeof item.pct === 'number' ? `${item.pct}%` : 'Fora';
          const cls = item.status === 'over' ? 'planning-over' : item.status === 'warning' ? 'planning-warning' : '';
          const safeName = esc(item.name).replace(/'/g, '&#39;');
          return `
            <button type="button" class="plan-legend-row" onclick="App.planning.openCategoryTransactions('${safeName}', 'acompanhamento')">
              <span class="plan-cat-swatch" style="background:${esc(item.color)};"></span>
              <span class="plan-legend-name">${esc(item.name)}</span>
              <span class="plan-legend-val tabular-nums">${App.utils.formatCurrency(item.realized)}</span>
              <span class="plan-legend-pct tabular-nums ${cls}">${pctStr}</span>
            </button>
          `;
        }).join('');
      }
    }

    // Gráfico 3: Evolução Mensal durante TODA a vigência do plano
    const evoSub = document.getElementById('acompEvoSub');
    if (evoSub) evoSub.textContent = `${plano.periodLabel} (${plano.durationMonths} ${plano.durationMonths === 1 ? 'mês' : 'meses'})`;

    const series = evaluation.monthlySeries;
    const ctxEvo = document.getElementById('acompanhamentoEvoChart');
    if (ctxEvo) {
      this._chartEvo = new Chart(ctxEvo, {
        type: 'bar',
        data: {
          labels: series.map(m => m.label),
          datasets: [
            {
              label: 'Despesa Planejada',
              data: series.map(m => m.planned),
              backgroundColor: plannedBarColor,
              borderRadius: 5,
              order: 2
            },
            {
              label: 'Despesa Realizada',
              data: series.map(m => m.realized),
              backgroundColor: series.map(m => (m.planned > 0 && m.realized > m.planned) ? realizedOverColor : realizedOkColor),
              borderRadius: 5,
              order: 2
            },
            {
              label: 'Receita Realizada',
              type: 'line',
              data: series.map(m => m.income),
              borderColor: incomeLineColor,
              backgroundColor: incomeLineColor,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 3,
              fill: false,
              order: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          scales: {
            x: { ticks: { color: tickColor }, grid: { color: gridColor } },
            y: { ticks: { color: tickColor, callback: v => App.utils.formatCurrency(v) }, grid: { color: gridColor } }
          },
          plugins: {
            datalabels: { display: false },
            legend: { labels: { color: legendColor, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${App.utils.formatCurrency(ctx.raw)}`
              }
            }
          }
        }
      });
    }

    // Tabela comparativa de desvios
    const tableBodyEl = document.getElementById('acompanhamentoTableBody');
    if (tableBodyEl) {
      const sortedRows = activeRows.slice().sort((a, b) => {
        const aP = typeof a.pct === 'number' ? a.pct : 9999;
        const bP = typeof b.pct === 'number' ? b.pct : 9999;
        return bP - aP;
      });

      if (sortedRows.length === 0) {
        tableBodyEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--text-muted);">Nenhum orçamento ou despesa registrada para ${esc(evaluation.scopeLabel)}.</td></tr>`;
      } else {
        tableBodyEl.innerHTML = sortedRows.map(t => {
          const safeName = esc(t.name).replace(/'/g, '&#39;');
          const pctLabel = typeof t.pct === 'number' ? `${t.pct}%` : 'Fora do plano';
          const barW = typeof t.pct === 'number' ? Math.min(t.pct, 100) : 100;
          const statusCls = t.status === 'over' ? 'planning-over' : (t.status === 'warning' || t.status === 'unplanned') ? 'planning-warning' : 'planning-ok';
          const barCls = t.status === 'over' || t.status === 'unplanned' ? 'over' : (t.status === 'warning' ? 'warning' : '');
          return `
            <tr class="clickable" onclick="App.planning.openCategoryTransactions('${safeName}', 'acompanhamento')">
              <td>
                <div class="plan-cat-btn" style="pointer-events:none;">
                  <span class="plan-cat-swatch" style="background:${esc(t.color)};"></span>
                  <span>${esc(t.name)}</span>
                  ${t.txCount > 0 ? `<small class="plan-cat-count">${t.txCount} lanç.</small>` : ''}
                </div>
              </td>
              <td class="text-right tabular-nums">${App.utils.formatCurrency(t.planned)}</td>
              <td class="text-right tabular-nums">${App.utils.formatCurrency(t.realized)}</td>
              <td class="text-right tabular-nums ${t.diff >= 0 ? 'planning-ok' : 'planning-over'}">${t.diff >= 0 ? '+' : '-'}${App.utils.formatCurrency(Math.abs(t.diff))}</td>
              <td class="text-right tabular-nums ${statusCls}">${pctLabel}</td>
              <td>
                <div class="plan-status-bar"><div class="plan-status-fill ${barCls}" style="width:${barW}%"></div></div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  },

  async showAcompanhamento() {
    await this.initPlanos();
    if (!this.currentPlanoId) {
      App.utils.showToast('Nenhum plano orçamentário encontrado.', 'error');
      return;
    }
    this.currentView = 'acompanhamento';
    App.ui.navigateTo('acompanhamento');
  },

  ajustarPlanejamento() {
    this._destroyCharts();
    this.currentView = 'detail';
    App.ui.navigateTo('planning-detail');
  },

  backToDetail() {
    this._destroyCharts();
    this.currentView = 'detail';
    App.ui.navigateTo('planning-detail');
  }
};

// =======================================================================
// Detalhamento Mensal de Analytics
// Lista todos os meses com os 6 KPIs principais
// =======================================================================
App.analyticsDetail = {
  _pendingKpi: 'all',

  open(kpi) {
    this._pendingKpi = kpi || 'all';
    App.ui.navigateTo('analytics-detail');
  },

  async load() {
    const kpiSel = document.getElementById('analyticsDetailKpi');
    if (kpiSel && this._pendingKpi) {
      kpiSel.value = this._pendingKpi;
      this._pendingKpi = null;
    }
    const kpiFiltro = kpiSel?.value || 'all';
    const periodoSel = document.getElementById('analyticsDetailPeriod');
    const periodoTipo = periodoSel?.value || '24';

    const allTx = await App.db.getAll('transactions');
    if (!allTx.length) {
      this._render([], kpiFiltro);
      return;
    }

    const dates = allTx.map(t => new Date(t.date.slice(0, 10) + 'T12:00:00'));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    // Define limites
    let startCycle, endCycle;
    if (periodoTipo === 'all') {
      startCycle = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
      endCycle   = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    } else {
      const meses = parseInt(periodoTipo, 10) || 24;
      endCycle   = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
      startCycle = new Date(endCycle.getFullYear(), endCycle.getMonth() - (meses - 1), 1);
    }

    // Pré-carrega dados fixos (patrimônio, investimentos, contas)
    const allAccounts = App.cache.accounts || await App.db.getAll('accounts');
    const allCards    = App.cache.creditCards || await App.db.getAll('creditCards');
    const allCats     = App.cache.categories || await App.db.getAll('categories');
    const allInv      = await App.db.getAll('investments');
    const allPat      = await App.db.getAll('patrimony');
    const memberId    = App.state.globalMemberFilter || null;

    const CAT_EXCL = new Set(['Pagamento Fatura', 'Saldo Inicial', 'Ajuste de Saldo']);
    const today = App.utils.todayISO();

    // Saldo total é "do momento" — calcula uma vez para o mês mais recente
    // Como varia mês a mês seria muito custoso, exibimos o mesmo para todos
    const totalBalanceAtual = App.cache.totalBalance ?? App.utils.calculateBalance(
      allAccounts.filter(a => !a.archived),
      await App.db.getAll('transactions')
    );

    const patrimonioLiquido = (() => {
      const assets = allPat.filter(p => p.type === 'asset').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
      const liabilities = allPat.filter(p => p.type === 'liability').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
      const totalInv = allInv.reduce((s, inv) => s + (parseFloat(inv.current_value) || 0), 0);
      return assets - liabilities + totalInv;
    })();

    // Itera meses
    const meses = [];
    const cursor = new Date(startCycle);
    while (cursor <= endCycle) {
      const cycle = App.utils.monthRangeFromDate(cursor.toISOString().slice(0, 10));

      // Transações do mês (confirmadas, sem filtro de cartão por enquanto)
      let periodTx = await App.db.getTransactionsInRange(cycle.start, cycle.end, { status: 'confirmed' });
      if (memberId) periodTx = periodTx.filter(t => t.member_id === memberId);

      // Receitas
      const income = periodTx
        .filter(t => t.type === 'income' && !t.ignore_from_total)
        .reduce((s, t) => s + parseFloat(t.amount), 0);

      // Despesas (aplicando regra de vencimento de cartão)
      let expense = 0;
      for (const t of periodTx) {
        if ((t.type !== 'expense' && t.type !== 'refund') || t.ignore_from_total) continue;
        if (t.invoice_locked) continue;
        let eff = t.date.slice(0, 10);
        if (t.credit_card_id) {
          const card = allCards.find(c => c.id === t.credit_card_id);
          if (card) {
            try {
              const p = App.cardInvoice.getInvoicePeriodForDate(card, eff);
              eff = p.due.slice(0, 10);
            } catch (e) {}
          }
        }
        if (eff >= cycle.start.slice(0, 10) && eff <= cycle.end.slice(0, 10)) {
          if (t.type === 'refund') expense -= parseFloat(t.amount);
          else expense += parseFloat(t.amount);
        }
      }

      // Custo de vida
      let livingExpenses = 0;
      for (const t of periodTx) {
        if ((t.type !== 'expense' && t.type !== 'refund') || t.ignore_from_total) continue;
        if (t.invoice_locked) continue;
        const cat = (t.category || '').trim();
        if (CAT_EXCL.has(cat)) continue;
        let eff = t.date.slice(0, 10);
        if (t.credit_card_id) {
          const card = allCards.find(c => c.id === t.credit_card_id);
          if (card) {
            try {
              const p = App.cardInvoice.getInvoicePeriodForDate(card, eff);
              eff = p.due.slice(0, 10);
            } catch (e) {}
          }
        }
        if (eff >= cycle.start.slice(0, 10) && eff <= cycle.end.slice(0, 10)) {
          const catObj = allCats.find(c => c.name === t.category);
          const cls = t.classification || catObj?.classification || 'necessary';
          if (cls === 'essential' || cls === 'necessary') {
            if (t.type === 'refund') livingExpenses -= parseFloat(t.amount);
            else livingExpenses += parseFloat(t.amount);
          }
        }
      }

      const balance = income - expense;

      // Saldo total do mês: reconstrói retroativamente usando saldo atual + ajuste
      // Aproximação: para meses passados, soma ao saldo atual as despesas ocorridas
      // depois do fim daquele mês e subtrai as receitas. Saldo no fim do mês.
      const isCurrentMonth = cycle.start.slice(0, 7) === App.utils.currentMonth().startDate.slice(0, 7);
      const isPast = cycle.end.slice(0, 10) < today;
      let totalBalanceMes = totalBalanceAtual;
      if (!isCurrentMonth) {
        // Recalcula retroativamente até o fim daquele mês
        const todos = await App.db.getAll('transactions');
        totalBalanceMes = App.utils.calculateBalance(
          allAccounts.filter(a => !a.archived),
          todos.filter(t => t.date.slice(0, 10) <= cycle.end.slice(0, 10))
        );
      }

      // Patrimônio líquido por mês é complexo; usa o valor atual para todos
      const netWorth = patrimonioLiquido;

      meses.push({
        cycle,
        label: cycle.refMonth,
        year: cursor.getFullYear(),
        totalBalance: totalBalanceMes,
        income,
        expense,
        balance,
        livingExpenses,
        netWorth
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Aplica ordenação conforme seleção
    const ordenacao = document.getElementById('analyticsDetailOrder')?.value || 'recent';
    const chaveValor = (kpiFiltro && kpiFiltro !== 'all') ? kpiFiltro : 'balance';

    if (ordenacao === 'recent') {
      meses.sort((a, b) => (b.cycle.start || '').localeCompare(a.cycle.start || ''));
    } else if (ordenacao === 'oldest') {
      meses.sort((a, b) => (a.cycle.start || '').localeCompare(b.cycle.start || ''));
    } else if (ordenacao === 'value_desc') {
      meses.sort((a, b) => (parseFloat(b[chaveValor]) || 0) - (parseFloat(a[chaveValor]) || 0));
    } else if (ordenacao === 'value_asc') {
      meses.sort((a, b) => (parseFloat(a[chaveValor]) || 0) - (parseFloat(b[chaveValor]) || 0));
    }

    this._render(meses, kpiFiltro);
  },

  _render(meses, kpiFiltro) {
    const head = document.getElementById('analyticsDetailHead');
    const body = document.getElementById('analyticsDetailBody');
    const empty = document.getElementById('analyticsDetailEmpty');
    if (!head || !body || !empty) return;

    const colunasTodos = [
      { key: 'label', label: 'Mês', align: 'left' },
      { key: 'totalBalance', label: 'Saldo Total', align: 'right' },
      { key: 'income', label: 'Receitas', align: 'right' },
      { key: 'expense', label: 'Despesas', align: 'right' },
      { key: 'balance', label: 'Saldo Líquido', align: 'right' },
      { key: 'livingExpenses', label: 'Custo de Vida', align: 'right' },
      { key: 'netWorth', label: 'Patrimônio Líquido', align: 'right' }
    ];

    const colunasFoco = kpiFiltro === 'all'
      ? colunasTodos
      : [
          { key: 'label', label: 'Mês', align: 'left' },
          colunasTodos.find(c => c.key === kpiFiltro)
        ];

    if (!meses.length) {
      head.innerHTML = '';
      body.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    head.innerHTML = '<tr>' + colunasFoco.map(c =>
      `<th class="${c.align === 'right' ? 'text-right' : ''}">${c.label}</th>`
    ).join('') + '</tr>';

    const corPara = (key, val) => {
      if (key === 'income') return 'color:var(--income);';
      if (key === 'expense' || key === 'livingExpenses') return 'color:var(--expense);';
      if (key === 'balance') return val >= 0 ? 'color:var(--income);font-weight:600;' : 'color:var(--expense);font-weight:600;';
      if (key === 'totalBalance' || key === 'netWorth') return 'font-weight:600;';
      return '';
    };

    body.innerHTML = meses.map(m => {
      const cells = colunasFoco.map(c => {
        if (c.key === 'label') {
          return `<td style="text-transform:capitalize;">${m.label}</td>`;
        }
        const v = m[c.key] || 0;
        return `<td class="text-right" style="${corPara(c.key, v)}">${App.utils.formatCurrency(v)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
  }
};

// =======================================================================
// Visão Anual de Analytics
// Tabela no formato Excel: meses como colunas, KPIs como linhas,
// detalhamento por categoria/membro e gráfico de colunas.
// =======================================================================
App.analyticsAnnual = {
  _chart: null,

  open() {
    App.ui.navigateTo('analytics-annual');
  },

  _mesesDoAno(ano) {
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return MESES.map((nome, i) => {
      const start = `${ano}-${String(i + 1).padStart(2, '0')}-01`;
      const cycle = App.utils.monthRangeFromDate(start);
      return { nome, index: i, cycle };
    });
  },

  async _populateYears() {
    const sel = document.getElementById('annualYearSelect');
    if (!sel) return;
    const allTx = await App.db.getAll('transactions');
    const anos = new Set();
    allTx.forEach(t => {
      const a = parseInt((t.date || '').slice(0, 4), 10);
      if (!isNaN(a)) anos.add(a);
    });
    anos.add(new Date().getFullYear());
    const lista = Array.from(anos).sort((a, b) => b - a);
    const atual = sel.value ? parseInt(sel.value, 10) : new Date().getFullYear();
    sel.innerHTML = lista.map(a => `<option value="${a}" ${a === atual ? 'selected' : ''}>${a}</option>`).join('');
  },

  async load() {
    await this._populateYears();

    const ano = parseInt(document.getElementById('annualYearSelect')?.value || new Date().getFullYear(), 10);
    const kpi = document.getElementById('annualKpiSelect')?.value || 'income';
    const breakdown = document.getElementById('annualBreakdownSelect')?.value || 'category';

    const allAccounts = App.cache.accounts || await App.db.getAll('accounts');
    const allCards = App.cache.creditCards || await App.db.getAll('creditCards');
    const allCats = App.cache.categories || await App.db.getAll('categories');
    const allMembers = App.cache.members || await App.db.getAll('members');
    const memberId = App.state.globalMemberFilter || null;

    const CAT_EXCL = new Set(['Pagamento Fatura', 'Saldo Inicial', 'Ajuste de Saldo']);

    const meses = this._mesesDoAno(ano);
    const valoresMensais = new Array(12).fill(0);
    const porItem = {}; // chave: categoria ou membro => [12 valores]

    // percorre cada mês
    for (const mes of meses) {
      let periodTx = await App.db.getTransactionsInRange(mes.cycle.start, mes.cycle.end, { status: 'confirmed' });
      if (memberId) periodTx = periodTx.filter(t => t.member_id === memberId);

      const somaMes = { valor: 0 };
      const mapCategoria = {};

      for (const t of periodTx) {
        if (t.ignore_from_total) continue;

        // Efetiva cartão pelo vencimento
        let eff = t.date.slice(0, 10);
        if (t.credit_card_id) {
          const card = allCards.find(c => c.id === t.credit_card_id);
          if (card) {
            try {
              const p = App.cardInvoice.getInvoicePeriodForDate(card, eff);
              eff = p.due.slice(0, 10);
            } catch (e) {}
          }
        }
        if (eff < mes.cycle.start.slice(0, 10) || eff > mes.cycle.end.slice(0, 10)) continue;

        let valor = parseFloat(t.amount) || 0;
        let incluir = false;
        let chaveDetalhe = null;

        if (kpi === 'income' && t.type === 'income') {
          incluir = true;
          chaveDetalhe = t.category || '(sem categoria)';
        } else if (kpi === 'expense' && t.type === 'expense' && !t.invoice_locked) {
          incluir = true;
          chaveDetalhe = t.category || '(sem categoria)';
        } else if (kpi === 'expense' && t.type === 'refund' && !t.invoice_locked) {
          incluir = true;
          valor = -valor;
          chaveDetalhe = t.category || '(sem categoria)';
        } else if (kpi === 'balance') {
          if (t.type === 'income') { incluir = true; chaveDetalhe = 'Receitas'; valor = valor; }
          else if (t.type === 'expense' && !t.invoice_locked) { incluir = true; chaveDetalhe = 'Despesas'; valor = -valor; }
          else if (t.type === 'refund' && !t.invoice_locked) { incluir = true; chaveDetalhe = 'Estornos'; valor = valor; }
        } else if (kpi === 'livingExpenses') {
          if (t.type !== 'expense' && t.type !== 'refund') continue;
          if (t.invoice_locked) continue;
          const catNome = (t.category || '').trim();
          if (CAT_EXCL.has(catNome)) continue;
          const catObj = allCats.find(c => c.name === t.category);
          const cls = t.classification || catObj?.classification || 'necessary';
          if (cls === 'essential' || cls === 'necessary') {
            incluir = true;
            chaveDetalhe = t.category || '(sem categoria)';
            if (t.type === 'refund') valor = -valor;
          }
        } else if (kpi === 'totalBalance' || kpi === 'netWorth') {
          // Calculado adiante, por mês
          continue;
        }

        if (!incluir) continue;
        somaMes.valor += valor;

        const key = breakdown === 'member'
          ? (t.member_name || '(sem membro)')
          : (chaveDetalhe || '(sem categoria)');
        if (!porItem[key]) porItem[key] = new Array(12).fill(0);
        porItem[key][mes.index] += valor;
      }

      // Para saldo e patrimônio, calcula por mês com regra própria
      if (kpi === 'totalBalance') {
        const todos = await App.db.getAll('transactions');
        const fimMes = mes.cycle.end.slice(0, 10);
        const saldo = App.utils.calculateBalance(
          allAccounts.filter(a => !a.archived),
          todos.filter(t => t.date.slice(0, 10) <= fimMes)
        );
        somaMes.valor = saldo;
      } else if (kpi === 'netWorth') {
        const invs = await App.db.getAll('investments');
        const pat = await App.db.getAll('patrimony');
        const totalInv = invs.reduce((s, i) => s + (parseFloat(i.current_value) || 0), 0);
        const assets = pat.filter(p => p.type === 'asset').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
        const liab = pat.filter(p => p.type === 'liability').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
        somaMes.valor = totalInv + assets - liab;
      }

      valoresMensais[mes.index] = somaMes.valor;
    }

    this._renderSummary(ano, kpi, valoresMensais);
    this._renderSummaryTable(valoresMensais);
    this._renderChart(ano, kpi, valoresMensais);
    this._renderBreakdownTable(meses, porItem, breakdown);
  },

  _kpiLabel(kpi) {
    return {
      income: 'Receitas',
      expense: 'Despesas',
      balance: 'Saldo Líquido',
      livingExpenses: 'Custo de Vida',
      totalBalance: 'Saldo Total',
      netWorth: 'Patrimônio Líquido'
    }[kpi] || kpi;
  },

  _renderSummary(ano, kpi, valores) {
    const container = document.getElementById('annualSummaryCards');
    if (!container) return;

    const total = valores.reduce((s, v) => s + v, 0);
    const valoresComMov = valores.filter(v => v !== 0);
    const media = valoresComMov.length ? total / valoresComMov.length : 0;
    const max = Math.max(...valores);
    const min = Math.min(...valores);
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const idxMax = valores.indexOf(max);
    const idxMin = valores.indexOf(min);

    container.innerHTML = `
      <div class="card"><div class="card-label">Total ${ano}</div><div class="card-value">${App.utils.formatCurrency(total)}</div><div class="card-sub">${this._kpiLabel(kpi)}</div></div>
      <div class="card"><div class="card-label">Média Mensal</div><div class="card-value">${App.utils.formatCurrency(media)}</div><div class="card-sub">${valoresComMov.length} meses com movimento</div></div>
      <div class="card"><div class="card-label">Maior Mês</div><div class="card-value" style="color:var(--income);">${App.utils.formatCurrency(max)}</div><div class="card-sub">${MESES[idxMax]}</div></div>
      <div class="card"><div class="card-label">Menor Mês</div><div class="card-value" style="color:var(--expense);">${App.utils.formatCurrency(min)}</div><div class="card-sub">${MESES[idxMin]}</div></div>
    `;
  },

  _renderSummaryTable(valores) {
    const table = document.getElementById('annualSummaryTable');
    if (!table) return;
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const total = valores.reduce((s, v) => s + v, 0);

    // Linha Variação entre meses (mês - mês anterior)
    const variacao = valores.map((v, i) => i === 0 ? 0 : v - valores[i - 1]);
    // Linha Variação % (mês / mês anterior)
    const variacaoPct = valores.map((v, i) => {
      if (i === 0) return null;
      const prev = valores[i - 1];
      if (prev === 0) return null;
      return ((v - prev) / Math.abs(prev)) * 100;
    });

    const fmtCell = (v) => `<td class="text-right" style="padding:8px 10px;font-size:0.82rem;">${v === null ? '—' : App.utils.formatCurrency(v)}</td>`;
    const fmtPct = (v) => {
      if (v === null) return `<td class="text-right" style="padding:8px 10px;font-size:0.82rem;color:#888;">—</td>`;
      const cor = v >= 0 ? 'var(--income)' : 'var(--expense)';
      return `<td class="text-right" style="padding:8px 10px;font-size:0.82rem;color:${cor};">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</td>`;
    };

    table.querySelector('thead').innerHTML = `
      <tr>
        <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);min-width:160px;">Indicador</th>
        ${MESES.map(m => `<th style="text-align:right;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">${m}</th>`).join('')}
        <th style="text-align:right;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#fff;background:#1a1a1a;border-bottom:1px solid var(--border);">Total</th>
      </tr>
    `;
    table.querySelector('tbody').innerHTML = `
      <tr style="background:#161616;">
        <td style="text-align:left;padding:10px;font-weight:600;color:#fff;">Total Mensal</td>
        ${valores.map(v => fmtCell(v)).join('')}
        <td class="text-right" style="padding:10px;font-weight:700;color:#fff;background:#1a1a1a;">${App.utils.formatCurrency(total)}</td>
      </tr>
      <tr style="background:#121212;">
        <td style="text-align:left;padding:10px;font-weight:500;color:#b0b0b0;font-size:0.82rem;">Variação entre Meses</td>
        ${variacao.map(v => fmtCell(v)).join('')}
        <td class="text-right" style="padding:10px;color:#888;background:#1a1a1a;">—</td>
      </tr>
      <tr style="background:#0f0f0f;">
        <td style="text-align:left;padding:10px;font-weight:500;color:#b0b0b0;font-size:0.82rem;">Variação em %</td>
        ${variacaoPct.map(v => fmtPct(v)).join('')}
        <td class="text-right" style="padding:10px;color:#888;background:#1a1a1a;">—</td>
      </tr>
    `;
  },

  _renderChart(ano, kpi, valores) {
    const canvas = document.getElementById('annualMonthsChart');
    if (!canvas) return;
    if (this._chart) this._chart.destroy();

    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    document.getElementById('annualChartTitle').textContent = `${this._kpiLabel(kpi)} — ${ano}`;

    this._chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: MESES,
        datasets: [{
          label: this._kpiLabel(kpi),
          data: valores,
          backgroundColor: valores.map(v => v >= 0 ? 'rgba(0,212,170,0.75)' : 'rgba(255,71,87,0.75)'),
          borderColor: valores.map(v => v >= 0 ? '#00d4aa' : '#ff4757'),
          borderWidth: 1,
          borderRadius: 6,
          barPercentage: 0.7,
          categoryPercentage: 0.85,
          maxBarThickness: 42
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: '#1f1f1f' } },
          y: {
            ticks: { color: '#888', callback: v => App.utils.formatCurrency(v) },
            grid: { color: '#1f1f1f' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${App.utils.formatCurrency(ctx.raw)}`
            }
          }
        }
      }
    });
  },

  _renderBreakdownTable(meses, porItem, breakdown) {
    const table = document.getElementById('annualBreakdownTable');
    const empty = document.getElementById('annualBreakdownEmpty');
    if (!table) return;

    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const itens = Object.entries(porItem)
      .map(([nome, valores]) => ({ nome, valores, total: valores.reduce((s, v) => s + v, 0) }))
      .filter(it => it.total !== 0)
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

    if (!itens.length) {
      table.querySelector('thead').innerHTML = '';
      table.querySelector('tbody').innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    const titulo = breakdown === 'member' ? 'Membro' : 'Categoria';

    table.querySelector('thead').innerHTML = `
      <tr>
        <th style="text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);min-width:180px;">${titulo}</th>
        ${MESES.map(m => `<th style="text-align:right;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#888;background:#0f0f0f;border-bottom:1px solid var(--border);">${m}</th>`).join('')}
        <th style="text-align:right;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;color:#fff;background:#1a1a1a;border-bottom:1px solid var(--border);">Total</th>
      </tr>
    `;

    const linhas = itens.map(it => {
      const cells = it.valores.map(v => {
        if (v === 0) return `<td class="text-right" style="padding:8px 10px;color:#3a3a3a;font-size:0.82rem;">—</td>`;
        const cor = v >= 0 ? 'var(--income)' : 'var(--expense)';
        return `<td class="text-right" style="padding:8px 10px;color:${cor};font-size:0.82rem;">${App.utils.formatCurrency(v)}</td>`;
      }).join('');
      return `<tr>
        <td style="text-align:left;padding:8px 10px;font-weight:500;font-size:0.85rem;color:#e0e0e0;">${it.nome}</td>
        ${cells}
        <td class="text-right" style="padding:8px 10px;font-weight:600;background:#1a1a1a;font-size:0.85rem;color:${it.total >= 0 ? 'var(--income)' : 'var(--expense)'};">${App.utils.formatCurrency(it.total)}</td>
      </tr>`;
    }).join('');

    // Linha de totais
    const totalPorMes = new Array(12).fill(0);
    itens.forEach(it => it.valores.forEach((v, i) => totalPorMes[i] += v));
    const totalGeral = totalPorMes.reduce((s, v) => s + v, 0);
    const linhaTotal = `<tr style="background:#161616;border-top:2px solid var(--border);">
      <td style="text-align:left;padding:10px;font-weight:700;color:#fff;">Total</td>
      ${totalPorMes.map(v => `<td class="text-right" style="padding:10px;font-weight:600;color:#fff;font-size:0.82rem;">${App.utils.formatCurrency(v)}</td>`).join('')}
      <td class="text-right" style="padding:10px;font-weight:700;color:#fff;background:#1a1a1a;">${App.utils.formatCurrency(totalGeral)}</td>
    </tr>`;

    table.querySelector('tbody').innerHTML = linhas + linhaTotal;
  }
};

App.fontesPagadoras = {
  async load() {
    const fontes = await App.db.getAll('fontesPagadoras');
    fontes.sort((a, b) => (b.data_entrada || '').localeCompare(a.data_entrada || ''));
    this.renderList(fontes);
    await this.loadPayrolls();
  },

  renderList(fontes) {
    const tbody = document.getElementById('fontesPagadorasTableBody');
    const empty = document.getElementById('fontesPagadorasEmpty');
    const cardsContainer = document.getElementById('fontesPagadorasCards');
    
    if (!fontes.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      if (cardsContainer) cardsContainer.innerHTML = '';
      return;
    }
    empty.style.display = 'none';

    const totalGeral = fontes.reduce((s, f) => s + (f.total_recebido || 0), 0);
    if (cardsContainer) {
      cardsContainer.innerHTML = `
        <div class="card"><div class="card-label">Total de Fontes</div><div class="card-value">${fontes.length}</div></div>
        <div class="card"><div class="card-label">Total Recebido</div><div class="card-value">${App.utils.formatCurrency(totalGeral)}</div></div>
      `;
    }

    tbody.innerHTML = fontes.map(f => {
      const entrada = f.data_entrada ? App.utils.formatDate(f.data_entrada) : '--';
      const saida = f.data_saida ? App.utils.formatDate(f.data_saida) : 'Ativo';
      return `<tr>
        <td><span style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="App.fontesPagadoras.verTransacoes('${f.id}')" title="Ver transações desta fonte">${f.razao_social}</span></td>
        <td>${f.cnpj || '--'}</td>
        <td>${entrada}</td>
        <td>${saida}</td>
        <td class="text-right">${App.utils.formatCurrency(f.total_recebido || 0)}</td>
        <td class="text-center actions-cell">
          <button class="icon-btn" onclick="App.fontesPagadoras.edit('${f.id}')">✏️</button>
          <button class="icon-btn delete" onclick="App.fontesPagadoras.remove('${f.id}')">🗑️</button>
        </td>
      </tr>`;
    }).join('');
  },

  async openModal(fonte = null) {
    document.getElementById('fpId').value = fonte?.id || '';
    document.getElementById('modalFontePagadoraTitle').textContent = fonte ? 'Editar Fonte Pagadora' : 'Nova Fonte Pagadora';
    document.getElementById('fpRazaoSocial').value = fonte?.razao_social || '';
    document.getElementById('fpCnpj').value = fonte?.cnpj || '';
    document.getElementById('fpDataEntrada').value = fonte?.data_entrada || '';
    document.getElementById('fpDataSaida').value = fonte?.data_saida || '';
    document.getElementById('fpObservacoes').value = fonte?.observacoes || '';
    App.ui.openModal('modalFontePagadora');
  },

  async edit(id) {
    const fonte = await App.db.getById('fontesPagadoras', id);
    if (fonte) this.openModal(fonte);
  },

  async save(e) {
    e.preventDefault();
    const id = document.getElementById('fpId').value;
    const razao_social = document.getElementById('fpRazaoSocial').value.trim();
    const cnpj = document.getElementById('fpCnpj').value.trim();
    const data_entrada = document.getElementById('fpDataEntrada').value;
    const data_saida = document.getElementById('fpDataSaida').value;
    const observacoes = document.getElementById('fpObservacoes').value.trim();

    if (!razao_social) { App.utils.showToast('Razão Social é obrigatória', 'error'); return false; }

    const fonte = {
      id: id || App.utils.generateId(),
      razao_social,
      cnpj,
      data_entrada,
      data_saida,
      observacoes,
      total_recebido: id ? (await App.db.getById('fontesPagadoras', id))?.total_recebido || 0 : 0
    };

    await App.db.put('fontesPagadoras', fonte);
    App.ui.closeModal('modalFontePagadora');
    App.utils.showToast(id ? 'Fonte atualizada!' : 'Fonte cadastrada!');
    this.load();
    return false;
  },

  async remove(id) {
    App.utils.confirm('Excluir fonte pagadora?', async () => {
      await App.db.delete('fontesPagadoras', id);
      this.load();
      App.utils.showToast('Fonte removida.');
    });
  },

  async verTransacoes(fonteId) {
    const fonte = await App.db.getById('fontesPagadoras', fonteId);
    if (!fonte) return;

    const allTx = await App.db.getAll('transactions');
    const txFonteBase = allTx.filter(t => t.fonte_pagadora_id === fonteId);

    if (!txFonteBase.length) {
      App.utils.showToast('Nenhuma transação para esta fonte pagadora.', 'info');
      return;
    }

    const tableBody = document.getElementById('cardDetailTableBody');
    const totalEl = document.getElementById('cardDetailTotal');
    const titleEl = document.getElementById('cardDetailTitle');
    const filterDiv = document.getElementById('cardDetailFilters');
    if (!tableBody || !totalEl || !titleEl || !filterDiv) return;

    titleEl.textContent = `📋 Transações da Fonte: ${fonte.razao_social}`;
    filterDiv.style.display = 'block';

    // Coleta as categorias únicas da fonte, ordenadas alfabeticamente
    const categoriasUnicas = [...new Set(
      txFonteBase.map(t => t.category).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    // Monta o filtro de data, categoria e ordenação
    filterDiv.innerHTML = `
      <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block;">Data início</label>
          <input type="date" id="fpFilterStart" style="padding:6px; border-radius:6px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border);">
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block;">Data fim</label>
          <input type="date" id="fpFilterEnd" style="padding:6px; border-radius:6px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border);">
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block;">Categoria</label>
          <select id="fpFilterCategory" style="padding:6px; border-radius:6px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border); min-width:180px;">
            <option value="">Todas as categorias</option>
            ${categoriasUnicas.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--text-muted); display:block;">Ordenar</label>
          <select id="fpFilterOrder" style="padding:6px; border-radius:6px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border);">
            <option value="desc">Mais recentes</option>
            <option value="asc">Mais antigas</option>
          </select>
        </div>
        <button class="btn btn-sm btn-primary" id="fpFilterApply" style="margin-bottom:2px;">Filtrar</button>
      </div>
    `;

    const typeNames = {
      income: 'Receita', expense: 'Despesa', transfer: 'Transferência',
      contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno'
    };

    const renderList = (txList) => {
      let html = '';
      txList.forEach(t => {
        const sign = t.type === 'income' || t.type === 'refund' ? '+' : '-';
        html += `<tr>
          <td>${App.utils.formatDateTime(t.date)}</td>
          <td>${typeNames[t.type] || t.type}</td>
          <td></td>
          <td>${t.category || '-'}</td>
          <td>${t.description || ''}</td>
          <td>${t.member_name || ''}</td>
          <td class="text-right" style="color:${sign === '+' ? 'var(--income)' : 'var(--expense)'};">${sign} ${App.utils.formatCurrency(Math.abs(parseFloat(t.amount)))}</td>
        </tr>`;
      });
      tableBody.innerHTML = html || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">Nenhuma transação encontrada com os filtros aplicados.</td></tr>';

      const total = txList.reduce((s, t) => {
        const amt = parseFloat(t.amount) || 0;
        return t.type === 'income' || t.type === 'refund' ? s + amt : s - amt;
      }, 0);
      totalEl.innerHTML = `Total líquido: <strong>${App.utils.formatCurrency(total)}</strong> <span style="color:var(--text-muted); font-weight:400; font-size:0.85rem;">(${txList.length} transaç${txList.length === 1 ? 'ão' : 'ões'})</span>`;
    };

    // Define valores padrão dos inputs (primeiro e último dia do range)
    const dates = txFonteBase.map(t => t.date.slice(0,10)).sort();
    if (dates.length > 0) {
      document.getElementById('fpFilterStart').value = dates[0];
      document.getElementById('fpFilterEnd').value = dates[dates.length - 1];
    }

    const applyFilter = () => {
      const start = document.getElementById('fpFilterStart').value;
      const end = document.getElementById('fpFilterEnd').value;
      const category = document.getElementById('fpFilterCategory').value;
      const order = document.getElementById('fpFilterOrder').value;

      let txList = txFonteBase.filter(t => {
        const d = t.date.slice(0,10);
        if (start && d < start) return false;
        if (end && d > end) return false;
        if (category && t.category !== category) return false;
        return true;
      });

      txList.sort((a, b) => {
        const cmp = a.date.localeCompare(b.date);
        return order === 'asc' ? cmp : -cmp;
      });

      renderList(txList);
    };

    document.getElementById('fpFilterApply').addEventListener('click', applyFilter);
    document.getElementById('fpFilterOrder').addEventListener('change', applyFilter);
    document.getElementById('fpFilterCategory').addEventListener('change', applyFilter);

    // Aplica uma vez para exibir todos os registros (ou conforme datas padrão)
    applyFilter();

    App.ui.openModal('modalCardDetail');
  },

  _payrollItems: { earning: [], deduction: [] },

  async openPayrollModal() {
    this._payrollItems = { earning: [{ desc: 'Salário Base', value: 0 }], deduction: [] };
    
    const fontes = await App.db.getAll('fontesPagadoras');
    const members = App.cache.members || await App.db.getAll('members');
    
    document.getElementById('payrollFonte').innerHTML = fontes.map(f => `<option value="${f.id}">${f.razao_social}</option>`).join('');
    document.getElementById('payrollMember').innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    
    const today = new Date();
    document.getElementById('payrollCompetencia').value = today.toISOString().slice(0, 7);
    document.getElementById('payrollDataVencimento').value = App.utils.todayISO();
    
    this.renderPayrollItems();
    App.ui.openModal('modalPayroll');
  },

  addPayrollItem(type) {
    this._payrollItems[type].push({ desc: '', value: 0 });
    this.renderPayrollItems();
  },

  removePayrollItem(type, index) {
    this._payrollItems[type].splice(index, 1);
    this.renderPayrollItems();
  },

  updatePayrollItem(type, index, field, val) {
    this._payrollItems[type][index][field] = field === 'value' ? (parseFloat(val) || 0) : val;
    this.calcPayrollNetTotal();
  },

  renderPayrollItems() {
    const renderList = (type, containerId) => {
      const container = document.getElementById(containerId);
      container.innerHTML = this._payrollItems[type].map((item, i) => `
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" placeholder="Descrição (ex: INSS)" value="${item.desc}" oninput="App.fontesPagadoras.updatePayrollItem('${type}', ${i}, 'desc', this.value)" style="flex:1; padding:6px;">
          <input type="number" step="0.01" placeholder="R$" value="${item.value || ''}" oninput="App.fontesPagadoras.updatePayrollItem('${type}', ${i}, 'value', this.value)" style="width:100px; padding:6px;">
          <button type="button" class="btn btn-ghost" onclick="App.fontesPagadoras.removePayrollItem('${type}', ${i})" style="padding:6px 10px;">✕</button>
        </div>
      `).join('');
    };
    renderList('earning', 'payrollEarningsList');
    renderList('deduction', 'payrollDeductionsList');
    this.calcPayrollNetTotal();
  },

  calcPayrollNetTotal() {
    const totalEarnings = this._payrollItems.earning.reduce((s, i) => s + i.value, 0);
    const totalDeductions = this._payrollItems.deduction.reduce((s, i) => s + i.value, 0);
    const net = totalEarnings - totalDeductions;
    document.getElementById('payrollNetTotal').textContent = App.utils.formatCurrency(net);
    this._currentNetTotal = net;
  },

  async savePayroll(e) {
    e.preventDefault();
    if (this._currentNetTotal <= 0) {
      App.utils.showToast('O valor líquido deve ser maior que zero.', 'error');
      return false;
    }

    const fonteId = document.getElementById('payrollFonte').value;
    const memberId = document.getElementById('payrollMember').value;
    const competencia = document.getElementById('payrollCompetencia').value;
    const vencimento = document.getElementById('payrollDataVencimento').value;

    const payroll = {
      id: App.utils.generateId(),
      fonte_id: fonteId,
      member_id: memberId,
      competencia: competencia,
      data_vencimento: vencimento,
      items: JSON.parse(JSON.stringify(this._payrollItems)),
      net_value: this._currentNetTotal,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    await App.db.put('payrolls', payroll);
    App.ui.closeModal('modalPayroll');
    App.utils.showToast('Vencimento lançado com sucesso!');
    this.load();
    return false;
  },

  async loadPayrolls() {
    const tbody = document.getElementById('payrollTableBody');
    if (!tbody) return;

    const payrolls = await App.db.getAll('payrolls');
    const pending = payrolls.filter(p => p.status === 'pending').sort((a,b) => a.data_vencimento.localeCompare(b.data_vencimento));
    const fontes = await App.db.getAll('fontesPagadoras');
    const fonteMap = Object.fromEntries(fontes.map(f => [f.id, f.razao_social]));

    const totalEl = document.getElementById('pendingPayrollsTotal');
    const emptyEl = document.getElementById('payrollEmpty');

    if (pending.length === 0) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (totalEl) totalEl.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const totalPendente = pending.reduce((s, p) => s + (parseFloat(p.net_value) || 0), 0);
    if (totalEl) {
      totalEl.innerHTML = `Total a receber: <strong style="color:var(--income);">${App.utils.formatCurrency(totalPendente)}</strong> <span style="color:var(--text-muted); font-size:0.85rem;">(${pending.length} vencimento${pending.length === 1 ? '' : 's'})</span>`;
    }

    tbody.innerHTML = pending.map(p => `
      <tr>
        <td><strong>${fonteMap[p.fonte_id] || 'Fonte Excluída'}</strong><br><small style="color:var(--text-muted);">Ref. ${p.competencia}</small></td>
        <td>${App.utils.formatDate(p.data_vencimento)}</td>
        <td class="text-right" style="color:var(--income); font-weight:600;">${App.utils.formatCurrency(p.net_value)}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-primary" onclick="App.fontesPagadoras.openLiquidateModal('${p.id}')">Receber</button>
          <button class="btn btn-sm btn-ghost" onclick="App.fontesPagadoras.deletePayroll('${p.id}')">🗑️</button>
        </td>
      </tr>
    `).join('');
  },

  async openPendingPayrollsModal() {
    await this.loadPayrolls();
    App.ui.openModal('modalPendingPayrolls');
  },

  async openLiquidateModal(payrollId) {
    const payroll = await App.db.getById('payrolls', payrollId);
    if (!payroll) return;

    document.getElementById('liqPayrollId').value = payroll.id;
    document.getElementById('liqPayrollValue').value = App.utils.formatCurrency(payroll.net_value);
    document.getElementById('liqPayrollDate').value = App.utils.todayISO();
    
    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    document.getElementById('liqPayrollAccount').innerHTML = accounts.filter(a => !a.archived).map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    App.ui.openModal('modalLiquidatePayroll');
  },

  async confirmLiquidatePayroll() {
    const payrollId = document.getElementById('liqPayrollId').value;
    const accountId = document.getElementById('liqPayrollAccount').value;
    const date = document.getElementById('liqPayrollDate').value;

    const payroll = await App.db.getById('payrolls', payrollId);
    if (!payroll) return;

    const accounts = App.cache.accounts || await App.db.getAll('accounts');
    const acc = accounts.find(a => a.id === accountId);
    const fonte = await App.db.getById('fontesPagadoras', payroll.fonte_id);

    let notes = "Verbas:\n";
    payroll.items.earning.forEach(i => { if(i.value > 0) notes += `+ ${i.desc}: ${App.utils.formatCurrency(i.value)}\n`; });
    notes += "\nDescontos:\n";
    payroll.items.deduction.forEach(i => { if(i.value > 0) notes += `- ${i.desc}: ${App.utils.formatCurrency(i.value)}\n`; });

    const txId = App.utils.generateId();
    const tx = {
      id: txId,
      type: 'income',
      amount: payroll.net_value,
      category: 'Salário',
      description: `Recebimento ${fonte.razao_social} - ${payroll.competencia}`,
      date: date + 'T12:00:00',
      account_id: accountId,
      account_name: acc.name,
      member_id: payroll.member_id,
      member_name: (App.cache.members.find(m => m.id === payroll.member_id) || {}).name || '',
      status: 'confirmed',
      notes: notes,
      createdAt: new Date().toISOString(),
      position: Date.now()
    };

    await App.db.put('transactions', tx);

    payroll.status = 'received';
    payroll.transaction_id = txId;
    await App.db.put('payrolls', payroll);

    if (fonte) {
      fonte.total_recebido = (fonte.total_recebido || 0) + payroll.net_value;
      await App.db.put('fontesPagadoras', fonte);
    }

    App.ui.closeModal('modalLiquidatePayroll');
    App.utils.showToast('Recebimento efetivado e lançado nas movimentações!');
    
    this.load(); 
    App.transactions.invalidateCache?.();
    App.saldos.load();
    App.dashboard.refresh();
  },

  async deletePayroll(id) {
    App.utils.confirm('Excluir esta previsão de vencimento?', async () => {
      await App.db.delete('payrolls', id);
      this.load();
      App.utils.showToast('Previsão excluída.');
    });
  }
};

// =======================================================================
// Busca Global
// =======================================================================
App.search = {
  term: '',

  async load() {
    // Obtém o termo da barra global se ainda não estiver definido
    if (!this.term) {
      const globalInput = document.getElementById('globalSearchInput');
      this.term = globalInput ? globalInput.value.trim() : '';
    }
    const term = this.term || '';
    document.getElementById('searchResults').innerHTML = '<p style="color:var(--text-muted);">Digite ao menos 2 caracteres para buscar.</p>';
    if (term.length < 2) return;

    const results = await this.execute(term);
    this.render(results);
  },

  async execute(term) {
    const lower = term.toLowerCase();
    const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const results = { transactions: [], accounts: [], members: [], categories: [] };

    const [transactions, accounts, members, categories] = await Promise.all([
      App.db.getAll('transactions'),
      App.db.getAll('accounts'),
      App.db.getAll('members'),
      App.db.getAll('categories')
    ]);

    transactions.forEach(t => {
      const fields = [t.description, t.category, t.account_name, t.member_name, t.notes].map(normalize);
      if (fields.some(f => f.includes(normalize(term)))) {
        results.transactions.push(t);
      }
    });

    accounts.forEach(a => {
      if (normalize(a.name).includes(normalize(term))) results.accounts.push(a);
    });

    members.forEach(m => {
      if (normalize(m.name).includes(normalize(term))) results.members.push(m);
    });

    categories.forEach(c => {
      if (normalize(c.name).includes(normalize(term))) results.categories.push(c);
    });

    results.transactions = results.transactions.slice(0, 50);
    results.accounts = results.accounts.slice(0, 20);
    results.members = results.members.slice(0, 20);
    results.categories = results.categories.slice(0, 20);

    return results;
  },

  render(results) {
    const container = document.getElementById('searchResults');
    if (!container) return;
    const total = results.transactions.length + results.accounts.length + results.members.length + results.categories.length;
    if (total === 0) {
      container.innerHTML = '<div class="empty-state">🔍 Nenhum resultado encontrado.</div>';
      return;
    }

    let html = `<p style="margin-bottom:16px; color:var(--text-muted);">${total} resultado(s) encontrado(s).</p>`;

    if (results.transactions.length > 0) {
      html += `<h3>💳 Transações (${results.transactions.length})</h3>
        <div class="table-container">
          <table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th class="text-right">Valor</th></tr></thead><tbody>`;
      results.transactions.forEach(t => {
        const typeNames = {income:'Receita',expense:'Despesa',transfer:'Transferência',contribution:'Aporte',withdrawal:'Resgate',refund:'Estorno'};
        const sign = t.type==='income'||t.type==='contribution'||t.type==='refund'||(t.type==='transfer' && t.transfer_subtype==='loan_payment')?'+':'-';
        html += `<tr style="cursor:pointer;" onclick="App.transactions.edit('${t.id}')">
          <td>${App.utils.formatDateTime(t.date)}</td>
          <td>${typeNames[t.type] || t.type}</td>
          <td>${t.description || ''}</td>
          <td>${t.category || ''}</td>
          <td>${t.account_name || ''}</td>
          <td class="text-right">${sign} ${App.utils.formatCurrency(t.amount)}</td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

    if (results.accounts.length > 0) {
      html += `<h3>🏦 Contas (${results.accounts.length})</h3>
        <div class="table-container">
          <table><thead><tr><th>Nome</th><th>Tipo</th><th class="text-center">Ações</th></tr></thead><tbody>`;
      results.accounts.forEach(a => {
        html += `<tr style="cursor:pointer;" onclick="App.accountDetail.load('${a.id}')">
          <td>${a.name}</td>
          <td>${a.type}</td>
          <td class="text-center"><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();App.accounts.edit('${a.id}')">✏️</button></td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

    if (results.members.length > 0) {
      html += `<h3>👥 Membros (${results.members.length})</h3>
        <div class="table-container">
          <table><thead><tr><th>Nome</th><th class="text-center">Ações</th></tr></thead><tbody>`;
      results.members.forEach(m => {
        html += `<tr style="cursor:pointer;" onclick="App.memberDetail.load('${m.id}')">
          <td>${m.name}</td>
          <td class="text-center"><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();App.members.edit('${m.id}')">✏️</button></td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

    if (results.categories.length > 0) {
      html += `<h3>🏷️ Categorias (${results.categories.length})</h3>
        <div class="table-container">
          <table><thead><tr><th>Nome</th><th>Tipo</th><th class="text-center">Ações</th></tr></thead><tbody>`;
      results.categories.forEach(c => {
        html += `<tr style="cursor:pointer;" onclick="App.categorization.edit('${c.id}')">
          <td>${c.name}</td>
          <td>${c.type==='expense'?'Despesa':'Receita'}</td>
          <td class="text-center"><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();App.categorization.edit('${c.id}')">✏️</button></td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

        container.innerHTML = html;
  }
};

// =======================================================================
// Histórico Financeiro – dashboard dinâmico com agregação diária/mensal/anual
// =======================================================================
App.financialHistory = {
  chart: null,
  percentageMode: false,
  chartType: 'line',
  originalData: null,
  monthlyData: [],
  aggregation: 'monthly',

  async load() {
    try {
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }

      this.setupFilters();

      const aggregationSelect = document.getElementById('fhAggregationFilter');
      const periodSelect = document.getElementById('fhPeriodFilter');

      let periodType = periodSelect ? periodSelect.value : 'last12';
      let aggregation = aggregationSelect ? aggregationSelect.value : 'monthly';

      // Se o usuário escolher "Últimos 30 dias", força a agregação diária
      if (periodType === 'last30') {
        aggregation = 'daily';
        if (aggregationSelect) aggregationSelect.value = 'daily';
      }

      this.aggregation = aggregation;

      const periods = await this.getPeriods(aggregation, periodType);
      const data = await this.buildDataFromPeriods(periods);

      this.monthlyData = data;
      this.originalData = {
        labels: data.map(d => d.shortLabel),
        renda: data.map(d => d.renda),
        consumo: data.map(d => d.consumo),
        divida: data.map(d => d.divida),
        patrimonio: data.map(d => d.patrimonio)
      };

      this.renderChart(data);
      this.renderSummary(data);
      this.renderAnalytics(data);
      this.renderTip(data);
      await this.renderPurchaseHistory(periods);

      if (window.lucide) {
        lucide.createIcons();
      }

      this.setupTabs();
      this.setupPercentMode();
      this.setupChartType();
      this.updateAlertBadge();
    } catch (e) {
      console.error('Erro ao carregar Histórico Financeiro:', e);
      App.utils.showToast('Erro ao carregar histórico.', 'error');
    }
  },

  async getPeriods(aggregation, periodType) {
    if (aggregation === 'daily') return this.getDailyPeriods(periodType);
    if (aggregation === 'annual') return this.getAnnualPeriods(periodType);
    return this.getMonthlyPeriods(periodType);
  },

  async getMonthlyPeriods(periodType) {
    const today = new Date();
    let startDate, endDate;

    if (periodType === 'next12') {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate = new Date(today.getFullYear(), today.getMonth() + 11, 1);
    } else if (periodType === 'last3') {
      startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      endDate = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (periodType === 'last6') {
      startDate = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      endDate = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (periodType === 'all') {
      const allTx = await App.db.getAll('transactions');
      if (allTx.length > 0) {
        const dates = allTx.map(t => new Date(t.date.slice(0, 10) + 'T12:00:00'));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        startDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        endDate = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
      } else {
        startDate = new Date(today.getFullYear(), today.getMonth() - 11, 1);
        endDate = new Date(today.getFullYear(), today.getMonth(), 1);
      }
    } else { // last12 default
      startDate = new Date(today.getFullYear(), today.getMonth() - 11, 1);
      endDate = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    const months = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const start = App.utils.monthRangeFromDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`).start;
      const end = App.utils.monthRangeFromDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`).end;
      const shortLabel = d.toLocaleDateString('pt-BR', { month: 'short' });
      months.push({
        start,
        end,
        shortLabel,
        fullLabel: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        year: d.getFullYear(),
        monthIndex: d.getMonth()
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  },

  async getDailyPeriods(periodType) {
    const today = new Date();
    let startDate, endDate;

    if (periodType === 'next12') {
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      endDate = new Date(today.getFullYear(), today.getMonth() + 11, today.getDate());
         } else if (periodType === 'last3') {
        startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2 * 30);
        endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      } else if (periodType === 'last6') {
        startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5 * 30);
        endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      } else if (periodType === 'last30') {
        startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
        endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      } else if (periodType === 'all') {
      const allTx = await App.db.getAll('transactions');
      if (allTx.length > 0) {
        const dates = allTx.map(t => new Date(t.date.slice(0, 10) + 'T12:00:00'));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        startDate = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
        endDate = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
      } else {
        startDate = new Date(today.getFullYear(), today.getMonth() - 11, today.getDate());
        endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      }
    } else { // last12 default
      startDate = new Date(today.getFullYear(), today.getMonth() - 11, today.getDate());
      endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    }

    const days = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const d = new Date(cursor);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({
        start: dateStr,
        end: dateStr + 'T23:59:59',
        shortLabel: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
        fullLabel: d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        year: d.getFullYear(),
        monthIndex: d.getMonth(),
        dayIndex: d.getDate()
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  },

  async getAnnualPeriods(periodType) {
    const today = new Date();
    let startYear, endYear;

    if (periodType === 'next12') {
      startYear = today.getFullYear();
      endYear = today.getFullYear() + 11;
    } else if (periodType === 'last3') {
      startYear = today.getFullYear() - 2;
      endYear = today.getFullYear();
    } else if (periodType === 'last6') {
      startYear = today.getFullYear() - 5;
      endYear = today.getFullYear();
    } else if (periodType === 'all') {
      const allTx = await App.db.getAll('transactions');
      if (allTx.length > 0) {
        const years = allTx.map(t => new Date(t.date.slice(0, 10) + 'T12:00:00').getFullYear());
        startYear = Math.min(...years);
        endYear = Math.max(...years);
      } else {
        startYear = today.getFullYear() - 11;
        endYear = today.getFullYear();
      }
    } else { // last12 default
      startYear = today.getFullYear() - 11;
      endYear = today.getFullYear();
    }

    const years = [];
    for (let y = startYear; y <= endYear; y++) {
      years.push({
        start: `${y}-01-01`,
        end: `${y}-12-31T23:59:59`,
        shortLabel: y.toString(),
        fullLabel: y.toString(),
        year: y
      });
    }
    return years;
  },

  async buildDataFromPeriods(periods) {
    const allTx = await App.db.getAll('transactions');
    const loans = await App.db.getAll('loans');
    const investments = await App.db.getAll('investments');
    const patrimony = await App.db.getAll('patrimony');
    const creditCards = App.cache.creditCards || await App.db.getAll('creditCards');

    return periods.map(period => {
      const periodTx = allTx.filter(t =>
        t.status === 'confirmed' &&
        t.date.slice(0, 10) >= period.start &&
        t.date.slice(0, 10) <= period.end
      );

      const renda = periodTx
        .filter(t => t.type === 'income' && !t.ignore_from_total)
        .reduce((s, t) => s + parseFloat(t.amount), 0);

      const consumo = periodTx
        .filter(t => t.type === 'expense' && !t.ignore_from_total)
        .reduce((s, t) => s + parseFloat(t.amount), 0);

      // Endividamento: empréstimos borroweds ativos + cartões de crédito pendentes + passivos de patrimônio
      let divida = 0;

      for (const loan of loans) {
        if (loan.type !== 'borrowed') continue;
        const loanDate = loan.date ? loan.date.slice(0, 10) : '';
        const paidDate = loan.paid_date ? loan.paid_date.slice(0, 10) : null;
        if (loanDate <= period.end && (!paidDate || paidDate > period.end)) {
          divida += parseFloat(loan.amount) || 0;
        }
      }

      for (const card of creditCards) {
        // Apenas parcelas pendentes futuras (ainda não pagas) cuja data está dentro do período são consideradas endividamento.
        const cardPendingExpenses = allTx
          .filter(t => 
            t.credit_card_id === card.id && 
            t.type === 'expense' && 
            t.status === 'pending' &&
            t.date.slice(0, 10) >= period.start &&
            t.date.slice(0, 10) <= period.end
          )
          .reduce((s, t) => s + parseFloat(t.amount), 0);
        const cardPendingRefunds = allTx
          .filter(t => 
            t.credit_card_id === card.id && 
            t.type === 'refund' && 
            t.status === 'pending' &&
            t.date.slice(0, 10) >= period.start &&
            t.date.slice(0, 10) <= period.end
          )
          .reduce((s, t) => s + parseFloat(t.amount), 0);
        divida += Math.max(0, cardPendingExpenses - cardPendingRefunds);
      }

      const patrimonyLiabilities = patrimony
        .filter(p => p.type === 'liability' && (!p.date || p.date <= period.end))
        .reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
      divida += patrimonyLiabilities;

      // Patrimônio líquido: investimentos + ativos - passivos
      const totalInvestments = investments.reduce((s, inv) => s + (parseFloat(inv.current_value) || 0), 0);
      const assets = patrimony.filter(p => p.type === 'asset').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
      const liabilities = patrimony.filter(p => p.type === 'liability').reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
      const patrimonio = totalInvestments + assets - liabilities;

      return {
        ...period,
        renda,
        consumo,
        divida,
        patrimonio,
        saldo: renda - consumo
      };
    });
  },

  calculateAverage(arr) {
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  },

  calculateTrend(arr) {
    const n = arr.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    arr.forEach((y, x) => {
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return arr.map((_, x) => intercept + slope * x);
  },

  renderChart(data) {
    const canvas = document.getElementById('fhFinanceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const rendaData = data.map(m => m.renda);
    const consumoData = data.map(m => m.consumo);
    const dividaData = data.map(m => m.divida);
    const patrimonioData = data.map(m => m.patrimonio);

    const mediaRenda = this.calculateAverage(rendaData);
    const trendRenda = this.calculateTrend(rendaData);

    const isDaily = this.aggregation === 'daily';
    const pointHoverRadius = isDaily ? 4 : 6;
    const tension = isDaily ? 0.45 : 0.35;
    const borderWidth = isDaily ? 1.6 : 2.5;
    const chartFontFamily = "'Manrope', 'Inter', system-ui, -apple-system, sans-serif";

    // Converte cor hexadecimal (#rrggbb) em rgba(r,g,b,alpha)
    const hexToRgba = (hex, alpha) => {
      const clean = String(hex).replace('#', '');
      const bigint = parseInt(clean, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // Gradiente vertical suave (mais forte no topo, esmaecendo até a base)
    const buildAreaGradient = (chartCtx, chartArea, hex) => {
      const gradient = chartCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, hexToRgba(hex, 0.32));
      gradient.addColorStop(0.6, hexToRgba(hex, 0.06));
      gradient.addColorStop(1, hexToRgba(hex, 0));
      return gradient;
    };

    // backgroundColor "scriptable": recalcula o gradiente sempre que a área do gráfico é (re)definida,
    // então funciona corretamente em qualquer altura de tela (desktop e mobile)
    const gradientFor = (hex) => (context) => {
      const { chart } = context;
      const { ctx: chartCtx, chartArea } = chart;
      if (!chartArea) return hexToRgba(hex, 0.12);
      return buildAreaGradient(chartCtx, chartArea, hex);
    };

    // Datasets principais com preenchimento em gradiente
    const datasets = [
      {
        label: 'Renda',
        data: rendaData,
        borderColor: '#22c55e',
        backgroundColor: gradientFor('#22c55e'),
        borderWidth,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        pointHoverRadius,
        pointHoverBackgroundColor: '#22c55e',
        pointHoverBorderColor: '#0f151b',
        pointHoverBorderWidth: 2,
        tension,
        fill: true,
        spanGaps: true
      },
      {
        label: 'Consumo',
        data: consumoData,
        borderColor: '#ef4444',
        backgroundColor: gradientFor('#ef4444'),
        borderWidth,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        pointHoverRadius,
        pointHoverBackgroundColor: '#ef4444',
        pointHoverBorderColor: '#0f151b',
        pointHoverBorderWidth: 2,
        tension,
        fill: true,
        spanGaps: true
      },
      {
        label: 'Endividamento',
        data: dividaData,
        borderColor: '#f59e0b',
        backgroundColor: gradientFor('#f59e0b'),
        borderWidth,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        pointHoverRadius,
        pointHoverBackgroundColor: '#f59e0b',
        pointHoverBorderColor: '#0f151b',
        pointHoverBorderWidth: 2,
        tension,
        fill: true,
        spanGaps: true
      },
      {
        label: 'Patrimônio',
        data: patrimonioData,
        borderColor: '#8b5cf6',
        backgroundColor: gradientFor('#8b5cf6'),
        borderWidth,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        pointHoverRadius,
        pointHoverBackgroundColor: '#8b5cf6',
        pointHoverBorderColor: '#0f151b',
        pointHoverBorderWidth: 2,
        tension,
        fill: true,
        spanGaps: true
      },
      {
        label: 'Média histórica',
        data: data.map(() => mediaRenda),
        borderColor: 'rgba(226,232,240,.55)',
        borderWidth: 1.25,
        borderDash: [4, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: .3,
        fill: false,
        hidden: true
      },
      {
        label: 'Tendência',
        data: trendRenda,
        borderColor: 'rgba(148,163,184,.55)',
        borderWidth: 1.25,
        borderDash: [2, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: .2,
        fill: false,
        hidden: true
      }
    ];

    // Define o tipo de gráfico conforme seleção
    const chartType = this.chartType === 'area' ? 'line' : this.chartType;

    // Se for barra, ajusta borderWidth e pointRadius
    datasets.forEach(ds => {
      if (chartType === 'bar') {
        ds.borderWidth = 1;
        ds.pointRadius = 0;
        ds.pointHoverRadius = 0;
      }
    });

    // Plugin exclusivo deste gráfico (não é registrado globalmente, então não afeta
    // nenhum outro Chart.js do app): destaca o último ponto de cada série e esmaece
    // as demais séries quando o mouse passa sobre um item da legenda.
    const seriesEnhancementsPlugin = {
      id: 'fhSeriesEnhancements',
      beforeDatasetDraw(chart, args) {
        const focus = chart.$fhFocusIndex;
        if (focus === null || focus === undefined || args.index === focus) return;
        chart.ctx.save();
        chart.ctx.globalAlpha = 0.18;
      },
      afterDatasetDraw(chart, args) {
        const focus = chart.$fhFocusIndex;
        if (focus === null || focus === undefined || args.index === focus) return;
        chart.ctx.restore();
      },
      afterDatasetsDraw(chart) {
        if (chartType !== 'line') return;
        const chartCtx = chart.ctx;
        chart.data.datasets.forEach((dataset, i) => {
          if (dataset.borderDash && dataset.borderDash.length) return; // ignora Média/Tendência
          const meta = chart.getDatasetMeta(i);
          if (!meta || meta.hidden || dataset.hidden) return;
          const points = meta.data;
          if (!points || !points.length) return;

          let lastIndex = -1;
          for (let idx = dataset.data.length - 1; idx >= 0; idx--) {
            const v = dataset.data[idx];
            if (v !== null && v !== undefined && !Number.isNaN(v)) { lastIndex = idx; break; }
          }
          if (lastIndex === -1 || !points[lastIndex]) return;

          const focus = chart.$fhFocusIndex;
          const dimmed = focus !== null && focus !== undefined && focus !== i;
          const { x, y } = points[lastIndex].getProps(['x', 'y'], true);
          const color = dataset.borderColor;

          chartCtx.save();
          chartCtx.globalAlpha = dimmed ? 0.18 : 1;
          chartCtx.beginPath();
          chartCtx.arc(x, y, 8, 0, Math.PI * 2);
          chartCtx.fillStyle = hexToRgba(color, 0.16);
          chartCtx.fill();
          chartCtx.beginPath();
          chartCtx.arc(x, y, 4.5, 0, Math.PI * 2);
          chartCtx.fillStyle = '#0f151b';
          chartCtx.fill();
          chartCtx.lineWidth = 2;
          chartCtx.strokeStyle = color;
          chartCtx.stroke();
          chartCtx.beginPath();
          chartCtx.arc(x, y, 2, 0, Math.PI * 2);
          chartCtx.fillStyle = color;
          chartCtx.fill();
          chartCtx.restore();
        });
      }
    };

    // Tooltip customizado em HTML (mais elegante que o padrão do Chart.js).
    // Se o elemento #fhChartTooltip não existir no DOM (ex.: HTML ainda não atualizado),
    // cai automaticamente no tooltip nativo do Chart.js, já estilizado abaixo.
    const tooltipEl = document.getElementById('fhChartTooltip');

    const buildTooltipHtml = (tooltip) => {
      const points = tooltip.dataPoints || [];
      const idx = points.length ? points[0].dataIndex : null;
      const fullLabel = (idx !== null && data[idx]) ? data[idx].fullLabel : '';

      const rows = points.map(dp => {
        const ds = dp.dataset;
        const color = typeof ds.borderColor === 'string' ? ds.borderColor : '#8995a3';
        const isReference = ds.label === 'Média histórica' || ds.label === 'Tendência';
        const value = dp.parsed.y;
        let variationHtml = '';
        if (!isReference) {
          const prevValue = dp.dataIndex > 0 ? ds.data[dp.dataIndex - 1] : null;
          if (prevValue !== null && prevValue !== undefined && prevValue !== 0) {
            const diff = ((value - prevValue) / Math.abs(prevValue)) * 100;
            const up = diff >= 0;
            variationHtml = `<span style="display:inline-flex;align-items:center;gap:2px;margin-left:8px;color:${up ? '#34d399' : '#f87171'};font-weight:600;font-size:10.5px;">${up ? '▲' : '▼'}${Math.abs(diff).toFixed(1)}%</span>`;
          }
        }
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:3px 0;">`
          + `<span style="display:flex;align-items:center;gap:7px;min-width:0;">`
          + `<span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;"></span>`
          + `<span style="color:#9aa7b5;font-size:11px;white-space:nowrap;">${ds.label}</span>`
          + `</span>`
          + `<span style="display:flex;align-items:center;white-space:nowrap;">`
          + `<span style="color:#f1f5f9;font-weight:600;font-size:12px;">${App.utils.formatCurrency(value)}</span>`
          + variationHtml
          + `</span>`
          + `</div>`;
      }).join('');

      return `<div style="font-family:${chartFontFamily};background:#10161d;border:1px solid #394552;border-radius:10px;padding:10px 13px;box-shadow:0 12px 28px rgba(0,0,0,.45);min-width:210px;">`
        + `<div style="color:#f1f5f9;font-weight:600;font-size:12px;margin-bottom:6px;text-transform:capitalize;">${fullLabel}</div>`
        + rows
        + `</div>`;
    };

    const externalTooltipHandler = (context) => {
      const { chart, tooltip } = context;
      if (!tooltipEl) return;

      if (!tooltip || tooltip.opacity === 0) {
        tooltipEl.style.opacity = '0';
        return;
      }

      tooltipEl.innerHTML = buildTooltipHtml(tooltip);

      const wrapperWidth = chart.canvas.parentNode ? chart.canvas.parentNode.clientWidth : chart.width;
      const tooltipWidth = tooltipEl.offsetWidth || 220;
      const tooltipHeight = tooltipEl.offsetHeight || 90;
      let left = tooltip.caretX;
      const half = tooltipWidth / 2;
      if (left + half > wrapperWidth) left = wrapperWidth - half - 6;
      if (left - half < 0) left = half + 6;

      let top = tooltip.caretY - 14;
      if (top - tooltipHeight < 0) {
        top = tooltip.caretY + 18;
        tooltipEl.style.transform = 'translate(-50%, 0)';
      } else {
        tooltipEl.style.transform = 'translate(-50%, -100%)';
      }

      tooltipEl.style.opacity = '1';
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top = Math.max(top, 0) + 'px';
    };

    this.chart = new Chart(ctx, {
      type: chartType,
      data: {
        labels: data.map(m => m.shortLabel),
        datasets: datasets
      },
      plugins: [seriesEnhancementsPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 10, right: 16, bottom: 6, left: 6 }
        },
        animation: {
          duration: isDaily ? 0 : 800,
          easing: 'easeOutQuart'
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'start',
            labels: {
              color: '#8995a3',
              usePointStyle: true,
              pointStyle: 'circle',
              pointStyleWidth: 7,
              boxHeight: 7,
              padding: 18,
              font: { size: 10.5, family: chartFontFamily }
            },
            onHover(evt, legendItem, legend) {
              const targetChart = legend.chart;
              targetChart.canvas.style.cursor = 'pointer';
              targetChart.$fhFocusIndex = legendItem.datasetIndex;
              targetChart.draw();
            },
            onLeave(evt, legendItem, legend) {
              const targetChart = legend.chart;
              targetChart.canvas.style.cursor = 'default';
              targetChart.$fhFocusIndex = null;
              targetChart.draw();
            }
          },
          tooltip: {
            enabled: !tooltipEl,
            external: tooltipEl ? externalTooltipHandler : undefined,
            backgroundColor: '#10161d',
            borderColor: '#394552',
            borderWidth: 1,
            cornerRadius: 10,
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5df',
            padding: 12,
            titleFont: { size: 13, weight: '600', family: chartFontFamily },
            bodyFont: { size: 11, family: chartFontFamily },
            displayColors: true,
            usePointStyle: true,
            boxPadding: 6,
            callbacks: {
              title(items) {
                if (!items.length) return '';
                const idx = items[0].dataIndex;
                return data[idx].fullLabel;
              },
              label(context) {
                if (context.dataset.label === 'Média histórica') {
                  return ` Média histórica: ${App.utils.formatCurrency(context.parsed.y)}`;
                }
                if (context.dataset.label === 'Tendência') {
                  return ` Tendência: ${App.utils.formatCurrency(context.parsed.y)}`;
                }
                const valorAtual = context.parsed.y;
                const idx = context.dataIndex;
                const valorAnterior = idx > 0 ? context.dataset.data[idx - 1] : null;
                let variacao = '';
                if (valorAnterior !== null && valorAnterior !== undefined) {
                  const dif = ((valorAtual - valorAnterior) / Math.abs(valorAnterior)) * 100;
                  variacao = ` (${dif >= 0 ? '+' : ''}${dif.toFixed(1)}%)`;
                }
                return ` ${context.dataset.label}: ${App.utils.formatCurrency(valorAtual)}${variacao}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawBorder: false
            },
            border: { display: false },
            ticks: {
              color: '#8995a3',
              font: { size: 10, family: chartFontFamily },
              autoSkip: true,
              maxTicksLimit: isDaily ? 10 : 12,
              maxRotation: 0,
              autoSkipPadding: 12
            }
          },
          y: {
            beginAtZero: false,
            grace: '5%',
            border: { display: false },
            grid: {
              color: 'rgba(148,163,184,0.08)',
              drawBorder: false
            },
            ticks: {
              color: '#8995a3',
              font: { size: 11, family: chartFontFamily },
              maxTicksLimit: 5,
              padding: 8,
              callback(value) {
                return 'R$ ' + Number(value).toLocaleString('pt-BR');
              }
            }
          }
        }
      }
    });

    this.chart.$fhFocusIndex = null;
  },

  renderSummary(data) {
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const rendaAvg = avg(data.map(m => m.renda));
    const consumoAvg = avg(data.map(m => m.consumo));
    const dividaAvg = avg(data.map(m => m.divida));
    const patrimonioAvg = avg(data.map(m => m.patrimonio));

    document.getElementById('fhSummaryRenda').querySelector('.fh-summary-value').textContent = App.utils.formatCurrency(rendaAvg);
    document.getElementById('fhSummaryConsumo').querySelector('.fh-summary-value').textContent = App.utils.formatCurrency(consumoAvg);
    document.getElementById('fhSummaryDivida').querySelector('.fh-summary-value').textContent = App.utils.formatCurrency(dividaAvg);
    document.getElementById('fhSummaryPatrimonio').querySelector('.fh-summary-value').textContent = App.utils.formatCurrency(patrimonioAvg);

    document.getElementById('fhRendaChange').textContent = '--';
    document.getElementById('fhConsumoChange').textContent = '--';
    document.getElementById('fhDividaChange').textContent = '--';
    document.getElementById('fhPatrimonioChange').textContent = '--';

    const last3 = data.slice(-3);
    const rendaTrend = last3.length > 1 ? last3[last3.length - 1].renda - last3[0].renda : 0;
    const consumoTrend = last3.length > 1 ? last3[last3.length - 1].consumo - last3[0].consumo : 0;
    if (consumoTrend > rendaTrend && rendaTrend > 0) {
      document.getElementById('fhAlertBox').style.display = 'flex';
      document.getElementById('fhAlertTitle').textContent = 'Seu consumo está crescendo acima da renda nos últimos períodos.';
      document.getElementById('fhAlertSubtitle').textContent = 'Considere revisar seus gastos.';
    } else {
      document.getElementById('fhAlertBox').style.display = 'none';
    }
  },

  renderAnalytics(data) {
    const maxRenda = data.reduce((a, b) => (a.renda > b.renda ? a : b));
    document.getElementById('fhMaxRendaPeriod').textContent = maxRenda.fullLabel;
    document.getElementById('fhMaxRendaValue').textContent = App.utils.formatCurrency(maxRenda.renda);
    document.getElementById('fhMaxRendaFoot').textContent = `+${App.utils.formatCurrency(maxRenda.renda - this.calculateAverage(data.map(m => m.renda)))} acima da média`;

    const maxConsumo = data.reduce((a, b) => (a.consumo > b.consumo ? a : b));
    document.getElementById('fhMaxConsumoPeriod').textContent = maxConsumo.fullLabel;
    document.getElementById('fhMaxConsumoValue').textContent = App.utils.formatCurrency(maxConsumo.consumo);
    document.getElementById('fhMaxConsumoFoot').textContent = `+${App.utils.formatCurrency(maxConsumo.consumo - this.calculateAverage(data.map(m => m.consumo)))} acima da média`;

    const maxDivida = data.reduce((a, b) => (a.divida > b.divida ? a : b));
    document.getElementById('fhMaxDividaPeriod').textContent = maxDivida.fullLabel;
    document.getElementById('fhMaxDividaValue').textContent = App.utils.formatCurrency(maxDivida.divida);
    document.getElementById('fhMaxDividaFoot').textContent = `+${App.utils.formatCurrency(maxDivida.divida - (data[Math.max(0, data.length - 3)]?.divida || 0))} em 3 períodos`;

    const saldos = data.map(m => m.saldo);
    const saldoMedio = this.calculateAverage(saldos);
    document.getElementById('fhSaldoMedioValue').textContent = App.utils.formatCurrency(saldoMedio);
    document.getElementById('fhSaldoMedioFoot').textContent = `${((saldoMedio / this.calculateAverage(data.map(m => m.renda))) * 100).toFixed(1)}% da renda média`;

    // --- INÍCIO DA NOVA LÓGICA DE TENDÊNCIA E SAÚDE FINANCEIRA ---
    const hoje = new Date();
    const mesAtual = hoje.getMonth();
    const anoAtual = hoje.getFullYear();

    const dadosPassados = data.filter(m => {
      return (m.year < anoAtual) || (m.year === anoAtual && m.monthIndex <= mesAtual);
    });

    const recent = dadosPassados.slice(-3);
    this._lastTrendData = recent; // Salva para o modal
    let trendStatus = 'Estável';
    let trendDescription = 'Situação financeira equilibrada';
    let trendScore = 75; // Padrão de segurança

    if (recent.length > 0) {
      const ultimoMes = recent[recent.length - 1];
      const renda = ultimoMes.renda;
      const consumo = ultimoMes.consumo;
      
      // Calcula a Taxa de Poupança do último mês (quanto % da renda sobrou)
      let savingRate = 0;
      if (renda > 0) {
        savingRate = ((renda - consumo) / renda) * 100;
      }

      // Transforma a taxa de poupança em uma nota de 0 a 100
      trendScore = Math.max(0, Math.min(100, Math.round(savingRate)));
      
      // Define o texto com base na nota real
      if (savingRate >= 20) {
        trendStatus = 'Excelente';
        trendDescription = 'Ótima capacidade de poupança';
      } else if (savingRate >= 10) {
        trendStatus = 'Saudável';
        trendDescription = 'Boa margem de economia';
      } else if (savingRate >= 0) {
        trendStatus = 'Atenção';
        trendDescription = 'Equilibrado, mas sem muita folga';
      } else {
        trendStatus = 'Perigo';
        trendDescription = 'Gastos acima da renda';
        trendScore = Math.max(5, 30 + Math.round(savingRate)); // Força um valor bem baixo visualmente
      }

      // Bônus de tendência (se o consumo caiu e a renda subiu nos últimos 3 meses)
      if (recent.length > 1) {
        const trendConsumo = recent[recent.length - 1].consumo - recent[0].consumo;
        const trendRenda = recent[recent.length - 1].renda - recent[0].renda;
        
        if (trendConsumo < 0 && trendRenda > 0) {
           trendDescription = 'Renda subindo e consumo caindo. Excelente!';
           if (trendScore < 70) trendScore += 10; 
        } else if (trendConsumo > trendRenda && trendConsumo > 0) {
           trendStatus = 'Atenção';
           trendDescription = 'Consumo crescendo mais que a renda';
           trendScore = Math.min(trendScore, 50); 
        }
      }
    }

    // Atualiza os elementos na tela
    document.getElementById('fhTrendStatus').textContent = trendStatus;
    document.getElementById('fhTrendDescription').textContent = trendDescription;
    document.getElementById('fhProgressNumber').innerHTML = `${trendScore} <small>100</small>`;
    // --- FIM DA NOVA LÓGICA ---

    this.updateSparklines();
  },

  showTrendDetails() {
    if (!this._lastTrendData || this._lastTrendData.length === 0) {
      App.utils.showToast('Dados insuficientes para detalhar.', 'warning');
      return;
    }

    const tbody = document.getElementById('trendDetailTableBody');
    if (!tbody) return;

    tbody.innerHTML = this._lastTrendData.map(m => {
      const sobra = m.renda - m.consumo;
      let poupanca = 0;
      if (m.renda > 0) {
        poupanca = (sobra / m.renda) * 100;
      }

      let corPoupanca = 'var(--text)';
      if (poupanca >= 20) corPoupanca = 'var(--income)';
      else if (poupanca >= 10) corPoupanca = '#fbbf24';
      else if (poupanca >= 0) corPoupanca = '#f59e0b';
      else corPoupanca = 'var(--expense)';

      let corSobra = sobra >= 0 ? 'var(--income)' : 'var(--expense)';

      return `
        <tr>
          <td style="font-weight:500; text-transform:capitalize;">${m.fullLabel}</td>
          <td class="text-right">${App.utils.formatCurrency(m.renda)}</td>
          <td class="text-right">${App.utils.formatCurrency(m.consumo)}</td>
          <td class="text-right" style="color:${corSobra}; font-weight:600;">${App.utils.formatCurrency(sobra)}</td>
          <td class="text-right" style="color:${corPoupanca}; font-weight:700;">${poupanca.toFixed(1)}%</td>
        </tr>
      `;
    }).join('');

    App.ui.openModal('modalTrendDetail');
  },

  updateSparklines() {
    const data = this.monthlyData;
    const canvasElements = document.querySelectorAll('.fh-sparkline');
    canvasElements.forEach(canvas => {
      const color = canvas.dataset.color;
      let values = [];
      if (color === '#22c55e') values = data.map(m => m.renda);
      else if (color === '#ef4444') values = data.map(m => m.consumo);
      else if (color === '#f59e0b') values = data.map(m => m.divida);
      else if (color === '#8b5cf6') values = data.map(m => m.saldo);

      canvas.dataset.values = values.join(',');
      this.createSparkline(canvas, values, color);
    });
  },

  createSparkline(canvas, values, color) {
    if (!values.length) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: values.map((_, i) => i),
        datasets: [{
          data: values,
          borderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: .35,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { tension: .35 } }
      }
    });
  },

  renderTip(data) {
    const rendaGrowth = data.length > 1 ? ((data[data.length - 1].renda - data[0].renda) / Math.abs(data[0].renda)) * 100 : 0;
    const dividaGrowth = data.length > 1 ? ((data[data.length - 1].divida - data[0].divida) / Math.abs(data[0].divida)) * 100 || 0 : 0;
    const tipText = `Seu endividamento variou ${dividaGrowth.toFixed(1)}% no período, enquanto sua renda cresceu ${rendaGrowth.toFixed(1)}%. Tente aumentar sua taxa de poupança para pelo menos 20% da sua renda.`;
    document.getElementById('fhTipText').textContent = tipText;
  },

  // ===== Histórico de compras =====
  purchaseMethodLabels: {
    pix: 'Pix',
    credit_card: 'Crédito',
    debit_card: 'Débito',
    cash: 'Dinheiro',
    transfer: 'Transferência',
    boleto: 'Boleto',
    vale_alimentacao: 'Vale Alimentação'
  },

  purchaseMethodColors: {
    'Crédito': '#60a5fa',
    'Pix': '#a3e635',
    'Débito': '#f59e0b',
    'Dinheiro': '#a78bfa',
    'Transferência': '#34d399',
    'Boleto': '#f87171',
    'Vale Alimentação': '#fb923c',
    'Não informado': '#6b7280'
  },

  _resolvePurchaseMethod(t, cardById) {
    const card = t.credit_card_id ? cardById[t.credit_card_id] : null;
    let method = (t.payment_method || '').trim();

    // Cartões pré-pagos (vale alimentação) mantêm o método próprio;
    // os demais cartões são tratados como crédito, mesmo quando o
    // payment_method gravado está vazio (importações antigas).
    if (card) {
      if (card.card_type === 'prepaid') {
        if (!method) method = 'vale_alimentacao';
      } else {
        method = 'credit_card';
      }
    }
    if (!method) method = 'nao_informado';

    let label = this.purchaseMethodLabels[method];
    if (!label) label = method === 'nao_informado' ? 'Não informado' : method;

    return {
      label,
      color: this.purchaseMethodColors[label] || '#6b7280',
      cardName: card ? (card.name || '') : ''
    };
  },

  async renderPurchaseHistory(periods) {
    const tbody = document.getElementById('fhPurchasesTableBody');
    if (!tbody) return;

    this.setupPurchaseSearch();

    if (!periods || !periods.length) {
      this._purchases = [];
      this._purchasesCardById = {};
      this._purchasesRange = { start: '', end: '' };
      this._renderPurchasesView([], {}, '', '', '');
      return;
    }

    const start = periods[0].start;
    const end = periods[periods.length - 1].end;

    const allTx = await App.db.getAll('transactions');
    const cards = App.cache.creditCards || [];
    const cardById = Object.fromEntries(cards.map(c => [c.id, c]));

    // "Pagamento Fatura" é quitação de dívida do cartão e não uma compra.
    const _isFaturaPayment = (cat) => {
      if (!cat) return false;
      const norm = String(cat)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      return norm.startsWith('pagamento') && norm.includes('fatura');
    };

    const purchases = allTx
      .filter(t => {
        if (t.type !== 'expense') return false;
        if (t.ignore_from_total) return false;
        if ((t.status || 'confirmed') === 'cancelled') return false;
        if (_isFaturaPayment(t.category)) return false;
        const dateOnly = (t.date || '').slice(0, 10);
        return dateOnly >= start && dateOnly <= end;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    this._purchases = purchases;
    this._purchasesCardById = cardById;
    this._purchasesRange = { start, end };
    this._renderPurchasesView(purchases, cardById, start, end, this._purchaseSearchTerm || '');
  },

  setupPurchaseSearch() {
    if (this._purchaseSearchSetup) return;
    this._purchaseSearchSetup = true;

    const input = document.getElementById('fhPurchasesSearch');
    const rerender = (value) => {
      this._purchaseSearchTerm = value;
      this._renderPurchasesView(
        this._purchases || [],
        this._purchasesCardById || {},
        this._purchasesRange ? this._purchasesRange.start : '',
        this._purchasesRange ? this._purchasesRange.end : '',
        value
      );
    };

    if (input) {
      input.value = this._purchaseSearchTerm || '';
      input.addEventListener('input', () => rerender(input.value));
    }

    const clearBtn = document.getElementById('fhPurchasesSearchClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (input) { input.value = ''; input.focus(); }
        rerender('');
      });
    }
  },

  _matchesPurchaseSearch(t, cardById, normalizedTerm) {
    if (!normalizedTerm) return true;
    const m = this._resolvePurchaseMethod(t, cardById);
    const dateOnly = (t.purchase_date || t.date || '').slice(0, 10);
    const amount = parseFloat(t.amount) || 0;
    const haystack = [
      t.description || '',
      t.category || '',
      t.account_name || '',
      t.member_name || '',
      m.label,
      m.cardName,
      dateOnly,
      App.utils.formatDate(dateOnly),
      App.utils.formatCurrency(amount),
      String(amount)
    ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return haystack.includes(normalizedTerm);
  },

  _renderPurchasesView(allPurchases, cardById, start, end, term) {
    const methodsEl = document.getElementById('fhPurchasesMethods');
    const emptyEl = document.getElementById('fhPurchasesEmpty');
    const footEl = document.getElementById('fhPurchasesFoot');
    const countEl = document.getElementById('fhPurchasesCount');
    const totalEl = document.getElementById('fhPurchasesTotal');
    const tbody = document.getElementById('fhPurchasesTableBody');
    const clearBtn = document.getElementById('fhPurchasesSearchClear');
    if (!tbody) return;

    const esc = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const hexToRgba = (hex, alpha) => {
      const clean = String(hex).replace('#', '');
      const bigint = parseInt(clean, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const normalizedTerm = String(term || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim();
    if (clearBtn) clearBtn.style.display = (term || '').trim() ? 'grid' : 'none';

    const purchases = normalizedTerm
      ? allPurchases.filter(t => this._matchesPurchaseSearch(t, cardById, normalizedTerm))
      : allPurchases;

    const methodTotals = {};
    purchases.forEach(t => {
      const m = this._resolvePurchaseMethod(t, cardById);
      if (!methodTotals[m.label]) {
        methodTotals[m.label] = { total: 0, count: 0, color: m.color };
      }
      methodTotals[m.label].total += parseFloat(t.amount) || 0;
      methodTotals[m.label].count += 1;
    });

    const total = purchases.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    if (countEl) countEl.textContent = purchases.length;
    if (totalEl) totalEl.textContent = App.utils.formatCurrency(total);

    if (methodsEl) {
      const entries = Object.entries(methodTotals).sort((a, b) => b[1].total - a[1].total);
      methodsEl.innerHTML = entries.map(([label, info]) => `
        <div class="fh-purchase-method-chip" style="border-color:${hexToRgba(info.color, 0.45)};background:${hexToRgba(info.color, 0.12)};">
          <span class="fh-purchase-method-dot" style="background:${info.color};"></span>
          <span class="fh-purchase-method-name">${esc(label)}</span>
          <span class="fh-purchase-method-count">${info.count}x</span>
          <span class="fh-purchase-method-total">${App.utils.formatCurrency(info.total)}</span>
        </div>
      `).join('');
    }

    if (!purchases.length) {
      tbody.innerHTML = '';
      if (emptyEl) {
        emptyEl.textContent = normalizedTerm
          ? '🔎 Nenhuma compra encontrada para a busca'
          : '🛒 Nenhuma compra encontrada no período';
        emptyEl.style.display = 'block';
      }
      if (footEl) footEl.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    tbody.innerHTML = purchases.map(t => {
      const m = this._resolvePurchaseMethod(t, cardById);
      const dateLabel = App.utils.formatDate((t.purchase_date || t.date || '').slice(0, 10));
      const title = esc(t.description || t.category || 'Compra');
      const cat = (t.category && t.description)
        ? `<span class="fh-purchase-cat">${esc(t.category)}</span>`
        : '';
      const instCount = parseInt(t.installments) || 1;
      const inst = instCount > 1
        ? `<span class="fh-purchase-installment">${parseInt(t.installment_number) || 1}/${instCount}</span>`
        : '';
      const cardInfo = m.cardName
        ? `<span class="fh-purchase-card">${esc(m.cardName)}</span>`
        : '';
      const amount = parseFloat(t.amount) || 0;

      return `<tr>
        <td class="fh-purchase-date">${dateLabel}</td>
        <td class="fh-purchase-desc">
          <div class="fh-purchase-title">${title}${inst}</div>
          ${cat}
        </td>
        <td class="fh-purchase-method">
          <span class="fh-purchase-badge" style="border-color:${hexToRgba(m.color, 0.45)};background:${hexToRgba(m.color, 0.12)};color:${m.color};">
            <span class="fh-purchase-badge-dot" style="background:${m.color};"></span>${esc(m.label)}
          </span>
          ${cardInfo}
        </td>
        <td class="fh-purchase-value">${App.utils.formatCurrency(amount)}</td>
      </tr>`;
    }).join('');

    if (footEl) {
      footEl.style.display = 'block';
      const countLabel = `${purchases.length} ${purchases.length === 1 ? 'compra' : 'compras'}`;
      footEl.textContent = normalizedTerm
        ? `${countLabel} de ${allPurchases.length} encontradas para "${term.trim()}"`
        : `Período: ${App.utils.formatDate(start)} a ${App.utils.formatDate(end)} · ${countLabel}`;
    }
  },

  setupTabs() {
    if (this._tabsSetup) return;
    this._tabsSetup = true;

    const tabsContainer = document.getElementById('fhMetricTabs');
    const allMetricsButton = document.getElementById('fhAllMetrics');

    if (tabsContainer) {
      tabsContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.fh-metric-tab');
        if (!tab) return;
        tab.classList.toggle('active');
        this.updateChartVisibility();
      });
    }

    if (allMetricsButton) {
      allMetricsButton.addEventListener('click', () => {
        document.querySelectorAll('.fh-metric-tab').forEach(tab => tab.classList.add('active'));
        this.updateChartVisibility();
      });
    }

    // Ativa todas as métricas inicialmente
    document.querySelectorAll('.fh-metric-tab').forEach(tab => tab.classList.add('active'));
    this.updateChartVisibility();
  },

  updateChartVisibility() {
    const tabs = document.querySelectorAll('.fh-metric-tab');
    const activeMetrics = new Set();
    tabs.forEach(tab => {
      if (tab.classList.contains('active')) activeMetrics.add(tab.dataset.metric);
    });

    this.chart.data.datasets.forEach((dataset, index) => {
      if (index >= 4) return;
      const label = dataset.label.toLowerCase();
      let metricKey = '';
      if (label.includes('renda')) metricKey = 'renda';
      else if (label.includes('consumo')) metricKey = 'consumo';
      else if (label.includes('endividamento')) metricKey = 'divida';
      else if (label.includes('patrimônio')) metricKey = 'patrimonio';

      if (metricKey) dataset.hidden = !activeMetrics.has(metricKey);
    });
    this.chart.update();
  },

  setupPercentMode() {
    if (this._percentSetup) return;
    this._percentSetup = true;
    const btn = document.getElementById('fhPercentMode');
    if (!btn) return;
    btn.addEventListener('click', () => {
      this.percentageMode = !this.percentageMode;
      btn.classList.toggle('active', this.percentageMode);

      if (this.percentageMode) {
        const datasets = this.chart.data.datasets;
        const metrics = ['renda', 'consumo', 'divida', 'patrimonio'];
        metrics.forEach((metric, i) => {
          const original = this.originalData[metric];
          const avg = this.calculateAverage(original);
          datasets[i].data = original.map(v => avg ? (v / avg) * 100 : 0);
        });
        this.chart.options.scales.y.ticks.callback = value => `${Math.round(value)}%`;
      } else {
        const datasets = this.chart.data.datasets;
        const metrics = ['renda', 'consumo', 'divida', 'patrimonio'];
        metrics.forEach((metric, i) => {
          datasets[i].data = [...this.originalData[metric]];
        });
        this.chart.options.scales.y.ticks.callback = value => 'R$ ' + Number(value).toLocaleString('pt-BR');
      }
      this.chart.update();
    });
  },

  setupChartType() {
    if (this._chartTypeSetup) return;
    this._chartTypeSetup = true;
    const sel = document.getElementById('fhChartType');
    if (!sel) return;
    sel.addEventListener('change', () => {
      this.chartType = sel.value;
      this.load();
    });
  },

  setupFilters() {
    if (this._filtersSetup) return;
    this._filtersSetup = true;
    const aggregationSelect = document.getElementById('fhAggregationFilter');
    if (aggregationSelect) {
      aggregationSelect.addEventListener('change', () => this.load());
    }
    const periodSelect = document.getElementById('fhPeriodFilter');
    if (periodSelect) {
      periodSelect.addEventListener('change', () => this.load());
    }
    const monthSelect = document.getElementById('fhMonthFilter');
    if (monthSelect) {
      monthSelect.addEventListener('change', () => this.load());
    }
  },

  async updateAlertBadge() {
    const badge = document.getElementById('fhAlertBadge');
    if (!badge) return;
    try {
      const notifs = await App.db.getAll('notifications');
      const unread = notifs.filter(n => !n.read).length;
      badge.textContent = String(unread);
      badge.style.display = unread > 0 ? '' : 'none';
    } catch (e) {}
  },

  exportCSV() {
    if (!this.monthlyData || !this.monthlyData.length) {
      App.utils.showToast('Sem dados para exportar neste período.', 'error');
      return;
    }
    const headers = ['Período', 'Renda', 'Consumo', 'Endividamento', 'Patrimônio'];
    const rows = this.monthlyData.map(d => [
      d.label || d.shortLabel || '',
      Number(d.renda || 0).toFixed(2),
      Number(d.consumo || 0).toFixed(2),
      Number(d.divida || 0).toFixed(2),
      Number(d.patrimonio || 0).toFixed(2)
    ]);
    App.utils.exportCSV('historico-financeiro.csv', headers, rows);
    App.utils.showToast('Histórico Financeiro exportado em CSV.');
  },

  showInsights() {
    const data = this.monthlyData || [];
    if (!data.length) {
      App.utils.showToast('Carregue um período para visualizar insights.', 'error');
      return;
    }
    const totalRenda = data.reduce((s, d) => s + (d.renda || 0), 0);
    const totalConsumo = data.reduce((s, d) => s + (d.consumo || 0), 0);
    const poupanca = totalRenda > 0 ? ((totalRenda - totalConsumo) / totalRenda) * 100 : 0;
    const tipTextEl = document.getElementById('fhTipText');
    const summary = `Taxa média de sobra no período: ${poupanca.toFixed(1)}% (Renda ${App.utils.formatCurrency(totalRenda)} vs. Consumo ${App.utils.formatCurrency(totalConsumo)}).`;
    if (tipTextEl) {
      tipTextEl.textContent = summary;
      tipTextEl.closest('.fh-tip-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    App.utils.showToast(summary);
  },

  showHelp() {
    App.utils.confirm(
      'Histórico Financeiro: compare Renda, Consumo, Endividamento e Patrimônio ao longo do tempo. Use os filtros de agregação/período no topo, ative o modo % para comparar variações sobre a média e clique nas abas para ocultar/exibir métricas.',
      () => {}
    );
  },

  quickSearch(query) {
    const q = String(query || '').trim();
    const searchInput = document.getElementById('fhPurchasesSearch');
    if (searchInput) {
      searchInput.value = q;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
};