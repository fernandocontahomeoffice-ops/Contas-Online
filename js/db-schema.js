// =====================================================================
// ARQUIVO: db-schema.js
// Fonte única de verdade para nome, versão e object stores do IndexedDB
// =====================================================================
(function (root) {
  const schema = {
    DB_NAME: 'ContasOnlineDB',
    DB_VERSION: 34,
    TRANSACTION_INDEXES: [
      'date',
      'type',
      'account_id',
      'account_to_id',
      'member_id',
      'credit_card_id',
      'installment_id',
      'status',
      'reconciled',
      'ignore_from_total'
    ],
    STORES: [
      'accounts',
      'categories',
      'investments',
      'patrimony',
      'members',
      'creditCards',
      'goals',
      'wishes',
      'receipts',
      'budgets',
      'loans',
      'transactionTemplates',
      'investmentHistory',
      'accountHistory',
      'creditLimitHistory',
      'notifications',
      'receiptFolders',
      'vehicles',
      'vehicleExpenses',
      'previdencia',
      'fontesPagadoras',
      'planosOrcamentarios',
      'indicatorHistory',
      'manualIncomes',
      'locais',
      'payrolls'
    ]
  };

  schema.ALL_STORES = ['transactions', ...schema.STORES];

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = schema;
  }
  if (root) {
    root.App = root.App || {};
    root.App.dbSchema = schema;
  }
})(typeof window !== 'undefined' ? window : globalThis);
