import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarRegistro } from '../src/registro.js';

test('falha não marca o evento como processado; envio sim', () => {
  const registro = criarRegistro();
  registro.registrar({ eventId: 'e1', placa: 'ABC1234', status: 'FALHA' });
  assert.equal(registro.jaProcessado('e1'), false);
  registro.registrar({ eventId: 'e1', placa: 'ABC1234', status: 'ENVIADA' });
  assert.equal(registro.jaProcessado('e1'), true);
  assert.deepEqual(registro.listar().map((i) => i.status), ['ENVIADA', 'FALHA']);
});

test('registro e idempotência sobrevivem a reinício do serviço', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notif-'));
  const caminho = join(dir, 'notificacoes.db');
  try {
    const antes = criarRegistro({ caminho });
    antes.registrar({ eventId: 'e9', placa: 'XYZ9876', status: 'ENVIADA', texto: 'oi' });
    antes.fechar();

    const depois = criarRegistro({ caminho });
    assert.equal(depois.jaProcessado('e9'), true);
    const [item] = depois.listar({ placa: 'XYZ9876' });
    assert.equal(item.texto, 'oi');
    assert.ok(item.registradoEm);
    depois.fechar();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listar respeita o limite', () => {
  const registro = criarRegistro({ limite: 3 });
  for (let i = 0; i < 5; i += 1) registro.registrar({ eventId: `e${i}`, status: 'ENVIADA' });
  assert.deepEqual(registro.listar().map((i) => i.eventId), ['e4', 'e3', 'e2']);
});
