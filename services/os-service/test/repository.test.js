import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, NotFoundError, STATUS, validarNovaOS } from '../src/domain.js';
import { criarRepositorio } from '../src/repository.js';

const entrada = (extra = {}) => validarNovaOS({
  placa: 'ABC1D23', marca: 'Fiat', modelo: 'Uno', clienteNome: 'João', clienteTelefone: '11987654321', ...extra,
});

let repo;
beforeEach(() => { repo = criarRepositorio(':memory:'); });

test('cria OS, registra histórico e enfileira evento OS_CRIADA no outbox', () => {
  const os = repo.criar(entrada());
  assert.ok(os.id);
  assert.equal(os.status, STATUS.AGUARDANDO_ORCAMENTO);
  assert.equal(repo.historico(os.id).length, 1);
  const [pendente] = repo.outboxPendentes();
  assert.equal(pendente.routingKey, 'os.criada');
  assert.equal(pendente.evento.tipo, 'OS_CRIADA');
  assert.equal(pendente.evento.dados.placa, 'ABC1D23');
});

test('impede duas OS ativas para a mesma placa', () => {
  repo.criar(entrada());
  assert.throws(() => repo.criar(entrada()), ConflictError);
});

test('permite nova OS para placa cuja OS anterior foi entregue', () => {
  const os = repo.criar(entrada({ status: STATUS.PRONTO_PARA_ENTREGA }));
  repo.atualizarStatus(os.id, STATUS.ENTREGUE);
  assert.doesNotThrow(() => repo.criar(entrada()));
});

test('atualizarStatus grava histórico e evento com dados do cliente', () => {
  const os = repo.criar(entrada());
  const { ordem, evento } = repo.atualizarStatus(os.id, STATUS.PRONTO_PARA_ENTREGA, { observacao: 'Lavado' });
  assert.equal(ordem.status, STATUS.PRONTO_PARA_ENTREGA);
  assert.equal(evento.tipo, 'OS_STATUS_ALTERADO');
  assert.equal(evento.dados.statusAnterior, STATUS.AGUARDANDO_ORCAMENTO);
  assert.equal(evento.dados.clienteTelefone, '5511987654321');
  const hist = repo.historico(os.id);
  assert.equal(hist.at(-1).observacao, 'Lavado');
  const keys = repo.outboxPendentes().map((p) => p.routingKey);
  assert.deepEqual(keys, ['os.criada', 'os.status.PRONTO_PARA_ENTREGA']);
});

test('transição inválida faz rollback (sem histórico nem evento)', () => {
  const os = repo.criar(entrada());
  assert.throws(() => repo.atualizarStatus(os.id, STATUS.ENTREGUE), ConflictError);
  assert.equal(repo.historico(os.id).length, 1);
  assert.equal(repo.outboxPendentes().length, 1);
  assert.equal(repo.buscar(os.id).status, STATUS.AGUARDANDO_ORCAMENTO);
});

test('listar oculta entregues por padrão', () => {
  const a = repo.criar(entrada({ status: STATUS.PRONTO_PARA_ENTREGA }));
  repo.criar(entrada({ placa: 'XYZ9876' }));
  repo.atualizarStatus(a.id, STATUS.ENTREGUE);
  assert.equal(repo.listar().length, 1);
  assert.equal(repo.listar({ incluirEntregues: true }).length, 2);
});

test('buscar OS inexistente lança NotFoundError', () => {
  assert.throws(() => repo.buscar('nao-existe'), NotFoundError);
});

test('marcarPublicado remove do outbox e registrarFalha incrementa tentativas', () => {
  repo.criar(entrada());
  const [p] = repo.outboxPendentes();
  repo.registrarFalha(p.id);
  assert.equal(repo.outboxPendentes()[0].tentativas, 1);
  repo.marcarPublicado(p.id);
  assert.equal(repo.outboxPendentes().length, 0);
});
