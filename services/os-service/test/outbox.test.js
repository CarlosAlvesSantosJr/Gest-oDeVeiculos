import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, validarNovaOS } from '../src/domain.js';
import { criarRelayOutbox } from '../src/outbox.js';
import { criarRepositorio } from '../src/repository.js';

const silencioso = { warn() {}, info() {}, error() {} };

function repoComEventos() {
  const repo = criarRepositorio(':memory:');
  const os = repo.criar(validarNovaOS({
    placa: 'ABC1234', marca: 'VW', modelo: 'Gol', clienteNome: 'Ana', clienteTelefone: '11999998888',
  }));
  repo.atualizarStatus(os.id, STATUS.PRONTO_PARA_ENTREGA);
  return repo;
}

test('relay publica eventos pendentes em ordem e marca como publicados', async () => {
  const repo = repoComEventos();
  const publicados = [];
  const relay = criarRelayOutbox({ repo, publicar: async (rk, ev) => publicados.push([rk, ev.tipo]), logger: silencioso });
  assert.equal(await relay.processar(), 2);
  assert.deepEqual(publicados, [['os.criada', 'OS_CRIADA'], ['os.status.PRONTO_PARA_ENTREGA', 'OS_STATUS_ALTERADO']]);
  assert.equal(repo.outboxPendentes().length, 0);
});

test('relay mantém eventos pendentes quando o broker falha e reenvia depois', async () => {
  const repo = repoComEventos();
  let brokerNoAr = false;
  const publicados = [];
  const relay = criarRelayOutbox({
    repo,
    logger: silencioso,
    publicar: async (rk) => {
      if (!brokerNoAr) throw new Error('ECONNREFUSED');
      publicados.push(rk);
    },
  });
  assert.equal(await relay.processar(), 0);
  assert.equal(repo.outboxPendentes().length, 2);
  assert.equal(repo.outboxPendentes()[0].tentativas, 1);

  brokerNoAr = true;
  assert.equal(await relay.processar(), 2);
  assert.equal(publicados.length, 2);
});

test('relay não executa ciclos sobrepostos', async () => {
  const repo = repoComEventos();
  let liberar;
  const relay = criarRelayOutbox({
    repo,
    logger: silencioso,
    publicar: () => new Promise((resolve) => { liberar = resolve; }),
  });
  const primeiro = relay.processar();
  assert.equal(await relay.processar(), 0);
  liberar();
  await new Promise((r) => setImmediate(r));
  liberar();
  assert.equal(await primeiro, 2);
});
