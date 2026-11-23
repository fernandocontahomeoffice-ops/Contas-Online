import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function loadBankLogosModule() {
  const code = fs.readFileSync(path.join(rootDir, 'js/bank-logos.js'), 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    window: {},
    globalThis: {},
    console
  };
  vm.runInNewContext(code, sandbox, { filename: 'js/bank-logos.js' });
  return mod.exports;
}

const bankLogosMod = loadBankLogosModule();

test('bank-logos resolves major Brazilian banks, fintechs, and accent variants accurately', () => {
  const svc = bankLogosMod.createBankLogosService();

  const cases = [
    ['Nubank', '18236120', 'Nubank'],
    ['Nu Conta Principal', '18236120', 'Nubank'],
    ['Itaú Personalité', '60701190', 'Itaú'],
    ['itau uniclass', '60701190', 'Itaú'],
    ['Banco do Brasil', '00000000', 'Banco do Brasil'],
    ['BB Ourocard', '00000000', 'Banco do Brasil'],
    ['Caixa Econômica', '00360305', 'Caixa'],
    ['Santander SX', '90400888', 'Santander'],
    ['Bradesco Prime', '60746948', 'Bradesco'],
    ['Inter Black', '00416968', 'Inter'],
    ['C6 Carbon', '31872495', 'C6 Bank'],
    ['Mercado Pago', '10573521', 'Mercado Pago'],
    ['PicPay Card', '22896431', 'PicPay'],
    ['XP Visa Infinite', '02332886', 'XP Investimentos'],
    ['BTG Pactual', '30306294', 'BTG Pactual'],
    ['PagSeguro / PagBank', '08561701', 'PagBank'],
    ['Sicredi Cooperativa', '01181521', 'Sicredi'],
    ['Sicoob', '02038232', 'Sicoob'],
    ['Efí Bank', '09089356', 'Efí Bank'],
    ['Gerencianet', '09089356', 'Efí Bank'],
    ['Crefisa', '61033106', 'Crefisa'],
    ['Banco Pan', '59285411', 'Banco Pan'],
    ['Wise USD', '40571694', 'Wise'],
    ['Revolut', '51342763', 'Revolut']
  ];

  for (const [input, expectedId, expectedName] of cases) {
    const resolved = svc.resolve(input);
    assert.ok(resolved, `Expected to resolve "${input}"`);
    assert.equal(resolved.id, expectedId, `Wrong ID for "${input}"`);
    assert.equal(resolved.displayName, expectedName, `Wrong displayName for "${input}"`);
    assert.ok(resolved.logoUrl.startsWith('https://cdn.jsdelivr.net/npm/logos-bancos-br@latest/'), `Expected CDN logo URL for "${input}"`);
  }
});

test('bank-logos resolves COMPE codes and stored bank_ispb objects directly', () => {
  const svc = bankLogosMod.createBankLogosService();

  assert.equal(svc.resolve('260')?.displayName, 'Nubank');
  assert.equal(svc.resolve('341 - Conta Salário')?.displayName, 'Itaú');
  assert.equal(svc.resolve('001')?.displayName, 'Banco do Brasil');
  assert.equal(svc.resolve({ name: 'Carteira Pessoal', bank_ispb: '00416968' })?.displayName, 'Inter');
});

test('bank-logos resolves extra international & benefit brands without false positives', () => {
  const svc = bankLogosMod.createBankLogosService();

  assert.equal(svc.resolve('Nomad Global')?.id, 'extra:nomad');
  assert.equal(svc.resolve('Will Bank')?.id, 'extra:will');
  assert.equal(svc.resolve('Alelo Refeição')?.id, 'extra:alelo');
  assert.equal(svc.resolve('Sodexo Alimentação')?.id, 'extra:pluxee');
  assert.equal(svc.resolve('VR Benefícios')?.id, 'extra:vr');

  // Word-boundary protection: should NOT falsely match unrelated words
  assert.equal(svc.resolve('Panificadora Central'), null);
  assert.equal(svc.resolve('Compra Internacional'), null);
  assert.equal(svc.resolve('Carteira Dinheiro'), null);
});

test('bank-logos ingests dynamic logos-bancos-br and BrasilAPI catalogs cleanly', () => {
  const svc = bankLogosMod.createBankLogosService();
  const initialCount = svc.getStats().totalWithLogos;

  const added = svc.ingestLogosBancosBr(
    {
      banks: [
        {
          ispb: '99990001',
          compe: '901',
          name: 'BANCO TESTE DIGITAL S.A.',
          shortName: 'BCO TESTE',
          displayName: 'Banco Teste',
          logo: { svg: 'logos/svg/99990001.svg', png: 'logos/png/99990001.png' }
        },
        {
          ispb: '99990002',
          compe: '902',
          name: 'SEM LOGO S.A.',
          logo: null
        }
      ]
    },
    {
      institutions: [
        {
          ispb: '99990003',
          compe: null,
          name: 'COOP PIX EXEMPLO LTDA.',
          shortName: 'COOP PIX EXEMPLO',
          displayName: 'Coop Pix Exemplo',
          logo: { png: 'logos/png/99990003.png' }
        }
      ]
    }
  );

  assert.equal(added, 2);
  assert.equal(svc.getStats().totalWithLogos, initialCount + 2);
  assert.equal(svc.resolve('Banco Teste')?.logoUrl, 'https://cdn.jsdelivr.net/npm/logos-bancos-br@latest/logos/svg/99990001.svg');
  assert.equal(svc.resolve('Coop Pix Exemplo')?.logoUrl, 'https://cdn.jsdelivr.net/npm/logos-bancos-br@latest/logos/png/99990003.png');

  const addedApi = svc.ingestBrasilApi([
    {
      ispb: '88880001',
      code: 888,
      name: 'BCO BRASILAPI TESTE',
      fullName: 'BANCO BRASILAPI TESTE S.A.',
      logo_url: 'https://cdn.jsdelivr.net/npm/logos-bancos-br@0/logos/svg/88880001.svg'
    }
  ]);
  assert.equal(addedApi, 1);
  assert.equal(svc.resolve('888')?.id, '88880001');
});

test('bank-logos renderLogoHtml escapes HTML safely and falls back to monogram cleanly', () => {
  const svc = bankLogosMod.createBankLogosService();

  const nubankHtml = svc.renderLogoHtml({ name: 'Nubank "Principal" <script>' });
  assert.ok(nubankHtml.includes('<img class="bank-logo-img"'));
  assert.ok(nubankHtml.includes('logos/svg/18236120.svg'));
  assert.ok(nubankHtml.includes('data-fallback-src="https://cdn.jsdelivr.net/npm/logos-bancos-br@latest/logos/png/18236120.png"'));
  assert.ok(!nubankHtml.includes('<script>'));

  const unknownHtml = svc.renderLogoHtml('Cofre Casa');
  assert.ok(unknownHtml.includes('bank-logo-monogram'));
  assert.ok(unknownHtml.includes('>CC<'));
});
