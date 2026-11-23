import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGeminiApiKey,
  resolveDeepSeekApiKey,
  selectProvider,
  parseJsonFromModelText,
  normalizeChatAction,
  formatProviderError
} from '../js/ai-provider-utils.mjs';

test('resolveDeepSeekApiKey prioriza CONTA_ONLINE_DEEPSEEKCO e aceita fallback com espaços ou DEEPSEEK_API_KEY', () => {
  assert.equal(resolveDeepSeekApiKey({ CONTA_ONLINE_DEEPSEEKCO: ' sk-ds-1 ' }), 'sk-ds-1');
  assert.equal(resolveDeepSeekApiKey({ 'conta online deepseekco': 'sk-ds-space' }), 'sk-ds-space');
  assert.equal(resolveDeepSeekApiKey({ DEEPSEEK_API_KEY: 'sk-ds-fallback' }), 'sk-ds-fallback');
  assert.equal(resolveDeepSeekApiKey({ CONTA_ONLINE_DEEPSEEKCO: 'sk-main', DEEPSEEK_API_KEY: 'sk-other' }), 'sk-main');
  assert.equal(resolveDeepSeekApiKey({}), '');
});

test('resolveGeminiApiKey lê apenas GEMINI_API_KEY2', () => {
  assert.equal(resolveGeminiApiKey({ GEMINI_API_KEY2: ' AIza-test ' }), 'AIza-test');
  assert.equal(resolveGeminiApiKey({ GEMINI_API_KEY: 'ignored-default' }), '');
});

test('selectProvider respeita provedor solicitado e escolhe automaticamente o disponível', () => {
  assert.equal(selectProvider('deepseek', { deepseek: true, gemini: true }), 'deepseek');
  assert.equal(selectProvider('gemini', { deepseek: true, gemini: true }), 'gemini');
  assert.equal(selectProvider('deepseek', { deepseek: false, gemini: true }), null);
  assert.equal(selectProvider('auto', { deepseek: false, gemini: true }), 'gemini');
  assert.equal(selectProvider('auto', { deepseek: true, gemini: false }), 'deepseek');
  assert.equal(selectProvider('auto', { deepseek: true, gemini: true }), 'deepseek');
  assert.equal(selectProvider('auto', { deepseek: false, gemini: false }), null);
});

test('parseJsonFromModelText interpreta JSON direto e blocos markdown cercados', () => {
  assert.deepEqual(parseJsonFromModelText('{"reply":"ok","action":"none"}'), { reply: 'ok', action: 'none' });
  assert.deepEqual(
    parseJsonFromModelText('```json\n{"categorizations":[{"nome":"Padaria"}]}\n```'),
    { categorizations: [{ nome: 'Padaria' }] }
  );
  assert.equal(parseJsonFromModelText('texto sem json'), null);
});

test('normalizeChatAction valida apenas ações permitidas', () => {
  assert.equal(normalizeChatAction('categorize_locais'), 'categorize_locais');
  assert.equal(normalizeChatAction('open_saldos'), 'open_saldos');
  assert.equal(normalizeChatAction('delete_everything'), 'none');
});

test('formatProviderError mapeia 401, 402 (saldo DeepSeek) e 429 com orientações corretas', () => {
  const dsAuth = formatProviderError('deepseek', { status: 401, message: 'Authentication Fails' });
  assert.equal(dsAuth.code, 'AUTH_ERROR');
  assert.match(dsAuth.error, /CONTA_ONLINE_DEEPSEEKCO/);

  const dsBal = formatProviderError('deepseek', { status: 402, message: 'Insufficient Balance' });
  assert.equal(dsBal.code, 'INSUFFICIENT_BALANCE');
  assert.match(dsBal.error, /Saldo insuficiente/);

  const gmAuth = formatProviderError('gemini', { status: 403, message: 'PERMISSION_DENIED' });
  assert.equal(gmAuth.code, 'AUTH_ERROR');
  assert.match(gmAuth.error, /GEMINI_API_KEY2/);

  const rate = formatProviderError('deepseek', { status: 429, message: 'Rate limit exceeded' });
  assert.equal(rate.code, 'RATE_LIMIT');
});
