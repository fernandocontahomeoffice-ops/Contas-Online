// =====================================================================
// ARQUIVO: bank-logos.js
// Catálogo gratuito e atualizado automaticamente de logos de bancos,
// fintechs, cooperativas e cartões de benefícios.
// Fonte principal: logos-bancos-br (Open Finance Brasil + BCB STR/Pix via jsDelivr CDN, MIT)
// Fallback automático: BrasilAPI (/api/banks/v1) + Favicons oficiais + Monograma SVG
// =====================================================================
(function (root) {
  'use strict';

  const CDN_BASE = 'https://cdn.jsdelivr.net/npm/logos-bancos-br@latest';
  const BANCOS_JSON_URL = `${CDN_BASE}/data/bancos.json`;
  const PIX_JSON_URL = `${CDN_BASE}/data/instituicoes-pix.json`;
  const BRASIL_API_URL = 'https://brasilapi.com.br/api/banks/v1';
  const CACHE_KEY = 'contasOnline_bankCatalog_v2';
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias (sincronizado com atualização semanal BCB)

  function normalizeText(value) {
    if (!value) return '';
    return String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildCdnUrl(relPath) {
    if (!relPath) return '';
    if (/^https?:\/\//i.test(relPath) || relPath.startsWith('data:')) return relPath;
    return `${CDN_BASE}/${relPath.replace(/^\/+/, '')}`;
  }

  function faviconUrl(domain) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  }

  // Catálogo inicial instantâneo (disponível no 1º render sem esperar rede)
  // Todos os ISPBs abaixo correspondem exatamente aos arquivos oficiais do logos-bancos-br.
  const POPULAR_SEED = [
    { ispb: '18236120', compe: '260', displayName: 'Nubank', color: '#820ad1', aliases: ['nubank', 'nu pagamentos', 'nu conta', 'nu', 'roxinho', 'ultravioleta', 'nuinvest'], popular: 1 },
    { ispb: '60701190', compe: '341', displayName: 'Itaú', color: '#ec7000', aliases: ['itau', 'itau unibanco', 'unibanco', 'itaubank', 'iti', 'itaucard', 'personnalite', 'uniclass', 'ion itau'], popular: 2 },
    { ispb: '00000000', compe: '001', displayName: 'Banco do Brasil', color: '#f9d616', aliases: ['banco do brasil', 'bco do brasil', 'bb', 'ourocard'], popular: 3 },
    { ispb: '60746948', compe: '237', displayName: 'Bradesco', color: '#cc092f', aliases: ['bradesco', 'bradescard', 'agora bradesco'], popular: 4 },
    { ispb: '90400888', compe: '033', displayName: 'Santander', color: '#ec0000', aliases: ['santander', 'santander sx', 'select santander', 'way santander'], popular: 5 },
    { ispb: '00360305', compe: '104', displayName: 'Caixa', color: '#005ca9', aliases: ['caixa', 'caixa economica', 'caixa economica federal', 'cef', 'caixa tem'], popular: 6 },
    { ispb: '00416968', compe: '077', displayName: 'Inter', color: '#ff7a00', aliases: ['banco inter', 'inter', 'intermedium', 'inter black', 'inter duo'], popular: 7 },
    { ispb: '31872495', compe: '336', displayName: 'C6 Bank', color: '#1a1a1a', aliases: ['c6', 'c6 bank', 'c6bank', 'c6 carbon'], popular: 8 },
    { ispb: '10573521', compe: '323', displayName: 'Mercado Pago', color: '#009ee3', aliases: ['mercado pago', 'mercadopago', 'mercado livre', 'meli'], popular: 9 },
    { ispb: '22896431', compe: '380', displayName: 'PicPay', color: '#21c25e', aliases: ['picpay', 'pic pay', 'picpay card', 'picpay bank'], popular: 10 },
    { ispb: '02332886', compe: '102', displayName: 'XP Investimentos', color: '#111111', aliases: ['xp', 'xp investimentos', 'banco xp', 'cartao xp'], popular: 11 },
    { ispb: '30306294', compe: '208', displayName: 'BTG Pactual', color: '#001e62', aliases: ['btg', 'btg pactual', 'btg+'], popular: 12 },
    { ispb: '08561701', compe: '290', displayName: 'PagBank', color: '#00a868', aliases: ['pagbank', 'pagseguro', 'pag seguro'], popular: 13 },
    { ispb: '02038232', compe: '756', displayName: 'Sicoob', color: '#003641', aliases: ['sicoob', 'bancoob'], popular: 14 },
    { ispb: '01181521', compe: '748', displayName: 'Sicredi', color: '#3fa110', aliases: ['sicredi'], popular: 15 },
    { ispb: '20855875', compe: '536', displayName: 'Neon', color: '#00a4e4', aliases: ['neon', 'banco neon'], popular: 16 },
    { ispb: '58160789', compe: '422', displayName: 'Safra', color: '#00205b', aliases: ['safra', 'banco safra', 'j safra'], popular: 17 },
    { ispb: '59285411', compe: '623', displayName: 'Banco Pan', color: '#00a8ff', aliases: ['banco pan', 'bco pan', 'pan'], popular: 18 },
    { ispb: '61186680', compe: '318', displayName: 'BMG', color: '#ff6600', aliases: ['bmg', 'banco bmg'], popular: 19 },
    { ispb: '62232889', compe: '707', displayName: 'Daycoval', color: '#003366', aliases: ['daycoval', 'banco daycoval'], popular: 20 },
    { ispb: '60889128', compe: '637', displayName: 'Sofisa', color: '#009688', aliases: ['sofisa', 'sofisa direto', 'banco sofisa'], popular: 21 },
    { ispb: '16501555', compe: '197', displayName: 'Stone', color: '#00a868', aliases: ['stone', 'ton stone'], popular: 22 },
    { ispb: '37880206', compe: '403', displayName: 'Cora', color: '#fe3e6d', aliases: ['cora', 'banco cora'], popular: 23 },
    { ispb: '19540550', compe: '461', displayName: 'Asaas', color: '#0030b9', aliases: ['asaas'], popular: 24 },
    { ispb: '09089356', compe: '364', displayName: 'Efí Bank', color: '#f37021', aliases: ['efi', 'efi bank', 'gerencianet'], popular: 25 },
    { ispb: '40571694', compe: null, displayName: 'Wise', color: '#9fe870', aliases: ['wise', 'transferwise'], popular: 26 },
    { ispb: '51342763', compe: '620', displayName: 'Revolut', color: '#191c1f', aliases: ['revolut'], popular: 27 },
    { ispb: '92702067', compe: '041', displayName: 'Banrisul', color: '#004a93', aliases: ['banrisul'], popular: 28 },
    { ispb: '00000208', compe: '070', displayName: 'BRB', color: '#0055a5', aliases: ['brb', 'banco de brasilia', 'brbcard'], popular: 29 },
    { ispb: '00315557', compe: '136', displayName: 'Unicred', color: '#004f39', aliases: ['unicred'], popular: 30 },
    { ispb: '05463212', compe: '085', displayName: 'Ailos', color: '#165c7d', aliases: ['ailos', 'viacredi'], popular: 31 },
    { ispb: '10398952', compe: '133', displayName: 'Cresol', color: '#f26522', aliases: ['cresol'], popular: 32 },
    { ispb: '10664513', compe: '121', displayName: 'Agibank', color: '#0066ff', aliases: ['agibank', 'agi'], popular: 33 },
    { ispb: '27098060', compe: '335', displayName: 'Digio', color: '#002c6c', aliases: ['digio', 'banco digio'], popular: 34 },
    { ispb: '61033106', compe: '069', displayName: 'Crefisa', color: '#005ca9', aliases: ['crefisa'], popular: 35 },
    { ispb: '92894922', compe: '212', displayName: 'Banco Original', color: '#00a859', aliases: ['banco original', 'original'], popular: 36 },
    { ispb: '01858774', compe: '413', displayName: 'Banco BV', color: '#00205b', aliases: ['bv', 'banco bv', 'votorantim', 'banco votorantim'], popular: 37 },
    { ispb: '45246410', compe: '125', displayName: 'Genial', color: '#0033a0', aliases: ['genial', 'genial investimentos'], popular: 38 },
    { ispb: '62287735', compe: '101', displayName: 'Warren', color: '#e02b57', aliases: ['warren', 'warren brasil'], logoRel: 'logos/png/62287735.png', popular: 39 },
    { ispb: '71027866', compe: '218', displayName: 'BS2', color: '#0038a8', aliases: ['bs2', 'banco bs2'], logoRel: 'logos/png/71027866.png', popular: 40 },
    { ispb: '11275560', compe: null, displayName: 'RecargaPay', color: '#009fe3', aliases: ['recargapay', 'recarga pay'], popular: 41 },
    { ispb: '24313102', compe: '769', displayName: '99Pay', color: '#ffcc00', aliases: ['99pay', '99 pay'], popular: 42 },
    { ispb: '18189547', compe: '542', displayName: 'InfinitePay', color: '#111111', aliases: ['infinitepay', 'infinite pay', 'cloudwalk'], popular: 43 },
    { ispb: '13935893', compe: '509', displayName: 'Celcoin', color: '#6b2cf5', aliases: ['celcoin'], popular: 44 },
    { ispb: '07237373', compe: '004', displayName: 'Banco do Nordeste', color: '#a6192e', aliases: ['banco do nordeste', 'bnb'], popular: 45 },
    { ispb: '04902979', compe: '003', displayName: 'Banco da Amazônia', color: '#006847', aliases: ['banco da amazonia', 'basa'], popular: 46 },
    { ispb: '28127603', compe: '021', displayName: 'Banestes', color: '#0055a4', aliases: ['banestes'], popular: 47 },
    { ispb: '13009717', compe: '047', displayName: 'Banese', color: '#006633', aliases: ['banese', 'banese card'], popular: 48 },
    { ispb: '04913711', compe: '037', displayName: 'Banpará', color: '#004b8d', aliases: ['banpara'], popular: 49 },
    { ispb: '28195667', compe: '246', displayName: 'ABC Brasil', color: '#003a70', aliases: ['abc brasil', 'banco abc'], popular: 50 },
    { ispb: '02398976', compe: '084', displayName: 'Sisprime', color: '#006837', aliases: ['sisprime'], popular: 51 }
  ];

  // Instituições extras populares (contas internacionais, corretoras e benefícios fora do STR/Pix)
  const EXTRA_BRANDS = [
    { key: 'extra:nomad', displayName: 'Nomad', color: '#ffd500', domain: 'nomadglobal.com', aliases: ['nomad', 'nomad global'], popular: 52 },
    { key: 'extra:avenue', displayName: 'Avenue', color: '#0056d6', domain: 'avenue.us', aliases: ['avenue', 'avenue securities'], popular: 53 },
    { key: 'extra:will', displayName: 'Will Bank', color: '#ffd100', domain: 'willbank.com.br', aliases: ['will', 'will bank', 'willbank'], popular: 54 },
    { key: 'extra:next', displayName: 'Next', color: '#00ff5f', domain: 'next.me', aliases: ['next', 'banco next'], popular: 55 },
    { key: 'extra:rico', displayName: 'Rico', color: '#ff5100', domain: 'rico.com.vc', aliases: ['rico', 'rico investimentos'], popular: 56 },
    { key: 'extra:clear', displayName: 'Clear Corretora', color: '#0038ff', domain: 'clear.com.br', aliases: ['clear', 'clear corretora'], popular: 57 },
    { key: 'extra:toro', displayName: 'Toro Investimentos', color: '#5b21b6', domain: 'toroinvestimentos.com.br', aliases: ['toro', 'toro investimentos'], popular: 58 },
    { key: 'extra:paypal', displayName: 'PayPal', color: '#003087', domain: 'paypal.com', aliases: ['paypal', 'pay pal'], popular: 59 },
    { key: 'extra:alelo', displayName: 'Alelo', color: '#007a53', domain: 'alelo.com.br', aliases: ['alelo', 'alelo refeicao', 'alelo alimentacao'], popular: 60 },
    { key: 'extra:pluxee', displayName: 'Pluxee (Sodexo)', color: '#00d68f', domain: 'pluxee.com.br', aliases: ['pluxee', 'sodexo'], popular: 61 },
    { key: 'extra:ticket', displayName: 'Ticket', color: '#e60028', domain: 'ticket.com.br', aliases: ['ticket', 'ticket restaurante', 'ticket alimentacao'], popular: 62 },
    { key: 'extra:vr', displayName: 'VR Benefícios', color: '#00a859', domain: 'vr.com.br', aliases: ['vr beneficios', 'vr refeicao', 'vr alimentacao', 'vr'], popular: 63 },
    { key: 'extra:flash', displayName: 'Flash Benefícios', color: '#ff2b6b', domain: 'flashapp.com.br', aliases: ['flash', 'flash beneficios'], popular: 64 },
    { key: 'extra:caju', displayName: 'Caju Benefícios', color: '#e63946', domain: 'caju.com.br', aliases: ['caju', 'caju beneficios'], popular: 65 },
    { key: 'extra:swile', displayName: 'Swile', color: '#111111', domain: 'swile.co', aliases: ['swile', 'vee beneficios'], popular: 66 },
    { key: 'extra:ifood-beneficios', displayName: 'iFood Benefícios', color: '#ea1d2c', domain: 'beneficios.ifood.com.br', aliases: ['ifood beneficios', 'ifood card'], popular: 67 },
    { key: 'extra:binance', displayName: 'Binance', color: '#f3ba2f', domain: 'binance.com', aliases: ['binance'], popular: 68 },
    { key: 'extra:mercadobitcoin', displayName: 'Mercado Bitcoin', color: '#f97316', domain: 'mercadobitcoin.com.br', aliases: ['mercado bitcoin', 'mb'], popular: 69 },
    { key: 'extra:porto', displayName: 'Porto Bank', color: '#00a1fc', domain: 'portoseguro.com.br', aliases: ['porto bank', 'porto seguro', 'cartao porto'], popular: 70 },
    { key: 'extra:carrefour', displayName: 'Banco Carrefour', color: '#004e9e', domain: 'carrefoursolucoes.com.br', aliases: ['carrefour', 'banco carrefour'], popular: 71 },
    { key: 'extra:atacadao', displayName: 'Cartão Atacadão', color: '#f37021', domain: 'cartaoatacadao.com.br', aliases: ['atacadao', 'cartao atacadao'], popular: 72 },
    { key: 'extra:riachuelo', displayName: 'Midway / Riachuelo', color: '#111111', domain: 'midway.com.br', aliases: ['midway', 'riachuelo'], popular: 73 },
    { key: 'extra:magalu', displayName: 'MagaluPay / LuizaCred', color: '#0086ff', domain: 'magazineluiza.com.br', aliases: ['magalu', 'magalupay', 'luizacred'], popular: 74 },
    { key: 'extra:bankofamerica', displayName: 'Bank of America', color: '#e31837', domain: 'bankofamerica.com', aliases: ['bank of america', 'bofa'], popular: 75 }
  ];

  // Palavras genéricas que nunca devem casar sozinhas no matcher automático
  const GENERIC_TOKENS = new Set([
    'banco', 'bco', 'bank', 'conta', 'cartao', 'credito', 'debito', 'corrente',
    'poupanca', 'investimento', 'investimentos', 'financeira', 'pagamento',
    'pagamentos', 'instituicao', 'sociedade', 'cooperativa', 'central', 'brasil',
    'nacional', 'digital', 'corretora', 'valores', 'ltda', 'sa', 's', 'a', 'ip',
    'scd', 'scfi', 'dtvm', 'ctvm', 'cctvm', 'cc', 'ccla', 'de', 'do', 'da', 'dos', 'das', 'e', 'em'
  ]);

  function containsWordSequence(haystackNorm, needleNorm) {
    if (!haystackNorm || !needleNorm) return false;
    if (haystackNorm === needleNorm) return true;
    const paddedHaystack = ` ${haystackNorm} `;
    const paddedNeedle = ` ${needleNorm} `;
    return paddedHaystack.includes(paddedNeedle);
  }

  function hashColor(str) {
    const palette = ['#0e6854', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#0f766e', '#4338ca', '#0369a1'];
    let h = 0;
    const s = String(str || 'B');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  function getMonogram(name) {
    const clean = String(name || '').trim();
    if (!clean) return 'B';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function createBankLogosService() {
    const state = {
      byId: new Map(),
      byIspb: new Map(),
      byCompe: new Map(),
      aliasIndex: [], // { alias, id, priority }
      catalogLoaded: false,
      catalogSource: 'seed',
      lastUpdatedAt: null,
      _loadPromise: null
    };

    function registerEntry(entry) {
      if (!entry || !entry.id || !entry.logoUrl) return;
      const existing = state.byId.get(entry.id);
      const merged = existing
        ? {
            ...existing,
            ...entry,
            displayName: existing.curated ? existing.displayName : (entry.displayName || existing.displayName),
            color: existing.color || entry.color || hashColor(entry.displayName || entry.name),
            popular: existing.popular || entry.popular || 9999,
            curated: Boolean(existing.curated || entry.curated),
            aliases: Array.from(new Set([...(existing.aliases || []), ...(entry.aliases || [])]))
          }
        : {
            ...entry,
            color: entry.color || hashColor(entry.displayName || entry.name),
            popular: entry.popular || 9999,
            aliases: Array.from(new Set(entry.aliases || []))
          };

      merged.normDisplay = normalizeText(merged.displayName);
      merged.normShort = normalizeText(merged.shortName);
      merged.normName = normalizeText(merged.name);
      state.byId.set(merged.id, merged);
      if (merged.ispb) state.byIspb.set(String(merged.ispb).padStart(8, '0'), merged);
      if (merged.compe) {
        const compe3 = String(merged.compe).replace(/\D/g, '').padStart(3, '0');
        if (compe3 && compe3 !== '000' && (!state.byCompe.has(compe3) || merged.curated)) {
          state.byCompe.set(compe3, merged);
        }
      }
    }

    function rebuildAliasIndex() {
      const list = [];
      for (const entry of state.byId.values()) {
        for (const rawAlias of entry.aliases || []) {
          const norm = normalizeText(rawAlias);
          if (!norm || GENERIC_TOKENS.has(norm)) continue;
          list.push({
            alias: norm,
            id: entry.id,
            length: norm.length,
            popular: entry.popular || 9999
          });
        }
      }
      // Maior especificidade (alias mais longo) primeiro; desempate por popularidade
      list.sort((a, b) => (b.length - a.length) || (a.popular - b.popular));
      state.aliasIndex = list;
    }

    function seedInitialEntries() {
      for (const item of POPULAR_SEED) {
        const ispb = String(item.ispb).padStart(8, '0');
        const svgUrl = item.logoRel
          ? buildCdnUrl(item.logoRel)
          : buildCdnUrl(`logos/svg/${ispb}.svg`);
        const pngUrl = buildCdnUrl(`logos/png/${ispb}.png`);
        registerEntry({
          id: ispb,
          ispb,
          compe: item.compe ? String(item.compe).padStart(3, '0') : null,
          displayName: item.displayName,
          shortName: item.displayName,
          name: item.displayName,
          color: item.color,
          logoUrl: svgUrl,
          fallbackPngUrl: pngUrl,
          aliases: [item.displayName, ...(item.aliases || [])],
          popular: item.popular,
          curated: true,
          source: 'logos-bancos-br'
        });
      }
      for (const brand of EXTRA_BRANDS) {
        registerEntry({
          id: brand.key,
          ispb: null,
          compe: null,
          displayName: brand.displayName,
          shortName: brand.displayName,
          name: brand.displayName,
          color: brand.color,
          logoUrl: faviconUrl(brand.domain),
          fallbackPngUrl: '',
          aliases: [brand.displayName, ...(brand.aliases || [])],
          popular: brand.popular,
          curated: true,
          source: 'official-favicon'
        });
      }
      rebuildAliasIndex();
    }

    function ingestLogosBancosBr(bancosPayload, pixPayload) {
      const bancosList = Array.isArray(bancosPayload)
        ? bancosPayload
        : (bancosPayload && Array.isArray(bancosPayload.banks) ? bancosPayload.banks : []);
      const pixList = Array.isArray(pixPayload)
        ? pixPayload
        : (pixPayload && Array.isArray(pixPayload.institutions) ? pixPayload.institutions : []);

      let added = 0;
      const processList = (items, isPixOnly) => {
        for (const item of items) {
          if (!item || !item.ispb || !item.logo) continue;
          const svgRel = item.logo.svg || '';
          const pngRel = item.logo.png || '';
          if (!svgRel && !pngRel) continue;
          const ispb = String(item.ispb).padStart(8, '0');
          const compe = item.compe ? String(item.compe).replace(/\D/g, '').padStart(3, '0') : null;
          const displayName = item.displayName || item.shortName || item.name || ispb;
          const aliases = [];
          if (item.displayName) aliases.push(item.displayName);
          if (item.shortName && item.shortName.length >= 4) aliases.push(item.shortName);
          registerEntry({
            id: ispb,
            ispb,
            compe,
            displayName,
            shortName: item.shortName || displayName,
            name: item.name || displayName,
            logoUrl: buildCdnUrl(svgRel || pngRel),
            fallbackPngUrl: pngRel ? buildCdnUrl(pngRel) : '',
            aliases,
            popular: isPixOnly ? 5000 : (item.displayName ? 500 : 2000),
            curated: Boolean(item.displayName),
            source: 'logos-bancos-br'
          });
          added++;
        }
      };

      processList(bancosList, false);
      processList(pixList, true);
      rebuildAliasIndex();
      return added;
    }

    function ingestBrasilApi(banksArray) {
      if (!Array.isArray(banksArray)) return 0;
      let added = 0;
      for (const item of banksArray) {
        if (!item || !item.ispb || !item.logo_url) continue;
        const ispb = String(item.ispb).padStart(8, '0');
        const compe = item.code ? String(item.code).replace(/\D/g, '').padStart(3, '0') : null;
        const displayName = item.name || item.fullName || ispb;
        registerEntry({
          id: ispb,
          ispb,
          compe,
          displayName,
          shortName: item.name || displayName,
          name: item.fullName || displayName,
          logoUrl: item.logo_url,
          fallbackPngUrl: buildCdnUrl(`logos/png/${ispb}.png`),
          aliases: [displayName],
          popular: 1000,
          curated: false,
          source: 'brasilapi'
        });
        added++;
      }
      rebuildAliasIndex();
      return added;
    }

    function readCache() {
      try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.entries) || !parsed.savedAt) return null;
        return parsed;
      } catch (_) {
        return null;
      }
    }

    function writeCache() {
      try {
        if (typeof localStorage === 'undefined') return;
        const compact = [];
        for (const e of state.byId.values()) {
          if (e.source === 'official-favicon') continue;
          compact.push([
            e.ispb,
            e.compe || '',
            e.displayName,
            e.shortName !== e.displayName ? e.shortName : '',
            e.name !== e.displayName ? e.name : '',
            e.logoUrl.startsWith(CDN_BASE + '/') ? e.logoUrl.slice(CDN_BASE.length + 1) : e.logoUrl,
            e.fallbackPngUrl && e.fallbackPngUrl.startsWith(CDN_BASE + '/') ? e.fallbackPngUrl.slice(CDN_BASE.length + 1) : '',
            e.popular
          ]);
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          savedAt: Date.now(),
          source: state.catalogSource,
          entries: compact
        }));
      } catch (_) {
        // Ignora quota/storage indisponível
      }
    }

    function restoreFromCache() {
      const cached = readCache();
      if (!cached) return false;
      for (const row of cached.entries) {
        if (!Array.isArray(row) || !row[0]) continue;
        const [ispb, compe, displayName, shortName, fullName, logoRel, pngRel, popular] = row;
        registerEntry({
          id: ispb,
          ispb,
          compe: compe || null,
          displayName,
          shortName: shortName || displayName,
          name: fullName || displayName,
          logoUrl: buildCdnUrl(logoRel),
          fallbackPngUrl: pngRel ? buildCdnUrl(pngRel) : '',
          aliases: [displayName, shortName].filter(Boolean),
          popular: popular || 2000,
          source: cached.source || 'logos-bancos-br'
        });
      }
      rebuildAliasIndex();
      state.lastUpdatedAt = cached.savedAt;
      state.catalogSource = cached.source || 'logos-bancos-br';
      const isFresh = (Date.now() - cached.savedAt) < CACHE_TTL_MS;
      if (isFresh && cached.entries.length > 100) {
        state.catalogLoaded = true;
      }
      return isFresh;
    }

    function syncLegacyMaps() {
      if (typeof window === 'undefined' || !window.App || !window.App.creditCards) return;
      const map = window.App.creditCards.bankLogoMap || {};
      const colors = window.App.creditCards.bankColors || {};
      for (const entry of state.byId.values()) {
        const key = normalizeText(entry.displayName);
        if (key) {
          map[key] = entry.logoUrl;
          if (!colors[key]) colors[key] = entry.color;
        }
        for (const a of entry.aliases || []) {
          const nk = normalizeText(a);
          if (nk && !map[nk]) map[nk] = entry.logoUrl;
          if (nk && !colors[nk]) colors[nk] = entry.color;
        }
      }
      window.App.creditCards.bankLogoMap = map;
      window.App.creditCards.bankColors = colors;
    }

    function upgradeRenderedPlaceholders() {
      if (typeof document === 'undefined') return;
      const nodes = document.querySelectorAll('[data-bank-logo-pending="1"]');
      nodes.forEach((node) => {
        const name = node.getAttribute('data-bank-logo-name') || '';
        const ispb = node.getAttribute('data-bank-ispb') || '';
        const entry = resolve(ispb ? { name, bank_ispb: ispb } : name);
        if (!entry) return;
        const fallbackLabel = node.getAttribute('data-bank-fallback') || '';
        node.outerHTML = renderLogoHtml({ name, bank_ispb: entry.id }, { fallbackIcon: fallbackLabel });
      });
    }

    async function loadCatalog(forceRefresh = false) {
      if (!forceRefresh && state.catalogLoaded) {
        syncLegacyMaps();
        return getStats();
      }
      if (!forceRefresh && state._loadPromise) {
        return state._loadPromise;
      }

      state._loadPromise = (async () => {
        if (typeof fetch !== 'function') {
          return getStats();
        }
        try {
          const [resBancos, resPix] = await Promise.all([
            fetch(BANCOS_JSON_URL, { cache: forceRefresh ? 'reload' : 'default' }),
            fetch(PIX_JSON_URL, { cache: forceRefresh ? 'reload' : 'default' })
          ]);
          if (resBancos.ok) {
            const bancosJson = await resBancos.json();
            const pixJson = resPix && resPix.ok ? await resPix.json() : [];
            const count = ingestLogosBancosBr(bancosJson, pixJson);
            if (count > 0) {
              state.catalogLoaded = true;
              state.catalogSource = 'logos-bancos-br';
              state.lastUpdatedAt = Date.now();
              writeCache();
              syncLegacyMaps();
              upgradeRenderedPlaceholders();
              return getStats();
            }
          }
        } catch (_) {
          // Fallback para BrasilAPI abaixo
        }

        try {
          const resBrasil = await fetch(BRASIL_API_URL, { cache: forceRefresh ? 'reload' : 'default' });
          if (resBrasil.ok) {
            const data = await resBrasil.json();
            const count = ingestBrasilApi(data);
            if (count > 0) {
              state.catalogLoaded = true;
              state.catalogSource = 'brasilapi';
              state.lastUpdatedAt = Date.now();
              writeCache();
              syncLegacyMaps();
              upgradeRenderedPlaceholders();
              return getStats();
            }
          }
        } catch (_) {
          // Permanece com seed local sem erro fatal
        }

        syncLegacyMaps();
        return getStats();
      })();

      try {
        return await state._loadPromise;
      } finally {
        state._loadPromise = null;
      }
    }

    function resolve(input) {
      if (!input) return null;

      // 1) Objeto de conta ou cartão com bank_ispb / bank_key salvo
      if (typeof input === 'object') {
        const directId = input.bank_ispb || input.bank_key || input.ispb || '';
        if (directId) {
          const byId = state.byId.get(String(directId)) || state.byIspb.get(String(directId).padStart(8, '0'));
          if (byId) return byId;
        }
        return resolve(input.name || input.bankName || '');
      }

      const raw = String(input).trim();
      if (!raw) return null;

      // 2) ID/ISPB exato
      if (state.byId.has(raw)) return state.byId.get(raw);
      if (/^\d{8}$/.test(raw) && state.byIspb.has(raw)) return state.byIspb.get(raw);

      // 3) Código COMPE explícito (ex: "260 - Nubank", "341", "001 Banco do Brasil")
      const compeMatch = raw.match(/^\s*(\d{3})(?:\s*[-–—|:]|\s+$|$)/);
      if (compeMatch && state.byCompe.has(compeMatch[1])) {
        return state.byCompe.get(compeMatch[1]);
      }

      const norm = normalizeText(raw);
      if (!norm) return null;

      // 4) Match exato de alias ou displayName (curated + full)
      for (const item of state.aliasIndex) {
        if (item.alias === norm) {
          return state.byId.get(item.id) || null;
        }
      }

      // 5) Match por fronteira de palavra nos aliases (mais longo / específico primeiro)
      for (const item of state.aliasIndex) {
        if (item.length < 2) continue;
        // Para siglas curtas de 2 letras (bb, xp, c6, bv, nu, vr, mb), exige palavra isolada
        if (containsWordSequence(norm, item.alias)) {
          return state.byId.get(item.id) || null;
        }
      }

      // 6) Busca no catálogo completo por displayName / shortName / name (fronteira de palavra)
      let bestMatch = null;
      let bestScore = -1;
      for (const entry of state.byId.values()) {
        const candidates = [
          { text: entry.normDisplay, weight: 300 },
          { text: entry.normShort, weight: 200 },
          { text: entry.normName, weight: 100 }
        ];
        for (const c of candidates) {
          if (!c.text || c.text.length < 3 || GENERIC_TOKENS.has(c.text)) continue;
          if (containsWordSequence(norm, c.text) || (norm.length >= 4 && !GENERIC_TOKENS.has(norm) && containsWordSequence(c.text, norm))) {
            const score = c.weight + Math.min(c.text.length, 40) - (entry.popular < 100 ? 0 : 10) + (entry.compe ? 20 : 0);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = entry;
            }
          }
        }
      }

      return bestMatch;
    }

    function getLogoUrl(input) {
      const entry = resolve(input);
      return entry ? entry.logoUrl : '';
    }

    function getColor(input) {
      const entry = resolve(input);
      return entry ? entry.color : '#2c3e50';
    }

    function renderMonogramHtml(label, color, pendingName, fallbackIcon) {
      const display = fallbackIcon ? fallbackIcon : escapeAttr(getMonogram(label));
      const bg = fallbackIcon ? 'transparent' : escapeAttr(color || hashColor(label));
      const pendingAttrs = pendingName
        ? ` data-bank-logo-pending="1" data-bank-logo-name="${escapeAttr(pendingName)}"${fallbackIcon ? ` data-bank-fallback="${escapeAttr(fallbackIcon)}"` : ''}`
        : '';
      if (fallbackIcon) {
        return `<span class="bank-logo-fallback-icon"${pendingAttrs}>${fallbackIcon}</span>`;
      }
      return `<span class="bank-logo-monogram" style="background:${bg};"${pendingAttrs}>${display}</span>`;
    }

    function renderLogoHtml(input, options) {
      const opts = options || {};
      const label = typeof input === 'object' && input ? (input.name || input.displayName || '') : String(input || '');
      const entry = resolve(input);
      const safeLabel = escapeAttr(label || (entry ? entry.displayName : 'Banco'));

      if (!entry) {
        return renderMonogramHtml(label, hashColor(label), state.catalogLoaded ? '' : label, opts.fallbackIcon || '');
      }

      const fallbackPng = entry.fallbackPngUrl && entry.fallbackPngUrl !== entry.logoUrl ? entry.fallbackPngUrl : '';
      const monogram = escapeAttr(getMonogram(label || entry.displayName));
      const color = escapeAttr(entry.color || hashColor(label));
      const fallbackIconAttr = opts.fallbackIcon ? ` data-fallback-icon="${escapeAttr(opts.fallbackIcon)}"` : '';

      return `<img class="bank-logo-img" src="${escapeAttr(entry.logoUrl)}" alt="${safeLabel}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback-src="${escapeAttr(fallbackPng)}" data-monogram="${monogram}" data-color="${color}"${fallbackIconAttr} onerror="window.App && App.bankLogos && App.bankLogos.handleImgError(this)">`;
    }

    function handleImgError(imgEl) {
      if (!imgEl || !imgEl.parentElement) return;
      const fallbackSrc = imgEl.getAttribute('data-fallback-src');
      if (fallbackSrc && imgEl.getAttribute('data-tried-fallback') !== '1') {
        imgEl.setAttribute('data-tried-fallback', '1');
        imgEl.src = fallbackSrc;
        return;
      }
      const parent = imgEl.parentElement;
      const fallbackIcon = imgEl.getAttribute('data-fallback-icon');
      const monogram = imgEl.getAttribute('data-monogram') || 'B';
      const color = imgEl.getAttribute('data-color') || '#0e6854';
      imgEl.style.display = 'none';
      if (fallbackIcon) {
        parent.textContent = fallbackIcon;
      } else {
        const badge = document.createElement('span');
        badge.className = 'bank-logo-monogram';
        badge.style.background = color;
        badge.textContent = monogram;
        parent.innerHTML = '';
        parent.appendChild(badge);
      }
    }

    function getAllBanks(filterQuery) {
      const q = normalizeText(filterQuery || '');
      const seenDisplay = new Set();
      const popular = [];
      const others = [];

      for (const entry of state.byId.values()) {
        if (!entry.logoUrl) continue;
        if (q) {
          const hay = `${entry.compe || ''} ${entry.normDisplay} ${entry.normShort} ${entry.normName} ${(entry.aliases || []).map(normalizeText).join(' ')}`;
          if (!hay.includes(q)) continue;
        }
        // Evita duplicatas idênticas de cooperativas afiliadas sem nome único quando não há busca
        const dedupeKey = `${entry.compe || 'PIX'}:${entry.normDisplay}`;
        if (!q && seenDisplay.has(dedupeKey)) continue;
        seenDisplay.add(dedupeKey);

        if (entry.popular < 100) {
          popular.push(entry);
        } else {
          others.push(entry);
        }
      }

      popular.sort((a, b) => a.popular - b.popular);
      others.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
      return { popular, others, total: popular.length + others.length };
    }

    function renderSelectOptions(selectEl, filterQuery, selectedId) {
      if (!selectEl) return;
      const { popular, others } = getAllBanks(filterQuery);
      const currentVal = selectedId !== undefined ? selectedId : selectEl.value;

      const formatLabel = (b) => b.compe ? `${b.compe} — ${b.displayName}` : b.displayName;
      const makeOpt = (b) => `<option value="${escapeAttr(b.id)}"${b.id === currentVal ? ' selected' : ''}>${escapeAttr(formatLabel(b))}</option>`;

      let html = '<option value="">-- Detectar automaticamente pelo nome --</option>';
      if (popular.length > 0) {
        html += `<optgroup label="Principais bancos e carteiras (${popular.length})">${popular.map(makeOpt).join('')}</optgroup>`;
      }
      if (others.length > 0) {
        html += `<optgroup label="Todos os bancos BCB / Open Finance (${others.length})">${others.map(makeOpt).join('')}</optgroup>`;
      }
      if (popular.length === 0 && others.length === 0) {
        html += '<option value="" disabled>Nenhum banco encontrado para a busca</option>';
      }
      selectEl.innerHTML = html;
      if (currentVal && Array.from(selectEl.options).some(o => o.value === currentVal)) {
        selectEl.value = currentVal;
      }
    }

    function updatePreview(previewEl, input) {
      if (!previewEl) return;
      const entry = resolve(input);
      if (entry) {
        previewEl.innerHTML = renderLogoHtml(entry);
        previewEl.title = entry.compe ? `${entry.displayName} (COMPE ${entry.compe})` : entry.displayName;
        previewEl.classList.add('has-logo');
      } else {
        const label = typeof input === 'string' ? input : (input && input.name) || '';
        previewEl.innerHTML = renderMonogramHtml(label || '?', '#64748b');
        previewEl.title = 'Logo detectado automaticamente pelo nome';
        previewEl.classList.remove('has-logo');
      }
    }

    function bindPicker({ selectId, searchId, previewId, nameInputId, countId, initialBankId, initialName, fillNameOnSelect = true }) {
      if (typeof document === 'undefined') return;
      const selectEl = document.getElementById(selectId);
      const searchEl = document.getElementById(searchId);
      const previewEl = document.getElementById(previewId);
      const nameEl = document.getElementById(nameInputId);
      const countEl = countId ? document.getElementById(countId) : null;
      if (!selectEl) return;

      const resolvedInitial = initialBankId
        ? resolve({ bank_ispb: initialBankId, name: initialName })
        : (initialName ? resolve(initialName) : null);
      const selectedId = resolvedInitial ? resolvedInitial.id : '';

      if (searchEl) searchEl.value = '';
      renderSelectOptions(selectEl, '', selectedId);
      updatePreview(previewEl, resolvedInitial || initialName || '');

      const updateCountBadge = () => {
        if (!countEl) return;
        const stats = getStats();
        countEl.textContent = `${stats.totalWithLogos} bancos com logo oficial`;
      };
      updateCountBadge();

      // Carrega catálogo completo em segundo plano se ainda estiver apenas no seed
      if (!state.catalogLoaded) {
        loadCatalog(false).then(() => {
          const currentSelected = selectEl.value || selectedId;
          renderSelectOptions(selectEl, searchEl ? searchEl.value : '', currentSelected);
          updatePreview(previewEl, currentSelected || (nameEl ? nameEl.value : ''));
          updateCountBadge();
        }).catch(() => {});
      }

      if (searchEl && !searchEl.dataset.bankPickerBound) {
        searchEl.dataset.bankPickerBound = '1';
        searchEl.addEventListener('input', () => {
          const q = searchEl.value;
          renderSelectOptions(selectEl, q, selectEl.value);
          // Se a busca filtrou para exatamente 1 banco, destaca no preview
          const { popular, others } = getAllBanks(q);
          const first = popular[0] || others[0];
          if (q.trim() && first) {
            updatePreview(previewEl, first);
          } else {
            updatePreview(previewEl, selectEl.value || (nameEl ? nameEl.value : ''));
          }
        });
      }

      if (!selectEl.dataset.bankPickerBound) {
        selectEl.dataset.bankPickerBound = '1';
        selectEl.addEventListener('change', () => {
          const picked = selectEl.value ? resolve(selectEl.value) : null;
          updatePreview(previewEl, picked || (nameEl ? nameEl.value : ''));
          if (fillNameOnSelect && picked && nameEl) {
            nameEl.value = picked.displayName;
          }
        });
      }

      if (nameEl && !nameEl.dataset.bankPreviewBound) {
        nameEl.dataset.bankPreviewBound = '1';
        nameEl.addEventListener('input', () => {
          if (!selectEl.value) {
            updatePreview(previewEl, nameEl.value);
          }
        });
      }
    }

    async function refreshCatalogWithFeedback(selectId, searchId, previewId, countId) {
      const btn = document.activeElement;
      if (btn && btn.tagName === 'BUTTON') btn.disabled = true;
      try {
        const stats = await loadCatalog(true);
        const selectEl = selectId ? document.getElementById(selectId) : null;
        const searchEl = searchId ? document.getElementById(searchId) : null;
        const previewEl = previewId ? document.getElementById(previewId) : null;
        const countEl = countId ? document.getElementById(countId) : null;
        if (selectEl) renderSelectOptions(selectEl, searchEl ? searchEl.value : '', selectEl.value);
        if (previewEl && selectEl) updatePreview(previewEl, selectEl.value);
        if (countEl) countEl.textContent = `${stats.totalWithLogos} bancos com logo oficial`;
        if (window.App && App.utils && typeof App.utils.showToast === 'function') {
          App.utils.showToast(`Catálogo atualizado: ${stats.totalWithLogos} instituições com logo!`);
        }
        return stats;
      } finally {
        if (btn && btn.tagName === 'BUTTON') btn.disabled = false;
      }
    }

    function getStats() {
      return {
        totalWithLogos: state.byId.size,
        catalogLoaded: state.catalogLoaded,
        source: state.catalogSource,
        lastUpdatedAt: state.lastUpdatedAt
      };
    }

    // Inicialização imediata (seed síncrono + restauração instantânea do cache localStorage)
    seedInitialEntries();
    restoreFromCache();

    return {
      CDN_BASE,
      BANCOS_JSON_URL,
      PIX_JSON_URL,
      BRASIL_API_URL,
      normalizeText,
      resolve,
      getLogoUrl,
      getColor,
      renderLogoHtml,
      handleImgError,
      getAllBanks,
      getStats,
      loadCatalog,
      ensureLoaded: () => loadCatalog(false),
      ingestLogosBancosBr,
      ingestBrasilApi,
      syncLegacyMaps,
      bindPicker,
      updatePreview,
      refreshCatalogWithFeedback
    };
  }

  const service = createBankLogosService();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createBankLogosService,
      normalizeText,
      containsWordSequence,
      getMonogram,
      POPULAR_SEED,
      EXTRA_BRANDS,
      service
    };
  }

  if (root) {
    root.App = root.App || {};
    root.App.bankLogos = service;
  }
})(typeof window !== 'undefined' ? window : globalThis);
