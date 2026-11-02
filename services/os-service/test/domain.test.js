import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictError, STATUS, ValidationError, normalizarPlaca, normalizarTelefone, placaValida,
  validarNovaOS, validarTransicao,
} from '../src/domain.js';

const valido = {
  placa: 'abc-1d23', marca: 'Fiat', modelo: 'Uno', clienteNome: 'João', clienteTelefone: '(11) 98765-4321',
};

test('normaliza e valida placas antigas e Mercosul', () => {
  assert.equal(normalizarPlaca(' abc-1234 '), 'ABC1234');
  assert.ok(placaValida('ABC1234'));
  assert.ok(placaValida('abc1d23'));
  assert.ok(!placaValida('AB12345'));
  assert.ok(!placaValida('ABCD123'));
  assert.ok(!placaValida(''));
});

test('normaliza telefone brasileiro para E.164 sem +', () => {
  assert.equal(normalizarTelefone('(11) 98765-4321'), '5511987654321');
  assert.equal(normalizarTelefone('1132654321'), '551132654321');
  assert.equal(normalizarTelefone('+55 11 98765-4321'), '5511987654321');
  assert.equal(normalizarTelefone('12345'), null);
  assert.equal(normalizarTelefone(undefined), null);
});

test('validarNovaOS normaliza os dados e aplica status inicial padrão', () => {
  const os = validarNovaOS(valido);
  assert.equal(os.placa, 'ABC1D23');
  assert.equal(os.clienteTelefone, '5511987654321');
  assert.equal(os.status, STATUS.AGUARDANDO_ORCAMENTO);
});

test('validarNovaOS lista todos os erros encontrados', () => {
  assert.throws(() => validarNovaOS({ placa: 'x' }), (erro) => {
    assert.ok(erro instanceof ValidationError);
    assert.equal(erro.httpStatus, 400);
    assert.equal(erro.detalhes.length, 5);
    return true;
  });
});

test('validarNovaOS rejeita status inicial ENTREGUE', () => {
  assert.throws(() => validarNovaOS({ ...valido, status: STATUS.ENTREGUE }), ValidationError);
});

test('transições permitidas entre os status do painel', () => {
  assert.doesNotThrow(() => validarTransicao(STATUS.AGUARDANDO_ORCAMENTO, STATUS.AGUARDANDO_PECA));
  assert.doesNotThrow(() => validarTransicao(STATUS.AGUARDANDO_PECA, STATUS.EM_ANDAMENTO));
  assert.doesNotThrow(() => validarTransicao(STATUS.EM_ANDAMENTO, STATUS.PRONTO_PARA_ENTREGA));
  assert.doesNotThrow(() => validarTransicao(STATUS.PRONTO_PARA_ENTREGA, STATUS.EM_ANDAMENTO));
  assert.doesNotThrow(() => validarTransicao(STATUS.PRONTO_PARA_ENTREGA, STATUS.ENTREGUE));
});

test('transições inválidas', () => {
  assert.throws(() => validarTransicao(STATUS.EM_ANDAMENTO, 'VOANDO'), ValidationError);
  assert.throws(() => validarTransicao(STATUS.EM_ANDAMENTO, STATUS.EM_ANDAMENTO), ConflictError);
  assert.throws(() => validarTransicao(STATUS.EM_ANDAMENTO, STATUS.ENTREGUE), ConflictError);
  assert.throws(() => validarTransicao(STATUS.ENTREGUE, STATUS.EM_ANDAMENTO), ConflictError);
});
