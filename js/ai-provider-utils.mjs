// =====================================================================
// ARQUIVO: js/ai-provider-utils.mjs
// Lógica pura e testável de resolução de provedores de IA (Gemini e DeepSeek),
// parsing seguro de JSON e formatação de erros em português.
// =====================================================================

export const GEMINI_MODEL = 'gemini-4-hydrogen';
export const DEEPSEEK_MODEL = 'deepseek-chat';
export const ALLOWED_CHAT_ACTIONS = new Set([
  'none',
  'categorize_locais',
  'categorize_expenses',
  'categorize_all',
  'open_locais',
  'open_saldos',
  'open_planning'
]);

export function resolveGeminiApiKey(env = process.env) {
  if (!env || typeof env !== 'object') return '';
  return String(env.GEMINI_API_KEY2 || '').trim();
}

export function resolveDeepSeekApiKey(env = process.env) {
  if (!env || typeof env !== 'object') return '';
  const candidates = [
    env.CONTA_ONLINE_DEEPSEEKCO,
    env.conta_online_deepseekco,
    env['conta online deepseekco'],
    env.DEEPSEEK_API_KEY
  ];
  for (const val of candidates) {
    const trimmed = String(val || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

export function selectProvider(requestedProvider, availability = {}) {
  const req = String(requestedProvider || 'auto').toLowerCase().trim();
  const hasGemini = Boolean(availability.gemini);
  const hasDeepSeek = Boolean(availability.deepseek);

  if (req === 'deepseek') {
    return hasDeepSeek ? 'deepseek' : null;
  }
  if (req === 'gemini') {
    return hasGemini ? 'gemini' : null;
  }

  // Modo automático: prioriza DeepSeek se for o único configurado; se ambos estiverem configurados, usa DeepSeek ou Gemini de forma determinística
  if (hasDeepSeek && !hasGemini) return 'deepseek';
  if (hasGemini && !hasDeepSeek) return 'gemini';
  if (hasDeepSeek && hasGemini) return 'deepseek';
  return null;
}

export function parseJsonFromModelText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    // Remove blocos markdown ```json ... ``` se o modelo envolver o JSON
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch (_) {}
    }
    // Tenta extrair primeiro objeto JSON válido
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch (_) {}
    }
    return null;
  }
}

export function normalizeChatAction(action) {
  const a = String(action || 'none').trim();
  return ALLOWED_CHAT_ACTIONS.has(a) ? a : 'none';
}

export function getErrorStatus(err) {
  if (!err) return 500;
  const raw = err.status || err.statusCode || err.code;
  const num = Number(raw);
  if (Number.isInteger(num) && num >= 400 && num <= 599) return num;
  const msg = String(err.message || '');
  if (/\b402\b|Insufficient Balance/i.test(msg)) return 402;
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg)) return 429;
  if (/\b403\b|PERMISSION_DENIED/i.test(msg)) return 403;
  if (/\b401\b|UNAUTHENTICATED|invalid.?api.?key|Authentication Fails/i.test(msg)) return 401;
  if (/\b400\b|INVALID_ARGUMENT|API_KEY_INVALID/i.test(msg)) return 400;
  return 502;
}

export function formatProviderError(provider, err) {
  const status = getErrorStatus(err);
  const rawMsg = String((err && err.message) || '');
  const isDeepSeek = provider === 'deepseek';
  const providerLabel = isDeepSeek ? 'DeepSeek' : 'Gemini';
  const envVar = isDeepSeek ? 'CONTA_ONLINE_DEEPSEEKCO' : 'GEMINI_API_KEY2';

  const isAuthError =
    status === 401 ||
    status === 403 ||
    /API_KEY_INVALID|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED|Authentication Fails|invalid.?api.?key/i.test(rawMsg);

  if (isAuthError) {
    return {
      status,
      code: 'AUTH_ERROR',
      provider,
      error: `Falha de autenticação na API ${providerLabel}. Verifique se a chave ${envVar} está configurada corretamente em Settings > Secrets.`
    };
  }

  if (status === 402) {
    return {
      status: 402,
      code: 'INSUFFICIENT_BALANCE',
      provider,
      error: `Saldo insuficiente na conta ${providerLabel}. Verifique seus créditos na plataforma ${providerLabel} ou alterne para outro provedor.`
    };
  }

  if (status === 429) {
    return {
      status: 429,
      code: 'RATE_LIMIT',
      provider,
      error: `Limite temporário da API ${providerLabel} atingido. Aguarde alguns instantes e tente novamente.`
    };
  }

  return {
    status: (status >= 400 && status <= 599) ? status : 502,
    code: 'AI_ERROR',
    provider,
    error: rawMsg
      ? `Erro ao consultar a IA (${providerLabel}): ${rawMsg}`
      : `Erro inesperado ao consultar a IA (${providerLabel}).`
  };
}
