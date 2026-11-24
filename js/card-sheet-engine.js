// =====================================================================
// ARQUIVO: card-sheet-engine.js
// Engine pura para a Planilha Online de Cartão de Crédito (testecartao.xlsx)
// Parsing de Excel/TSV/CSV, normalização de colunas, parcelas, divisão
// entre membros, detecção de duplicatas e validação segura de URL GitHub.
// =====================================================================
(function (root) {
  const DEFAULT_FILENAME = 'testecartao.xlsx';

  const CANONICAL_HEADERS = [
    'Data',
    'Hora',
    'Descrição',
    'Categoria',
    'Classificação',
    'Membro',
    'Parcelas',
    'Valor'
  ];

  const HEADER_ALIASES = {
    data: 'date',
    date: 'date',
    dt: 'date',
    datacompra: 'date',
    hora: 'time',
    time: 'time',
    horario: 'time',
    descricao: 'description',
    description: 'description',
    desc: 'description',
    estabelecimento: 'description',
    historico: 'description',
    lancamento: 'description',
    titulo: 'description',
    categoria: 'category',
    category: 'category',
    cat: 'category',
    classificacao: 'classification',
    classification: 'classification',
    class: 'classification',
    membro: 'member',
    member: 'member',
    membername: 'member',
    responsavel: 'member',
    pessoa: 'member',
    titular: 'member',
    parcelas: 'installments',
    installments: 'installments',
    parcela: 'installments',
    qtdparcelas: 'installments',
    vezes: 'installments',
    valor: 'amount',
    amount: 'amount',
    value: 'amount',
    total: 'amount',
    preco: 'amount',
    tipo: 'type',
    type: 'type',
    cartao: 'card',
    card: 'card',
    creditcard: 'card'
  };

  function stripAccents(str) {
    return String(str ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeHeaderToken(header) {
    return stripAccents(header)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function mapHeaderKey(header) {
    const token = normalizeHeaderToken(header);
    return HEADER_ALIASES[token] || null;
  }

  function roundCurrency(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function addMonthsISO(dateISO, monthsToAdd) {
    const clean = String(dateISO || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const [y, m, d] = clean.split('-').map(Number);
    const target = new Date(Date.UTC(y, (m - 1) + Number(monthsToAdd || 0), 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    const day = Math.min(d || 1, lastDay);
    return `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-${pad2(day)}`;
  }

  function excelSerialToDateISO(serial) {
    const num = Number(serial);
    if (!Number.isFinite(num) || num < 1 || num > 2958465) return '';
    // Excel epoch: 1899-12-30 (accounts for 1900 leap year bug)
    const wholeDays = Math.floor(num);
    const utcMs = Date.UTC(1899, 11, 30) + wholeDays * 86400000;
    const dt = new Date(utcMs);
    if (Number.isNaN(dt.getTime())) return '';
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  }

  function normalizeDateCell(raw, fallbackDate = '') {
    if (raw == null || raw === '') return fallbackDate;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
    }
    const str = String(raw).trim();
    if (!str) return fallbackDate;

    // ISO date or ISO datetime
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]);
      const d = Number(isoMatch[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
      }
    }

    // Brazilian DD/MM/YYYY or DD-MM-YYYY (also supports 2-digit year DD/MM/YY)
    const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (brMatch) {
      const d = Number(brMatch[1]);
      const m = Number(brMatch[2]);
      let y = Number(brMatch[3]);
      if (y < 100) y += y >= 70 ? 1900 : 2000;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
      }
    }

    // Numeric Excel serial date
    if (/^\d+(\.\d+)?$/.test(str)) {
      const serialIso = excelSerialToDateISO(parseFloat(str));
      if (serialIso) return serialIso;
    }

    return fallbackDate;
  }

  function normalizeTimeCell(raw) {
    if (raw == null || raw === '') return '';
    const str = String(raw).trim();
    if (!str) return '';

    // Excel fractional day (e.g., 0.5 => 12:00:00) or full serial with fractional part
    if (/^\d*(\.\d+)$/.test(str) || str === '0') {
      const num = parseFloat(str);
      if (Number.isFinite(num) && num >= 0) {
        const frac = num >= 1 ? (num - Math.floor(num)) : num;
        const totalSeconds = Math.round(frac * 86400) % 86400;
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
      }
    }

    const hmMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hmMatch) {
      const h = Number(hmMatch[1]);
      const m = Number(hmMatch[2]);
      const s = hmMatch[3] != null ? Number(hmMatch[3]) : 0;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
        return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
      }
    }

    return '';
  }

  function combineDateAndTime(dateISO, timeNormalized) {
    const d = normalizeDateCell(dateISO, '');
    if (!d) return '';
    const t = normalizeTimeCell(timeNormalized);
    return t ? `${d}T${t}` : d;
  }

  function parseAmountBR(raw) {
    if (raw == null || raw === '') return NaN;
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? roundCurrency(raw) : NaN;
    }
    let s = String(raw).trim();
    if (!s) return NaN;

    let isAccountingNeg = false;
    if (/^\(.*\)$/.test(s)) {
      isAccountingNeg = true;
      s = s.slice(1, -1).trim();
    }

    // Remove currency symbols and spaces
    s = s.replace(/R\$/gi, '').replace(/\s+/g, '');

    // Keep sign
    let sign = 1;
    if (s.startsWith('-')) {
      sign = -1;
      s = s.slice(1);
    } else if (s.startsWith('+')) {
      s = s.slice(1);
    }
    if (isAccountingNeg) sign = -1;

    // Strip any stray non-numeric characters except . and ,
    s = s.replace(/[^0-9.,]/g, '');
    if (!s) return NaN;

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');

    if (hasComma && hasDot) {
      // Determine decimal separator by last occurrence
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        // Brazilian: 1.234,56
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        // US: 1,234.56
        s = s.replace(/,/g, '');
      }
    } else if (hasComma) {
      const parts = s.split(',');
      if (parts.length === 2 && parts[1].length <= 2) {
        s = `${parts[0]}.${parts[1]}`;
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (hasDot) {
      const parts = s.split('.');
      // If multiple dots like 1.234.567 -> thousands separators
      if (parts.length > 2) {
        s = s.replace(/\./g, '');
      }
    }

    const parsed = parseFloat(s);
    if (!Number.isFinite(parsed)) return NaN;
    return roundCurrency(sign * parsed);
  }

  function formatAmountInput(value) {
    const num = typeof value === 'number' ? value : parseAmountBR(value);
    if (!Number.isFinite(num)) return '';
    return num.toFixed(2).replace('.', ',');
  }

  function normalizeClassification(raw) {
    if (!raw) return '';
    const token = stripAccents(raw)
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (token.includes('essenc') || token === 'essential') return 'essential';
    if (token.includes('necess') || token === 'necessary') return 'necessary';
    if (token.includes('superflu') || token === 'superfluous') return 'superfluous';
    return '';
  }

  function classificationToLabel(code) {
    if (code === 'essential') return 'Essencial';
    if (code === 'necessary') return 'Necessário';
    if (code === 'superfluous') return 'Supérfluo';
    return '';
  }

  function isSplitMemberLabel(raw) {
    const token = stripAccents(raw).toLowerCase().trim();
    return token === 'compra dividida' || token === 'transacao dividida' || token === 'dividida' || token === 'split';
  }

  function parseInstallments(raw) {
    if (raw == null || raw === '') return 1;
    const str = String(raw).trim();
    // Handles "3", "3x", "01/03" (extracts denominator if x/y, otherwise first int)
    const slashMatch = str.match(/^\d+\s*\/\s*(\d+)$/);
    if (slashMatch) {
      return Math.min(48, Math.max(1, parseInt(slashMatch[1], 10) || 1));
    }
    const numMatch = str.match(/(\d+)/);
    if (!numMatch) return 1;
    return Math.min(48, Math.max(1, parseInt(numMatch[1], 10) || 1));
  }

  function resolveTxTypeAndAmount(rawAmount, convention = 'excel_signed', explicitType = '') {
    const parsed = parseAmountBR(rawAmount);
    if (!Number.isFinite(parsed) || parsed === 0) {
      return { valid: false, txType: 'expense', amount: 0, signedAmount: NaN };
    }
    const expType = stripAccents(explicitType).toLowerCase().trim();
    let txType;
    if (expType === 'refund' || expType === 'estorno' || expType === 'credito') {
      txType = 'refund';
    } else if (expType === 'expense' || expType === 'despesa' || expType === 'debito') {
      txType = 'expense';
    } else if (convention === 'positive_expense') {
      txType = parsed > 0 ? 'expense' : 'refund';
    } else {
      // Exact testecartao.xlsx / App.cardInvoice.importXLSX rule: negative = expense, positive = refund
      txType = parsed < 0 ? 'expense' : 'refund';
    }
    return {
      valid: true,
      txType,
      amount: roundCurrency(Math.abs(parsed)),
      signedAmount: parsed
    };
  }

  function createEmptyRow(overrides = {}) {
    const id = overrides.rowId || `srow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    return {
      rowId: id,
      date: overrides.date != null ? overrides.date : '',
      time: overrides.time != null ? overrides.time : '',
      description: overrides.description != null ? overrides.description : '',
      category: overrides.category != null ? overrides.category : '',
      classification: overrides.classification != null ? normalizeClassification(overrides.classification) : '',
      member: overrides.member != null ? overrides.member : '',
      installments: overrides.installments != null ? parseInstallments(overrides.installments) : 1,
      amount: overrides.amount != null ? overrides.amount : '',
      memberSplits: Array.isArray(overrides.memberSplits) ? overrides.memberSplits : null,
      syncedTxIds: Array.isArray(overrides.syncedTxIds) ? overrides.syncedTxIds : [],
      syncState: overrides.syncState || 'draft', // draft | pending | synced | duplicate | error
      syncMessage: overrides.syncMessage || '',
      forceDuplicate: Boolean(overrides.forceDuplicate),
      lastSyncedHash: overrides.lastSyncedHash || ''
    };
  }

  function isRowBlank(row) {
    if (!row) return true;
    const desc = String(row.description || '').trim();
    const amt = String(row.amount || '').trim();
    const cat = String(row.category || '').trim();
    const mem = String(row.member || '').trim();
    return !desc && !amt && !cat && !mem;
  }

  function computeRowFingerprint(row, cardId, convention = 'excel_signed') {
    return JSON.stringify({
      cardId: cardId || '',
      convention,
      date: normalizeDateCell(row.date, ''),
      time: normalizeTimeCell(row.time),
      description: String(row.description || '').trim(),
      category: String(row.category || '').trim() || 'Outros',
      classification: normalizeClassification(row.classification),
      member: String(row.member || '').trim(),
      installments: parseInstallments(row.installments),
      amount: parseAmountBR(row.amount),
      memberSplits: row.memberSplits || null
    });
  }

  function buildEqualSplits(totalAmount, members) {
    if (!Array.isArray(members) || members.length === 0) return [];
    const totalCents = Math.round(roundCurrency(totalAmount) * 100);
    const n = members.length;
    const baseCents = Math.floor(totalCents / n);
    const remainder = totalCents - baseCents * n;
    return members.map((m, idx) => ({
      member_id: m.id,
      amount: (baseCents + (idx === n - 1 ? remainder : 0)) / 100
    }));
  }

  function buildTransactionsFromRow(row, options = {}) {
    const {
      card,
      members = [],
      accounts = [],
      convention = 'excel_signed',
      generateId = () => `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      nowISO = new Date().toISOString()
    } = options;

    if (!card || !card.id) {
      return { ok: false, error: 'Selecione um cartão de crédito.', transactions: [] };
    }
    if (isRowBlank(row)) {
      return { ok: false, blank: true, error: '', transactions: [] };
    }

    const dateISO = normalizeDateCell(row.date, '');
    if (!dateISO) {
      return { ok: false, error: 'Informe uma data válida (DD/MM/AAAA ou AAAA-MM-DD).', transactions: [] };
    }

    const description = String(row.description || '').trim();
    if (!description) {
      return { ok: false, error: 'Informe a descrição do lançamento.', transactions: [] };
    }

    const amtInfo = resolveTxTypeAndAmount(row.amount, convention, row.explicitType || '');
    if (!amtInfo.valid) {
      return { ok: false, error: 'Valor inválido (use número diferente de zero).', transactions: [] };
    }

    const timeNorm = normalizeTimeCell(row.time);
    const fullDate = timeNorm ? `${dateISO}T${timeNorm}` : dateISO;
    const category = String(row.category || '').trim() || 'Outros';
    const classification = normalizeClassification(row.classification);
    const installments = parseInstallments(row.installments);
    const totalAmount = amtInfo.amount;
    const txType = amtInfo.txType;

    const accountName = card.account_id
      ? (accounts.find(a => a.id === card.account_id)?.name || '')
      : '';

    const rawMember = String(row.member || '').trim();
    const isSplit = isSplitMemberLabel(rawMember);

    let resolvedMemberId = '';
    let resolvedMemberName = '';
    let resolvedSplitsTotal = null;

    if (isSplit) {
      if (members.length === 0) {
        return { ok: false, error: 'Cadastre membros para usar "Compra dividida".', transactions: [] };
      }
      if (Array.isArray(row.memberSplits) && row.memberSplits.length > 0) {
        const cleaned = row.memberSplits
          .map(s => ({ member_id: s.member_id, amount: roundCurrency(parseFloat(s.amount) || 0) }))
          .filter(s => s.member_id && s.amount > 0);
        const sum = roundCurrency(cleaned.reduce((acc, s) => acc + s.amount, 0));
        if (cleaned.length > 0 && Math.abs(sum - totalAmount) <= 0.02) {
          resolvedSplitsTotal = cleaned;
        } else {
          // Rescale or reset proportionally to current totalAmount
          resolvedSplitsTotal = buildEqualSplits(totalAmount, members);
        }
      } else {
        resolvedSplitsTotal = buildEqualSplits(totalAmount, members);
      }
      const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
      resolvedMemberId = null;
      resolvedMemberName = resolvedSplitsTotal.map(s => memberMap[s.member_id] || s.member_id).join(' + ');
    } else if (rawMember) {
      const found = members.find(m =>
        m.id === rawMember ||
        stripAccents(m.name).toLowerCase().trim() === stripAccents(rawMember).toLowerCase().trim()
      );
      if (!found) {
        return { ok: false, error: `Membro "${rawMember}" não encontrado.`, transactions: [] };
      }
      resolvedMemberId = found.id;
      resolvedMemberName = found.name;
    } else if (card.member_id) {
      const cardMember = members.find(m => m.id === card.member_id);
      resolvedMemberId = card.member_id;
      resolvedMemberName = cardMember ? cardMember.name : '';
    }

    // Reuse existing transaction IDs when installment count matches to keep updates clean
    const existingIds = Array.isArray(row.syncedTxIds) ? row.syncedTxIds : [];
    const totalCents = Math.round(totalAmount * 100);
    const baseCents = Math.floor(totalCents / installments);
    const remainderCents = totalCents - baseCents * installments;
    const groupId = installments > 1 ? `sgrp_${row.rowId}` : null;

    const splitRatios = resolvedSplitsTotal
      ? resolvedSplitsTotal.map(s => ({ member_id: s.member_id, ratio: s.amount / totalAmount }))
      : null;

    const transactions = [];
    for (let p = 0; p < installments; p++) {
      // Last installment gets remainder cents (matches existing App.cardInvoice.importXLSX)
      const parcelCents = baseCents + (p === installments - 1 ? remainderCents : 0);
      const parcelAmount = parcelCents / 100;
      const shiftedDate = addMonthsISO(dateISO, p);
      const parcelDate = timeNorm ? `${shiftedDate}T${timeNorm}` : shiftedDate;

      let parcelMemberSplits = undefined;
      if (splitRatios) {
        parcelMemberSplits = [];
        let sumParts = 0;
        for (let i = 0; i < splitRatios.length; i++) {
          const part = roundCurrency(parcelAmount * splitRatios[i].ratio);
          parcelMemberSplits.push({ member_id: splitRatios[i].member_id, amount: part });
          sumParts = roundCurrency(sumParts + part);
        }
        if (parcelMemberSplits.length > 0) {
          const diff = roundCurrency(parcelAmount - sumParts);
          parcelMemberSplits[parcelMemberSplits.length - 1].amount = roundCurrency(
            parcelMemberSplits[parcelMemberSplits.length - 1].amount + diff
          );
        }
      }

      const txId = (existingIds.length === installments && existingIds[p])
        ? existingIds[p]
        : generateId();

      const tx = {
        id: txId,
        type: txType,
        amount: parcelAmount,
        category,
        description,
        date: parcelDate,
        account_id: card.account_id || null,
        account_name: accountName,
        account_to_id: null,
        account_to_name: null,
        member_id: resolvedMemberId,
        member_name: resolvedMemberName,
        credit_card_id: card.id,
        payment_method: 'credit_card',
        classification,
        receipt_url: '',
        investment_id: null,
        purchase_date: installments > 1 ? dateISO : '',
        installment_id: groupId,
        installments,
        installment_number: p + 1,
        recurring: false,
        vacation: false,
        status: 'pending',
        reconciled: false,
        ignore_from_total: false,
        createdAt: nowISO,
        sheet_row_id: row.rowId,
        sheet_source: DEFAULT_FILENAME
      };

      if (parcelMemberSplits) {
        tx.member_splits = parcelMemberSplits;
      }

      transactions.push(tx);
    }

    return { ok: true, error: '', transactions, txType, totalAmount, isSplit };
  }

  function findDuplicateTransactions(candidateTxs, existingTxs, ownedTxIds = []) {
    const ownedSet = new Set(ownedTxIds || []);
    const duplicates = [];
    for (const cand of candidateTxs || []) {
      const match = (existingTxs || []).find(ex => {
        if (!ex || ownedSet.has(ex.id)) return false;
        if (ex.sheet_row_id && cand.sheet_row_id && ex.sheet_row_id === cand.sheet_row_id) return false;
        if (ex.credit_card_id !== cand.credit_card_id) return false;
        if (ex.type !== cand.type) return false;
        if (String(ex.description || '').trim().toLowerCase() !== String(cand.description || '').trim().toLowerCase()) return false;
        if (Math.abs((parseFloat(ex.amount) || 0) - (parseFloat(cand.amount) || 0)) >= 0.005) return false;
        if (String(ex.date || '').slice(0, 10) !== String(cand.date || '').slice(0, 10)) return false;
        return true;
      });
      if (match) duplicates.push({ candidate: cand, existing: match });
    }
    return duplicates;
  }

  function detectHeaderRow(firstRow) {
    if (!Array.isArray(firstRow)) return null;
    const mapping = {};
    let recognized = 0;
    firstRow.forEach((cell, idx) => {
      const key = mapHeaderKey(cell);
      if (key && mapping[key] === undefined) {
        mapping[key] = idx;
        recognized++;
      }
    });
    return recognized >= 2 ? mapping : null;
  }

  function parseWorkbookMatrix(matrix, options = {}) {
    const { defaultDate = '', convention = 'excel_signed' } = options;
    if (!Array.isArray(matrix) || matrix.length === 0) {
      return { rows: [], detectedHeaders: null, skippedEmpty: 0 };
    }

    let startIndex = 0;
    let colMap = detectHeaderRow(matrix[0]);
    if (colMap) {
      startIndex = 1;
    } else {
      // Positional fallback matching CANONICAL_HEADERS:
      // Data | Hora | Descrição | Categoria | Classificação | Membro | Parcelas | Valor
      colMap = {
        date: 0,
        time: 1,
        description: 2,
        category: 3,
        classification: 4,
        member: 5,
        installments: 6,
        amount: 7
      };
    }

    const rows = [];
    let skippedEmpty = 0;
    for (let i = startIndex; i < matrix.length; i++) {
      const rawRow = Array.isArray(matrix[i]) ? matrix[i] : [];
      const nonEmpty = rawRow.filter(v => v != null && String(v).trim() !== '').length;
      if (nonEmpty === 0) {
        skippedEmpty++;
        continue;
      }

      const pick = (key) => {
        const idx = colMap[key];
        if (idx === undefined || idx < 0 || idx >= rawRow.length) return '';
        return rawRow[idx] != null ? rawRow[idx] : '';
      };

      const rawDate = pick('date');
      const rawTime = pick('time');
      const rawDesc = String(pick('description') || '').trim();
      const rawCat = String(pick('category') || '').trim();
      const rawClass = String(pick('classification') || '').trim();
      const rawMember = String(pick('member') || '').trim();
      const rawInst = pick('installments');
      const rawAmt = pick('amount');
      const rawType = String(pick('type') || '').trim();

      const dateISO = normalizeDateCell(rawDate, defaultDate);
      const timeNorm = normalizeTimeCell(rawTime);
      const parsedAmt = parseAmountBR(rawAmt);
      let amountStr = Number.isFinite(parsedAmt) ? formatAmountInput(parsedAmt) : String(rawAmt || '').trim();

      // Respect explicit type column if present and amount had no sign
      if (rawType && Number.isFinite(parsedAmt) && parsedAmt > 0) {
        const tNorm = stripAccents(rawType).toLowerCase();
        if (convention === 'excel_signed' && (tNorm === 'expense' || tNorm === 'despesa' || tNorm === 'debito')) {
          amountStr = formatAmountInput(-Math.abs(parsedAmt));
        }
      }

      rows.push(createEmptyRow({
        date: dateISO,
        time: timeNorm ? timeNorm.slice(0, 5) : '',
        description: rawDesc,
        category: rawCat,
        classification: normalizeClassification(rawClass),
        member: rawMember,
        installments: parseInstallments(rawInst),
        amount: amountStr,
        syncState: 'pending'
      }));
    }

    return { rows, detectedHeaders: colMap, skippedEmpty };
  }

  function parseClipboardTable(text, options = {}) {
    const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!raw) return { rows: [], hasHeaders: false };
    const lines = raw.split('\n').filter(line => line.trim() !== '');
    if (!lines.length) return { rows: [], hasHeaders: false };

    const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
    const matrix = lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, '')));
    const hasHeaders = Boolean(detectHeaderRow(matrix[0]));
    const parsed = parseWorkbookMatrix(matrix, options);
    return { rows: parsed.rows, hasHeaders };
  }

  function buildExportMatrix(rows, options = {}) {
    const { convention = 'excel_signed' } = options;
    const out = [CANONICAL_HEADERS.slice()];
    for (const row of rows || []) {
      if (isRowBlank(row)) continue;
      const dateISO = normalizeDateCell(row.date, '');
      const dateBR = dateISO ? `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}/${dateISO.slice(0, 4)}` : '';
      const timeNorm = normalizeTimeCell(row.time);
      const amtInfo = resolveTxTypeAndAmount(row.amount, convention);
      // Always export with testecartao.xlsx / importXLSX standard: negative = expense, positive = refund
      const excelAmount = amtInfo.valid
        ? (amtInfo.txType === 'expense' ? -amtInfo.amount : amtInfo.amount)
        : 0;

      out.push([
        dateBR,
        timeNorm ? timeNorm.slice(0, 5) : '',
        String(row.description || '').trim(),
        String(row.category || '').trim() || 'Outros',
        classificationToLabel(normalizeClassification(row.classification)),
        String(row.member || '').trim(),
        parseInstallments(row.installments),
        excelAmount
      ]);
    }
    return out;
  }

  function convertTransactionsToSheetRows(transactions, options = {}) {
    const { convention = 'excel_signed' } = options;
    if (!Array.isArray(transactions) || transactions.length === 0) return [];

    // Group installments belonging to the same installment_id or sheet_row_id
    const grouped = new Map();
    const standalone = [];

    for (const tx of transactions) {
      if (!tx || (tx.type !== 'expense' && tx.type !== 'refund')) continue;
      if (tx.category === 'Pagamento Fatura') continue;
      const groupKey = tx.sheet_row_id || tx.installment_id || null;
      if (groupKey && (tx.installments > 1 || tx.sheet_row_id)) {
        if (!grouped.has(groupKey)) grouped.set(groupKey, []);
        grouped.get(groupKey).push(tx);
      } else {
        standalone.push(tx);
      }
    }

    const result = [];
    const buildFromGroup = (txList) => {
      const sorted = [...txList].sort((a, b) => (a.installment_number || 1) - (b.installment_number || 1));
      const first = sorted[0];
      const totalAmount = roundCurrency(sorted.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0));
      const signed = convention === 'positive_expense'
        ? (first.type === 'expense' ? totalAmount : -totalAmount)
        : (first.type === 'expense' ? -totalAmount : totalAmount);

      const dateStr = first.purchase_date || String(first.date || '').slice(0, 10);
      const timeStr = String(first.date || '').includes('T') ? String(first.date).split('T')[1].slice(0, 5) : '';
      const isSplit = Array.isArray(first.member_splits) && first.member_splits.length > 0;

      let memberSplitsTotal = null;
      if (isSplit) {
        const totalsByMember = new Map();
        for (const t of sorted) {
          for (const sp of (t.member_splits || [])) {
            totalsByMember.set(sp.member_id, roundCurrency((totalsByMember.get(sp.member_id) || 0) + (parseFloat(sp.amount) || 0)));
          }
        }
        memberSplitsTotal = [...totalsByMember.entries()].map(([member_id, amount]) => ({ member_id, amount }));
      }

      return createEmptyRow({
        rowId: first.sheet_row_id || `srow_tx_${first.id}`,
        date: normalizeDateCell(dateStr, ''),
        time: timeStr,
        description: first.description || '',
        category: first.category || 'Outros',
        classification: first.classification || '',
        member: isSplit ? 'Compra dividida' : (first.member_name || ''),
        installments: Math.max(sorted.length, first.installments || 1),
        amount: formatAmountInput(signed),
        memberSplits: memberSplitsTotal,
        syncedTxIds: sorted.map(t => t.id),
        syncState: 'synced',
        syncMessage: sorted.length > 1 ? `Sincronizado (${sorted.length}x)` : 'Sincronizado'
      });
    };

    for (const txList of grouped.values()) {
      result.push(buildFromGroup(txList));
    }
    for (const tx of standalone) {
      result.push(buildFromGroup([tx]));
    }

    result.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return result;
  }

  function resolveGithubRawUrl(inputUrl) {
    const raw = String(inputUrl || '').trim();
    if (!raw) {
      return { ok: false, error: 'Informe a URL do arquivo testecartao.xlsx no GitHub.' };
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: 'URL inválida. Use um link HTTPS do GitHub.' };
    }

    if (parsed.protocol !== 'https:') {
      return { ok: false, error: 'Apenas URLs HTTPS do GitHub são permitidas.' };
    }

    const host = parsed.hostname.toLowerCase();
    let finalUrl = '';

    if (host === 'raw.githubusercontent.com') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 4) {
        return { ok: false, error: 'URL raw do GitHub incompleta.' };
      }
      finalUrl = `https://raw.githubusercontent.com/${segments.join('/')}`;
    } else if (host === 'github.com' || host === 'www.github.com') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      // Supports:
      // /owner/repo/blob/branch/path/to/testecartao.xlsx
      // /owner/repo/raw/branch/path/to/testecartao.xlsx
      if (segments.length >= 5 && (segments[2] === 'blob' || segments[2] === 'raw')) {
        const owner = segments[0];
        const repo = segments[1];
        const rest = segments.slice(3).join('/');
        finalUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
      } else {
        return {
          ok: false,
          error: 'Use o link direto do arquivo no GitHub (ex: https://github.com/usuario/repo/blob/main/testecartao.xlsx).'
        };
      }
    } else {
      return {
        ok: false,
        error: 'Apenas links de github.com ou raw.githubusercontent.com são permitidos.'
      };
    }

    if (!/\.(xlsx|xls|csv)$/i.test(finalUrl)) {
      return {
        ok: false,
        error: 'O link precisa apontar para um arquivo .xlsx, .xls ou .csv.'
      };
    }

    return { ok: true, rawUrl: finalUrl };
  }

  function computeSheetTotals(rows, convention = 'excel_signed') {
    let expenses = 0;
    let refunds = 0;
    let syncedCount = 0;
    let pendingCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    let filledCount = 0;

    for (const row of rows || []) {
      if (isRowBlank(row)) continue;
      filledCount++;
      const amtInfo = resolveTxTypeAndAmount(row.amount, convention);
      if (amtInfo.valid) {
        if (amtInfo.txType === 'expense') expenses += amtInfo.amount;
        else refunds += amtInfo.amount;
      }
      if (row.syncState === 'synced') syncedCount++;
      else if (row.syncState === 'error') errorCount++;
      else if (row.syncState === 'duplicate') duplicateCount++;
      else pendingCount++;
    }

    expenses = roundCurrency(expenses);
    refunds = roundCurrency(refunds);
    const net = roundCurrency(expenses - refunds);

    return {
      expenses,
      refunds,
      net,
      filledCount,
      syncedCount,
      pendingCount,
      errorCount,
      duplicateCount
    };
  }

  const api = {
    DEFAULT_FILENAME,
    CANONICAL_HEADERS,
    mapHeaderKey,
    normalizeDateCell,
    normalizeTimeCell,
    combineDateAndTime,
    addMonthsISO,
    parseAmountBR,
    formatAmountInput,
    normalizeClassification,
    classificationToLabel,
    isSplitMemberLabel,
    parseInstallments,
    resolveTxTypeAndAmount,
    createEmptyRow,
    isRowBlank,
    computeRowFingerprint,
    buildEqualSplits,
    buildTransactionsFromRow,
    findDuplicateTransactions,
    detectHeaderRow,
    parseWorkbookMatrix,
    parseClipboardTable,
    buildExportMatrix,
    convertTransactionsToSheetRows,
    resolveGithubRawUrl,
    computeSheetTotals
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.App = root.App || {};
    root.App.cardSheetEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
