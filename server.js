import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  GEMINI_MODEL,
  DEEPSEEK_MODEL,
  resolveGeminiApiKey,
  resolveDeepSeekApiKey,
  selectProvider,
  parseJsonFromModelText,
  normalizeChatAction,
  getErrorStatus,
  formatProviderError
} from './js/ai-provider-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

app.use(express.json({ limit: '2mb' }));

function getProviderAvailability() {
  return {
    gemini: Boolean(resolveGeminiApiKey(process.env)),
    deepseek: Boolean(resolveDeepSeekApiKey(process.env))
  };
}

function getGeminiClient() {
  const apiKey = resolveGeminiApiKey(process.env);
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

async function callWithRetry(fn, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = getErrorStatus(err);
      const isTransient = status >= 500 || /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(String(err?.message || ''));
      if (!isTransient || attempt === maxRetries) throw err;
      await new Promise(resolve => setTimeout(resolve, 650 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

async function callDeepSeekJson({ systemInstruction, messages }) {
  const apiKey = resolveDeepSeekApiKey(process.env);
  if (!apiKey) {
    const err = new Error('Chave DeepSeek não configurada.');
    err.status = 503;
    throw err;
  }

  const payload = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: systemInstruction },
      ...messages
    ],
    response_format: { type: 'json_object' }
  };

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMsg = data?.error?.message || data?.message || `HTTP ${response.status}`;
    const err = new Error(apiMsg);
    err.status = response.status;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content || '';
  return {
    text: String(content).trim(),
    model: data?.model || DEEPSEEK_MODEL
  };
}

function buildMissingKeyResponse(requestedProvider) {
  const req = String(requestedProvider || 'auto').toLowerCase().trim();
  if (req === 'deepseek') {
    return {
      code: 'API_KEY_MISSING',
      provider: 'deepseek',
      error: 'API DeepSeek não configurada no servidor. Adicione CONTA_ONLINE_DEEPSEEKCO em Settings > Secrets para usar a DeepSeek.'
    };
  }
  if (req === 'gemini') {
    return {
      code: 'API_KEY_MISSING',
      provider: 'gemini',
      error: 'API Gemini não configurada no servidor. Adicione GEMINI_API_KEY2 em Settings > Secrets para usar o Gemini.'
    };
  }
  return {
    code: 'API_KEY_MISSING',
    provider: null,
    error: 'Nenhuma API de IA configurada no servidor. Adicione CONTA_ONLINE_DEEPSEEKCO (DeepSeek) ou GEMINI_API_KEY2 (Gemini) em Settings > Secrets.'
  };
}

app.get('/api/ai/health', (_req, res) => {
  const availability = getProviderAvailability();
  const defaultProvider = selectProvider('auto', availability);
  res.json({
    configured: Boolean(defaultProvider),
    defaultProvider,
    model: defaultProvider === 'deepseek' ? DEEPSEEK_MODEL : GEMINI_MODEL,
    providers: {
      deepseek: {
        configured: availability.deepseek,
        model: DEEPSEEK_MODEL,
        envVar: 'CONTA_ONLINE_DEEPSEEKCO',
        label: 'DeepSeek'
      },
      gemini: {
        configured: availability.gemini,
        model: GEMINI_MODEL,
        envVar: 'GEMINI_API_KEY2',
        label: 'Gemini'
      }
    }
  });
});

app.post('/api/ai/categorize-locais', async (req, res) => {
  const availability = getProviderAvailability();
  const requestedProvider = req.body?.provider || 'auto';
  const provider = selectProvider(requestedProvider, availability);

  if (!provider) {
    return res.status(503).json(buildMissingKeyResponse(requestedProvider));
  }

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const existingLocais = Array.isArray(req.body?.existingLocais) ? req.body.existingLocais : [];

  const items = rawItems
    .filter(item => item && typeof item.description === 'string' && item.description.trim().length > 0)
    .slice(0, 40)
    .map(item => ({
      description: item.description.trim().slice(0, 140),
      category: typeof item.category === 'string' ? item.category.trim().slice(0, 60) : '',
      amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0,
      count: Number.isInteger(Number(item.count)) ? Number(item.count) : 1
    }));

  if (items.length === 0) {
    return res.status(400).json({
      code: 'INVALID_INPUT',
      error: 'Nenhuma compra válida foi enviada para categorização.'
    });
  }

  const existingSummary = existingLocais
    .slice(0, 120)
    .map(l => `- ${String(l.nome || '').trim()} (${String(l.categoria || 'Outros').trim()})`)
    .join('\n');

  const systemInstruction = [
    'Você é um especialista brasileiro em classificação de extratos bancários e faturas de cartão de crédito para o aplicativo Contas Online.',
    'Sua tarefa é identificar o estabelecimento/local de compra real de cada descrição bancária enviada.',
    'Regras obrigatórias:',
    '1. Limpe prefixos de maquininhas/intermediadores (como PG *, PAG*, MP *, SUMUP *, EBN *, IFD*, PIX ENVIO, COMPRA CARTAO), códigos de filial, cidades, datas e parcelas (ex: 01/03).',
    '2. Se o estabelecimento claramente corresponder a um local já existente na lista fornecida, REUTILIZE exatamente o mesmo "nome" e "categoria" existentes para agrupar corretamente.',
    '3. Escolha uma categoria curta e padronizada em português, preferindo: Mercado, Restaurante, Delivery, Padaria, Cafeteria, Bar, Farmácia, Saúde, Combustível, Transporte, Marketplace, Moda, Pet, Lazer, Tecnologia, Assinatura, Energia, Internet, Telefonia, Moradia, Manutenção, Serviço, Transferência, Outros.',
    '4. Escolha exatamente 1 emoji adequado para "icone".',
    '5. Em "padrao", retorne uma palavra-chave ou trecho limpo (em texto simples, sem barras ou caracteres especiais de regex complexos, de 3 a 45 caracteres) que esteja contido na descrição original para reconhecer futuras compras do mesmo estabelecimento automaticamente.',
    '6. Defina "excluir_do_ranking" como true APENAS para transferências entre pessoas físicas, pagamentos de fatura ou movimentações financeiras genéricas; para lojas, restaurantes, serviços e estabelecimentos reais, use false.',
    '7. Retorne EXCLUSIVAMENTE um objeto JSON no formato {"categorizations": [{"description": string, "nome": string, "categoria": string, "icone": string, "padrao": string, "excluir_do_ranking": boolean}]}, preservando o campo "description" idêntico ao recebido.'
  ].join('\n');

  const prompt = [
    existingSummary ? `Locais já cadastrados no dicionário do usuário:\n${existingSummary}\n` : '',
    'Compras pendentes de identificação de local:',
    JSON.stringify(items, null, 2)
  ].filter(Boolean).join('\n');

  try {
    let rawText = '';
    let usedModel = provider === 'deepseek' ? DEEPSEEK_MODEL : GEMINI_MODEL;

    if (provider === 'deepseek') {
      const dsRes = await callWithRetry(() => callDeepSeekJson({
        systemInstruction,
        messages: [{ role: 'user', content: prompt }]
      }));
      rawText = dsRes.text;
      usedModel = dsRes.model;
    } else {
      const ai = getGeminiClient();
      const response = await callWithRetry(() => ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              categorizations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    nome: { type: Type.STRING },
                    categoria: { type: Type.STRING },
                    icone: { type: Type.STRING },
                    padrao: { type: Type.STRING },
                    excluir_do_ranking: { type: Type.BOOLEAN }
                  },
                  required: ['description', 'nome', 'categoria', 'icone', 'padrao', 'excluir_do_ranking']
                }
              }
            },
            required: ['categorizations']
          }
        }
      }));
      rawText = (response.text || '').trim();
    }

    const parsed = parseJsonFromModelText(rawText);
    const categorizations = Array.isArray(parsed?.categorizations) ? parsed.categorizations : [];
    return res.json({ provider, model: usedModel, categorizations });
  } catch (err) {
    console.error(`[AI categorize-locais:${provider}]`, err);
    const formatted = formatProviderError(provider, err);
    return res.status(formatted.status).json(formatted);
  }
});

app.post('/api/ai/categorize-expenses', async (req, res) => {
  const availability = getProviderAvailability();
  const requestedProvider = req.body?.provider || 'auto';
  const provider = selectProvider(requestedProvider, availability);

  if (!provider) {
    return res.status(503).json(buildMissingKeyResponse(requestedProvider));
  }

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const rawCategories = Array.isArray(req.body?.categories) ? req.body.categories : [];

  const items = rawItems
    .filter(item => item && item.id && typeof item.description === 'string' && item.description.trim().length > 0)
    .slice(0, 35)
    .map(item => ({
      id: String(item.id).slice(0, 80),
      description: item.description.trim().slice(0, 140),
      amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0,
      date: typeof item.date === 'string' ? item.date.slice(0, 10) : '',
      currentCategory: typeof item.currentCategory === 'string' ? item.currentCategory.trim().slice(0, 60) : '',
      currentClassification: typeof item.currentClassification === 'string' ? item.currentClassification.trim().slice(0, 30) : ''
    }));

  if (items.length === 0) {
    return res.status(400).json({
      code: 'INVALID_INPUT',
      error: 'Nenhum gasto válido foi enviado para categorização e classificação.'
    });
  }

  const categoriesList = rawCategories
    .filter(c => c && typeof c.name === 'string' && c.name.trim())
    .slice(0, 120)
    .map(c => ({
      name: c.name.trim().slice(0, 60),
      defaultClassification: typeof c.classification === 'string' ? c.classification.trim() : ''
    }));

  const categoriesText = categoriesList
    .map(c => `- ${c.name}${c.defaultClassification ? ` (padrão: ${c.defaultClassification})` : ''}`)
    .join('\n');

  const systemInstruction = [
    'Você é um planejador financeiro brasileiro especialista no método 50/30/20 para o aplicativo Contas Online.',
    'Para cada despesa recebida, defina a categoria mais adequada e a classificação 50/30/20: "essential" (Essencial), "necessary" (Necessário) ou "superfluous" (Supérfluo).',
    'Regras obrigatórias:',
    '1. Escolha o campo "category" EXATAMENTE entre os nomes existentes na lista de categorias do usuário fornecida abaixo (não invente categorias novas).',
    '2. Se currentCategory já for uma categoria específica (diferente de vazio ou "Outros"), mantenha-a, ajustando apenas a classificação se estiver ausente.',
    '3. Critérios de classificação ("classification"):',
    '   - "essential" (Essencial): moradia, aluguel, condomínio, energia, água, gás, mercado básico mensal, saúde, farmácia/medicamentos, plano de saúde, educação básica/obrigatória, impostos essenciais, alimentação básica de casa, cuidados essenciais de pets.',
    '   - "necessary" (Necessário): transporte/Uber de rotina, combustível, manutenção de carro/casa, internet, telefonia, vestuário básico, serviços cotidianos úteis, despesas residenciais complementares.',
    '   - "superfluous" (Supérfluo): delivery/iFood/lanches, restaurantes/bares/cafeterias/sorveterias, lazer/cinema/passeios/viagens, streaming/assinaturas de entretenimento, presentes, compras não essenciais ou por impulso.',
    '4. Retorne EXCLUSIVAMENTE um objeto JSON no formato {"items": [{"id": string, "category": string, "classification": "essential" | "necessary" | "superfluous"}]} preservando cada "id" exatamente como enviado.'
  ].join('\n');

  const prompt = [
    categoriesText ? `Categorias de despesa disponíveis no aplicativo:\n${categoriesText}\n` : '',
    'Despesas para categorizar e classificar:',
    JSON.stringify(items, null, 2)
  ].filter(Boolean).join('\n');

  try {
    let rawText = '';
    let usedModel = provider === 'deepseek' ? DEEPSEEK_MODEL : GEMINI_MODEL;

    if (provider === 'deepseek') {
      const dsRes = await callWithRetry(() => callDeepSeekJson({
        systemInstruction,
        messages: [{ role: 'user', content: prompt }]
      }));
      rawText = dsRes.text;
      usedModel = dsRes.model;
    } else {
      const ai = getGeminiClient();
      const response = await callWithRetry(() => ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    category: { type: Type.STRING },
                    classification: {
                      type: Type.STRING,
                      enum: ['essential', 'necessary', 'superfluous']
                    }
                  },
                  required: ['id', 'category', 'classification']
                }
              }
            },
            required: ['items']
          }
        }
      }));
      rawText = (response.text || '').trim();
    }

    const parsed = parseJsonFromModelText(rawText);
    const outItems = Array.isArray(parsed?.items) ? parsed.items : [];
    return res.json({ provider, model: usedModel, items: outItems });
  } catch (err) {
    console.error(`[AI categorize-expenses:${provider}]`, err);
    const formatted = formatProviderError(provider, err);
    return res.status(formatted.status).json(formatted);
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const availability = getProviderAvailability();
  const requestedProvider = req.body?.provider || 'auto';
  const provider = selectProvider(requestedProvider, availability);

  if (!provider) {
    return res.status(503).json(buildMissingKeyResponse(requestedProvider));
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({
      code: 'INVALID_INPUT',
      error: 'Digite uma mensagem para conversar com a IA.'
    });
  }

  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const context = (req.body?.context && typeof req.body.context === 'object') ? req.body.context : {};

  const safeHistory = rawHistory
    .filter(m => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
    .slice(-14)
    .map(m => ({
      role: m.role,
      text: m.text.trim().slice(0, 2000)
    }));

  const systemInstruction = [
    'Você é o Assistente Financeiro IA integrado ao aplicativo Contas Online.',
    'Responda sempre em português do Brasil, de forma clara, objetiva, prática e amigável.',
    'Use os dados reais do projeto enviados no contexto abaixo (saldos, contas, receitas, despesas do mês, locais de compras, gastos pendentes de categoria/classificação, categorias, planos e investimentos). Nunca invente valores que não estejam no contexto.',
    'Formate valores monetários em R$ no padrão brasileiro (ex: R$ 1.250,00).',
    'Você pode acionar tarefas reais dentro do aplicativo escolhendo o campo "action":',
    '- "categorize_locais": quando o usuário pedir para categorizar ou organizar locais de compras/estabelecimentos pendentes.',
    '- "categorize_expenses": quando o usuário pedir para categorizar gastos/despesas ou classificar em Essencial, Necessário e Supérfluo.',
    '- "categorize_all": quando o usuário pedir para organizar tudo (locais, categorias e classificação dos gastos).',
    '- "open_locais": quando o usuário pedir para abrir ou ver a página de Locais.',
    '- "open_saldos": quando o usuário pedir para abrir ou ver a página de Saldos & Movimentações.',
    '- "open_planning": quando o usuário pedir para abrir ou ver o Planejamento Financeiro.',
    '- "none": para respostas informativas, análises, dicas ou perguntas gerais.',
    'Quando action for "categorize_locais", "categorize_expenses" ou "categorize_all", responda brevemente confirmando que está executando a tarefa agora.',
    'Retorne EXCLUSIVAMENTE um objeto JSON no formato {"reply": string, "action": "none" | "categorize_locais" | "categorize_expenses" | "categorize_all" | "open_locais" | "open_saldos" | "open_planning"}.',
    '',
    'Contexto atual do projeto do usuário:',
    JSON.stringify(context)
  ].join('\n');

  try {
    let rawText = '';
    let usedModel = provider === 'deepseek' ? DEEPSEEK_MODEL : GEMINI_MODEL;

    if (provider === 'deepseek') {
      const dsMessages = [
        ...safeHistory.map(m => ({
          role: m.role === 'model' ? 'assistant' : 'user',
          content: m.text
        })),
        { role: 'user', content: message.slice(0, 2500) }
      ];
      const dsRes = await callWithRetry(() => callDeepSeekJson({
        systemInstruction,
        messages: dsMessages
      }));
      rawText = dsRes.text;
      usedModel = dsRes.model;
    } else {
      const ai = getGeminiClient();
      const contents = [
        ...safeHistory.map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })),
        { role: 'user', parts: [{ text: message.slice(0, 2500) }] }
      ];
      const response = await callWithRetry(() => ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              action: {
                type: Type.STRING,
                enum: ['none', 'categorize_locais', 'categorize_expenses', 'categorize_all', 'open_locais', 'open_saldos', 'open_planning']
              }
            },
            required: ['reply', 'action']
          }
        }
      }));
      rawText = (response.text || '').trim();
    }

    const parsed = parseJsonFromModelText(rawText);
    return res.json({
      provider,
      model: usedModel,
      reply: typeof parsed?.reply === 'string' ? parsed.reply : rawText,
      action: normalizeChatAction(parsed?.action)
    });
  } catch (err) {
    console.error(`[AI chat:${provider}]`, err);
    const formatted = formatProviderError(provider, err);
    return res.status(formatted.status).json(formatted);
  }
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
