import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/app.js';
import { criarRegistro } from '../src/registro.js';

let servidor;
let base;
const app = {};
const registro = criarRegistro();
const consumidor = { conectado: true };

before(async () => {
  registro.registrar({ eventId: 'e1', placa: 'ABC1234', status: 'ENVIADA' });
  registro.registrar({ eventId: 'e2', placa: 'XYZ9876', status: 'ENVIADA' });
  const provedor = {
    nome: 'web',
    status: () => ({ provedor: 'web', estado: 'aguardando_pareamento', codigoPareamento: 'ABCD-1234' }),
    desconectar: async () => { provedor.desconectado = true; },
  };
  app.provedor = provedor;
  servidor = criarApp({ registro, provedor, consumidor, managerToken: 'tk' }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

test('health reflete conexão com o broker', async () => {
  let resp = await fetch(`${base}/health`);
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).provedorWhatsApp, 'web');
  consumidor.conectado = false;
  resp = await fetch(`${base}/health`);
  assert.equal(resp.status, 503);
  consumidor.conectado = true;
});

test('lista notificações, mais recentes primeiro, com filtro por placa', async () => {
  const todas = await (await fetch(`${base}/api/notificacoes`)).json();
  assert.deepEqual(todas.map((n) => n.eventId), ['e2', 'e1']);
  const filtradas = await (await fetch(`${base}/api/notificacoes?placa=abc1234`)).json();
  assert.equal(filtradas.length, 1);
});

test('status e desconexão do WhatsApp exigem o token do gerente', async () => {
  assert.equal((await fetch(`${base}/api/whatsapp/status`)).status, 401);
  const resp = await fetch(`${base}/api/whatsapp/status`, { headers: { Authorization: 'Bearer tk' } });
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).codigoPareamento, 'ABCD-1234');

  assert.equal((await fetch(`${base}/api/whatsapp/desconectar`, { method: 'POST' })).status, 401);
  const desc = await fetch(`${base}/api/whatsapp/desconectar`, { method: 'POST', headers: { Authorization: 'Bearer tk' } });
  assert.equal(desc.status, 202);
  assert.equal(app.provedor.desconectado, true);
});
