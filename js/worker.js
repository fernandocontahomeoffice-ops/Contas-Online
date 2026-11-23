// =======================================================================
// Web Worker – Importação de transações em background
// =======================================================================

// Configurações do banco de dados (idênticas ao db-schema.js principal)
const DB_NAME = 'ContasOnlineDB';
const DB_VERSION = 34;

/**
 * Abre a conexão com o IndexedDB.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function(event) {
      const db = event.target.result;

      // Cria a object store de transações, se não existir
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('date', 'date', { unique: false });
        txStore.createIndex('type', 'type', { unique: false });
        txStore.createIndex('account_id', 'account_id', { unique: false });
        txStore.createIndex('account_to_id', 'account_to_id', { unique: false });
        txStore.createIndex('member_id', 'member_id', { unique: false });
        txStore.createIndex('credit_card_id', 'credit_card_id', { unique: false });
        txStore.createIndex('installment_id', 'installment_id', { unique: false });
        txStore.createIndex('status', 'status', { unique: false });
        txStore.createIndex('reconciled', 'reconciled', { unique: false });
        txStore.createIndex('ignore_from_total', 'ignore_from_total', { unique: false });
      }

      // Garante que todas as demais stores existam
      const stores = [
        'accounts', 'categories', 'investments', 'patrimony', 'members',
        'creditCards', 'goals', 'wishes', 'receipts', 'budgets', 'loans',
        'transactionTemplates', 'investmentHistory', 'accountHistory',
        'creditLimitHistory', 'notifications', 'receiptFolders',
        'vehicles', 'vehicleExpenses', 'previdencia', 'fontesPagadoras',
        'planosOrcamentarios', 'indicatorHistory', 'manualIncomes', 'locais', 'payrolls'
      ];
      stores.forEach(function(storeName) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      });
    };

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      if (event.target.error && event.target.error.name === 'VersionError') {
        const fallbackReq = indexedDB.open(DB_NAME);
        fallbackReq.onsuccess = function(ev) { resolve(ev.target.result); };
        fallbackReq.onerror = function(ev) { reject(ev.target.error); };
        return;
      }
      reject(event.target.error);
    };
  });
}

/**
 * Insere vários itens em uma única transação (putMany).
 * @param {IDBDatabase} db - Conexão aberta com o banco.
 * @param {string} storeName - Nome da object store.
 * @param {Array} items - Lista de objetos a serem persistidos.
 * @returns {Promise<number>} - Quantidade de itens inseridos.
 */
function putMany(db, storeName, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      store.put(items[i]);
      count++;
    }
    tx.oncomplete = function() {
      resolve(count);
    };
    tx.onerror = function(event) {
      reject(event.target.error);
    };
  });
}

// Estado interno do Worker
let db = null;               // Conexão com o banco
let cancelled = false;       // Flag de cancelamento
let totalBatches = 0;        // Total de lotes esperados
let processedBatches = 0;    // Lotes já processados
let totalTransactions = 0;   // Total de transações informado
let processedTransactions = 0; // Total de transações inseridas

/**
 * Processa um lote de transações.
 * @param {Array} batch - Array de objetos de transação.
 * @param {number} batchIndex - Índice do lote (0‑based).
 */
async function processBatch(batch, batchIndex) {
  if (cancelled) return;

  try {
    // Normaliza campos opcionais (mesma lógica da interface)
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      if (!item.id) {
        item.id = 'wrk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      }
      if (item.ignore_from_total === undefined) item.ignore_from_total = false;
      if (!item.credit_card_id) item.credit_card_id = null;
      if (!item.account_to_id) item.account_to_id = null;
      if (!item.account_to_name) item.account_to_name = null;
      if (item.installments === undefined) item.installments = 1;
      if (item.installment_number === undefined) item.installment_number = 1;
      if (item.recurring === undefined) item.recurring = false;
      if (item.vacation === undefined) item.vacation = false;
      if (item.status === undefined) item.status = 'confirmed';
      if (item.reconciled === undefined) item.reconciled = false;
    }

    await putMany(db, 'transactions', batch);
    processedTransactions += batch.length;
    processedBatches++;

    // Envia progresso para a página principal
    self.postMessage({
      type: 'progress',
      current: processedTransactions,
      total: totalTransactions,
      batchIndex: batchIndex,
      batchSize: batch.length
    });

    // Se todos os lotes foram processados, envia sinal de conclusão
    if (processedBatches >= totalBatches) {
      self.postMessage({ type: 'complete' });
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
}

// Escuta mensagens vindas da interface principal
self.onmessage = async function(event) {
  const msg = event.data;

  if (msg.type === 'importBatch') {
    // Inicializa o banco na primeira chamada
    if (!db) {
      try {
        db = await openDB();
      } catch (err) {
        self.postMessage({ type: 'error', error: 'Falha ao abrir banco: ' + err.message });
        return;
      }
    }

    // Configura contadores na primeira leva
    if (msg.batchIndex === 0) {
      cancelled = false;
      totalBatches = msg.totalBatches;
      totalTransactions = msg.totalTransactions;
      processedBatches = 0;
      processedTransactions = 0;
    }

    // Processa o lote recebido
    await processBatch(msg.batch, msg.batchIndex);

  } else if (msg.type === 'cancel') {
    // Cancela o processamento
    cancelled = true;
    self.postMessage({ type: 'cancelled' });
  }
};

// Informa que o Worker está pronto (opcional, para depuração)
self.postMessage({ type: 'ready' });