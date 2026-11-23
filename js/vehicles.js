// =====================================================================
// ARQUIVO: vehicles.js
// Módulo de veículos (cadastro, despesas, detalhes)
// =====================================================================
var App = window.App || {};

App.vehicles = {
  currentVehicleId: null,

  async load() {
    try {
      const page = document.getElementById('page-vehicles');
      if (page) page.classList.add('vehicles-page');

      const vehicles = await App.db.getAll('vehicles');
      vehicles.sort((a, b) => (b.aquisition_date || '').localeCompare(a.aquisition_date || ''));

      const allExpenses = await App.db.getAll('vehicleExpenses');
      this.renderList(vehicles, allExpenses);
    } catch (e) {
      console.error('Erro ao carregar veículos:', e);
      App.utils.showToast('Erro ao carregar veículos.', 'error');
    }
  },

  renderList(vehicles, allExpenses) {
    const container = document.getElementById('page-vehicles');
    if (!container) return;
    container.innerHTML = '';

    const expenseMap = {};
    allExpenses.forEach(e => {
      if (!expenseMap[e.vehicle_id]) expenseMap[e.vehicle_id] = 0;
      expenseMap[e.vehicle_id] += parseFloat(e.amount);
    });

    const totalVehicles = vehicles.length;
    const totalGastos = vehicles.reduce((s, v) => s + (expenseMap[v.id] || 0), 0);
    const autonomias = vehicles.filter(v => v.avg_autonomy && v.avg_autonomy > 0).map(v => v.avg_autonomy);
    const avgAutonomia = autonomias.length > 0 ? (autonomias.reduce((s, a) => s + a, 0) / autonomias.length).toFixed(1) : '--';
    const allFuelDates = allExpenses.filter(e => e.expense_type === 'Combustível' && e.date).map(e => e.date);
    const lastFuelDate = allFuelDates.length > 0 ? allFuelDates.sort().reverse()[0] : null;
    const totalKm = vehicles.reduce((s, v) => s + (v.current_km - (v.initial_km || 0)), 0);
    const custoPorKm = totalKm > 0 ? (totalGastos / totalKm).toFixed(2) : '0.00';

    const getDaysAgo = (dateStr) => {
      if (!dateStr) return '';
      const diff = Math.floor((new Date() - new Date(dateStr + 'T12:00:00')) / 86400000);
      return diff === 0 ? 'Hoje' : diff === 1 ? 'Há 1 dia' : `Há ${diff} dias`;
    };

    let html = `
      <div class="page-header">
        <div>
          <h1 style="font-size:24px;font-weight:700;color:var(--text);">Veículos</h1>
          <p style="font-size:14px;color:var(--text-muted);">Gerencie seus veículos de forma prática e organizada.</p>
        </div>
        <div>
          <button class="btn btn-primary" onclick="App.vehicles.openModal()">＋ Novo Veículo</button>
        </div>
      </div>

      <div class="vehicles-summary-grid">
        <div class="vehicles-summary-card">
          <div class="v-icon blue"><i data-lucide="car"></i></div>
          <div class="v-info"><div class="v-value">${totalVehicles}</div><div class="v-label">${totalVehicles === 1 ? 'Veículo ativo' : 'Veículos ativos'}</div></div>
        </div>
        <div class="vehicles-summary-card">
          <div class="v-icon green"><i data-lucide="wallet"></i></div>
          <div class="v-info"><div class="v-value">${App.utils.formatCurrency(totalGastos)}</div><div class="v-label">Total gasto</div></div>
        </div>
        <div class="vehicles-summary-card">
          <div class="v-icon purple"><i data-lucide="gauge"></i></div>
          <div class="v-info"><div class="v-value">${avgAutonomia} km/l</div><div class="v-label">Média geral</div></div>
        </div>
        <div class="vehicles-summary-card">
          <div class="v-icon orange"><i data-lucide="calendar"></i></div>
          <div class="v-info"><div class="v-value">${lastFuelDate ? App.utils.formatDate(lastFuelDate) : '--'}</div><div class="v-label">Último abastecimento</div></div>
        </div>
        <div class="vehicles-summary-card">
          <div class="v-icon red"><i data-lucide="trending-up"></i></div>
          <div class="v-info"><div class="v-value">${App.utils.formatCurrency(parseFloat(custoPorKm))}</div><div class="v-label">Custo por km</div></div>
        </div>
      </div>

      <div class="vehicles-filter-bar">
        <div class="search-input-wrapper">
          <input type="text" id="vehiclesSearch" placeholder="Buscar veículo ou placa..." oninput="App.vehicles.filterVehicleList()">
          <i data-lucide="search"></i>
        </div>
        <select id="vehiclesSort" onchange="App.vehicles.filterVehicleList()">
          <option value="name">Ordenar por nome</option>
          <option value="km">Maior km</option>
          <option value="expense">Maior gasto</option>
        </select>
      </div>

      <div class="vehicles-grid" id="vehiclesGrid"></div>
    `;

    container.innerHTML = html;
    container.classList.add('active');

    this._vehiclesData = vehicles;
    this._expensesData = allExpenses;
    this.renderVehicleCards(vehicles, expenseMap);

    if (window.lucide) {
      setTimeout(() => lucide.createIcons({ attrs: { stroke: 'currentColor', 'stroke-width': '2', width: '24', height: '24' } }), 100);
    }
  },

  _vehiclesData: [],
  _expensesData: [],

  renderVehicleCards(vehicles, expenseMap) {
    const grid = document.getElementById('vehiclesGrid');
    if (!grid) return;

    let cardsHtml = '';
    vehicles.forEach(v => {
      const gastoTotal = expenseMap[v.id] || 0;
      const vehicleExpenses = (this._expensesData || []).filter(e => e.vehicle_id === v.id);
      const fuelExpenses = vehicleExpenses.filter(e => e.expense_type === 'Combustível').sort((a,b) => b.date.localeCompare(a.date));
      const lastFuel = fuelExpenses.length > 0 ? fuelExpenses[0] : null;
      const mediaMensalKm = v.current_km && v.aquisition_date ? Math.round((v.current_km - (v.initial_km || 0)) / Math.max(1, (new Date() - new Date(v.aquisition_date + 'T12:00:00')) / (1000*60*60*24*30))) : 0;
      const mediaMensalGasto = gastoTotal > 0 && v.aquisition_date ? gastoTotal / Math.max(1, (new Date() - new Date(v.aquisition_date + 'T12:00:00')) / (1000*60*60*24*30)) : 0;
      const autonomiaStatus = v.avg_autonomy ? (v.avg_autonomy >= 8 ? 'good' : v.avg_autonomy >= 5 ? 'medium' : 'bad') : '';
      const autonomiaLabel = v.avg_autonomy ? (v.avg_autonomy >= 8 ? 'Boa' : v.avg_autonomy >= 5 ? 'Média' : 'Ruim') : '--';

      let tankStatus = ''; let tankClass = '';
      if (lastFuel) {
        const daysSince = Math.floor((new Date() - new Date(lastFuel.date + 'T12:00:00')) / 86400000);
        if (daysSince <= 3) { tankStatus = 'Cheio'; tankClass = 'full'; }
        else if (daysSince <= 10) { tankStatus = 'Meio'; tankClass = 'medium'; }
        else { tankStatus = 'Reserva'; tankClass = 'bad'; }
      }
      const getDaysAgo = (dateStr) => this.formatTimeAgo(dateStr);

      cardsHtml += `
        <div class="vehicle-card-item">
          <div class="vehicle-card-photo">
            ${v.photo_data ? `<img src="${v.photo_data}" alt="${v.model}" />` : `<i data-lucide="car"></i>`}
          </div>
          <div class="vehicle-card-info">
            <div class="v-info-block" style="min-width:140px;">
              <div class="v-label">Veículo</div>
              <div class="v-value" style="font-weight:600;font-size:1rem;">${v.model}</div>
              <span class="v-badge ${v.sale_date ? 'sold' : 'active'}">${v.sale_date ? 'Vendido' : 'Ativo'}</span>
            </div>
            <div class="v-info-block">
              <div class="v-label">Placa</div>
              <div class="v-value"><span class="v-placa-badge">${v.plate || '--'}</span></div>
            </div>
            <div class="v-info-block">
              <div class="v-label">KM atual</div>
              <div class="v-value">${v.current_km.toLocaleString('pt-BR')} km</div>
              <div style="font-size:11px;color:var(--text-muted);">Média mensal: ${mediaMensalKm} km</div>
            </div>
            <div class="v-info-block">
              <div class="v-label">Autonomia</div>
              <div class="v-value">${v.avg_autonomy ? v.avg_autonomy.toFixed(1) + ' km/l' : '--'}</div>
              ${autonomiaStatus ? `<span class="v-badge ${autonomiaStatus}">${autonomiaLabel}</span>` : ''}
            </div>
            <div class="v-info-block">
              <div class="v-label">Último abastecimento</div>
              <div class="v-value">${lastFuel ? App.utils.formatDate(lastFuel.date) : '--'}</div>
              <div style="font-size:11px;color:var(--text-muted);">${lastFuel ? getDaysAgo(lastFuel.date) : ''}</div>
              ${tankStatus ? `<span class="v-badge ${tankClass}">${tankStatus}</span>` : ''}
            </div>
            <div class="v-info-block">
              <div class="v-label">Gasto total</div>
              <div class="v-value">${App.utils.formatCurrency(gastoTotal)}</div>
              <div style="font-size:11px;color:var(--text-muted);">Média mês: ${App.utils.formatCurrency(mediaMensalGasto)}</div>
            </div>
          </div>
          <div class="vehicle-card-actions">
            <button class="vd-icon-btn" onclick="App.vehicles.openModal('${v.id}')" title="Editar"><i data-lucide="pencil"></i></button>
            <button class="vd-icon-btn" onclick="App.vehicles.openDetail('${v.id}')" title="Ver detalhes"><i data-lucide="eye"></i></button>
            <button class="vd-icon-btn delete" onclick="App.vehicles.remove('${v.id}')" title="Excluir"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
      `;
    });

    grid.innerHTML = cardsHtml || '<p style="color:var(--text-muted);padding:24px;text-align:center;">Nenhum veículo encontrado.</p>';

    if (window.lucide) {
      setTimeout(() => lucide.createIcons({ attrs: { stroke: 'currentColor', 'stroke-width': '2', width: '24', height: '24' } }), 100);
    }
  },

  filterVehicleList() {
    const search = (document.getElementById('vehiclesSearch')?.value || '').toLowerCase().trim();
    const sort = document.getElementById('vehiclesSort')?.value || 'name';
    const vehicles = [...(this._vehiclesData || [])];
    const expenseMap = {};
    (this._expensesData || []).forEach(e => {
      if (!expenseMap[e.vehicle_id]) expenseMap[e.vehicle_id] = 0;
      expenseMap[e.vehicle_id] += parseFloat(e.amount);
    });

    let filtered = vehicles.filter(v => {
      if (!search) return true;
      return (v.model || '').toLowerCase().includes(search) || (v.plate || '').toLowerCase().includes(search);
    });

    if (sort === 'km') filtered.sort((a,b) => (b.current_km||0) - (a.current_km||0));
    else if (sort === 'expense') filtered.sort((a,b) => (expenseMap[b.id]||0) - (expenseMap[a.id]||0));
    else filtered.sort((a,b) => (a.model||'').localeCompare(b.model||''));

    this.renderVehicleCards(filtered, expenseMap);
  },

    async openModal(vehicleId = null) {
    const v = vehicleId ? await App.db.getById('vehicles', vehicleId) : null;
    document.getElementById('vehicleId').value = v?.id || '';
    document.getElementById('modalVehicleTitle').textContent = v ? 'Editar Veículo' : 'Novo Veículo';
    document.getElementById('vehicleModel').value = v?.model || '';
    document.getElementById('vehiclePlate').value = v?.plate || '';
    document.getElementById('vehicleColor').value = v?.color || '';
    document.getElementById('vehicleRenavam').value = v?.renavam || '';
    document.getElementById('vehicleYear').value = v?.year || '';
    document.getElementById('vehicleInitialKm').value = v?.initial_km || '';
    document.getElementById('vehicleKm').value = v?.current_km || '';
    document.getElementById('vehicleAquisitionDate').value = v?.aquisition_date || App.utils.todayISO();
    document.getElementById('vehicleSaleDate').value = v?.sale_date || '';
    document.getElementById('vehicleFuel').value = v?.fuel || '';
    document.getElementById('vehiclePhotoData').value = v?.photo_data || '';

    // Restaurar preview da foto
    const photoPreview = document.getElementById('vPhotoPreview');
    const photoPlaceholder = document.getElementById('vPhotoPlaceholder');
    const photoCircle = document.getElementById('vPhotoCircle');
    if (v?.photo_data) {
      photoPreview.src = v.photo_data;
      photoPreview.style.display = 'block';
      photoPlaceholder.style.display = 'none';
      photoCircle.classList.add('has-photo');
    } else {
      photoPreview.src = '';
      photoPreview.style.display = 'none';
      photoPlaceholder.style.display = '';
      photoCircle.classList.remove('has-photo');
    }

    App.ui.openModal('modalVehicle');
  },

  handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tamanho (5MB)
    if (file.size > 5 * 1024 * 1024) {
      App.utils.showToast('A imagem deve ter no máximo 5MB.', 'error');
      event.target.value = '';
      return;
    }

    // Validar tipo
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      App.utils.showToast('Formato inválido. Use PNG ou JPEG.', 'error');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      document.getElementById('vehiclePhotoData').value = dataUrl;
      const photoPreview = document.getElementById('vPhotoPreview');
      const photoPlaceholder = document.getElementById('vPhotoPlaceholder');
      const photoCircle = document.getElementById('vPhotoCircle');
      photoPreview.src = dataUrl;
      photoPreview.style.display = 'block';
      photoPlaceholder.style.display = 'none';
      photoCircle.classList.add('has-photo');
    };
    reader.readAsDataURL(file);
  },

  async saveFromModal(e) {
    e.preventDefault();
    try {
      const id = document.getElementById('vehicleId').value;
      const model = document.getElementById('vehicleModel').value.trim();
      const plate = document.getElementById('vehiclePlate').value.trim();
      const color = document.getElementById('vehicleColor').value.trim();
      const renavam = document.getElementById('vehicleRenavam').value.trim();
      const year = parseInt(document.getElementById('vehicleYear').value) || null;
      const currentKm = parseFloat(document.getElementById('vehicleKm').value);
      const aquisitionDate = document.getElementById('vehicleAquisitionDate').value;
      const saleDate = document.getElementById('vehicleSaleDate').value;
      const fuel = document.getElementById('vehicleFuel').value;
      const photoData = document.getElementById('vehiclePhotoData').value;

      if (!model) { App.utils.showToast('Modelo obrigatório', 'error'); return false; }
      if (isNaN(currentKm)) { App.utils.showToast('Km inválido', 'error'); return false; }
      if (!aquisitionDate) { App.utils.showToast('Data de aquisição obrigatória', 'error'); return false; }

      const initialKm = parseFloat(document.getElementById('vehicleInitialKm').value) || null;
      const vehicle = {
        id: id || App.utils.generateId(),
        model,
        plate: plate.toUpperCase(),
        color,
        renavam,
        year,
        initial_km: initialKm,
        current_km: currentKm,
        aquisition_date: aquisitionDate,
        sale_date: saleDate || null,
        fuel: fuel || '',
        photo_data: photoData || '',
        avg_autonomy: id ? (await App.db.getById('vehicles', id))?.avg_autonomy || null : null,
        total_expenses: id ? (await App.db.getById('vehicles', id))?.total_expenses || 0 : 0
      };
      await App.db.put('vehicles', vehicle);
      App.ui.closeModal('modalVehicle');
      App.utils.showToast(id ? 'Veículo atualizado!' : 'Veículo criado!');
      this.load();
    } catch (e) {
      console.error('Erro ao salvar veículo:', e);
      App.utils.showToast('Erro ao salvar veículo.', 'error');
    }
    return false;
  },

  async remove(id) {
    App.utils.confirm('Excluir veículo e todos os gastos associados?', async () => {
      await App.db.delete('vehicles', id);
      const expenses = await App.db.getAll('vehicleExpenses');
      for (const e of expenses.filter(e => e.vehicle_id === id)) {
        await App.db.delete('vehicleExpenses', e.id);
      }
      App.utils.showToast('Veículo removido!');
      this.load();
    });
  },

  async openDetail(vehicleId) {
    this.currentVehicleId = vehicleId;
    App.ui.navigateTo('vehicle-detail');
    await this.loadDetail();
  },

  _expenseCache: null,
  _expenseFilter: { search: '', type: 'Todos', sort: 'recente', period: 'todos' },
  _filteredExpenses: [],
  _expensePage: 1,
  _expensePageSize: 20,

  async loadDetail() {
    const v = await App.db.getById('vehicles', this.currentVehicleId);
    if (!v) return;

    // Marca a página com classe para o novo CSS
    const page = document.getElementById('page-vehicle-detail');
    if (page) page.classList.add('vehicle-detail-page');

    const expenses = await App.db.getAll('vehicleExpenses');
    const vehicleExpenses = expenses
      .filter(e => e.vehicle_id === this.currentVehicleId)
      .sort((a, b) => b.date.localeCompare(a.date));

    this._expenseCache = vehicleExpenses;
    this._expenseFilter = { search: '', type: 'Todos', sort: 'recente', period: 'todos' };

    // Tempo de uso
    const startDate = new Date(v.aquisition_date + 'T12:00:00');
    const endDate = v.sale_date ? new Date(v.sale_date + 'T12:00:00') : new Date();
    const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
    const years = Math.floor(diffMonths / 12);
    const months = diffMonths % 12;
    const timeUsage = (years > 0 ? years + 'a ' : '') + months + 'm';

    const allKm = vehicleExpenses.map(e => e.km).filter(km => km != null);
    const startKm = v.initial_km != null
      ? v.initial_km
      : (allKm.length > 0 ? Math.min(...allKm) : v.current_km);
    const totalKm = Math.max(0, v.current_km - startKm);

    const gastosTotais = vehicleExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);
    const gastosCombustivel = vehicleExpenses
      .filter(e => e.expense_type === 'Combustível')
      .reduce((s, e) => s + parseFloat(e.amount), 0);
    const gastosManutencao = vehicleExpenses
      .filter(e => e.expense_type === 'Manutenção')
      .reduce((s, e) => s + parseFloat(e.amount), 0);
    const gastosOutros = vehicleExpenses
      .filter(e => e.expense_type !== 'Combustível' && e.expense_type !== 'Manutenção')
      .reduce((s, e) => s + parseFloat(e.amount), 0);

    const custoPorKm = totalKm > 0 ? gastosTotais / totalKm : 0;
    const mesesAtivos = Math.max(1, diffMonths);
    const mediaMensal = gastosTotais / mesesAtivos;

    const chronoForAutonomy = [...vehicleExpenses]
      .filter(x => x.km != null)
      .sort((a, b) => {
        const byDate = a.date.localeCompare(b.date);
        if (byDate !== 0) return byDate;
        return (a.km || 0) - (b.km || 0);
      });
    let somaAutonomia = 0, contAutonomia = 0;
    for (let i = 1; i < chronoForAutonomy.length; i++) {
      const cur = chronoForAutonomy[i];
      const prev = chronoForAutonomy[i-1];
      if (cur.liters > 0 && cur.km > 0 && prev.km > 0) {
        const dist = cur.km - prev.km;
        if (dist > 0) {
          somaAutonomia += dist / cur.liters;
          contAutonomia++;
        }
      }
    }
    const avgAutonomia = contAutonomia > 0 ? (somaAutonomia / contAutonomia).toFixed(1) : '--';

    const pageContent = document.getElementById('vehicleDetailCards');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <header class="vd-topbar">
        <div class="vd-vehicle-head">
          <button class="vd-back" onclick="App.ui.navigateTo('vehicles')"><i data-lucide="chevron-left"></i> Voltar</button>
          <div class="vd-vehicle-icon"><i data-lucide="car" style="width:28px;height:28px;color:#fff"></i></div>
          <div class="vd-title">
            <h1>${v.model}</h1>
            <p>${v.plate || 'Sem placa'} &nbsp;&nbsp;·&nbsp;&nbsp;${v.current_km.toLocaleString('pt-BR')} km</p>
          </div>
        </div>
        <div class="vd-actions">
          <button class="vd-primary" onclick="App.vehicles.openExpensesList()" title="Ver todos os gastos">📋 Ver Gastos</button>
          <button class="vd-primary" onclick="App.vehicles.openExpenseModal()">＋ Novo Gasto</button>
          <button class="vd-primary" style="padding:10px 11px;" onclick="App.vehicles.exportExpensesCSV()" title="Exportar CSV">⇩</button>
        </div>
      </header>

      <section class="vd-cards">
        <article class="vd-card vd-metric">
          <div class="vd-metric-icon i-purple"><i data-lucide="gauge"></i></div>
          <div><div class="vd-metric-label">KM atual</div><div class="vd-metric-value">${v.current_km.toLocaleString('pt-BR')} km</div><div class="vd-metric-sub">Atualizado</div></div>
        </article>
        <article class="vd-card vd-metric">
          <div class="vd-metric-icon i-green"><i data-lucide="fuel"></i></div>
          <div><div class="vd-metric-label">Autonomia média</div><div class="vd-metric-value">${avgAutonomia} km/L</div><div class="vd-metric-sub">Média geral</div></div>
        </article>
        <article class="vd-card vd-metric">
          <div class="vd-metric-icon i-blue"><i data-lucide="calendar-clock"></i></div>
          <div><div class="vd-metric-label">Tempo de uso</div><div class="vd-metric-value">${timeUsage}</div><div class="vd-metric-sub">Desde a aquisição</div></div>
        </article>
        <article class="vd-card vd-metric">
          <div class="vd-metric-icon i-orange"><i data-lucide="flag-triangle-right"></i></div>
          <div><div class="vd-metric-label">KM rodados</div><div class="vd-metric-value">${totalKm.toLocaleString('pt-BR')} km</div><div class="vd-metric-sub">Desde a aquisição</div></div>
        </article>
        <article class="vd-card vd-metric">
          <div class="vd-metric-icon i-red"><i data-lucide="wallet"></i></div>
          <div><div class="vd-metric-label">Gastos totais</div><div class="vd-metric-value">${App.utils.formatCurrency(gastosTotais)}</div><div class="vd-metric-sub">Todos os lançamentos</div></div>
        </article>
      </section>

      <section class="vd-grid2">
        <article class="vd-section">
          <h2 class="vd-section-title"><i data-lucide="car"></i> Informações do veículo</h2>
          <div class="vd-info-box">
            <div class="vd-info-grid">
              <div class="vd-info-cell"><div class="vd-info-label">Placa</div><div class="vd-info-value">${v.plate || '--'}</div></div>
              <div class="vd-info-cell"><div class="vd-info-label">Aquisição</div><div class="vd-info-value">${App.utils.formatDate(v.aquisition_date)}</div></div>
              <div class="vd-info-cell"><div class="vd-info-label">Tempo de uso</div><div class="vd-info-value">${timeUsage}</div></div>
              <div class="vd-info-cell"><div class="vd-info-label">KM inicial</div><div class="vd-info-value">${startKm.toLocaleString('pt-BR')} km</div></div>
              <div class="vd-info-cell">
                <div class="vd-info-label">KM atual</div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <input type="number" id="vdEditKm" value="${v.current_km}" step="1" min="0"
                         style="background:#0b0d0f; border:1px solid #30343a; color:#f1f2f4; border-radius:6px; padding:5px 8px; width:110px; font-size:12px; font-family:inherit; outline:none;"
                         onfocus="this.style.borderColor='#4d8dff';"
                         onblur="this.style.borderColor='#30343a';"
                         onkeydown="if(event.key==='Enter'){event.preventDefault();App.vehicles.saveCurrentKm();}">
                  <button class="vd-icon-btn" onclick="App.vehicles.saveCurrentKm()" title="Salvar KM" style="padding:4px 8px; height:28px; width:auto;"><i data-lucide="check"></i></button>
                </div>
              </div>
              <div class="vd-info-cell"><div class="vd-info-label">Total percorrido</div><div class="vd-info-value">${totalKm.toLocaleString('pt-BR')} km</div></div>
            </div>
          </div>
        </article>

        <article class="vd-section">
          <h2 class="vd-section-title"><i data-lucide="wallet"></i> Resumo de custos</h2>
          <div class="vd-cost-box">
            <div class="vd-cost-grid">
              <div class="vd-cost-cell"><div class="vd-cost-label">Gastos totais</div><div class="vd-cost-value">${App.utils.formatCurrency(gastosTotais)}</div><div class="vd-cost-sub">100% do total</div></div>
              <div class="vd-cost-cell"><div class="vd-cost-label vd-green">Combustível</div><div class="vd-cost-value">${App.utils.formatCurrency(gastosCombustivel)}</div><div class="vd-cost-sub">${gastosTotais ? ((gastosCombustivel/gastosTotais)*100).toFixed(0) : 0}% do total</div></div>
              <div class="vd-cost-cell"><div class="vd-cost-label vd-orange">Manutenção</div><div class="vd-cost-value">${App.utils.formatCurrency(gastosManutencao)}</div><div class="vd-cost-sub">${gastosTotais ? ((gastosManutencao/gastosTotais)*100).toFixed(0) : 0}% do total</div></div>
              <div class="vd-cost-cell"><div class="vd-cost-label vd-blue">Custo por km</div><div class="vd-cost-value">${App.utils.formatCurrency(custoPorKm)}</div><div class="vd-cost-sub">Por km rodado</div></div>
              <div class="vd-cost-cell"><div class="vd-cost-label vd-pink">Média mensal</div><div class="vd-cost-value">${App.utils.formatCurrency(mediaMensal)}</div><div class="vd-cost-sub">Últimos ${mesesAtivos} ${mesesAtivos === 1 ? 'mês' : 'meses'}</div></div>
            </div>
          </div>
        </article>
      </section>

      <section class="vd-bottom">
        <article class="vd-section vd-chart-section" id="vdEvolutionSection">
          <div class="vd-chart-head">
            <div class="vd-chart-title"><i data-lucide="bar-chart-3"></i> Evolução de gastos (R$)</div>
            <select class="vd-select vd-chart-select" id="vdChartPeriod" onchange="App.vehicles.renderEvolutionChart()">
              <option>Últimos 8 meses</option><option>Últimos 12 meses</option>
            </select>
          </div>
          <div style="height:210px;"><canvas id="vdEvolutionChart"></canvas></div>
        </article>

        <article class="vd-section vd-chart-section" id="vdDonutSection">
          <div class="vd-chart-title" style="margin-bottom:10px"><i data-lucide="pie-chart"></i> Gastos por tipo</div>
          <div class="vd-type-layout">
            <div style="max-width:190px; margin:auto;"><canvas id="vdDonutChart"></canvas></div>
            <div id="vdDonutLegend"></div>
          </div>
          <div class="vd-side-stats" id="vdSideStats"></div>
        </article>
      </section>
    `;

    if (pageContent) {
      pageContent.innerHTML = '';
      pageContent.appendChild(wrapper);
    }

    if (document.getElementById('modalVehicleExpensesList')?.classList.contains('open')) {
      this.filterExpenses();
    }
    setTimeout(() => {
      this.renderEvolutionChart();
      this.renderDonutChart();
      this.renderSideStats();
    }, 100);
  },

  async saveCurrentKm() {
    const input = document.getElementById('vdEditKm');
    if (!input) return;
    const newKm = parseFloat(input.value);
    if (isNaN(newKm) || newKm < 0) {
      App.utils.showToast('KM inválida.', 'error');
      return;
    }

    const vehicle = await App.db.getById('vehicles', this.currentVehicleId);
    if (!vehicle) return;

    if (newKm === parseFloat(vehicle.current_km)) {
      App.utils.showToast('KM sem alteração.');
      return;
    }

    const allExpenses = await App.db.getAll('vehicleExpenses');
    const vehicleExpenses = allExpenses.filter(x => x.vehicle_id === this.currentVehicleId);
    const maxKmExpenses = vehicleExpenses.reduce((max, x) => {
      const v = parseFloat(x.km);
      return (!isNaN(v) && v > max) ? v : max;
    }, parseFloat(vehicle.initial_km) || 0);

    const apply = async () => {
      vehicle.current_km = newKm;
      await App.db.put('vehicles', vehicle);

      const chronological = [...vehicleExpenses]
        .filter(x => x.km != null)
        .sort((a, b) => {
          const byDate = a.date.localeCompare(b.date);
          if (byDate !== 0) return byDate;
          return (a.km || 0) - (b.km || 0);
        });

      let prev = null;
      for (const cur of chronological) {
        if (prev) {
          const driven = cur.km - prev.km;
          cur.km_driven = driven > 0 ? driven : 0;
          const curLiters = parseFloat(cur.liters) || 0;
          cur.km_per_liter = (curLiters > 0 && cur.km_driven > 0) ? cur.km_driven / curLiters : null;
          await App.db.put('vehicleExpenses', cur);
        } else {
          cur.km_driven = 0;
          cur.km_per_liter = null;
          await App.db.put('vehicleExpenses', cur);
        }
        prev = cur;
      }

      const fuelExpenses = vehicleExpenses.filter(x => x.km_per_liter && x.km_per_liter > 0);
      vehicle.avg_autonomy = fuelExpenses.length > 0
        ? fuelExpenses.reduce((s, x) => s + x.km_per_liter, 0) / fuelExpenses.length
        : null;
      vehicle.total_expenses = vehicleExpenses.reduce((s, x) => s + parseFloat(x.amount), 0);
      await App.db.put('vehicles', vehicle);

      App.utils.showToast('KM atualizada!');
      this.loadDetail();
    };

    if (newKm < maxKmExpenses) {
      App.utils.confirm(
        `A KM informada (${newKm.toLocaleString('pt-BR')}) é menor que a maior KM registrada nos gastos (${maxKmExpenses.toLocaleString('pt-BR')}). Deseja continuar?`,
        apply,
        null
      );
    } else {
      await apply();
    }
  },

  openExpensesList() {
    if (!this._expenseCache) this._expenseCache = [];
    App.ui.openModal('modalVehicleExpensesList');
    this.filterExpenses();
    if (window.lucide) {
      setTimeout(() => lucide.createIcons({ attrs: { stroke: 'currentColor', 'stroke-width': '2', width: '24', height: '24' } }), 60);
    }
  },

  filterExpenses() {
    if (!this._expenseCache) return;
    const search = (document.getElementById('vdSearchInput')?.value || '').toLowerCase().trim();
    const typeSel = document.getElementById('vdTypeFilter')?.value || 'Tipo: Todos';
    const periodSel = document.getElementById('vdPeriodFilter')?.value || 'Período: Todos';
    const sortSel = document.getElementById('vdSortFilter')?.value || 'Ordenar: Mais recente';

    this._expenseFilter.search = search;
    this._expenseFilter.type = typeSel;
    this._expenseFilter.sort = sortSel;
    this._expenseFilter.period = periodSel;

    let filtered = [...this._expenseCache];

    if (typeSel !== 'Tipo: Todos') {
      filtered = filtered.filter(e => e.expense_type === typeSel);
    }

    const now = new Date();
    if (periodSel === 'Últimos 30 dias') {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);
      filtered = filtered.filter(e => new Date(e.date + 'T12:00:00') >= cutoff);
    } else if (periodSel === 'Últimos 6 meses') {
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - 6);
      filtered = filtered.filter(e => new Date(e.date + 'T12:00:00') >= cutoff);
    } else if (periodSel === 'Últimos 12 meses') {
      const cutoff = new Date(now);
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      filtered = filtered.filter(e => new Date(e.date + 'T12:00:00') >= cutoff);
    }

    if (search) {
      filtered = filtered.filter(e =>
        (e.description || '').toLowerCase().includes(search) ||
        (e.expense_type || '').toLowerCase().includes(search)
      );
    }

    if (sortSel === 'Menor valor') {
      filtered.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
    } else if (sortSel === 'Maior valor') {
      filtered.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
    } else {
      filtered.sort((a, b) => b.date.localeCompare(a.date));
    }

    this._filteredExpenses = filtered;
    this._expensePage = 1;
    this.renderExpensePage();
  },

  goToExpensePage(page) {
    const total = this._filteredExpenses ? this._filteredExpenses.length : 0;
    const pageSize = this._expensePageSize || 20;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const target = Math.max(1, Math.min(page, totalPages));
    this._expensePage = target;
    this.renderExpensePage();
  },

  renderExpensePage() {
    const filtered = this._filteredExpenses || [];
    const pageSize = this._expensePageSize || 20;
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    let currentPage = this._expensePage || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    this._expensePage = currentPage;

    const start = (currentPage - 1) * pageSize;
    const end = Math.min(start + pageSize, totalItems);
    const pageData = filtered.slice(start, end);

    const tbody = document.getElementById('vdTableContainer');
    if (tbody) {
      if (pageData.length === 0) {
        tbody.innerHTML = '<p style="padding:20px;color:var(--vd-muted);">Nenhum registro encontrado.</p>';
      } else {
        tbody.innerHTML = `<table class="vd-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>KM</th><th>Litros</th><th>KM/L</th><th>R$/L</th><th>Valor</th><th>Ações</th></tr></thead>
          <tbody>${pageData.map(e => {
            const esc = (v) => App.utils.escapeHtml(v);
            const kml = e.km_per_liter ? e.km_per_liter.toFixed(1) : '--';
            const pricePerLiter = e.liters > 0 ? (e.amount / e.liters).toFixed(2) : '--';
            const tipoIcon = e.expense_type === 'Combustível' ? '⛽' : '🔧';
            const fuelLabel = e.expense_type === 'Combustível' && e.fuel_type ? ` · ${esc(e.fuel_type)}` : '';
            return `<tr>
              <td>${App.utils.formatDate(e.date)}</td>
              <td><span class="vd-badge">${tipoIcon} ${esc(e.expense_type || 'Outros')}${fuelLabel}</span></td>
              <td>${esc(e.description || '')}</td>
              <td>${e.km ? e.km.toLocaleString('pt-BR') : '--'}</td>
              <td>${e.liters ? e.liters.toFixed(1) : '--'}</td>
              <td>${kml}</td>
              <td>R$ ${pricePerLiter}</td>
              <td>${App.utils.formatCurrency(e.amount)}</td>
              <td><div class="vd-action">
                <button class="vd-icon-btn" onclick="App.vehicles.editExpense('${e.id}')"><i data-lucide="pencil"></i></button>
                <button class="vd-icon-btn" onclick="App.vehicles.showExpenseDetail('${e.id}')"><i data-lucide="info"></i></button>
                <button class="vd-icon-btn delete" onclick="App.vehicles.removeExpense('${e.id}')"><i data-lucide="trash-2"></i></button>
              </div></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>`;
      }

      if (window.lucide) {
        setTimeout(() => lucide.createIcons({ attrs: { stroke: 'currentColor', 'stroke-width': '2', width: '24', height: '24' } }), 30);
      }
    }

    const footer = document.getElementById('vdTableFooter');
    if (footer) {
      const from = totalItems === 0 ? 0 : start + 1;
      const to = end;

      let paginationHtml = '<div class="vd-pagination" style="display:flex; align-items:center; gap:5px;">';

      const prevDisabled = currentPage <= 1;
      paginationHtml += `<button class="vd-page-btn" ${prevDisabled ? 'disabled' : ''} style="${prevDisabled ? 'opacity:0.35; cursor:not-allowed;' : ''}" onclick="App.vehicles.goToExpensePage(${currentPage - 1})" title="Anterior">‹</button>`;

      const maxButtons = 5;
      let windowStart = Math.max(1, currentPage - Math.floor(maxButtons / 2));
      let windowEnd = Math.min(totalPages, windowStart + maxButtons - 1);
      if (windowEnd - windowStart + 1 < maxButtons) {
        windowStart = Math.max(1, windowEnd - maxButtons + 1);
      }

      if (windowStart > 1) {
        paginationHtml += `<button class="vd-page-btn" onclick="App.vehicles.goToExpensePage(1)">1</button>`;
        if (windowStart > 2) {
          paginationHtml += `<span style="color:var(--vd-muted); padding:0 4px;">…</span>`;
        }
      }

      for (let p = windowStart; p <= windowEnd; p++) {
        paginationHtml += `<button class="vd-page-btn ${p === currentPage ? 'active' : ''}" onclick="App.vehicles.goToExpensePage(${p})">${p}</button>`;
      }

      if (windowEnd < totalPages) {
        if (windowEnd < totalPages - 1) {
          paginationHtml += `<span style="color:var(--vd-muted); padding:0 4px;">…</span>`;
        }
        paginationHtml += `<button class="vd-page-btn" onclick="App.vehicles.goToExpensePage(${totalPages})">${totalPages}</button>`;
      }

      const nextDisabled = currentPage >= totalPages;
      paginationHtml += `<button class="vd-page-btn" ${nextDisabled ? 'disabled' : ''} style="${nextDisabled ? 'opacity:0.35; cursor:not-allowed;' : ''}" onclick="App.vehicles.goToExpensePage(${currentPage + 1})" title="Próxima">›</button>`;

      paginationHtml += '</div>';

      footer.innerHTML = `<span>Exibindo ${from}–${to} de ${totalItems} registros</span>${paginationHtml}`;
    }
  },

  formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const past = new Date(dateOnly + 'T12:00:00');
    const now = new Date();
    now.setHours(12, 0, 0, 0);

    if (past > now) return 'No futuro';

    const diffDays = Math.floor((now - past) / 86400000);

    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Há 1 dia';
    if (diffDays < 30) return `Há ${diffDays} dias`;

    let years = now.getFullYear() - past.getFullYear();
    let months = now.getMonth() - past.getMonth();
    let days = now.getDate() - past.getDate();

    if (days < 0) {
      months--;
      const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years--;
      months += 12;
    }

    const parts = [];
    if (years > 0) parts.push(`${years} ${years === 1 ? 'ano' : 'anos'}`);
    if (months > 0) parts.push(`${months} ${months === 1 ? 'mês' : 'meses'}`);
    if (days > 0) parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);

    if (parts.length === 0) return 'Hoje';
    if (parts.length === 1) return `Há ${parts[0]}`;
    if (parts.length === 2) return `Há ${parts[0]} e ${parts[1]}`;
    return `Há ${parts[0]}, ${parts[1]} e ${parts[2]}`;
  },

  async showExpenseDetail(expenseId) {
    const e = await App.db.getById('vehicleExpenses', expenseId);
    if (!e) return;

    const v = e.vehicle_id ? await App.db.getById('vehicles', e.vehicle_id) : null;

    const daysLabel = this.formatTimeAgo(e.date);

    const kmSince = (v && v.current_km != null && e.km != null)
      ? Math.max(0, v.current_km - e.km)
      : null;

    const typeIcons = {
      'Combustível': '⛽',
      'Manutenção': '🔧',
      'Revisão': '🛠️',
      'Seguro': '🛡️',
      'IPVA / Licenciamento': '📋',
      'Multa': '🚨',
      'Pedágio': '🛣️',
      'Estacionamento': '🅿️',
      'Lavagem': '🧼',
      'Pneus': '🛞',
      'Peças / Acessórios': '⚙️',
      'Outros': '📝'
    };
    const icon = typeIcons[e.expense_type] || '📝';
    const typeLabel = e.fuel_type
      ? `${e.expense_type || 'Outros'} · ${e.fuel_type}`
      : (e.expense_type || 'Outros');

    const body = document.getElementById('expenseDetailBody');
    if (!body) return;

    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; align-items:center; gap:14px; padding-bottom:16px; border-bottom:1px solid var(--border);">
          <div style="width:52px; height:52px; border-radius:14px; background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; font-size:1.6rem; flex-shrink:0;">${icon}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Tipo</div>
            <div style="font-size:1.05rem; font-weight:600; color:var(--text);">${typeLabel}</div>
          </div>
        </div>

        <div>
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Descrição</div>
          <div style="font-size:0.95rem; color:var(--text);">${e.description || '—'}</div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
          <div>
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Valor</div>
            <div style="font-size:1.35rem; font-weight:700; color:var(--text);">${App.utils.formatCurrency(e.amount)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Data</div>
            <div style="font-size:0.95rem; color:var(--text);">${App.utils.formatDate(e.date)}</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">${daysLabel}</div>
          </div>
        </div>

        ${kmSince !== null ? `
        <div style="padding:14px 16px; background:var(--bg-secondary); border-radius:10px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.2rem;">🛣️</span>
            <span style="font-size:0.85rem; color:var(--text-muted);">Km rodados desde então</span>
          </div>
          <span style="font-size:1.05rem; font-weight:700; color:var(--text);">${kmSince.toLocaleString('pt-BR')} km</span>
        </div>` : ''}
      </div>
    `;

    App.ui.openModal('modalVehicleExpenseDetail');
  },

  async exportExpensesCSV() {
    if (!this._expenseCache || !this._expenseCache.length) {
      App.utils.showToast('Nenhum dado para exportar.', 'error');
      return;
    }
    const headers = ['Data', 'Tipo', 'Combustível', 'Descrição', 'KM', 'Litros', 'KM/L', 'R$/L', 'Valor'];
    const rows = this._expenseCache.map(e => {
      const kml = e.km_per_liter ? e.km_per_liter.toFixed(1) : '';
      const pricePerLiter = e.liters > 0 ? (e.amount / e.liters).toFixed(2) : '';
      return [
        App.utils.formatDate(e.date),
        e.expense_type || '',
        e.fuel_type || '',
        e.description || '',
        e.km || '',
        e.liters || '',
        kml,
        pricePerLiter,
        e.amount
      ];
    });
    App.utils.exportCSV('gastos_veiculo.csv', headers, rows);
    App.utils.showToast('Dados exportados!');
  },

  _evolutionChart: null,
  _donutChart: null,

  async renderEvolutionChart() {
    const canvas = document.getElementById('vdEvolutionChart');
    if (!canvas || !this._expenseCache) return;

    const periodSel = document.getElementById('vdChartPeriod')?.value || 'Últimos 8 meses';
    const monthsCount = periodSel === 'Últimos 12 meses' ? 12 : 8;

    const now = new Date();
    const labels = [];
    const data = [];
    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = d.toISOString().slice(0, 7);
      labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
      const total = this._expenseCache
        .filter(e => e.date.startsWith(monthStr))
        .reduce((s, e) => s + parseFloat(e.amount), 0);
      data.push(total);
    }

    if (this._evolutionChart) this._evolutionChart.destroy();
    this._evolutionChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: '#6f5cff',
          backgroundColor: 'rgba(111, 92, 255, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#7b6cff',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#8d939c' }, grid: { color: '#24272c' } },
          y: { ticks: { color: '#8d939c', callback: v => App.utils.formatCurrency(v) }, grid: { color: '#24272c' } }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => App.utils.formatCurrency(ctx.raw) } }
        }
      }
    });
  },

  renderDonutChart() {
    const canvas = document.getElementById('vdDonutChart');
    if (!canvas || !this._expenseCache) return;

    const combustivel = this._expenseCache.filter(e => e.expense_type === 'Combustível').reduce((s, e) => s + parseFloat(e.amount), 0);
    const manutencao = this._expenseCache.filter(e => e.expense_type === 'Manutenção').reduce((s, e) => s + parseFloat(e.amount), 0);
    const outros = this._expenseCache.filter(e => e.expense_type !== 'Combustível' && e.expense_type !== 'Manutenção').reduce((s, e) => s + parseFloat(e.amount), 0);
    const total = combustivel + manutencao + outros;

    const colors = ['#f3a51b', '#2e79cc', '#7555c7'];
    const labels = ['Combustível', 'Manutenção', 'Outros'];
    const values = [combustivel, manutencao, outros];

    if (this._donutChart) this._donutChart.destroy();
    this._donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: '#1f1f1f',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${App.utils.formatCurrency(ctx.raw)}` } }
        }
      }
    });

    const legendEl = document.getElementById('vdDonutLegend');
    if (legendEl) {
      legendEl.innerHTML = `
        <div class="vd-legend">
          ${labels.map((l, i) => `<div class="vd-legend-row"><span class="vd-legend-dot" style="background:${colors[i]}"></span><div>${l}<span class="vd-legend-sub">${App.utils.formatCurrency(values[i])} (${total ? ((values[i]/total)*100).toFixed(0) : 0}%)</span></div></div>`).join('')}
        </div>`;
    }

    this.renderSideStats();
  },

  renderSideStats() {
    const container = document.getElementById('vdSideStats');
    if (!container || !this._expenseCache) return;
    const total = this._expenseCache.length;
    const maxExpense = this._expenseCache.reduce((max, e) => Math.max(max, parseFloat(e.amount)), 0);
    const sortedByDate = [...this._expenseCache].sort((a, b) => b.date.localeCompare(a.date));
    const lastDate = sortedByDate.length ? App.utils.formatDate(sortedByDate[0].date) : '--';

    container.innerHTML = `
      <div class="vd-stat"><div class="vd-stat-icon"><i data-lucide="layers"></i></div><div><div class="vd-stat-label">Total de lançamentos</div><div class="vd-stat-value">${total}</div></div></div>
      <div class="vd-stat"><div class="vd-stat-icon" style="background:#341b1b;color:#ff6868"><i data-lucide="arrow-up-right"></i></div><div><div class="vd-stat-label">Maior gasto</div><div class="vd-stat-value">${App.utils.formatCurrency(maxExpense)}</div></div></div>
      <div class="vd-stat"><div class="vd-stat-icon" style="background:#17301d;color:#5ce87a"><i data-lucide="clock"></i></div><div><div class="vd-stat-label">Último gasto</div><div class="vd-stat-value">${lastDate}</div></div></div>
    `;
  },

  async openExpenseModal(expenseId = null) {
    const e = expenseId ? await App.db.getById('vehicleExpenses', expenseId) : null;
    document.getElementById('expenseId').value = e?.id || '';
    document.getElementById('modalVehicleExpenseTitle').textContent = e ? 'Editar Gasto' : 'Novo Gasto';
    document.getElementById('expenseDescription').value = e?.description || '';
    document.getElementById('expenseAmount').value = e?.amount || '';
    document.getElementById('expenseDate').value = e?.date || App.utils.todayISO();
    document.getElementById('expenseKm').value = e?.km || '';

    const expenseTypeSelect = document.getElementById('expenseType');
    const savedType = e?.expense_type || 'Combustível';
    const typeExists = Array.from(expenseTypeSelect.options).some(opt => opt.value === savedType);
    if (!typeExists && e?.expense_type) {
      const opt = document.createElement('option');
      opt.value = savedType;
      opt.textContent = savedType;
      expenseTypeSelect.appendChild(opt);
    }
    expenseTypeSelect.value = savedType;

    const pricePerLiter = (e && e.amount && e.liters && parseFloat(e.liters) > 0)
      ? (parseFloat(e.amount) / parseFloat(e.liters)).toFixed(3)
      : '';
    document.getElementById('expensePricePerLiter').value = pricePerLiter;
    document.getElementById('expenseLiters').value = e?.liters || '';

    const fuelTypeSelect = document.getElementById('expenseFuelType');
    if (fuelTypeSelect) {
      const savedFuel = e?.fuel_type || 'Gasolina Comum';
      const fuelExists = Array.from(fuelTypeSelect.options).some(opt => opt.value === savedFuel);
      if (!fuelExists && e?.fuel_type) {
        const opt = document.createElement('option');
        opt.value = savedFuel;
        opt.textContent = savedFuel;
        fuelTypeSelect.appendChild(opt);
      }
      fuelTypeSelect.value = savedFuel;
    }

    this.onExpenseTypeChange();
    App.ui.openModal('modalVehicleExpense');
  },

  onExpenseTypeChange() {
    const type = (document.getElementById('expenseType')?.value || '').toLowerCase();
    const isFuel = type.includes('combust');
    const fields = document.getElementById('expenseFuelFields');
    if (fields) fields.style.display = isFuel ? '' : 'none';
    if (isFuel) {
      this.recalcLiters();
    } else {
      const litersField = document.getElementById('expenseLiters');
      if (litersField) litersField.value = '';
    }
  },

  recalcLiters() {
    const amount = parseFloat(document.getElementById('expenseAmount')?.value) || 0;
    const price = parseFloat(document.getElementById('expensePricePerLiter')?.value) || 0;
    const litersField = document.getElementById('expenseLiters');
    if (!litersField) return;
    if (amount > 0 && price > 0) {
      litersField.value = (amount / price).toFixed(2);
    } else {
      litersField.value = '';
    }
  },

  async saveExpenseFromModal(e) {
    e.preventDefault();
    try {
      const id = document.getElementById('expenseId').value;
      const type = document.getElementById('expenseType').value.trim();
      if (!type) { App.utils.showToast('Tipo obrigatório', 'error'); return false; }
      const description = document.getElementById('expenseDescription').value.trim();
      const amount = parseFloat(document.getElementById('expenseAmount').value);
      if (isNaN(amount) || amount <= 0) { App.utils.showToast('Valor pago inválido', 'error'); return false; }
      const date = document.getElementById('expenseDate').value;
      if (!date) { App.utils.showToast('Data obrigatória', 'error'); return false; }
      const km = parseFloat(document.getElementById('expenseKm').value);
      if (isNaN(km)) { App.utils.showToast('Km inválido', 'error'); return false; }

      const isFuel = type.toLowerCase().includes('combust');
      let liters;
      let fuelType = null;
      if (isFuel) {
        const pricePerLiter = parseFloat(document.getElementById('expensePricePerLiter').value);
        if (isNaN(pricePerLiter) || pricePerLiter <= 0) {
          App.utils.showToast('Informe o valor do litro.', 'error');
          return false;
        }
        const fuelTypeSelect = document.getElementById('expenseFuelType');
        fuelType = fuelTypeSelect ? fuelTypeSelect.value : null;
        liters = amount / pricePerLiter;
      } else {
        liters = null;
      }

      // Busca o gasto anterior considerando data E km (desempate): precisa ser
      // estritamente anterior em data, OU mesma data com km menor.
      const allExpensesBefore = await App.db.getAll('vehicleExpenses');
      const candidates = allExpensesBefore.filter(x =>
        x.vehicle_id === this.currentVehicleId &&
        x.km != null &&
        x.id !== id &&
        (x.date < date || (x.date === date && x.km < km))
      );
      candidates.sort((a, b) => {
        const byDate = b.date.localeCompare(a.date);
        if (byDate !== 0) return byDate;
        return (b.km || 0) - (a.km || 0);
      });
      const lastExpense = candidates.length > 0 ? candidates[0] : null;

      let kmDriven = 0;
      let kmPerLiter = null;
      if (lastExpense && lastExpense.km != null) {
        kmDriven = km - lastExpense.km;
        if (liters && liters > 0 && kmDriven > 0) {
          kmPerLiter = kmDriven / liters;
        }
      }

      const expense = {
        id: id || App.utils.generateId(),
        vehicle_id: this.currentVehicleId,
        expense_type: type,
        fuel_type: fuelType,
        description,
        amount,
        date,
        km,
        liters: liters || null,
        km_driven: kmDriven,
        km_per_liter: kmPerLiter,
        created_at: new Date().toISOString()
      };
      await App.db.put('vehicleExpenses', expense);

      const vehicle = await App.db.getById('vehicles', this.currentVehicleId);
      if (vehicle) {
        const allExpenses = await App.db.getAll('vehicleExpenses');
        const vehicleExpenses = allExpenses.filter(x => x.vehicle_id === this.currentVehicleId);

        // current_km = MAIOR km registrada, nunca a km de um lançamento retroativo
        const maxKm = vehicleExpenses.reduce((max, x) => {
          const v = parseFloat(x.km);
          return (!isNaN(v) && v > max) ? v : max;
        }, parseFloat(vehicle.current_km) || 0);
        vehicle.current_km = maxKm;

        // Recalcula km_driven e km_per_liter de todos os gastos de combustível
        // em ordem cronológica (data, depois km) para corrigir retroativos.
        const chronological = [...vehicleExpenses]
          .filter(x => x.km != null)
          .sort((a, b) => {
            const byDate = a.date.localeCompare(b.date);
            if (byDate !== 0) return byDate;
            return (a.km || 0) - (b.km || 0);
          });

        let prev = null;
        for (const cur of chronological) {
          if (prev) {
            const driven = cur.km - prev.km;
            cur.km_driven = driven > 0 ? driven : 0;
            const curLiters = parseFloat(cur.liters) || 0;
            if (curLiters > 0 && cur.km_driven > 0) {
              cur.km_per_liter = cur.km_driven / curLiters;
            } else {
              cur.km_per_liter = null;
            }
            await App.db.put('vehicleExpenses', cur);
          } else {
            cur.km_driven = 0;
            cur.km_per_liter = null;
            await App.db.put('vehicleExpenses', cur);
          }
          prev = cur;
        }

        const fuelExpenses = vehicleExpenses.filter(x => x.km_per_liter && x.km_per_liter > 0);
        if (fuelExpenses.length > 0) {
          vehicle.avg_autonomy = fuelExpenses.reduce((s, x) => s + x.km_per_liter, 0) / fuelExpenses.length;
        } else {
          vehicle.avg_autonomy = null;
        }
        vehicle.total_expenses = vehicleExpenses.reduce((s, x) => s + parseFloat(x.amount), 0);
        await App.db.put('vehicles', vehicle);
      }

      App.ui.closeModal('modalVehicleExpense');
      App.utils.showToast(id ? 'Gasto atualizado!' : 'Gasto registrado!');
      this.loadDetail();
    } catch (err) {
      console.error('Erro ao salvar gasto:', err);
      App.utils.showToast('Erro ao salvar gasto.', 'error');
    }
    return false;
  },

  async editExpense(id) {
    await this.openExpenseModal(id);
  },

  async removeExpense(id) {
    App.utils.confirm('Excluir gasto?', async () => {
      await App.db.delete('vehicleExpenses', id);
      const vehicle = await App.db.getById('vehicles', this.currentVehicleId);
      if (vehicle) {
        const allExpenses = await App.db.getAll('vehicleExpenses');
        const vehicleExpenses = allExpenses.filter(x => x.vehicle_id === this.currentVehicleId);

        const maxKm = vehicleExpenses.reduce((max, x) => {
          const v = parseFloat(x.km);
          return (!isNaN(v) && v > max) ? v : max;
        }, parseFloat(vehicle.initial_km) || 0);
        vehicle.current_km = maxKm;

        const chronological = [...vehicleExpenses]
          .filter(x => x.km != null)
          .sort((a, b) => {
            const byDate = a.date.localeCompare(b.date);
            if (byDate !== 0) return byDate;
            return (a.km || 0) - (b.km || 0);
          });

        let prev = null;
        for (const cur of chronological) {
          if (prev) {
            const driven = cur.km - prev.km;
            cur.km_driven = driven > 0 ? driven : 0;
            const curLiters = parseFloat(cur.liters) || 0;
            cur.km_per_liter = (curLiters > 0 && cur.km_driven > 0) ? cur.km_driven / curLiters : null;
            await App.db.put('vehicleExpenses', cur);
          } else {
            cur.km_driven = 0;
            cur.km_per_liter = null;
            await App.db.put('vehicleExpenses', cur);
          }
          prev = cur;
        }

        vehicle.total_expenses = vehicleExpenses.reduce((s, x) => s + parseFloat(x.amount), 0);
        const fuelExpenses = vehicleExpenses.filter(x => x.km_per_liter && x.km_per_liter > 0);
        vehicle.avg_autonomy = fuelExpenses.length > 0
          ? fuelExpenses.reduce((s, x) => s + x.km_per_liter, 0) / fuelExpenses.length
          : null;
        await App.db.put('vehicles', vehicle);
      }
      App.utils.showToast('Gasto removido!');
      this.loadDetail();
    });
  }
};