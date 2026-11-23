// =====================================================================
// ARQUIVO: utils.js
// Configurações globais, estado, utilitários (formatCurrency, datas,
// saldos, alerts, dialogs, CSV, captura PNG)
// =====================================================================
var App = window.App || {};

// Configurações
App.config = {
  DB_NAME: (App.dbSchema && App.dbSchema.DB_NAME) || 'ContasOnlineDB',
  DB_VERSION: (App.dbSchema && App.dbSchema.DB_VERSION) || 34,
  DB_STORES: (App.dbSchema && App.dbSchema.STORES) || [],
  CATS_EXP: ['Alimentação','Moradia','Transporte','Saúde','Lazer','Educação','Vestuário','Assinaturas','Outros'],
  CATS_INC: ['Salário','Freelance','Investimentos','Vendas','Reembolso','Outros'],
  COLORS: ['#e64a19','#5d4037','#f57c00','#d32f2f','#7b1fa2','#1976d2','#c2185b','#455a64','#757575','#2e7d32','#00695c','#1565c0','#4a148c','#33691e','#00838f'],
  INVESTMENT_TYPES: ['Ações','FIIs','Tesouro Direto','CDB','LC/LCI/LCA','Cripto','Fundos','Poupança','Renda Fixa','Outros'],
  INDICATORS: { selic: 13.75, ipca: 4.87, cdi: 13.65, poupanca: 6.17 },
  CLASSIFICATION_MAP: {
    'Alimentação':'essential','Moradia':'essential','Saúde':'essential',
    'Transporte':'necessary','Educação':'necessary',
    'Vestuário':'superfluous','Lazer':'superfluous','Assinaturas':'superfluous',
    'Outros':'necessary'
  },
  CAT_COLORS: {
    'Alimentação': '#e67e22', 'Moradia': '#c0392b', 'Transporte':'#2980b9',
    'Saúde':'#27ae60', 'Lazer':'#8e44ad', 'Educação':'#f39c12',
    'Vestuário':'#e74c3c', 'Assinaturas':'#7f8c8d', 'Outros':'#95a5a6',
    'Salário':'#2ecc71', 'Freelance':'#3498db', 'Investimentos':'#1abc9c',
    'Vendas':'#f1c40f', 'Reembolso':'#9b59b6'
  },

  // Dicionário canônico de Locais (comerciantes/empresas onde o dinheiro é gasto).
  // Os padrões são armazenados como strings e compilados em runtime por App.locais._compilePatterns.
  // Se o primeiro item do array tiver formato "/.../flags", o App.locais respeita a flag.
  LOCAIS_SEED: [
    // ===== MERCADOS =====
    { id: 'atacadao',       nome: 'Atacadão',                categoria: 'Mercado',       icone: '🛒', padroes: ['atacad[aã]o\\s+(independ|av|13|15|29|compras|supermercado|das carnes)', '^atacad[aã]o$', '^atacadoa'] },
    { id: 'tatico',         nome: 'Supermercado Tatico',     categoria: 'Mercado',       icone: '🛒', padroes: ['supermercado\\s+t[aá]tico', '^t[aá]tico\\s+\\d'] },
    { id: 'pratiko',        nome: 'Supermercado Pratiko',    categoria: 'Mercado',       icone: '🛒', padroes: ['supermercado\\s+pratik[oó]', 'supermercado\\s+pratico'] },
    { id: 'carrefour',      nome: 'Carrefour',               categoria: 'Mercado',       icone: '🛒', padroes: ['^carrefour'] },
    { id: 'assai',          nome: 'Assaí Atacadista',        categoria: 'Mercado',       icone: '🛒', padroes: ['ass[aá]i\\s+atacadista', '^ass[aá]i\\b'] },
    { id: 'leve',           nome: 'Supermercado Leve',       categoria: 'Mercado',       icone: '🛒', padroes: ['supermercado\\s+leve', '^leve\\s+supermercado'] },
    { id: 'paodeacucar',    nome: 'Pão de Açúcar',           categoria: 'Mercado',       icone: '🛒', padroes: ['p[aã]o\\s+de\\s+a[cç][uú]car'] },
    { id: 'bretas',         nome: 'Bretas / Prezunic',       categoria: 'Mercado',       icone: '🛒', padroes: ['bretas\\s+prezunic'] },
    { id: 'vieira',         nome: 'Supermercado Vieira',     categoria: 'Mercado',       icone: '🛒', padroes: ['supermercado\\s+vieira'] },
    { id: 'supermix',       nome: 'Super Mix',               categoria: 'Mercado',       icone: '🛒', padroes: ['super\\s+mix\\s+supermercado'] },
    { id: 'probraziliam',   nome: 'Pró Braziliam',           categoria: 'Mercado',       icone: '🛒', padroes: ['supermercado\\s+pr[oó]\\s+braziliam'] },
    { id: 'cristorei',      nome: 'Supermercado Cristo Rei', categoria: 'Mercado',       icone: '🛒', padroes: ['supermercado\\s+cristo\\s+rei'] },
    { id: 'uniaoaçougue',   nome: 'União Alimentos',         categoria: 'Mercado',       icone: '🥩', padroes: ['uni[aã]o\\s+alimentos'] },
    { id: 'atacadaocarnes', nome: 'Atacadão das Carnes',     categoria: 'Mercado',       icone: '🥩', padroes: ['atacad[aã]o\\s+das\\s+carnes'] },
    { id: 'costaatacadao',  nome: 'Costa Atacadão',          categoria: 'Mercado',       icone: '🛒', padroes: ['costa\\s+atacad[aã]o'] },

    // ===== DELIVERY / RESTAURANTES =====
    { id: 'ifood',          nome: 'iFood',                   categoria: 'Delivery',      icone: '🍔', padroes: ['^ifood', '^ifood\\s*-'] },
    { id: '99food',         nome: '99 Food',                 categoria: 'Delivery',      icone: '🍔', padroes: ['^99\\s+food', '^#\\s+food', '^99\\s+presencial'] },
    { id: 'uber',           nome: 'Uber',                    categoria: 'Transporte',    icone: '🚗', padroes: ['uber\\s+presencial', '^uber\\b'] },
    { id: 'burguerking',    nome: 'Burger King',             categoria: 'Restaurante',   icone: '🍔', padroes: ['burguer\\s+king'] },
    { id: 'mcdonalds',      nome: "McDonald's",              categoria: 'Restaurante',   icone: '🍔', padroes: ['mc\\s+donalds'] },
    { id: 'giraffas',       nome: 'Giraffas',                categoria: 'Restaurante',   icone: '🍽️', padroes: ['giraffas'] },
    { id: 'caseratto',      nome: 'Caseratto',               categoria: 'Restaurante',   icone: '🍽️', padroes: ['caseratto'] },
    { id: 'hiperburguer',   nome: 'Hiper Burguer',           categoria: 'Restaurante',   icone: '🍔', padroes: ['hiper\\s+burguer'] },
    { id: 'pitdog',         nome: 'Pit Dog',                 categoria: 'Restaurante',   icone: '🌭', padroes: ['pit\\s+dog'] },
    { id: 'jnpasteis',      nome: 'JN Pastéis',              categoria: 'Restaurante',   icone: '🥟', padroes: ['jn\\s+pasteis'] },
    { id: 'duogelatto',     nome: 'Duo Gelatto',             categoria: 'Sorveteria',    icone: '🍦', padroes: ['duo\\s+gelatto'] },
    { id: 'churrospc',      nome: 'Churros PC Criativa',     categoria: 'Restaurante',   icone: '🍩', padroes: ['churros\\s+pc\\s+criativa'] },
    { id: 'espetinho',      nome: 'Espetinho PC do Avião',   categoria: 'Restaurante',   icone: '🍢', padroes: ['espetinho\\s+pc\\s+do\\s+avi[aã]o'] },
    { id: 'tortafeira',     nome: 'Torta Feira PC do Avião', categoria: 'Restaurante',   icone: '🥧', padroes: ['torta\\s+feira\\s+pc'] },
    { id: 'feirachop',      nome: 'Feira Choop PC do Avião', categoria: 'Bar',           icone: '🍺', padroes: ['feira\\s+choop'] },
    { id: 'panificadora',   nome: 'Panificadora Pão Gostoso',categoria: 'Padaria',       icone: '🥖', padroes: ['panificadora\\s+p[aã]o\\s+gostoso'] },
    { id: 'padariagen',     nome: 'Padaria',                 categoria: 'Padaria',       icone: '🥖', padroes: ['^padaria$'] },
    { id: 'vidaly',         nome: 'Vidaly Lanchonet',        categoria: 'Restaurante',   icone: '🍽️', padroes: ['vidaly\\s+lanchonet'] },
    { id: 'exxqueminha',    nome: 'Exxqueminha',             categoria: 'Restaurante',   icone: '🌮', padroes: ['exxqueminha'] },
    { id: 'biomundo',       nome: 'Bio Mundo',               categoria: 'Saudável',      icone: '🥗', padroes: ['bio\\s+mundo'] },
    { id: 'frutosdegoias',  nome: 'Frutos de Goiás',         categoria: 'Saudável',      icone: '🥤', padroes: ['frutos\\s+de\\s+goias'] },
    { id: 'quiosquever',    nome: 'Quiosque do Vinicius',    categoria: 'Saudável',      icone: '🥥', padroes: ['quiosque\\s+do\\s+vinicius'] },
    { id: 'aguaJdBotanico', nome: 'Água de Coco Jd Botânico',categoria: 'Saudável',      icone: '🥥', padroes: ['agua\\s+de\\s+coco\\s+jd'] },
    { id: 'sorveteriaero',  nome: 'Sorveteria Setor Aeroporto', categoria: 'Sorveteria', icone: '🍦', padroes: ['sorveteria\\s+setor\\s+aeroporto'] },
    { id: 'rodizioFazenda', nome: 'Rodízio Fazenda',         categoria: 'Restaurante',   icone: '🍖', padroes: ['rodizio\\s+fazenda'] },

    // ===== DISTRIBUIDORAS =====
    { id: 'distCanedo',     nome: 'Distribuidora Senador Canedo', categoria: 'Bebidas', icone: '🍺', padroes: ['distribuidora\\s+senador\\s+canedo', 'senador\\s+canedo\\s+distribuidora'] },
    { id: 'distAparecida',  nome: 'Distribuidora Aparecida', categoria: 'Bebidas',       icone: '🍺', padroes: ['distribuidora\\s+aparecida'] },
    { id: 'distCervejato',  nome: 'Distribuidora Cervejato', categoria: 'Bebidas',       icone: '🍺', padroes: ['distribuidora\\s+cervejato'] },
    { id: 'distSorvets',    nome: 'Distribuidora de Sorvetes', categoria: 'Sorveteria', icone: '🍦', padroes: ['distribuidora\\s+de\\s+sorvets'] },
    { id: 'mpTrindent',     nome: 'MP Trindent',             categoria: 'Bebidas',       icone: '🍺', padroes: ['mp\\s+trindent'] },

    // ===== COMBUSTÍVEL =====
    { id: 'postopraca',     nome: 'Posto Praça do Avião',    categoria: 'Combustível',   icone: '⛽', padroes: ['posto\\s+pra[cç]a\\s+do\\s+avi[aã]o'] },
    { id: 'postoanhanguera',nome: 'Posto Av Anhanguera',     categoria: 'Combustível',   icone: '⛽', padroes: ['posto\\s+av\\s+anhanguera'] },
    { id: 'postoshell',     nome: 'Posto Shell Anhanguera',  categoria: 'Combustível',   icone: '⛽', padroes: ['posto\\s+shel\\s+av\\s+anhanguera'] },
    { id: 'postogoias',     nome: 'Posto AV Goiás Petrobras',categoria: 'Combustível',   icone: '⛽', padroes: ['posto\\s+av\\s+goi[aá]s\\s+petrobr[aá]s'] },

    // ===== SAÚDE =====
    { id: 'drogasil',       nome: 'Drogasil',                categoria: 'Farmácia',      icone: '💊', padroes: ['drogasil'] },
    { id: 'marceloCunha',   nome: 'Marcelo Cunha Odonto',    categoria: 'Saúde',         icone: '🦷', padroes: ['marcelo\\s+cunha\\s+odonto'] },

    // ===== PET =====
    { id: 'petlove',        nome: 'Pet Love',                categoria: 'Pet',           icone: '🐾', padroes: ['pet\\s*love'] },

    // ===== EDUCAÇÃO =====
    { id: 'unifatecie',     nome: 'Unifatecie',              categoria: 'Educação',      icone: '🎓', padroes: ['unifatecie'] },
    { id: 'granconcursos',  nome: 'Gran Concursos',          categoria: 'Educação',      icone: '📚', padroes: ['gran\\s+concursos', 'gran\\s+concuros'] },

    // ===== VEÍCULOS =====
    { id: 'toytec',         nome: 'Toy Tec',                 categoria: 'Manutenção',    icone: '🔧', padroes: ['toy\\s+tec'] },
    { id: 'lavajatoBrasil', nome: 'Lava Jato Brasil',        categoria: 'Lava-jato',     icone: '🧼', padroes: ['lava\\s+jato\\s+brasil'] },
    { id: 'lavarapidoAero', nome: 'Lava Rápido Setor Aeroporto', categoria: 'Lava-jato', icone: '🧼', padroes: ['lava\\s+r[aá]pido\\s+setor\\s+aeroporto'] },
    { id: 'globaltec',      nome: 'Global Tec Locações',     categoria: 'Lava-jato',     icone: '🧼', padroes: ['global\\s+tec\\s+loca[cç][oõ]es'] },
    { id: 'autobrasil',     nome: 'Auto Brasil',             categoria: 'Lava-jato',     icone: '🧼', padroes: ['auto\\s+brasil\\s+passeio'] },
    { id: 'detrango',       nome: 'Detran Goiás',            categoria: 'Órgão Público', icone: '🚗', padroes: ['detrango'] },

    // ===== CASA / UTILIDADES =====
    { id: 'equatorial',     nome: 'Equatorial Energia',      categoria: 'Energia',       icone: '⚡', padroes: ['equatorial'] },
    { id: 'niofibra',       nome: 'Nio Fibra',               categoria: 'Internet',      icone: '🌐', padroes: ['nio\\s+fibra'] },
    { id: 'jingxixang',     nome: 'Jing Xixang Utilidades',  categoria: 'Utilidades',    icone: '🏠', padroes: ['jing\\s+xixang\\s+utilidades'] },
    { id: 'ferragistaTri',  nome: 'Ferragista Triângulo',    categoria: 'Utilidades',    icone: '🔧', padroes: ['tri[aâ]ngulo\\s+ferragista', 'ferragista\\s+tri[aâ]ngulo'] },

    // ===== TECNOLOGIA / ASSINATURAS =====
    { id: 'apple',          nome: 'Apple',                   categoria: 'Tecnologia',    icone: '📱', padroes: ['apple\\s+ipad'] },
    { id: 'googleone',      nome: 'Google One',              categoria: 'Assinatura',    icone: '☁️', padroes: ['google\\s+one'] },
    { id: 'amazon',         nome: 'Amazon',                  categoria: 'Marketplace',   icone: '📦', padroes: ['^amazon\\b'] },
    { id: 'shopee',         nome: 'Shopee',                  categoria: 'Marketplace',   icone: '🛍️', padroes: ['shopee', 'shoope'] },
    { id: 'mercadolivre',   nome: 'Mercado Livre',           categoria: 'Marketplace',   icone: '📦', padroes: ['mercado\\s+livre'] },
    { id: 'ciabra',         nome: 'Ciabra Pagamentos',       categoria: 'Assinatura',    icone: '💳', padroes: ['ciabra\\s+pagamentos'] },
    { id: 'doc24',          nome: 'DOC 24 Seguros',          categoria: 'Assinatura',    icone: '🛡️', padroes: ['doc\\s*24\\s+seguros'] },

    // ===== MODA / VESTUÁRIO =====
    { id: 'adidas',         nome: 'Adidas',                  categoria: 'Moda',          icone: '👟', padroes: ['adidas', 'funfanactis'] },
    { id: 'fila',           nome: 'Fila',                    categoria: 'Moda',          icone: '👟', padroes: ['fila\\s+speed\\s+zone', 'tenis\\s+place'] },
    { id: 'fiamamura',      nome: 'Fiamamura',               categoria: 'Moda',          icone: '👕', padroes: ['fiamamura'] },
    { id: 'cea',            nome: 'C&A',                     categoria: 'Moda',          icone: '👕', padroes: ['c\\s*&\\s*a\\s+pay'] },
    { id: 'natura',         nome: 'Natura / Pura Essência',  categoria: 'Cosméticos',    icone: '🌸', padroes: ['pura\\s+ess[eê]ncia'] },
    { id: 'oboticario',     nome: 'O Boticário',             categoria: 'Cosméticos',    icone: '🌸', padroes: ['o\\s+botic[aá]rio'] },
    { id: 'barbaros',       nome: 'Barbaros Barbershop',     categoria: 'Barbearia',     icone: '💈', padroes: ['barbaros\\s+barbershop'] },

    // ===== PRESENTES =====
    { id: 'brasilcacau',    nome: 'Brasil Cacau',            categoria: 'Presentes',     icone: '🍫', padroes: ['brasil\\s+cacau'] },
    { id: 'cacaushow',      nome: 'Cacau Show',              categoria: 'Presentes',     icone: '🍫', padroes: ['cacau\\s+show'] },
    { id: 'caedu',          nome: 'Caedu',                   categoria: 'Presentes',     icone: '🎁', padroes: ['caedu'] },

    // ===== ELETRODOMÉSTICOS =====
    { id: 'mondial',        nome: 'Mondial',                 categoria: 'Eletro',        icone: '📺', padroes: ['mondial'] },
    { id: 'everet',         nome: 'Bebedouro Everet',        categoria: 'Eletro',        icone: '💧', padroes: ['bebedouro\\s+everet'] },
    { id: 'midea',          nome: 'Midea',                   categoria: 'Eletro',        icone: '❄️', padroes: ['midea\\s+ecomaster'] },
    { id: 'elgin',          nome: 'Elgin',                   categoria: 'Eletro',        icone: '🔥', padroes: ['churrasqueira\\s+elgin'] },

    // ===== ESTACIONAMENTO / CINEMA =====
    { id: 'estBrasilC',     nome: 'Estacionamento Brasil Center', categoria: 'Estacionamento', icone: '🅿️', padroes: ['estacionamento\\s+brasil\\s+center'] },
    { id: 'estPasseio',     nome: 'Estacionamento Passeio das Águas', categoria: 'Estacionamento', icone: '🅿️', padroes: ['estacionamento\\s+p[ae]s?se?io\\s+das\\s+[aá]guas'] },
    { id: 'estCentro',      nome: 'Estacionamento Centro',   categoria: 'Estacionamento',icone: '🅿️', padroes: ['estacionamento\\s+centro'] },
    { id: 'estGoiania',     nome: 'Estacionamento Goiânia Shopping', categoria: 'Estacionamento', icone: '🅿️', padroes: ['estacionamento\\s+goi[aâ]nia\\s+shooping'] },
    { id: 'cinemark',       nome: 'Cinemark',                categoria: 'Cinema',        icone: '🎬', padroes: ['cinemark'] },

    // ===== COMUNICAÇÃO =====
    { id: 'vivo',           nome: 'Vivo',                    categoria: 'Telefonia',     icone: '📱', padroes: ['recarga\\s+vivo'] },

    // ===== EXCLUIR DO RANKING (não são "empresas onde o dinheiro fica") =====
    { id: 'aluguel',        nome: 'Aluguel APTO 25-A',       categoria: 'Moradia',       icone: '🏠', padroes: ['^aluguel\\s+apto', '^aluguel\\s+25-a'], excluir_do_ranking: true },
    { id: 'faturas',        nome: 'Pagamentos de Fatura',    categoria: 'Transferência', icone: '💳', padroes: ['pagamento\\s+fatura', '^fatura\\s+(xp|nubank|itau)'], excluir_do_ranking: true },
    { id: 'emprestimos',    nome: 'Empréstimos',             categoria: 'Terceiros',     icone: '🤝', padroes: ['empr[eé]stimo', 'infinity\\s+pay'], excluir_do_ranking: true },
    { id: 'doacoes',        nome: 'Doações',                 categoria: 'Doação',        icone: '❤️', padroes: ['doa[cç][aã]o'], excluir_do_ranking: true },
    { id: 'pixTerceiros',   nome: 'Pix p/ Terceiros',        categoria: 'Terceiros',     icone: '👤', padroes: ['pix\\s+(fraudas|lanche|vanessa|lucas|no\\s+cr[eé]dito)'], excluir_do_ranking: true }
  ]
};

// Carregar indicadores salvos
(function(){
  const saved = localStorage.getItem('app_indicators');
  if (saved) { try { Object.assign(App.config.INDICATORS, JSON.parse(saved)); } catch(e) {} }
})();

App.state = {
  currentMemberFilter: null,
  globalMemberFilter: null,
  saldoVisibility: {}
};

App.cache = App.cache || {};

// Utilitários
App.utils = {
  formatCurrency: v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v),
  formatDate: (d) => {
    if (!d) return '-';
    const datePart = d.includes('T') ? d.split('T')[0] : d;
    return datePart.split('-').reverse().join('/');
  },
  formatDateTime: d => {
    if (!d) return '-';
    if (d.includes('T')) {
      const [date, time] = d.split('T');
      const [y, m, day] = date.split('-');
      const [h, min] = time.split(':');
      return `${day}/${m}/${y} ${h}:${min}`;
    }
    return d.split('-').reverse().join('/');
  },
  formatDateTimeFull: d => {
    if (!d) return '-';
    const base = App.utils.formatDateTime(d);
    if (d.includes('T')) return base;
    // Se não tem hora, adiciona 00:00
    return `${base} 00:00`;
  },
  todayISO: () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
},
  parseFloatLocale: (str) => {
    if (typeof str === 'number') return str;
    if (typeof str !== 'string') return NaN;
    const normalized = str.trim().replace(',', '.');
    return parseFloat(normalized);
  },
  generateId: () => 'id_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
  showToast: (msg,type='success') => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent=msg; t.className='toast '+type+' show';
    clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2500);
  },

  hexToHSL(hex) {
    let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
    let max = Math.max(r,g,b), min = Math.min(r,g,b), h, s, l = (max+min)/2;
    if (max === min) h = s = 0;
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
  },

  generateAnalogousPalette(hex, count = 6) {
    const hsl = this.hexToHSL(hex);
    const palette = [];
    for (let i = 0; i < count; i++) {
      const newHue = (hsl.h + (i - Math.floor(count/2)) * 8 + 360) % 360;
      const newSat = Math.min(100, Math.max(20, hsl.s + (i % 2 === 0 ? 3 : -3)));
      const newLight = Math.min(88, Math.max(12, hsl.l + (i - Math.floor(count/2)) * 6));
      palette.push(`hsl(${newHue}, ${newSat}%, ${newLight}%)`);
    }
    return palette;
  },

  monthRangeFromDate(dateStr) {
    const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const d = new Date(dateOnly + 'T12:00:00');
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
    return {
      start: start.toISOString().slice(0,10),
      end: end.toISOString().slice(0,10) + 'T23:59:59',
      startDate: start.toISOString().slice(0,10),
      label: `${this.formatDate(start.toISOString().slice(0,10))} → ${this.formatDate(end.toISOString().slice(0,10))}`,
      monthName: start.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}),
      refMonth: `${start.toLocaleDateString('pt-BR',{month:'long'})}/${start.getFullYear()}`
    };
  },

  cycleFromDate(dateStr) {
    const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const d = new Date(dateOnly + 'T12:00:00');
    if (d.getDate() <= 10) d.setMonth(d.getMonth()-1);
    const start = new Date(d.getFullYear(), d.getMonth(), 11);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 10);
    return {
      start: start.toISOString().slice(0,10),
      end: end.toISOString().slice(0,10) + 'T23:59:59',
      startDate: start.toISOString().slice(0,10),
      label: `${this.formatDate(start.toISOString().slice(0,10))} → ${this.formatDate(end.toISOString().slice(0,10))}`,
      monthName: start.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}),
      refMonth: `${start.toLocaleDateString('pt-BR',{month:'long'})}/${start.getFullYear()}`
    };
  },

  currentMonth: () => App.utils.monthRangeFromDate(new Date().toISOString().slice(0,10)),
  currentCycle: () => App.utils.cycleFromDate(new Date().toISOString().slice(0,10)),
  addMonths: (dateStr, months) => { const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr; const d = new Date(dateOnly + 'T12:00:00'); d.setMonth(d.getMonth()+months); return d.toISOString().slice(0,10); },

  showFieldError(input, msg) {
    if (!input) return;
    input.classList.add('error');
    let errEl = input.parentNode.querySelector('.field-error');
    if (!errEl) {
      errEl = document.createElement('span');
      errEl.className = 'field-error';
      errEl.style.color = 'var(--expense)';
      errEl.style.fontSize = '0.7rem';
      input.parentNode.appendChild(errEl);
    }
    errEl.textContent = msg;
  },

  clearFieldError(input) {
    if (!input) return;
    input.classList.remove('error');
    const errEl = input.parentNode.querySelector('.field-error');
    if (errEl) errEl.remove();
  },

  calculateBalance(accounts, txAll) {
    const today = this.todayISO();
    const balanceMap = {};
    const includedAccounts = accounts.filter(a => !a.exclude_from_total);
    includedAccounts.forEach(a => { balanceMap[a.id] = (a.initial_balance || 0); });
    txAll.forEach(t => {
      // Ignora transações não confirmadas, marcadas para ignorar, com data futura, travadas por pagamento de fatura ou compras de cartão de crédito
      if (t.status !== 'confirmed' || t.ignore_from_total) return;
      if (t.invoice_locked) return;
      if (t.credit_card_id) return;
      if (t.date.slice(0,10) > today) return;
      const amt = parseFloat(t.amount);
      if (t.type==='income'||t.type==='refund') balanceMap[t.account_id]=(balanceMap[t.account_id]||0)+amt;
      else if (t.type==='expense') balanceMap[t.account_id]=(balanceMap[t.account_id]||0)-amt;
      else if (t.type==='transfer'||t.type==='contribution') { balanceMap[t.account_id]=(balanceMap[t.account_id]||0)-amt; balanceMap[t.account_to_id]=(balanceMap[t.account_to_id]||0)+amt; }
      else if (t.type==='withdrawal') { balanceMap[t.account_id]=(balanceMap[t.account_id]||0)-amt; balanceMap[t.account_to_id]=(balanceMap[t.account_to_id]||0)+amt; }
    });
    return includedAccounts.reduce((s,a) => s + (balanceMap[a.id]||0), 0);
  },

  calculateProjectedBalance(accounts, txAll, days = 30) {
    const today = this.todayISO();
    const futureDate = new Date(today+'T12:00:00');
    futureDate.setDate(futureDate.getDate() + days);
    const futureStr = futureDate.toISOString().slice(0,10);
    const balanceMap = {};
    const includedAccounts = accounts.filter(a => !a.exclude_from_total);
    includedAccounts.forEach(a => { balanceMap[a.id] = (a.initial_balance || 0); });
    txAll.forEach(t => {
      // Ignora transações marcadas para ignorar, travadas por pagamento de fatura, compras de cartão de crédito ou com data posterior ao limite da projeção
      if (t.ignore_from_total) return;
      if (t.invoice_locked) return;
      if (t.credit_card_id) return;
      if (t.date.slice(0,10) > futureStr) return;
      // Inclui transações confirmadas ou pendentes
      if (t.status !== 'confirmed' && t.status !== 'pending') return;
      const amt = parseFloat(t.amount);
      if (t.type==='income'||t.type==='refund') balanceMap[t.account_id]=(balanceMap[t.account_id]||0)+amt;
      else if (t.type==='expense') balanceMap[t.account_id]=(balanceMap[t.account_id]||0)-amt;
      else if (t.type==='transfer'||t.type==='contribution') { balanceMap[t.account_id]=(balanceMap[t.account_id]||0)-amt; balanceMap[t.account_to_id]=(balanceMap[t.account_to_id]||0)+amt; }
      else if (t.type==='withdrawal') { balanceMap[t.account_id]=(balanceMap[t.account_id]||0)-amt; balanceMap[t.account_to_id]=(balanceMap[t.account_to_id]||0)+amt; }
    });
    return includedAccounts.reduce((s,a) => s + (balanceMap[a.id]||0), 0);
  },

  _alerts: [],
  async addAlert(msg, type='warning', quiet=false) {
    this._alerts.push({ id: App.utils.generateId(), msg, type, date: new Date().toISOString(), read: false });
    try { await App.db.put('notifications', { id: App.utils.generateId(), message: msg, type, date: new Date().toISOString(), read: false }); } catch(e) {}
    this.updateAlertBell();
    if (!quiet) {
      const count = this._alerts.filter(a => !a.read).length;
      const lastSeen = parseInt(sessionStorage.getItem('last_alert_count')||'0');
      const newAlerts = count - lastSeen;
      if (newAlerts > 0 && count > 0) App.utils.showToast(`${newAlerts} notificaç${newAlerts>1?'ões':'ão'}!`, 'success');
      sessionStorage.setItem('last_alert_count', count);
    }
  },
  getAlerts() { return this._alerts.slice(-20).reverse(); },
  clearAlerts() { this._alerts = []; this.updateAlertBell(); sessionStorage.setItem('last_alert_count', '0'); },
  updateAlertBell() {
    const count = this._alerts.filter(a => !a.read).length;
    const bell = document.getElementById('alertCount');
    if (bell) { bell.textContent = count; bell.style.display = count > 0 ? 'flex' : 'none'; }
  },

  applyGlobalMemberFilter(txArray) {
    if (App.state.globalMemberFilter) return txArray.filter(t => t.member_id === App.state.globalMemberFilter);
    return txArray;
  },

  confirm(message, onOk, onCancel) {
    document.getElementById('confirmTitle').textContent = 'Confirmar';
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOk').onclick = () => { App.ui.closeModal('modalConfirm'); if (onOk) onOk(); };
    document.getElementById('confirmCancel').onclick = () => { App.ui.closeModal('modalConfirm'); if (onCancel) onCancel(); };
    App.ui.openModal('modalConfirm');
  },

  prompt(message, defaultValue, onOk, onCancel) {
    document.getElementById('promptTitle').textContent = 'Informe';
    document.getElementById('promptMessage').textContent = message;
    document.getElementById('promptInput').value = defaultValue || '';
    document.getElementById('promptOk').onclick = () => { const val = document.getElementById('promptInput').value; App.ui.closeModal('modalPrompt'); if (onOk) onOk(val); };
    document.getElementById('promptCancel').onclick = () => { App.ui.closeModal('modalPrompt'); if (onCancel) onCancel(); };
    App.ui.openModal('modalPrompt');
  },

  selectAccount(accounts, onSelect, onSkip) {
    const listEl = document.getElementById('selectAccountList');
    if (!listEl) return;
    document.getElementById('selectAccountTitle').textContent = 'Selecione a Conta';
    let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
    accounts.forEach((a, i) => {
      html += `<button class="btn btn-outline" style="text-align:left; padding:12px;" onclick="App.ui.closeModal('modalSelectAccount'); App.utils._selectedAccountCallback(${i})">
        <div style="display:flex; justify-content:space-between;">
          <span>${a.name}</span>
          <span style="font-weight:600;">${this.formatCurrency(a.balance || 0)}</span>
        </div>
      </button>`;
    });
    html += '</div>';
    listEl.innerHTML = html || '<p>Nenhuma conta disponível.</p>';
    this._selectedAccountCallback = (index) => {
      if (onSelect) onSelect(accounts[index]);
    };

    // Botão de pular: só aparece quando um callback de skip é fornecido.
    const skipBtn = document.getElementById('selectAccountSkipBtn');
    if (skipBtn) {
      if (typeof onSkip === 'function') {
        skipBtn.style.display = '';
        this._skipAccountCallback = () => {
          App.ui.closeModal('modalSelectAccount');
          onSkip();
        };
      } else {
        skipBtn.style.display = 'none';
        this._skipAccountCallback = null;
      }
    }

    App.ui.openModal('modalSelectAccount');
  },

  exportCSV(filename, headers, data) {
    const BOM = '\uFEFF';
    const escCell = (App.math && typeof App.math.sanitizeCsvCell === 'function')
      ? App.math.sanitizeCsvCell
      : (v => `"${String(v ?? '').replace(/"/g, '""')}"`);
    let csv = BOM + headers.map(h => escCell(h)).join(';') + '\n';
    data.forEach(row => { csv += row.map(v => escCell(v)).join(';') + '\n'; });
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  },

  async capturePageAsPNG(elementIdOrElement, filename, options = {}) {
    const { fullScreen = false } = options;

    const element = fullScreen
      ? document.body
      : (typeof elementIdOrElement === 'string'
          ? document.getElementById(elementIdOrElement)
          : elementIdOrElement);

    if (!element) {
      App.utils.showToast('Elemento não encontrado.', 'error');
      return;
    }
    if (typeof html2canvas === 'undefined') {
      App.utils.showToast('Biblioteca html2canvas não carregada.', 'error');
      return;
    }

    App.utils.showToast('Gerando imagem...');

    // Guarda estilos originais para restaurar depois
    const restore = [];
    const hideTemporarily = (el) => {
      if (!el) return;
      const prev = el.style.visibility;
      el.style.visibility = 'hidden';
      restore.push(() => { el.style.visibility = prev; });
    };

    // Se for captura de tela inteira, esconde elementos flutuantes/efêmeros
    if (fullScreen) {
      hideTemporarily(document.getElementById('fabContainer'));
      hideTemporarily(document.getElementById('toast'));
      hideTemporarily(document.querySelector('.mobile-menu-btn'));
      hideTemporarily(document.getElementById('globalAlertBell'));
      hideTemporarily(document.getElementById('themeToggle'));
      hideTemporarily(document.getElementById('globalSearchContainer'));
      hideTemporarily(document.querySelector('.sidebar-toggle-floating'));
      hideTemporarily(document.getElementById('alertDropdown'));
    }

    try {
      const isLight = document.body.classList.contains('light-mode');
      const bgColor = isLight ? '#e0e0e0' : '#0a0a0a';

      // Calcula a largura/altura reais da página inteira
      const width = fullScreen
        ? Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth)
        : undefined;
      const height = fullScreen
        ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight)
        : undefined;

      const canvas = await html2canvas(element, {
        backgroundColor: bgColor,
        scale: window.devicePixelRatio > 1 ? window.devicePixelRatio * 2 : 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        imageTimeout: 20000,
        width: width,
        height: height,
        windowWidth: width,
        windowHeight: height,
        scrollX: 0,
        scrollY: -window.scrollY,
        onclone: (clonedDoc) => {
          const clonedEl = element.id
            ? clonedDoc.getElementById(element.id)
            : clonedDoc.body;
          if (clonedEl) {
            clonedEl.style.display = 'block';
            clonedEl.style.overflow = 'visible';
            clonedEl.style.maxHeight = 'none';
          }

          // Se for captura de tela inteira, garante que a sidebar e o main
          // fiquem em suas posições fixas na imagem final
          if (fullScreen) {
            const clonedBody = clonedDoc.body;
            if (clonedBody) {
              clonedBody.style.overflow = 'visible';
              clonedBody.style.height = 'auto';
            }
            const clonedSidebar = clonedDoc.getElementById('sidebar');
            if (clonedSidebar) {
              clonedSidebar.style.position = 'absolute';
              clonedSidebar.style.top = '0';
              clonedSidebar.style.left = '0';
              clonedSidebar.style.height = '100%';
            }
            const clonedMain = clonedDoc.getElementById('mainContent');
            if (clonedMain) {
              clonedMain.style.minHeight = '100%';
            }
          }

          // Converte selects para spans estáticos
          clonedDoc.querySelectorAll('select').forEach(sel => {
            const span = clonedDoc.createElement('span');
            span.textContent = sel.options[sel.selectedIndex]?.text || '';
            span.style.cssText = 'display:inline-block; padding:6px 10px;';
            sel.parentNode?.replaceChild(span, sel);
          });

          // Esconde modais abertos que possam ter sido clonados
          clonedDoc.querySelectorAll('.modal-overlay').forEach(m => {
            if (!m.classList.contains('open')) m.style.display = 'none';
          });
        }
      });

      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = filename || `captura_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.png`;
      a.href = dataUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      App.utils.showToast('Imagem gerada!');
    } catch (e) {
      console.error('Erro ao gerar PNG:', e);
      App.utils.showToast('Erro ao gerar imagem.', 'error');
    } finally {
      restore.forEach(fn => fn());
    }
  },

  async ensureCategory(categoryName) {
    if (!categoryName || categoryName === 'Outros') return;
    const cats = App.cache.categories || await App.db.getAll('categories');
    if (!App.cache.categories) App.cache.categories = cats;
    const exists = cats.some(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (!exists) {
      const classification = App.config.CLASSIFICATION_MAP[categoryName] || 'necessary';
      const color = App.config.CAT_COLORS[categoryName] || App.config.COLORS[Math.floor(Math.random() * App.config.COLORS.length)];
      await App.db.put('categories', {
        id: App.utils.generateId(),
        name: categoryName,
        type: 'expense',
        classification,
        parent_id: null,
        color,
        archived: false
      });
      App.cache.categories = null;
    }
  },

  escapeHtml(str) {
    if (App.math && typeof App.math.escapeHtml === 'function') {
      return App.math.escapeHtml(str);
    }
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _chartDataLabelsReady: false,
  getChartDataLabelsPlugin() {
    if (typeof ChartDataLabels === 'undefined') return [];
    return [ChartDataLabels];
  },

  registerChartDataLabelsOnce() {
    if (this._chartDataLabelsReady) return true;
    if (typeof Chart === 'undefined' || typeof ChartDataLabels === 'undefined') return false;
    try {
      const registered = Chart.registry && Chart.registry.plugins && Chart.registry.plugins.get('datalabels');
      if (!registered && typeof Chart.register === 'function') {
        Chart.register(ChartDataLabels);
      }
      Chart.defaults.plugins = Chart.defaults.plugins || {};
      Chart.defaults.plugins.datalabels = Object.assign({ display: false }, Chart.defaults.plugins.datalabels || {});
      this._chartDataLabelsReady = true;
      return true;
    } catch (e) {
      return false;
    }
  }
};