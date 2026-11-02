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

test('editar altera só os campos diferentes, registra histórico e evento', () => {
  const os = repo.criar(entrada());
  const { ordem, alterados } = repo.editar(os.id, { modelo: 'Uno Mille', marca: 'Fiat', cor: 'Branco' });
  assert.deepEqual(alterados, ['modelo', 'cor']);
  assert.equal(ordem.modelo, 'Uno Mille');
  assert.equal(ordem.status, os.status, 'edição não muda o status');
  assert.equal(repo.historico(os.id).at(-1).observacao, 'Dados alterados: modelo, cor');
  const evento = repo.outboxPendentes().at(-1);
  assert.equal(evento.routingKey, 'os.dados.alterados');
  assert.deepEqual(evento.evento.dados.antes, { modelo: 'Uno', cor: '' });
});

test('editar sem mudanças não gera histórico nem evento', () => {
  const os = repo.criar(entrada());
  const { alterados } = repo.editar(os.id, { marca: 'Fiat' });
  assert.deepEqual(alterados, []);
  assert.equal(repo.historico(os.id).length, 1);
  assert.equal(repo.outboxPendentes().length, 1);
});

test('editar placa para uma placa já ativa em outra OS é bloqueado', () => {
  const a = repo.criar(entrada());
  repo.criar(entrada({ placa: 'XYZ9876' }));
  assert.throws(() => repo.editar(a.id, { placa: 'XYZ9876' }), ConflictError);
  assert.doesNotThrow(() => repo.editar(a.id, { placa: 'DEF5678' }));
});

test('OS entregue não pode ser editada', () => {
  const os = repo.criar(entrada({ status: STATUS.PRONTO_PARA_ENTREGA }));
  repo.atualizarStatus(os.id, STATUS.ENTREGUE);
  assert.throws(() => repo.editar(os.id, { cor: 'Azul' }), ConflictError);
});

test('telefone editado é usado no próximo aviso de WhatsApp', () => {
  const os = repo.criar(entrada());
  repo.editar(os.id, { clienteTelefone: '5521999990000' });
  const { evento } = repo.atualizarStatus(os.id, STATUS.PRONTO_PARA_ENTREGA);
  assert.equal(evento.dados.clienteTelefone, '5521999990000');
});

test('marcarPublicado remove do outbox e registrarFalha incrementa tentativas', () => {
  repo.criar(entrada());
  const [p] = repo.outboxPendentes();
  repo.registrarFalha(p.id);
  assert.equal(repo.outboxPendentes()[0].tentativas, 1);
  repo.marcarPublicado(p.id);
  assert.equal(repo.outboxPendentes().length, 0);
});
