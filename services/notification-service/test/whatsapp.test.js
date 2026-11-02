import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErroWhatsApp, criarProvedor, criarProvedorCloudApi, criarProvedorMock } from '../src/whatsapp.js';

const silencioso = { info() {}, warn() {}, error() {} };

function fetchFalso(status, corpo) {
  const chamadas = [];
  const impl = async (url, opcoes) => {
    chamadas.push({ url, opcoes, corpo: JSON.parse(opcoes.body) });
    return { ok: status < 400, status, json: async () => corpo };
  };
  return { impl, chamadas };
}

test('provedor mock devolve id', async () => {
  const r = await criarProvedorMock({ logger: silencioso }).enviar({ para: '5511999998888', texto: 'oi' });
  assert.match(r.id, /^mock-/);
});

test('Cloud API: envia mensagem de texto no formato oficial da Meta', async () => {
  const { impl, chamadas } = fetchFalso(200, { messages: [{ id: 'wamid.ABC' }] });
  const p = criarProvedorCloudApi({ token: 'tk', phoneNumberId: '123', fetchImpl: impl });
  const r = await p.enviar({ para: '5511999998888', texto: 'Seu carro está pronto' });
  assert.equal(r.id, 'wamid.ABC');
  assert.equal(chamadas[0].url, 'https://graph.facebook.com/v21.0/123/messages');
  assert.equal(chamadas[0].opcoes.headers.Authorization, 'Bearer tk');
  assert.deepEqual(chamadas[0].corpo, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511999998888', type: 'text',
    text: { preview_url: false, body: 'Seu carro está pronto' },
  });
});

test('Cloud API: usa template aprovado quando configurado', async () => {
  const { impl, chamadas } = fetchFalso(200, { messages: [{ id: 'wamid.T' }] });
  const p = criarProvedorCloudApi({ token: 'tk', phoneNumberId: '123', template: 'veiculo_pronto', fetchImpl: impl });
  await p.enviar({ para: '55119', texto: 'x', variaveis: ['Ana', 'Fiat Uno', 'ABC1D23', 'Oficina'] });
  const { template, type } = chamadas[0].corpo;
  assert.equal(type, 'template');
  assert.equal(template.name, 'veiculo_pronto');
  assert.equal(template.language.code, 'pt_BR');
  assert.deepEqual(template.components[0].parameters.map((x) => x.text), ['Ana', 'Fiat Uno', 'ABC1D23', 'Oficina']);
});

test('Cloud API: erro 400 é permanente, 500 e 429 são temporários', async () => {
  for (const [status, permanente] of [[400, true], [401, true], [429, false], [500, false]]) {
    const { impl } = fetchFalso(status, { error: { message: `falha ${status}` } });
    const p = criarProvedorCloudApi({ token: 'tk', phoneNumberId: '1', fetchImpl: impl });
    await assert.rejects(p.enviar({ para: '1', texto: 'x' }), (erro) => {
      assert.ok(erro instanceof ErroWhatsApp);
      assert.equal(erro.httpStatus, status);
      assert.equal(erro.permanente, permanente, `status ${status}`);
      assert.equal(erro.message, `falha ${status}`);
      return true;
    });
  }
});

test('Cloud API: falha de rede é temporária', async () => {
  const p = criarProvedorCloudApi({
    token: 'tk', phoneNumberId: '1', fetchImpl: async () => { throw new Error('ENOTFOUND'); },
  });
  await assert.rejects(p.enviar({ para: '1', texto: 'x' }), (e) => e instanceof ErroWhatsApp && !e.permanente);
});

test('criarProvedor escolhe pelo ambiente e valida credenciais', () => {
  assert.equal(criarProvedor({}, { logger: silencioso }).nome, 'mock');
  assert.equal(criarProvedor({ WHATSAPP_PROVIDER: 'cloud', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' }).nome, 'cloud');
  assert.throws(() => criarProvedor({ WHATSAPP_PROVIDER: 'cloud' }));
});
