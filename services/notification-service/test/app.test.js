import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/app.js';
import { criarRegistro } from '../src/registro.js';

let servidor;
let base;
const registro = criarRegistro();
const consumidor = { conectado: true };

before(async () => {
  registro.registrar({ eventId: 'e1', placa: 'ABC1234', status: 'ENVIADA' });
  registro.registrar({ eventId: 'e2', placa: 'XYZ9876', status: 'ENVIADA' });
  servidor = criarApp({ registro, provedor: { nome: 'mock' }, consumidor }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

test('health reflete conexão com o broker', async () => {
  let resp = await fetch(`${base}/health`);
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).provedorWhatsApp, 'mock');
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
