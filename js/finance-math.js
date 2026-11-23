// =====================================================================
// ARQUIVO: finance-math.js
// Funções puras de cálculo financeiro e sanitização (Browser + Node tests)
// =====================================================================
(function (root) {
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeCsvCell(val) {
    const raw = String(val ?? '');
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function roundCurrency(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  function calcClassificationSplits(transactions, totalIncome) {
    const totals = {
      essential: 0,
      necessary: 0,
      superfluous: 0,
      investments: 0
    };

    for (const tx of transactions || []) {
      if (!tx || tx.ignore_from_total) continue;
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'contribution') {
        totals.investments += amt;
      } else if (tx.type === 'expense') {
        const key = tx.classification;
        if (key === 'essential' || key === 'necessary' || key === 'superfluous') {
          totals[key] += amt;
        } else {
          totals.necessary += amt;
        }
      }
    }

    const base = totalIncome > 0 ? totalIncome : 0;
    return {
      essential: roundCurrency(totals.essential),
      necessary: roundCurrency(totals.necessary),
      superfluous: roundCurrency(totals.superfluous),
      investments: roundCurrency(totals.investments),
      pct: {
        essential: base > 0 ? roundCurrency((totals.essential / base) * 100) : 0,
        necessary: base > 0 ? roundCurrency((totals.necessary / base) * 100) : 0,
        superfluous: base > 0 ? roundCurrency((totals.superfluous / base) * 100) : 0,
        investments: base > 0 ? roundCurrency((totals.investments / base) * 100) : 0
      }
    };
  }

  function calcInstallmentSchedule(totalAmount, count, startDateISO) {
    const totalCents = Math.round((Number(totalAmount) || 0) * 100);
    const n = Math.max(1, parseInt(count, 10) || 1);
    const baseCents = Math.floor(totalCents / n);
    const remainder = totalCents - baseCents * n;

    const [y, m, d] = String(startDateISO || new Date().toISOString().slice(0, 10))
      .slice(0, 10)
      .split('-')
      .map(Number);

    const schedule = [];
    for (let i = 0; i < n; i++) {
      const target = new Date(Date.UTC(y, (m - 1) + i, 1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      const day = Math.min(d || 1, lastDay);
      const dateStr = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cents = baseCents + (i === 0 ? remainder : 0);
      schedule.push({
        installmentNumber: i + 1,
        installments: n,
        date: dateStr,
        amount: cents / 100
      });
    }
    return schedule;
  }

  function calcAccountBalanceFromTx(initialBalance, transactions, accountId) {
    let balance = Number(initialBalance) || 0;
    for (const t of transactions || []) {
      if (!t || t.status !== 'confirmed') continue;
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income' || t.type === 'refund') {
        if (t.account_id === accountId) balance += amt;
      } else if (t.type === 'expense') {
        if (t.account_id === accountId && !t.credit_card_id) balance -= amt;
      } else if (t.type === 'transfer' || t.type === 'contribution' || t.type === 'withdrawal') {
        if (t.account_id === accountId) balance -= amt;
        if (t.account_to_id === accountId) balance += amt;
      }
    }
    return roundCurrency(balance);
  }

  const api = {
    escapeHtml,
    sanitizeCsvCell,
    roundCurrency,
    calcClassificationSplits,
    calcInstallmentSchedule,
    calcAccountBalanceFromTx
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.App = root.App || {};
    root.App.math = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
