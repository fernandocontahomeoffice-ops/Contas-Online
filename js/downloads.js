// =====================================================================
// ARQUIVO: downloads.js
// Central de Downloads — Exportações especiais
// =====================================================================
var App = window.App || {};

App.downloads = {
  _selectedYear: new Date().getFullYear(),

  // -------------------------------------------------------------------
  // Renderiza a página Central de Downloads
  // -------------------------------------------------------------------
  async load() {
    const container = document.getElementById('downloadsContent');
    if (!container) return;

    const allTx = await App.db.getAll('transactions');
    const anos = new Set();
    allTx.forEach(t => {
      const a = parseInt((t.date || '').slice(0, 4), 10);
      if (!isNaN(a)) anos.add(a);
    });
    anos.add(new Date().getFullYear());
    const anosOrd = Array.from(anos).sort((a, b) => b - a);

    if (!anosOrd.includes(this._selectedYear)) {
      this._selectedYear = anosOrd[0];
    }

    container.innerHTML = `
      <div style="max-width:960px;">
        <div class="card" style="margin-bottom:20px;">
          <div class="card-label">📅 Ano de referência</div>
          <div style="display:flex; gap:12px; align-items:center; margin-top:12px; flex-wrap:wrap;">
            <select id="downloadsYearSelector" onchange="App.downloads.onYearChange()"
                    style="padding:10px 14px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border); border-radius:8px; font-size:1rem; min-width:140px; cursor:pointer;">
              ${anosOrd.map(y => `<option value="${y}" ${y === this._selectedYear ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
            <span style="color:var(--text-muted); font-size:0.85rem;">Escolha o ano e clique em qualquer card abaixo para baixar a planilha.</span>
          </div>
          <div id="downloadsPreview" style="margin-top:16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;"></div>
        </div>

        <h3 style="margin-bottom:12px;">📦 Exportações disponíveis</h3>
        <div class="cards-row" id="downloadsCards">
          <div class="card clickable" onclick="App.downloads.exportMetricsExcel()">
            <div class="card-label">📊 Métricas — Prova Completa</div>
            <div class="card-value">→</div>
            <div class="card-sub">Planilha com 5 abas: Prova Completa (transação por transação), Resumo por Categoria, Resumo por Conta, Transações Ignoradas e Conferência. Espelha a auditoria do Saldo Total (usa todas as transações até hoje, ignora o ano selecionado).</div>
          </div>

          <div class="card clickable" onclick="App.downloads.exportAnnualExcel(App.downloads._selectedYear)">
            <div class="card-label">📈 Resumo Anual — Excel</div>
            <div class="card-value">→</div>
            <div class="card-sub">Consolidado por mês e categoria (formato Ano Ref + Detalhamento com blocos de Entradas, Saídas e Investimentos).</div>
          </div>

          <div class="card clickable" onclick="App.downloads.exportAnnualByMemberExcel(App.downloads._selectedYear)">
            <div class="card-label">👥 Resumo Anual por Membro — Excel</div>
            <div class="card-value">→</div>
            <div class="card-sub">Entradas, saídas, investimentos (aportes e resgates) e resultado mês a mês por membro, com consolidado e aba individual.</div>
          </div>

          <div class="card clickable" onclick="App.downloads.exportDetailedTransactions(App.downloads._selectedYear)">
            <div class="card-label">📋 Transações Detalhadas — Excel</div>
            <div class="card-value">→</div>
            <div class="card-sub">Uma linha por transação do ano, com data, tipo, categoria, membro, conta, valor e observações.</div>
          </div>

          <div class="card clickable" onclick="App.downloads.exportByCategory(App.downloads._selectedYear)">
            <div class="card-label">🏷️ Análise por Categoria — Excel</div>
            <div class="card-value">→</div>
            <div class="card-sub">Matriz de categorias × meses, com totais por categoria e por mês. Ideal para identificar padrões.</div>
          </div>

          <div class="card clickable" onclick="App.downloads.exportConsolidatedExtract(App.downloads._selectedYear)">
            <div class="card-label">🏦 Extrato Consolidado — Excel</div>
            <div class="card-value">→</div>
            <div class="card-sub">Extrato cronológico do ano com saldo acumulado linha a linha (mesma regra do Saldo Total do app).</div>
          </div>
        </div>
      </div>
    `;

    await this.renderPreview();
  },

  onYearChange() {
    const sel = document.getElementById('downloadsYearSelector');
    if (sel) this._selectedYear = parseInt(sel.value, 10);
    this.renderPreview();
  },

  async renderPreview() {
    const preview = document.getElementById('downloadsPreview');
    if (!preview) return;

    const year = this._selectedYear;
    const startDate = `${year}-01-01`;
    const endDate   = `${year}-12-31`;
    const allTx = await App.db.getAll('transactions');

    let entradas = 0, saidas = 0, invest = 0, qtd = 0;
    for (const t of allTx) {
      if (t.status !== 'confirmed') continue;
      if (t.ignore_from_total) continue;
      if (this._isInvoicePayment(t)) continue;
      const d = (t.date || '').slice(0, 10);
      if (d < startDate || d > endDate) continue;
      const val = parseFloat(t.amount) || 0;
      qtd++;
      if (t.type === 'income')        entradas += val;
      else if (t.type === 'refund')   saidas   -= val;
      else if (t.type === 'expense')  saidas   += val;
      else if (t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte')) invest += val;
      else if (t.type === 'withdrawal'   || (t.type === 'transfer' && t.transfer_subtype === 'resgate')) invest -= val;
    }
    const resultado = entradas - saidas - invest;

    const card = (label, valor, cor) => `
      <div style="padding:12px 16px; background:var(--bg-secondary); border-radius:8px; border-left:3px solid ${cor};">
        <div style="font-size:0.72rem; color:#888; text-transform:uppercase; letter-spacing:0.05em;">${label}</div>
        <div style="font-size:1.1rem; font-weight:700; color:${cor}; margin-top:4px;">${App.utils.formatCurrency(valor)}</div>
      </div>
    `;

    preview.innerHTML =
      card('↑ Entradas', entradas, '#22c55e') +
      card('↓ Saídas', saidas, '#ef4444') +
      card('↗ Investimentos (líq.)', invest, '#60a5fa') +
      card('◎ Resultado', resultado, resultado >= 0 ? '#22c55e' : '#ef4444') +
      card('📌 Transações no ano', qtd, '#888');
  },

  _isInvoicePayment(t) {
    const catNorm = String(t && t.category ? t.category : '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim();
    return catNorm === 'pagamento fatura' ||
           catNorm === 'pagamento de fatura' ||
           catNorm === 'reversao pagamento fatura';
  },

  // ===================================================================
  // NOVO: Planilha de Métricas — espelha a auditoria do Saldo Total
  // 5 abas: Prova Completa / Resumo por Categoria / Resumo por Conta /
  //         Transações Ignoradas / Conferência
  // ===================================================================
  async exportMetricsExcel() {
    try {
      App.utils.showToast('Gerando planilha de métricas...');

      const today = App.utils.todayISO();
      const allAccounts = await App.db.getAll('accounts');
      const allTx       = await App.db.getAll('transactions');
      const allMembers  = await App.db.getAll('members');

      const memberMap = Object.fromEntries(allMembers.map(m => [m.id, m.name]));

      const activeAccounts   = allAccounts.filter(a => !a.archived);
      const accountsForTotal = activeAccounts.filter(a => !a.exclude_from_total);
      const isIncluded = (id) => accountsForTotal.some(a => a.id === id);

      // ============================================================
      // Conjunto aplicado no cálculo do Saldo Total (mesma regra do app)
      // ============================================================
      const txApplicable = allTx.filter(t => {
        const dStr = (t.date || '').slice(0, 10);
        const dVal = new Date(dStr + 'T12:00:00');
        if (!dStr || isNaN(dVal.getTime()))    return false;
        const amt = parseFloat(t.amount);
        if (!isFinite(amt) || amt < 0)         return false;
        if (t.status !== 'confirmed')          return false;
        if (dStr > today)                      return false;
        if (t.invoice_locked)                  return false;
        if (t.credit_card_id)                  return false;
        if (t.ignore_from_total)               return false;
        return true;
      }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      // ============================================================
      // ABA 4 — Transações Ignoradas
      // ============================================================
      const ignoradas = [];
      for (const t of allTx) {
        const dStr = (t.date || '').slice(0, 10);
        const dVal = new Date(dStr + 'T12:00:00');
        const amt  = parseFloat(t.amount);

        const motivos = [];
        if (!dStr || isNaN(dVal.getTime())) motivos.push('Data inválida');
        if (!isFinite(amt) || amt < 0)      motivos.push('Valor inválido');
        if (t.status !== 'confirmed')       motivos.push('Status ≠ confirmed');
        if (dStr > today)                   motivos.push('Data futura');
        if (t.invoice_locked)               motivos.push('Fatura já paga (invoice_locked)');
        if (t.credit_card_id)               motivos.push('Compra em cartão de crédito');
        if (t.ignore_from_total)            motivos.push('Marcada "Ignorar no saldo total"');

        if (motivos.length > 0) {
          ignoradas.push({
            'ID': t.id,
            'Data': dStr,
            'Tipo': t.type,
            'Categoria': t.category || '',
            'Descrição': t.description || '',
            'Valor': parseFloat(t.amount) || 0,
            'Conta Origem': t.account_name || '',
            'Conta Destino': t.account_to_name || '',
            'Membro': t.member_name || (t.member_id ? memberMap[t.member_id] : '') || '',
            'Motivo': motivos.join(' | ')
          });
        }
      }

      // ============================================================
      // ABA 1 — Prova Completa
      // ============================================================
      const aplicadas = [];
      let saldoAcum = 0;

      for (const t of txApplicable) {
        const dStr = (t.date || '').slice(0, 10);
        const amt  = parseFloat(t.amount);

        const srcIn = isIncluded(t.account_id);
        const dstIn = t.account_to_id ? isIncluded(t.account_to_id) : false;

        let efeito = 0, categoria = '';
        if (t.type === 'income')        { if (srcIn) { efeito = +amt; categoria = 'Receita';       } }
        else if (t.type === 'refund')   { if (srcIn) { efeito = +amt; categoria = 'Estorno';       } }
        else if (t.type === 'expense')  { if (srcIn) { efeito = -amt; categoria = 'Despesa';       } }
        else if (t.type === 'transfer')     { if (srcIn) efeito -= amt; if (dstIn) efeito += amt; categoria = 'Transferência'; }
        else if (t.type === 'contribution') { if (srcIn) efeito -= amt; if (dstIn) efeito += amt; categoria = 'Aporte';       }
        else if (t.type === 'withdrawal')   { if (srcIn) efeito -= amt; if (dstIn) efeito += amt; categoria = 'Resgate';      }

        if (efeito === 0 && !['transfer','contribution','withdrawal'].includes(t.type)) continue;

        saldoAcum += efeito;
        aplicadas.push({
          '#': aplicadas.length + 1,
          'Data': dStr,
          'Dia/Mês': dStr.slice(8, 10) + '/' + dStr.slice(5, 7),
          'Ano': dStr.slice(0, 4),
          'Mês': dStr.slice(0, 7),
          'Tipo': t.type,
          'Categoria': categoria,
          'Descrição': t.description || t.category || '',
          'Valor TX': amt,
          'Efeito': efeito,
          'Saldo Acumulado': saldoAcum,
          'Conta Origem': t.account_name || '',
          'Conta Destino': t.account_to_name || '',
          'Membro': t.member_name || '',
          'Cartão': t.credit_card_id ? 'Sim' : 'Não',
          'Status': t.status || '',
          'Marcada Ignorar': t.ignore_from_total ? 'Sim' : 'Não'
        });
      }

      // ============================================================
      // ABA 2 — Resumo por Categoria
      // ============================================================
      const resumoCat = {};
      for (const a of aplicadas) {
        if (!resumoCat[a.Categoria]) resumoCat[a.Categoria] = { qtd: 0, valor: 0, efeito: 0 };
        resumoCat[a.Categoria].qtd++;
        resumoCat[a.Categoria].valor += Math.abs(a['Valor TX']);
        resumoCat[a.Categoria].efeito += a['Efeito'];
      }
      const resumoCatRows = Object.entries(resumoCat).map(([cat, v]) => ({
        'Categoria': cat,
        'Qtd Transações': v.qtd,
        'Valor Total Movimentado': v.valor,
        'Efeito Líquido no Saldo': v.efeito
      })).sort((a, b) => Math.abs(b['Efeito Líquido no Saldo']) - Math.abs(a['Efeito Líquido no Saldo']));

      // ============================================================
      // ABA 3 — Resumo por Conta
      // ============================================================
      const resumoConta = {};
      for (const a of accountsForTotal) {
        resumoConta[a.id] = {
          'Conta': a.name,
          'Tipo': a.type,
          'Membro': memberMap[a.member_id] || '',
          'Saldo Inicial': a.initial_balance || 0,
          'Receitas': 0,
          'Estornos': 0,
          'Despesas': 0,
          'Transferências Enviadas': 0,
          'Transferências Recebidas': 0,
          'Aportes Enviados': 0,
          'Aportes Recebidos': 0,
          'Resgates Enviados': 0,
          'Resgates Recebidos': 0,
          'Qtd Transações': 0,
          'Saldo Final': a.initial_balance || 0
        };
      }

      for (const t of txApplicable) {
        const amt = parseFloat(t.amount) || 0;
        const src = resumoConta[t.account_id];
        const dst = resumoConta[t.account_to_id];

        if (t.type === 'income'  && src) { src['Receitas']  += amt; src['Saldo Final'] += amt; }
        if (t.type === 'refund'  && src) { src['Estornos']  += amt; src['Saldo Final'] += amt; }
        if (t.type === 'expense' && src) { src['Despesas']  += amt; src['Saldo Final'] -= amt; }
        if (t.type === 'transfer')     { if (src) { src['Transferências Enviadas'] += amt; src['Saldo Final'] -= amt; } if (dst) { dst['Transferências Recebidas'] += amt; dst['Saldo Final'] += amt; } }
        if (t.type === 'contribution') { if (src) { src['Aportes Enviados']       += amt; src['Saldo Final'] -= amt; } if (dst) { dst['Aportes Recebidos']       += amt; dst['Saldo Final'] += amt; } }
        if (t.type === 'withdrawal')   { if (src) { src['Resgates Enviados']      += amt; src['Saldo Final'] -= amt; } if (dst) { dst['Resgates Recebidos']      += amt; dst['Saldo Final'] += amt; } }
        if (src) src['Qtd Transações']++;
        if (dst) dst['Qtd Transações']++;
      }
      const resumoContaRows = Object.values(resumoConta);

      // ============================================================
      // ABA 5 — Conferência
      // ============================================================
      const confRows = [
        { Item: 'Data de referência', Valor: today },
        { Item: 'Total de contas ativas', Valor: activeAccounts.length },
        { Item: 'Contas no cálculo', Valor: accountsForTotal.length },
        { Item: 'Total de transações no banco', Valor: allTx.length },
        { Item: 'Transações aplicadas no cálculo', Valor: aplicadas.length },
        { Item: 'Transações ignoradas', Valor: ignoradas.length },
        { Item: 'Soma acumulada', Valor: saldoAcum },
        { Item: 'Saldo em App.cache.totalBalance', Valor: App.cache.totalBalance },
        { Item: 'Diferença', Valor: saldoAcum - App.cache.totalBalance },
        { Item: 'Status', Valor: Math.abs(saldoAcum - App.cache.totalBalance) < 0.01 ? '✅ BATE' : '❌ DIVERGE' }
      ];

      // ============================================================
      // Montagem do Workbook
      // ============================================================
      const wb = XLSX.utils.book_new();

      // Paleta (mesma do Resumo Anual)
      const PURPLE     = '4B2E83';
      const WHITE      = 'FFFFFF';
      const GREEN_BG   = 'E2EFDA';
      const GREEN_TXT  = '375623';
      const RED_TXT    = 'C00000';
      const BORDER     = 'BFBFBF';

      const bd = {
        top:    { style: 'thin', color: { rgb: BORDER } },
        bottom: { style: 'thin', color: { rgb: BORDER } },
        left:   { style: 'thin', color: { rgb: BORDER } },
        right:  { style: 'thin', color: { rgb: BORDER } }
      };

      const headerStyle = {
        font: { bold: true, color: { rgb: WHITE }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: PURPLE } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: bd
      };

      const styleHeader = (ws) => {
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: 0, c: C });
          if (ws[addr]) ws[addr].s = headerStyle;
        }
      };

      const setMoneyFormat = (ws, moneyCols) => {
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addrH = XLSX.utils.encode_cell({ r: 0, c: C });
          if (!ws[addrH]) continue;
          if (moneyCols.includes(ws[addrH].v)) {
            for (let R = 1; R <= range.e.r; R++) {
              const addr = XLSX.utils.encode_cell({ r: R, c: C });
              if (ws[addr] && ws[addr].t === 'n') {
                ws[addr].z = '"R$ "#,##0.00;[Red]-"R$ "#,##0.00';
              }
            }
          }
        }
      };

      // --- ABA 1: Prova Completa ---
      const ws1 = XLSX.utils.json_to_sheet(aplicadas);
      styleHeader(ws1);
      ws1['!cols'] = [
        { wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 9 }, { wch: 14 }, { wch: 16 }, { wch: 55 },
        { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 12 }
      ];
      setMoneyFormat(ws1, ['Valor TX', 'Efeito', 'Saldo Acumulado']);
      XLSX.utils.book_append_sheet(wb, ws1, 'Prova Completa');

      // --- ABA 2: Resumo por Categoria ---
      const ws2 = XLSX.utils.json_to_sheet(resumoCatRows);
      styleHeader(ws2);
      ws2['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 28 }, { wch: 28 }];
      setMoneyFormat(ws2, ['Valor Total Movimentado', 'Efeito Líquido no Saldo']);
      XLSX.utils.book_append_sheet(wb, ws2, 'Resumo por Categoria');

      // --- ABA 3: Resumo por Conta ---
      const ws3 = XLSX.utils.json_to_sheet(resumoContaRows);
      styleHeader(ws3);
      ws3['!cols'] = [
        { wch: 32 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
        { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
        { wch: 14 }, { wch: 16 }
      ];
      setMoneyFormat(ws3, [
        'Saldo Inicial', 'Receitas', 'Estornos', 'Despesas',
        'Transferências Enviadas', 'Transferências Recebidas',
        'Aportes Enviados', 'Aportes Recebidos',
        'Resgates Enviados', 'Resgates Recebidos',
        'Saldo Final'
      ]);
      XLSX.utils.book_append_sheet(wb, ws3, 'Resumo por Conta');

      // --- ABA 4: Transações Ignoradas ---
      const ws4 = XLSX.utils.json_to_sheet(ignoradas);
      styleHeader(ws4);
      ws4['!cols'] = [
        { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 55 },
        { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 45 }
      ];
      setMoneyFormat(ws4, ['Valor']);
      XLSX.utils.book_append_sheet(wb, ws4, 'Transações Ignoradas');

      // --- ABA 5: Conferência ---
      const ws5 = XLSX.utils.json_to_sheet(confRows);
      styleHeader(ws5);
      ws5['!cols'] = [{ wch: 45 }, { wch: 24 }];
      {
        const range = XLSX.utils.decode_range(ws5['!ref']);
        for (let R = 1; R <= range.e.r; R++) {
          const addrLabel = XLSX.utils.encode_cell({ r: R, c: 0 });
          const addrValue = XLSX.utils.encode_cell({ r: R, c: 1 });
          if (ws5[addrLabel]) {
            ws5[addrLabel].s = {
              font: { bold: true, color: { rgb: GREEN_TXT }, sz: 11 },
              fill: { patternType: 'solid', fgColor: { rgb: GREEN_BG } },
              alignment: { horizontal: 'left', vertical: 'center' },
              border: bd
            };
          }
          if (ws5[addrValue]) {
            ws5[addrValue].s = {
              font: { color: { rgb: '000000' }, sz: 11 },
              fill: { patternType: 'solid', fgColor: { rgb: GREEN_BG } },
              alignment: { horizontal: 'left', vertical: 'center' },
              border: bd
            };
            if (typeof ws5[addrValue].v === 'number' && ws5[addrLabel]) {
              const lbl = String(ws5[addrLabel].v || '');
              if (lbl.includes('Soma acumulada') || lbl.includes('Saldo em App') || lbl.includes('Diferença')) {
                ws5[addrValue].z = '"R$ "#,##0.00;[Red]-"R$ "#,##0.00';
              }
            }
          }
        }
      }
      XLSX.utils.book_append_sheet(wb, ws5, 'Conferência');

      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      XLSX.writeFile(wb, `metricas_${ts}.xlsx`);

      App.utils.showToast(`Planilha de métricas exportada! (${aplicadas.length} transações, saldo ${App.utils.formatCurrency(saldoAcum)})`);
    } catch (e) {
      console.error('Erro ao exportar métricas:', e);
      App.utils.showToast('Erro ao exportar planilha.', 'error');
    }
  },

  // ===================================================================
  // Exporta Resumo Anual em Excel no formato "Ano Ref" + Detalhamento
  // ===================================================================
  async exportAnnualExcel(year) {
    try {
      if (!year) {
        const anoAtual = new Date().getFullYear();
        year = await new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;';

          const modal = document.createElement('div');
          modal.style.cssText = 'background:#1e1e1e;color:#fff;border-radius:16px;padding:24px;width:90%;max-width:420px;box-shadow:0 20px 40px rgba(0,0,0,0.5);font-family:inherit;';

          modal.innerHTML = `
            <h3 style="margin:0 0 12px;font-size:1.2rem;font-weight:600;">Exportar Resumo Anual</h3>
            <p style="margin:0 0 16px;color:#ccc;font-size:0.9rem;">Informe o ano que deseja exportar:</p>
            <input type="number" id="__annualExportYear" min="2000" max="2099" value="${anoAtual}"
              style="width:100%;padding:12px;background:#0f0f0f;border:1px solid #333;border-radius:8px;color:#fff;font-size:1rem;outline:none;">
            <div style="display:flex;gap:10px;margin-top:20px;">
              <button id="__annualCancel" style="flex:1;padding:12px;background:transparent;border:1px solid #444;border-radius:8px;color:#ccc;cursor:pointer;">Cancelar</button>
              <button id="__annualConfirm" style="flex:2;padding:12px;background:#246be2;border:1px solid #3983ff;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;">Exportar</button>
            </div>
          `;
          overlay.appendChild(modal);
          document.body.appendChild(overlay);

          const input = modal.querySelector('#__annualExportYear');
          setTimeout(() => { input.focus(); input.select(); }, 50);

          const fechar = (v) => { overlay.remove(); resolve(v); };
          modal.querySelector('#__annualCancel').onclick = () => fechar(null);
          modal.querySelector('#__annualConfirm').onclick = () => fechar(parseInt(input.value) || anoAtual);
          overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(null); });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') fechar(parseInt(input.value) || anoAtual);
            if (e.key === 'Escape') fechar(null);
          });
        });
        if (!year) return;
      }

      App.utils.showToast(`Gerando resumo de ${year}...`);

      const startDate = `${year}-01-01`;
      const endDate   = `${year}-12-31T23:59:59`;
      const allTx     = await App.db.getAll('transactions');
      const cards     = await App.db.getAll('creditCards');
      const cats      = await App.db.getAll('categories');
      const accounts  = await App.db.getAll('accounts');

      const cardMap = Object.fromEntries(cards.map(c => [c.id, c]));
      const accMap  = Object.fromEntries(accounts.map(a => [a.id, a]));

      const txAno = allTx.filter(t => {
        if (t.status !== 'confirmed') return false;
        if (t.ignore_from_total) return false;
        if (this._isInvoicePayment(t)) return false;
        const d = (t.date || '').slice(0, 10);
        return d >= startDate && d <= `${year}-12-31`;
      });

      const monthOf = (t) => {
        let d = (t.date || '').slice(0, 10);
        if (t.credit_card_id && cardMap[t.credit_card_id]) {
          try {
            const p = App.cardInvoice.getInvoicePeriodForDate(cardMap[t.credit_card_id], d);
            d = p.due.slice(0, 10);
          } catch (e) {}
        }
        const m = parseInt(d.slice(5, 7), 10) - 1;
        return (m >= 0 && m <= 11) ? m : -1;
      };

      const totais = {
        entradas:      Array(12).fill(0),
        saidas:        Array(12).fill(0),
        investimentos: Array(12).fill(0),
        resultado:     Array(12).fill(0)
      };

      const detalhamento = {
        entradas: {},
        saidas:   {},
        aportes:  Array(12).fill(0),
        resgates: Array(12).fill(0)
      };

      for (const t of txAno) {
        const m = monthOf(t);
        if (m < 0) continue;
        const val = parseFloat(t.amount) || 0;
        const cat = t.category || 'Outros';

        if (t.type === 'income') {
          totais.entradas[m] += val;
          if (!detalhamento.entradas[cat]) detalhamento.entradas[cat] = Array(12).fill(0);
          detalhamento.entradas[cat][m] += val;

        } else if (t.type === 'expense') {
          totais.saidas[m] += val;
          if (!detalhamento.saidas[cat]) detalhamento.saidas[cat] = Array(12).fill(0);
          detalhamento.saidas[cat][m] += val;

        } else if (t.type === 'refund') {
          totais.saidas[m] -= val;
          if (!detalhamento.saidas[cat]) detalhamento.saidas[cat] = Array(12).fill(0);
          detalhamento.saidas[cat][m] -= val;

        } else if (t.type === 'contribution' ||
                  (t.type === 'transfer' && t.transfer_subtype === 'aporte')) {
          totais.investimentos[m] += val;
          detalhamento.aportes[m] += val;

        } else if (t.type === 'withdrawal' ||
                  (t.type === 'transfer' && t.transfer_subtype === 'resgate')) {
          totais.investimentos[m] -= val;
          detalhamento.resgates[m] += val;
        }
      }

      for (let i = 0; i < 12; i++) {
        totais.resultado[i] = totais.entradas[i] - totais.saidas[i] - totais.investimentos[i];
      }

      const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const NUM_COLS = 13;
      const headerRow = [`Ano Ref/${year}`, ...MONTHS];
      const aoa = [];
      const rowIdx = {};
      let r = 0;

      rowIdx.summaryHeader = r; aoa.push(headerRow); r++;
      rowIdx.summaryEntradas = r; aoa.push(['↑ Entradas',      ...totais.entradas]); r++;
      rowIdx.summarySaidas   = r; aoa.push(['↓ Saídas',        ...totais.saidas]); r++;
      rowIdx.summaryInvest   = r; aoa.push(['↗ Investimentos', ...totais.investimentos]); r++;
      rowIdx.summaryResult   = r; aoa.push(['◎ Resultado',     ...totais.resultado]); r++;
      aoa.push([]); r++;

      rowIdx.incHeader = r; aoa.push(headerRow); r++;
      rowIdx.incTitle  = r; aoa.push(['↑ Entradas', ...totais.entradas]); r++;
      rowIdx.incCats = [];
      const sortedIncCats = Object.keys(detalhamento.entradas).sort((a, b) => {
        const ta = detalhamento.entradas[a].reduce((s, v) => s + v, 0);
        const tb = detalhamento.entradas[b].reduce((s, v) => s + v, 0);
        return tb - ta;
      });
      for (const cat of sortedIncCats) {
        const tot = detalhamento.entradas[cat].reduce((s, v) => s + v, 0);
        if (tot === 0) continue;
        rowIdx.incCats.push(r);
        aoa.push([cat, ...detalhamento.entradas[cat]]); r++;
      }
      aoa.push([]); r++;

      rowIdx.expHeader = r; aoa.push(headerRow); r++;
      rowIdx.expTitle  = r; aoa.push(['↓ Saídas', ...totais.saidas]); r++;
      rowIdx.expCats = [];
      const sortedExpCats = Object.keys(detalhamento.saidas).sort((a, b) => {
        const ta = detalhamento.saidas[a].reduce((s, v) => s + v, 0);
        const tb = detalhamento.saidas[b].reduce((s, v) => s + v, 0);
        return tb - ta;
      });
      for (const cat of sortedExpCats) {
        const tot = detalhamento.saidas[cat].reduce((s, v) => s + v, 0);
        if (tot === 0) continue;
        rowIdx.expCats.push(r);
        aoa.push([cat, ...detalhamento.saidas[cat]]); r++;
      }
      aoa.push([]); r++;

      rowIdx.invHeader  = r; aoa.push(headerRow); r++;
      rowIdx.invTitle   = r; aoa.push(['↗ Investimentos', ...totais.investimentos]); r++;
      rowIdx.invAportes = r; aoa.push(['Aportes',  ...detalhamento.aportes]); r++;
      rowIdx.invResg    = r; aoa.push(['Resgates', ...detalhamento.resgates]); r++;

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const range = XLSX.utils.decode_range(ws['!ref']);

      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[addr];
          if (cell && cell.t === 'n' && C > 0) {
            cell.z = '"R$ "#,##0.00';
          }
        }
      }

      const PURPLE     = '4B2E83';
      const GREEN_BG   = 'E2EFDA';
      const GREEN_TXT  = '375623';
      const GREEN_MID  = 'A9D08E';
      const GREEN_DARK = '375623';
      const RED_BG     = 'FCE4E4';
      const RED_TXT    = 'C00000';
      const RED_MID    = 'F4B6B6';
      const BLUE_BG    = 'DDEBF7';
      const BLUE_TXT   = '2E75B6';
      const ALT_ROW    = 'F7F7F7';
      const WHITE      = 'FFFFFF';
      const BORDER     = 'BFBFBF';

      const bd = {
        top:    { style: 'thin', color: { rgb: BORDER } },
        bottom: { style: 'thin', color: { rgb: BORDER } },
        left:   { style: 'thin', color: { rgb: BORDER } },
        right:  { style: 'thin', color: { rgb: BORDER } }
      };

      const setCell = (rr, cc, style) => {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = style;
      };

      const applyRow = (rr, labelStyle, valueStyle) => {
        for (let c = 0; c < NUM_COLS; c++) {
          setCell(rr, c, c === 0 ? labelStyle : valueStyle);
        }
      };

      const headerStyle = {
        font: { bold: true, color: { rgb: WHITE }, sz: 11, name: 'Calibri' },
        fill: { patternType: 'solid', fgColor: { rgb: PURPLE } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: bd
      };

      const mkLabel = (txt, bg) => ({
        font: { bold: true, color: { rgb: txt }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: bd
      });
      const mkValue = (bg) => ({
        font: { color: { rgb: '000000' }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'right', vertical: 'center' },
        border: bd
      });
      const mkPlain = (bg) => ({
        font: { color: { rgb: '000000' }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: bd
      });

      [rowIdx.summaryHeader, rowIdx.incHeader, rowIdx.expHeader, rowIdx.invHeader]
        .forEach(rr => applyRow(rr, headerStyle, headerStyle));

      applyRow(rowIdx.summaryEntradas, mkLabel(GREEN_TXT, GREEN_BG), mkValue(GREEN_BG));
      applyRow(rowIdx.summarySaidas,   mkLabel(RED_TXT,   RED_BG),   mkValue(RED_BG));
      applyRow(rowIdx.summaryInvest,   mkLabel(BLUE_TXT,  BLUE_BG),  mkValue(BLUE_BG));

      setCell(rowIdx.summaryResult, 0, {
        font: { bold: true, color: { rgb: WHITE }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: GREEN_DARK } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: bd
      });
      for (let c = 1; c < NUM_COLS; c++) {
        const v = totais.resultado[c - 1];
        const bg = v < 0 ? RED_MID : (v > 0 ? GREEN_MID : WHITE);
        setCell(rowIdx.summaryResult, c, {
          font: { bold: true, color: { rgb: '000000' }, sz: 11 },
          fill: { patternType: 'solid', fgColor: { rgb: bg } },
          alignment: { horizontal: 'right', vertical: 'center' },
          border: bd
        });
      }

      applyRow(rowIdx.incTitle, mkLabel(GREEN_TXT, GREEN_BG), mkValue(GREEN_BG));
      rowIdx.incCats.forEach((rr, i) => {
        const bg = (i % 2 === 0) ? WHITE : ALT_ROW;
        applyRow(rr, mkPlain(bg), mkValue(bg));
      });

      applyRow(rowIdx.expTitle, mkLabel(RED_TXT, RED_BG), mkValue(RED_BG));
      rowIdx.expCats.forEach((rr, i) => {
        const bg = (i % 2 === 0) ? WHITE : ALT_ROW;
        applyRow(rr, mkPlain(bg), mkValue(bg));
      });

      applyRow(rowIdx.invTitle, mkLabel(BLUE_TXT, BLUE_BG), mkValue(BLUE_BG));
      [rowIdx.invAportes, rowIdx.invResg].forEach((rr, i) => {
        const bg = (i % 2 === 0) ? WHITE : ALT_ROW;
        applyRow(rr, mkPlain(bg), mkValue(bg));
      });

      ws['!cols'] = [{ wch: 26 }, ...Array(12).fill({ wch: 13 })];
      ws['!rows'] = [];
      [rowIdx.summaryHeader, rowIdx.incHeader, rowIdx.expHeader, rowIdx.invHeader]
        .forEach(rr => { ws['!rows'][rr] = { hpt: 14.4 }; });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Resumo ${year}`);
      XLSX.writeFile(wb, `resumo_anual_${year}.xlsx`);

      App.utils.showToast(`Resumo ${year} exportado com sucesso!`);
    } catch (e) {
      console.error('Erro ao exportar Resumo Anual:', e);
      App.utils.showToast('Erro ao exportar planilha.', 'error');
    }
  },

  // ===================================================================
  // Exporta Resumo Anual por Membro em Excel (Consolidado + Aba/Membro)
  // ===================================================================
  async exportAnnualByMemberExcel(year) {
    try {
      if (!year) year = this._selectedYear || new Date().getFullYear();
      App.utils.showToast(`Gerando resumo por membro de ${year}...`);

      const startDate = `${year}-01-01`;
      const endDate   = `${year}-12-31`;
      const [allTx, cards, members] = await Promise.all([
        App.db.getAll('transactions'),
        App.db.getAll('creditCards'),
        App.db.getAll('members')
      ]);

      const cardMap      = Object.fromEntries(cards.map(c => [c.id, c]));
      const memberById   = Object.fromEntries(members.map(m => [m.id, m]));
      const memberByName = new Map();
      members.forEach(m => {
        if (m && m.name) memberByName.set(String(m.name).toLowerCase().trim(), m.id);
      });

      const txAno = allTx.filter(t => {
        if (t.status !== 'confirmed') return false;
        if (t.ignore_from_total) return false;
        if (this._isInvoicePayment(t)) return false;
        const d = (t.date || '').slice(0, 10);
        return d >= startDate && d <= endDate;
      });

      const monthOf = (t) => {
        let d = (t.date || '').slice(0, 10);
        if (t.credit_card_id && cardMap[t.credit_card_id]) {
          try {
            const p = App.cardInvoice.getInvoicePeriodForDate(cardMap[t.credit_card_id], d);
            d = p.due.slice(0, 10);
          } catch (e) {}
        }
        const m = parseInt(d.slice(5, 7), 10) - 1;
        return (m >= 0 && m <= 11) ? m : -1;
      };

      const buckets = new Map();
      const getBucket = (key, displayName) => {
        if (!buckets.has(key)) {
          buckets.set(key, {
            id: key,
            name: displayName,
            entradas:    Array(12).fill(0),
            saidas:      Array(12).fill(0),
            aportes:     Array(12).fill(0),
            resgates:    Array(12).fill(0),
            catEntradas: {},
            catSaidas:   {}
          });
        }
        return buckets.get(key);
      };

      members.forEach(m => {
        if (m && m.id) getBucket(m.id, m.name || 'Membro');
      });

      for (const t of txAno) {
        const m = monthOf(t);
        if (m < 0) continue;
        const cat = t.category || 'Outros';

        const parts = [];
        if (Array.isArray(t.member_splits) && t.member_splits.length > 0) {
          for (const sp of t.member_splits) {
            const amt = parseFloat(sp.amount) || 0;
            if (amt === 0) continue;
            const mid = (sp.member_id && memberById[sp.member_id]) ? sp.member_id : '__sem_membro__';
            const mname = memberById[mid]?.name || 'Sem membro';
            parts.push({ key: mid, name: mname, val: amt });
          }
        } else {
          const amt = parseFloat(t.amount) || 0;
          let mid = (t.member_id && memberById[t.member_id]) ? t.member_id : null;
          if (!mid && t.member_name) {
            mid = memberByName.get(String(t.member_name).toLowerCase().trim()) || null;
          }
          const key = mid || '__sem_membro__';
          const mname = mid ? memberById[mid].name : 'Sem membro';
          parts.push({ key, name: mname, val: amt });
        }

        for (const p of parts) {
          const b = getBucket(p.key, p.name);
          const val = p.val;
          if (t.type === 'income') {
            b.entradas[m] += val;
            if (!b.catEntradas[cat]) b.catEntradas[cat] = Array(12).fill(0);
            b.catEntradas[cat][m] += val;
          } else if (t.type === 'expense') {
            b.saidas[m] += val;
            if (!b.catSaidas[cat]) b.catSaidas[cat] = Array(12).fill(0);
            b.catSaidas[cat][m] += val;
          } else if (t.type === 'refund') {
            b.saidas[m] -= val;
            if (!b.catSaidas[cat]) b.catSaidas[cat] = Array(12).fill(0);
            b.catSaidas[cat][m] -= val;
          } else if (t.type === 'contribution' || (t.type === 'transfer' && t.transfer_subtype === 'aporte')) {
            b.aportes[m] += val;
          } else if (t.type === 'withdrawal' || (t.type === 'transfer' && t.transfer_subtype === 'resgate')) {
            b.resgates[m] += val;
          }
        }
      }

      const sumArr = (arr) => arr.reduce((s, v) => s + v, 0);
      const listaBuckets = [];
      for (const b of buckets.values()) {
        b.investimentos = b.aportes.map((v, i) => v - b.resgates[i]);
        b.resultado     = b.entradas.map((v, i) => v - b.saidas[i] - b.investimentos[i]);
        b.totEntradas   = sumArr(b.entradas);
        b.totSaidas     = sumArr(b.saidas);
        b.totAportes    = sumArr(b.aportes);
        b.totResgates   = sumArr(b.resgates);
        b.totInvest     = sumArr(b.investimentos);
        b.totResultado  = sumArr(b.resultado);

        const temMov = b.totEntradas !== 0 || b.totSaidas !== 0 || b.totAportes !== 0 || b.totResgates !== 0;
        if (b.id === '__sem_membro__' && !temMov) continue;
        listaBuckets.push(b);
      }

      if (listaBuckets.length === 0) {
        App.utils.showToast(`Nenhum dado encontrado para ${year}.`, 'info');
        return;
      }

      const MONTHS     = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                          'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const NUM_COLS   = 14;
      const PURPLE     = '4B2E83';
      const GREEN_BG   = 'E2EFDA';
      const GREEN_TXT  = '375623';
      const GREEN_MID  = 'A9D08E';
      const GREEN_DARK = '375623';
      const RED_BG     = 'FCE4E4';
      const RED_TXT    = 'C00000';
      const RED_MID    = 'F4B6B6';
      const BLUE_BG    = 'DDEBF7';
      const BLUE_TXT   = '2E75B6';
      const ALT_ROW    = 'F7F7F7';
      const WHITE      = 'FFFFFF';
      const BORDER     = 'BFBFBF';

      const bd = {
        top:    { style: 'thin', color: { rgb: BORDER } },
        bottom: { style: 'thin', color: { rgb: BORDER } },
        left:   { style: 'thin', color: { rgb: BORDER } },
        right:  { style: 'thin', color: { rgb: BORDER } }
      };
      const headerStyle = {
        font: { bold: true, color: { rgb: WHITE }, sz: 11, name: 'Calibri' },
        fill: { patternType: 'solid', fgColor: { rgb: PURPLE } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: bd
      };
      const mkLabel = (txt, bg) => ({
        font: { bold: true, color: { rgb: txt }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: bd
      });
      const mkValue = (bg) => ({
        font: { color: { rgb: '000000' }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'right', vertical: 'center' },
        border: bd
      });
      const mkPlain = (bg) => ({
        font: { color: { rgb: '000000' }, sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: bd
      });

      const formatMoneyCells = (ws) => {
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; R++) {
          for (let C = 1; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[addr];
            if (cell && cell.t === 'n') {
              cell.z = '"R$ "#,##0.00;[Red]-"R$ "#,##0.00';
            }
          }
        }
      };

      const setCellStyle = (ws, rr, cc, style) => {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = style;
      };

      const applyRowStyle = (ws, rr, colCount, labelStyle, valueStyle) => {
        for (let c = 0; c < colCount; c++) {
          setCellStyle(ws, rr, c, c === 0 ? labelStyle : valueStyle);
        }
      };

      const wb = XLSX.utils.book_new();

      // ================================================================
      // ABA 1: Consolidado por Membro
      // ================================================================
      const consAoa = [];
      const consStyles = [];
      let cr = 0;

      consAoa.push([`Resumo Anual por Membro — ${year}`, '↑ Entradas', '↓ Saídas', 'Aportes', 'Resgates', '↗ Investido (líq.)', '◎ Resultado']);
      consStyles.push({ row: cr, type: 'header', cols: 7 });
      cr++;

      let gEntradas = 0, gSaidas = 0, gAportes = 0, gResgates = 0, gInvest = 0, gResult = 0;
      listaBuckets.forEach((b, idx) => {
        gEntradas += b.totEntradas;
        gSaidas   += b.totSaidas;
        gAportes  += b.totAportes;
        gResgates += b.totResgates;
        gInvest   += b.totInvest;
        gResult   += b.totResultado;

        consAoa.push([b.name, b.totEntradas, b.totSaidas, b.totAportes, b.totResgates, b.totInvest, b.totResultado]);
        consStyles.push({ row: cr, type: 'plain', cols: 7, bg: idx % 2 === 0 ? WHITE : ALT_ROW, resultVal: b.totResultado });
        cr++;
      });

      consAoa.push(['TOTAL GERAL', gEntradas, gSaidas, gAportes, gResgates, gInvest, gResult]);
      consStyles.push({ row: cr, type: 'totalSummary', cols: 7, resultVal: gResult });
      cr++;

      consAoa.push([]); cr++;

      for (const b of listaBuckets) {
        consAoa.push([`${b.name} — ${year}`, ...MONTHS, 'Total']);
        consStyles.push({ row: cr, type: 'header', cols: NUM_COLS });
        cr++;

        consAoa.push(['↑ Entradas', ...b.entradas, b.totEntradas]);
        consStyles.push({ row: cr, type: 'income', cols: NUM_COLS });
        cr++;

        consAoa.push(['↓ Saídas', ...b.saidas, b.totSaidas]);
        consStyles.push({ row: cr, type: 'expense', cols: NUM_COLS });
        cr++;

        consAoa.push(['↗ Investimentos (líq.)', ...b.investimentos, b.totInvest]);
        consStyles.push({ row: cr, type: 'invest', cols: NUM_COLS });
        cr++;

        consAoa.push(['  • Aportes', ...b.aportes, b.totAportes]);
        consStyles.push({ row: cr, type: 'plain', cols: NUM_COLS, bg: WHITE });
        cr++;

        consAoa.push(['  • Resgates', ...b.resgates, b.totResgates]);
        consStyles.push({ row: cr, type: 'plain', cols: NUM_COLS, bg: ALT_ROW });
        cr++;

        consAoa.push(['◎ Resultado', ...b.resultado, b.totResultado]);
        consStyles.push({ row: cr, type: 'result', cols: NUM_COLS, valores: [...b.resultado, b.totResultado] });
        cr++;

        consAoa.push([]); cr++;
      }

      const wsCons = XLSX.utils.aoa_to_sheet(consAoa);
      formatMoneyCells(wsCons);

      for (const st of consStyles) {
        if (st.type === 'header') {
          applyRowStyle(wsCons, st.row, st.cols, headerStyle, headerStyle);
        } else if (st.type === 'income') {
          applyRowStyle(wsCons, st.row, st.cols, mkLabel(GREEN_TXT, GREEN_BG), mkValue(GREEN_BG));
        } else if (st.type === 'expense') {
          applyRowStyle(wsCons, st.row, st.cols, mkLabel(RED_TXT, RED_BG), mkValue(RED_BG));
        } else if (st.type === 'invest') {
          applyRowStyle(wsCons, st.row, st.cols, mkLabel(BLUE_TXT, BLUE_BG), mkValue(BLUE_BG));
        } else if (st.type === 'plain') {
          applyRowStyle(wsCons, st.row, st.cols, mkPlain(st.bg), mkValue(st.bg));
        } else if (st.type === 'totalSummary') {
          applyRowStyle(wsCons, st.row, st.cols, {
            font: { bold: true, color: { rgb: WHITE }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: GREEN_DARK } },
            alignment: { horizontal: 'left', vertical: 'center' },
            border: bd
          }, {
            font: { bold: true, color: { rgb: '000000' }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: GREEN_BG } },
            alignment: { horizontal: 'right', vertical: 'center' },
            border: bd
          });
        } else if (st.type === 'result') {
          setCellStyle(wsCons, st.row, 0, {
            font: { bold: true, color: { rgb: WHITE }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: GREEN_DARK } },
            alignment: { horizontal: 'left', vertical: 'center' },
            border: bd
          });
          for (let c = 1; c < st.cols; c++) {
            const v = st.valores[c - 1];
            const bg = v < 0 ? RED_MID : (v > 0 ? GREEN_MID : WHITE);
            setCellStyle(wsCons, st.row, c, {
              font: { bold: true, color: { rgb: '000000' }, sz: 11 },
              fill: { patternType: 'solid', fgColor: { rgb: bg } },
              alignment: { horizontal: 'right', vertical: 'center' },
              border: bd
            });
          }
        }
      }

      wsCons['!cols'] = [{ wch: 28 }, ...Array(12).fill({ wch: 14 }), { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, wsCons, `Consolidado ${year}`);

      // ================================================================
      // ABAS INDIVIDUAIS: Uma aba por membro
      // ================================================================
      const usedSheetNames = new Set([`Consolidado ${year}`]);
      const safeSheetName = (rawName) => {
        let clean = String(rawName || 'Membro').replace(/[:\\\/\?\*\[\]]/g, '').trim() || 'Membro';
        if (clean.length > 31) clean = clean.slice(0, 31).trim();
        let candidate = clean;
        let idx = 2;
        while (usedSheetNames.has(candidate)) {
          const suffix = ` (${idx})`;
          candidate = clean.slice(0, 31 - suffix.length) + suffix;
          idx++;
        }
        usedSheetNames.add(candidate);
        return candidate;
      };

      for (const b of listaBuckets) {
        const aoa = [];
        const rowIdx = {};
        let r = 0;
        const headerRow = [`${b.name} — ${year}`, ...MONTHS, 'Total'];

        rowIdx.summaryHeader   = r; aoa.push(headerRow); r++;
        rowIdx.summaryEntradas = r; aoa.push(['↑ Entradas',            ...b.entradas,      b.totEntradas]); r++;
        rowIdx.summarySaidas   = r; aoa.push(['↓ Saídas',              ...b.saidas,        b.totSaidas]); r++;
        rowIdx.summaryInvest   = r; aoa.push(['↗ Investimentos (líq.)',...b.investimentos, b.totInvest]); r++;
        rowIdx.summaryResult   = r; aoa.push(['◎ Resultado',           ...b.resultado,     b.totResultado]); r++;
        aoa.push([]); r++;

        rowIdx.incHeader = r; aoa.push(headerRow); r++;
        rowIdx.incTitle  = r; aoa.push(['↑ Entradas', ...b.entradas, b.totEntradas]); r++;
        rowIdx.incCats   = [];
        const sortedInc = Object.keys(b.catEntradas).sort((x, y) => sumArr(b.catEntradas[y]) - sumArr(b.catEntradas[x]));
        for (const cat of sortedInc) {
          const tot = sumArr(b.catEntradas[cat]);
          if (tot === 0) continue;
          rowIdx.incCats.push(r);
          aoa.push([cat, ...b.catEntradas[cat], tot]);
          r++;
        }
        aoa.push([]); r++;

        rowIdx.expHeader = r; aoa.push(headerRow); r++;
        rowIdx.expTitle  = r; aoa.push(['↓ Saídas', ...b.saidas, b.totSaidas]); r++;
        rowIdx.expCats   = [];
        const sortedExp = Object.keys(b.catSaidas).sort((x, y) => sumArr(b.catSaidas[y]) - sumArr(b.catSaidas[x]));
        for (const cat of sortedExp) {
          const tot = sumArr(b.catSaidas[cat]);
          if (tot === 0) continue;
          rowIdx.expCats.push(r);
          aoa.push([cat, ...b.catSaidas[cat], tot]);
          r++;
        }
        aoa.push([]); r++;

        rowIdx.invHeader  = r; aoa.push(headerRow); r++;
        rowIdx.invTitle   = r; aoa.push(['↗ Investimentos (líq.)', ...b.investimentos, b.totInvest]); r++;
        rowIdx.invAportes = r; aoa.push(['Aportes',  ...b.aportes,  b.totAportes]); r++;
        rowIdx.invResg    = r; aoa.push(['Resgates', ...b.resgates, b.totResgates]); r++;

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        formatMoneyCells(ws);

        [rowIdx.summaryHeader, rowIdx.incHeader, rowIdx.expHeader, rowIdx.invHeader]
          .forEach(rr => applyRowStyle(ws, rr, NUM_COLS, headerStyle, headerStyle));

        applyRowStyle(ws, rowIdx.summaryEntradas, NUM_COLS, mkLabel(GREEN_TXT, GREEN_BG), mkValue(GREEN_BG));
        applyRowStyle(ws, rowIdx.summarySaidas,   NUM_COLS, mkLabel(RED_TXT,   RED_BG),   mkValue(RED_BG));
        applyRowStyle(ws, rowIdx.summaryInvest,   NUM_COLS, mkLabel(BLUE_TXT,  BLUE_BG),  mkValue(BLUE_BG));

        setCellStyle(ws, rowIdx.summaryResult, 0, {
          font: { bold: true, color: { rgb: WHITE }, sz: 11 },
          fill: { patternType: 'solid', fgColor: { rgb: GREEN_DARK } },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: bd
        });
        const resComTot = [...b.resultado, b.totResultado];
        for (let c = 1; c < NUM_COLS; c++) {
          const v = resComTot[c - 1];
          const bg = v < 0 ? RED_MID : (v > 0 ? GREEN_MID : WHITE);
          setCellStyle(ws, rowIdx.summaryResult, c, {
            font: { bold: true, color: { rgb: '000000' }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: bg } },
            alignment: { horizontal: 'right', vertical: 'center' },
            border: bd
          });
        }

        applyRowStyle(ws, rowIdx.incTitle, NUM_COLS, mkLabel(GREEN_TXT, GREEN_BG), mkValue(GREEN_BG));
        rowIdx.incCats.forEach((rr, i) => {
          const bg = (i % 2 === 0) ? WHITE : ALT_ROW;
          applyRowStyle(ws, rr, NUM_COLS, mkPlain(bg), mkValue(bg));
        });

        applyRowStyle(ws, rowIdx.expTitle, NUM_COLS, mkLabel(RED_TXT, RED_BG), mkValue(RED_BG));
        rowIdx.expCats.forEach((rr, i) => {
          const bg = (i % 2 === 0) ? WHITE : ALT_ROW;
          applyRowStyle(ws, rr, NUM_COLS, mkPlain(bg), mkValue(bg));
        });

        applyRowStyle(ws, rowIdx.invTitle, NUM_COLS, mkLabel(BLUE_TXT, BLUE_BG), mkValue(BLUE_BG));
        [rowIdx.invAportes, rowIdx.invResg].forEach((rr, i) => {
          const bg = (i % 2 === 0) ? WHITE : ALT_ROW;
          applyRowStyle(ws, rr, NUM_COLS, mkPlain(bg), mkValue(bg));
        });

        ws['!cols'] = [{ wch: 28 }, ...Array(12).fill({ wch: 13 }), { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws, safeSheetName(b.name));
      }

      XLSX.writeFile(wb, `resumo_anual_por_membro_${year}.xlsx`);
      App.utils.showToast(`Resumo por membro ${year} exportado com sucesso!`);
    } catch (e) {
      console.error('Erro ao exportar Resumo Anual por Membro:', e);
      App.utils.showToast('Erro ao exportar planilha.', 'error');
    }
  },

  // -------------------------------------------------------------------
  // Transações Detalhadas do ano (uma linha por TX)
  // -------------------------------------------------------------------
  async exportDetailedTransactions(year) {
    try {
      if (!year) year = this._selectedYear || new Date().getFullYear();
      App.utils.showToast(`Gerando transações detalhadas de ${year}...`);

      const startDate = `${year}-01-01`;
      const endDate   = `${year}-12-31`;
      const allTx     = await App.db.getAll('transactions');
      const cards     = await App.db.getAll('creditCards');
      const accounts  = await App.db.getAll('accounts');
      const members   = await App.db.getAll('members');

      const cardMap   = Object.fromEntries(cards.map(c => [c.id, c.name]));
      const accMap    = Object.fromEntries(accounts.map(a => [a.id, a.name]));
      const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

      const txAno = allTx
        .filter(t => {
          const d = (t.date || '').slice(0, 10);
          return d >= startDate && d <= endDate;
        })
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      const typeNames = {
        income: 'Receita', expense: 'Despesa', transfer: 'Transferência',
        contribution: 'Aporte', withdrawal: 'Resgate', refund: 'Estorno',
        adjustment: 'Ajuste'
      };

      const rows = txAno.map(t => {
        const dStr = (t.date || '').slice(0, 10);
        let dataExib = App.utils.formatDate(dStr);
        let horaExib = '—';
        if ((t.date || '').includes('T')) {
          horaExib = t.date.split('T')[1].slice(0, 5);
        }
        return {
          'Data': dataExib,
          'Hora': horaExib,
          'Ano': dStr.slice(0, 4),
          'Mês': dStr.slice(0, 7),
          'Tipo': typeNames[t.type] || t.type,
          'Categoria': t.category || '',
          'Descrição': t.description || '',
          'Membro': t.member_name || (t.member_id ? memberMap[t.member_id] : '') || '',
          'Conta Origem': t.account_name || (t.account_id ? accMap[t.account_id] : '') || '',
          'Conta Destino': t.account_to_name || (t.account_to_id ? accMap[t.account_to_id] : '') || '',
          'Cartão de Crédito': t.credit_card_id ? (cardMap[t.credit_card_id] || 'Sim') : '—',
          'Valor': parseFloat(t.amount) || 0,
          'Status': t.status || '',
          'Conciliado': t.reconciled ? 'Sim' : 'Não',
          'Ignorado no Total': t.ignore_from_total ? 'Sim' : 'Não',
          'Fatura Travada': t.invoice_locked ? 'Sim' : 'Não',
          'Parcela': t.installments > 1 ? `${t.installment_number}/${t.installments}` : '—',
          'Observações': t.notes || ''
        };
      });

      if (rows.length === 0) {
        App.utils.showToast(`Nenhuma transação encontrada em ${year}.`, 'info');
        return;
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 9 }, { wch: 14 }, { wch: 18 },
        { wch: 45 }, { wch: 16 }, { wch: 24 }, { wch: 24 }, { wch: 20 }, { wch: 14 },
        { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 35 }
      ];

      const range = XLSX.utils.decode_range(ws['!ref']);
      const PURPLE = '4B2E83';
      const WHITE = 'FFFFFF';
      const BORDER = 'BFBFBF';
      const bd = {
        top:    { style: 'thin', color: { rgb: BORDER } },
        bottom: { style: 'thin', color: { rgb: BORDER } },
        left:   { style: 'thin', color: { rgb: BORDER } },
        right:  { style: 'thin', color: { rgb: BORDER } }
      };
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addrH = XLSX.utils.encode_cell({ r: 0, c: C });
        if (ws[addrH]) {
          ws[addrH].s = {
            font: { bold: true, color: { rgb: WHITE }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: PURPLE } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: bd
          };
          if (ws[addrH].v === 'Valor') {
            for (let R = 1; R <= range.e.r; R++) {
              const addr = XLSX.utils.encode_cell({ r: R, c: C });
              if (ws[addr] && ws[addr].t === 'n') ws[addr].z = '"R$ "#,##0.00';
            }
          }
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Transações ${year}`);
      XLSX.writeFile(wb, `transacoes_detalhadas_${year}.xlsx`);
      App.utils.showToast(`Transações de ${year} exportadas!`);
    } catch (e) {
      console.error('Erro ao exportar transações detalhadas:', e);
      App.utils.showToast('Erro ao exportar planilha.', 'error');
    }
  },

  // -------------------------------------------------------------------
  // Análise por Categoria (matriz categoria × mês)
  // -------------------------------------------------------------------
  async exportByCategory(year) {
    try {
      if (!year) year = this._selectedYear || new Date().getFullYear();
      App.utils.showToast(`Gerando análise por categoria de ${year}...`);

      const startDate = `${year}-01-01`;
      const endDate   = `${year}-12-31`;
      const allTx     = await App.db.getAll('transactions');
      const cards     = await App.db.getAll('creditCards');
      const cardMap   = Object.fromEntries(cards.map(c => [c.id, c]));

      const txAno = allTx.filter(t => {
        if (t.status !== 'confirmed') return false;
        if (t.ignore_from_total) return false;
        const d = (t.date || '').slice(0, 10);
        return d >= startDate && d <= endDate;
      });

      const monthOf = (t) => {
        let d = (t.date || '').slice(0, 10);
        if (t.credit_card_id && cardMap[t.credit_card_id]) {
          try {
            const p = App.cardInvoice.getInvoicePeriodForDate(cardMap[t.credit_card_id], d);
            d = p.due.slice(0, 10);
          } catch (e) {}
        }
        const m = parseInt(d.slice(5, 7), 10) - 1;
        return (m >= 0 && m <= 11) ? m : -1;
      };

      const mapEntradas = {};
      const mapSaidas   = {};

      for (const t of txAno) {
        const m = monthOf(t);
        if (m < 0) continue;
        const val = parseFloat(t.amount) || 0;
        const cat = t.category || 'Outros';

        if (t.type === 'income') {
          if (!mapEntradas[cat]) mapEntradas[cat] = Array(12).fill(0);
          mapEntradas[cat][m] += val;
        } else if (t.type === 'expense') {
          if (!mapSaidas[cat]) mapSaidas[cat] = Array(12).fill(0);
          mapSaidas[cat][m] += val;
        } else if (t.type === 'refund') {
          if (!mapSaidas[cat]) mapSaidas[cat] = Array(12).fill(0);
          mapSaidas[cat][m] -= val;
        }
      }

      const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const headerRow = ['Categoria', ...MONTHS, 'TOTAL'];
      const aoa = [];

      aoa.push([`Análise por Categoria — ${year}`, '', '', '', '', '', '', '', '', '', '', '', '', '']);
      aoa.push([]);
      aoa.push(['↑ ENTRADAS', '', '', '', '', '', '', '', '', '', '', '', '', '']);
      aoa.push(headerRow);

      const sortedInc = Object.keys(mapEntradas).sort((a, b) =>
        mapEntradas[b].reduce((s, v) => s + v, 0) - mapEntradas[a].reduce((s, v) => s + v, 0)
      );
      for (const cat of sortedInc) {
        const arr = mapEntradas[cat];
        const tot = arr.reduce((s, v) => s + v, 0);
        if (tot === 0) continue;
        aoa.push([cat, ...arr, tot]);
      }
      const incTotal = Array(12).fill(0);
      sortedInc.forEach(cat => {
        mapEntradas[cat].forEach((v, i) => { incTotal[i] += v; });
      });
      aoa.push(['TOTAL ENTRADAS', ...incTotal, incTotal.reduce((s, v) => s + v, 0)]);
      aoa.push([]);

      aoa.push(['↓ SAÍDAS', '', '', '', '', '', '', '', '', '', '', '', '', '']);
      aoa.push(headerRow);
      const sortedExp = Object.keys(mapSaidas).sort((a, b) =>
        mapSaidas[b].reduce((s, v) => s + v, 0) - mapSaidas[a].reduce((s, v) => s + v, 0)
      );
      for (const cat of sortedExp) {
        const arr = mapSaidas[cat];
        const tot = arr.reduce((s, v) => s + v, 0);
        if (tot === 0) continue;
        aoa.push([cat, ...arr, tot]);
      }
      const expTotal = Array(12).fill(0);
      sortedExp.forEach(cat => {
        mapSaidas[cat].forEach((v, i) => { expTotal[i] += v; });
      });
      aoa.push(['TOTAL SAÍDAS', ...expTotal, expTotal.reduce((s, v) => s + v, 0)]);
      aoa.push([]);

      aoa.push(['◎ RESULTADO (Entradas − Saídas)', '', '', '', '', '', '', '', '', '', '', '', '', '']);
      const resultado = incTotal.map((v, i) => v - expTotal[i]);
      aoa.push(['Resultado', ...resultado, resultado.reduce((s, v) => s + v, 0)]);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const range = XLSX.utils.decode_range(ws['!ref']);

      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = 1; C <= 13; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[addr];
          if (cell && cell.t === 'n') cell.z = '"R$ "#,##0.00';
        }
      }

      const PURPLE = '4B2E83';
      const WHITE = 'FFFFFF';
      const GREEN_BG = 'E2EFDA';
      const GREEN_TXT = '375623';
      const RED_BG = 'FCE4E4';
      const RED_TXT = 'C00000';
      const GREEN_DARK = '375623';
      const BORDER = 'BFBFBF';
      const bd = {
        top:    { style: 'thin', color: { rgb: BORDER } },
        bottom: { style: 'thin', color: { rgb: BORDER } },
        left:   { style: 'thin', color: { rgb: BORDER } },
        right:  { style: 'thin', color: { rgb: BORDER } }
      };

      const setStyle = (rr, cc, style) => {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = style;
      };

      setStyle(0, 0, {
        font: { bold: true, color: { rgb: WHITE }, sz: 13 },
        fill: { patternType: 'solid', fgColor: { rgb: PURPLE } },
        alignment: { horizontal: 'left', vertical: 'center' }
      });

      for (let R = 0; R <= range.e.r; R++) {
        const a1 = ws[XLSX.utils.encode_cell({ r: R, c: 0 })];
        if (!a1) continue;
        const v = String(a1.v || '');
        if (v.startsWith('↑ ENTRADAS')) {
          for (let C = 0; C <= 13; C++) setStyle(R, C, {
            font: { bold: true, color: { rgb: GREEN_DARK }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: GREEN_BG } },
            alignment: { horizontal: 'left', vertical: 'center' },
            border: bd
          });
        } else if (v.startsWith('↓ SAÍDAS')) {
          for (let C = 0; C <= 13; C++) setStyle(R, C, {
            font: { bold: true, color: { rgb: RED_TXT }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: RED_BG } },
            alignment: { horizontal: 'left', vertical: 'center' },
            border: bd
          });
        } else if (v.startsWith('◎ RESULTADO')) {
          for (let C = 0; C <= 13; C++) setStyle(R, C, {
            font: { bold: true, color: { rgb: WHITE }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: GREEN_DARK } },
            alignment: { horizontal: 'left', vertical: 'center' },
            border: bd
          });
        } else if (v === 'Categoria') {
          for (let C = 0; C <= 13; C++) setStyle(R, C, {
            font: { bold: true, color: { rgb: WHITE }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: PURPLE } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: bd
          });
        } else if (v === 'TOTAL ENTRADAS' || v === 'TOTAL SAÍDAS' || v === 'Resultado') {
          for (let C = 0; C <= 13; C++) setStyle(R, C, {
            font: { bold: true, color: { rgb: '000000' }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } },
            alignment: { horizontal: C === 0 ? 'left' : 'right', vertical: 'center' },
            border: bd
          });
        }
      }

      ws['!cols'] = [{ wch: 30 }, ...Array(12).fill({ wch: 12 }), { wch: 14 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Por Categoria ${year}`);
      XLSX.writeFile(wb, `analise_por_categoria_${year}.xlsx`);
      App.utils.showToast(`Análise por categoria de ${year} exportada!`);
    } catch (e) {
      console.error('Erro ao exportar análise por categoria:', e);
      App.utils.showToast('Erro ao exportar planilha.', 'error');
    }
  },

  // -------------------------------------------------------------------
  // Extrato Consolidado cronológico com saldo acumulado
  // -------------------------------------------------------------------
  async exportConsolidatedExtract(year) {
    try {
      if (!year) year = this._selectedYear || new Date().getFullYear();
      App.utils.showToast(`Gerando extrato consolidado de ${year}...`);

      const today = App.utils.todayISO();
      const startDate = `${year}-01-01`;
      const endDate   = `${year}-12-31`;

      const allAccounts = await App.db.getAll('accounts');
      const allTx       = await App.db.getAll('transactions');

      const activeAccounts   = allAccounts.filter(a => !a.archived);
      const accountsForTotal = activeAccounts.filter(a => !a.exclude_from_total);
      const isIncluded = (id) => accountsForTotal.some(a => a.id === id);

      const filteredTx = allTx.filter(t => {
        const d = (t.date || '').slice(0, 10);
        if (d < startDate || d > endDate) return false;
        if (t.status !== 'confirmed') return false;
        if (t.ignore_from_total) return false;
        if (t.invoice_locked) return false;
        if (t.credit_card_id) return false;
        if (d > today) return false;
        return true;
      }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      let saldoAcum = 0;
      const rows = [];

      for (const t of filteredTx) {
        const dStr = (t.date || '').slice(0, 10);
        const amt  = parseFloat(t.amount) || 0;
        const srcIn = isIncluded(t.account_id);
        const dstIn = t.account_to_id ? isIncluded(t.account_to_id) : false;

        let efeito = 0, categoria = '';
        if (t.type === 'income')        { if (srcIn) { efeito = +amt; categoria = 'Receita';       } }
        else if (t.type === 'refund')   { if (srcIn) { efeito = +amt; categoria = 'Estorno';       } }
        else if (t.type === 'expense')  { if (srcIn) { efeito = -amt; categoria = 'Despesa';       } }
        else if (t.type === 'transfer')     { if (srcIn) efeito -= amt; if (dstIn) efeito += amt; categoria = 'Transferência'; }
        else if (t.type === 'contribution') { if (srcIn) efeito -= amt; if (dstIn) efeito += amt; categoria = 'Aporte';       }
        else if (t.type === 'withdrawal')   { if (srcIn) efeito -= amt; if (dstIn) efeito += amt; categoria = 'Resgate';      }

        if (efeito === 0 && !['transfer','contribution','withdrawal'].includes(t.type)) continue;

        saldoAcum += efeito;
        rows.push({
          'Data': App.utils.formatDate(dStr),
          'Tipo': categoria,
          'Descrição': t.description || t.category || '',
          'Conta Origem': t.account_name || '',
          'Conta Destino': t.account_to_name || '',
          'Efeito': efeito,
          'Saldo Acumulado': saldoAcum
        });
      }

      if (rows.length === 0) {
        App.utils.showToast(`Nenhuma transação aplicável em ${year}.`, 'info');
        return;
      }

      rows.push({
        'Data': '── FIM ──',
        'Tipo': '',
        'Descrição': `Saldo final de ${year}`,
        'Conta Origem': '',
        'Conta Destino': '',
        'Efeito': '',
        'Saldo Acumulado': saldoAcum
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const range = XLSX.utils.decode_range(ws['!ref']);

      for (let R = 1; R <= range.e.r; R++) {
        const addrE = XLSX.utils.encode_cell({ r: R, c: 5 });
        const addrS = XLSX.utils.encode_cell({ r: R, c: 6 });
        if (ws[addrE] && ws[addrE].t === 'n') ws[addrE].z = '"R$ "#,##0.00;[Red]-"R$ "#,##0.00';
        if (ws[addrS] && ws[addrS].t === 'n') ws[addrS].z = '"R$ "#,##0.00;[Red]-"R$ "#,##0.00';
      }

      const PURPLE = '4B2E83';
      const WHITE = 'FFFFFF';
      const BORDER = 'BFBFBF';
      const bd = {
        top:    { style: 'thin', color: { rgb: BORDER } },
        bottom: { style: 'thin', color: { rgb: BORDER } },
        left:   { style: 'thin', color: { rgb: BORDER } },
        right:  { style: 'thin', color: { rgb: BORDER } }
      };
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c: C });
        if (ws[addr]) {
          ws[addr].s = {
            font: { bold: true, color: { rgb: WHITE }, sz: 11 },
            fill: { patternType: 'solid', fgColor: { rgb: PURPLE } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: bd
          };
        }
      }

      ws['!cols'] = [
        { wch: 12 }, { wch: 14 }, { wch: 50 }, { wch: 24 }, { wch: 24 }, { wch: 16 }, { wch: 18 }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Extrato ${year}`);
      XLSX.writeFile(wb, `extrato_consolidado_${year}.xlsx`);
      App.utils.showToast(`Extrato consolidado de ${year} exportado!`);
    } catch (e) {
      console.error('Erro ao exportar extrato consolidado:', e);
      App.utils.showToast('Erro ao exportar planilha.', 'error');
    }
  }
};