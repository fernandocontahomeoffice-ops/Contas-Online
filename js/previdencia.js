// =====================================================================
// ARQUIVO: previdencia.js
// Módulo de previdência (minha previdência)
// =====================================================================
var App = window.App || {};

App.previdencia = {
  _chart: null,

  async load() {
    try {
      const contribs = await App.db.getAll('previdencia');
      contribs.sort((a, b) => b.date.localeCompare(a.date));
      this.renderResumo(contribs);
      this.renderTabela(contribs);
      this.renderChart(contribs);
    } catch (e) {
      console.error('Erro ao carregar previdência:', e);
      document.getElementById('previdenciaResumo').innerHTML = '<p>Erro ao carregar dados. A store pode não existir. Recarregue a página após atualizar o banco.</p>';
      document.getElementById('previdenciaTableBody').innerHTML = '<tr><td colspan="5">Erro ao carregar.</td></tr>';
    }
  },

  renderResumo(contribs) {
    const total = contribs.reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const publica = contribs.filter(c => c.tipo === 'publica').reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const privada = contribs.filter(c => c.tipo === 'privada').reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    document.getElementById('previdenciaResumo').innerHTML = `
      <div class="card"><div class="card-label">Total Contribuído</div><div class="card-value">${App.utils.formatCurrency(total)}</div></div>
      <div class="card"><div class="card-label">Pública (INSS)</div><div class="card-value">${App.utils.formatCurrency(publica)}</div></div>
      <div class="card"><div class="card-label">Privada</div><div class="card-value">${App.utils.formatCurrency(privada)}</div></div>
    `;
  },

  renderTabela(contribs) {
    const tbody = document.getElementById('previdenciaTableBody');
    if (!contribs.length) {
      tbody.innerHTML = '<tr><td colspan="5">Nenhuma contribuição registrada</td></tr>';
      return;
    }
    tbody.innerHTML = contribs.map(c => `<tr>
      <td>${App.utils.formatDate(c.date)}</td>
      <td>${App.utils.formatCurrency(c.valor)}</td>
      <td>${c.tipo === 'publica' ? 'Pública' : 'Privada'}</td>
      <td>${c.instituicao || ''}</td>
      <td class="text-center">
        <button class="icon-btn" onclick="App.previdencia.edit('${c.id}')">✏️</button>
        <button class="icon-btn delete" onclick="App.previdencia.remove('${c.id}')">🗑️</button>
      </td>
    </tr>`).join('');
  },

  renderChart(contribs) {
    // Gráfico de barras com evolução anual
    const canvas = document.getElementById('previdenciaChart');
    if (!canvas) return;
    const annual = {};
    contribs.forEach(c => {
      const year = c.date.slice(0, 4);
      annual[year] = (annual[year] || 0) + parseFloat(c.valor || 0);
    });
    const anos = Object.keys(annual).sort();
    const valores = anos.map(a => annual[a]);

    if (this._chart) this._chart.destroy();
    this._chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: anos,
        datasets: [{
          label: 'Contribuição Anual',
          data: valores,
          backgroundColor: '#4CAF50',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { ticks: { callback: v => App.utils.formatCurrency(v) }, grid: { color: '#1f1f1f' } }
        },
        plugins: {
          legend: { labels: { color: '#b0b0b0' } },
          tooltip: { callbacks: { label: ctx => App.utils.formatCurrency(ctx.raw) } }
        }
      }
    });
  },

  async openModal(prev = null) {
    document.getElementById('prevId').value = prev?.id || '';
    document.getElementById('modalPrevidenciaTitle').textContent = prev ? 'Editar' : 'Nova Contribuição';
    document.getElementById('prevValor').value = prev?.valor || '';
    document.getElementById('prevData').value = prev?.date || App.utils.todayISO();
    document.getElementById('prevTipo').value = prev?.tipo || 'publica';
    document.getElementById('prevInstituicao').value = prev?.instituicao || '';
    App.ui.openModal('modalPrevidencia');
  },

  async edit(id) {
    const prev = await App.db.getById('previdencia', id);
    if (prev) this.openModal(prev);
  },

  async save(e) {
    e.preventDefault();
    const id = document.getElementById('prevId').value;
    const valor = parseFloat(document.getElementById('prevValor').value);
    if (isNaN(valor) || valor <= 0) { App.utils.showToast('Valor inválido', 'error'); return false; }
    const date = document.getElementById('prevData').value;
    if (!date) { App.utils.showToast('Data obrigatória', 'error'); return false; }
    const tipo = document.getElementById('prevTipo').value;
    const instituicao = document.getElementById('prevInstituicao').value.trim();

    const contrib = {
      id: id || App.utils.generateId(),
      valor,
      date,
      tipo,
      instituicao
    };
    await App.db.put('previdencia', contrib);
    App.ui.closeModal('modalPrevidencia');
    App.utils.showToast(id ? 'Contribuição atualizada!' : 'Contribuição registrada!');
    this.load();
    return false;
  },

  async remove(id) {
    App.utils.confirm('Excluir contribuição?', async () => {
      await App.db.delete('previdencia', id);
      this.load();
      App.utils.showToast('Contribuição removida.');
    });
  }
};