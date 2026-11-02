import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictError, STATUS, ValidationError, normalizarPlaca, normalizarTelefone, placaValida,
  formatarNomeProprio, validarEdicaoOS, validarNovaOS, validarTransicao,
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

test('formatarNomeProprio: nomes de pessoa com preposições minúsculas', () => {
  assert.equal(formatarNomeProprio('joão da silva'), 'João da Silva');
  assert.equal(formatarNomeProprio('ANA MARIA DOS SANTOS'), 'Ana Maria dos Santos');
  assert.equal(formatarNomeProprio('  pedro   e   paulo  '), 'Pedro e Paulo');
  assert.equal(formatarNomeProprio("maria-clara d'ávila"), "Maria-Clara D'Ávila");
  assert.equal(formatarNomeProprio('Carlos McDonald'), 'Carlos McDonald', 'caixa mista intencional é preservada');
  assert.equal(formatarNomeProprio('da silva'), 'Da Silva', 'primeira palavra sempre maiúscula');
});

test('formatarNomeProprio: dados do veículo preservam siglas, versões e números', () => {
  const v = (s) => formatarNomeProprio(s, { tipo: 'veiculo' });
  assert.equal(v('volkswagen'), 'Volkswagen');
  assert.equal(v('bmw'), 'BMW');
  assert.equal(v('mercedes-benz'), 'Mercedes-Benz');
  assert.equal(v('onix ltz'), 'Onix LTZ');
  assert.equal(v('hb20 vision'), 'HB20 Vision');
  assert.equal(v('gol 1.6'), 'Gol 1.6');
  assert.equal(v('Corolla XEi'), 'Corolla XEi');
  assert.equal(v('azul marinho'), 'Azul Marinho');
});

test('validarNovaOS aplica a capitalização em cliente, marca, modelo e cor', () => {
  const os = validarNovaOS({ ...valido, clienteNome: 'JOSÉ DE OLIVEIRA', marca: 'fiat', modelo: 'argo drive', cor: 'vermelho' });
  assert.equal(os.clienteNome, 'José de Oliveira');
  assert.equal(os.marca, 'Fiat');
  assert.equal(os.modelo, 'Argo Drive');
  assert.equal(os.cor, 'Vermelho');
});

test('validarNovaOS rejeita nome de cliente com números ou curto demais', () => {
  assert.throws(() => validarNovaOS({ ...valido, clienteNome: 'Joao123' }), ValidationError);
  assert.throws(() => validarNovaOS({ ...valido, clienteNome: 'J' }), ValidationError);
  assert.throws(() => validarNovaOS({ ...valido, clienteNome: '---' }), ValidationError);
});

test('validarEdicaoOS valida só os campos enviados', () => {
  assert.deepEqual(validarEdicaoOS({ modelo: 'uno mille', cor: 'branco' }), { modelo: 'Uno Mille', cor: 'Branco' });
  assert.deepEqual(validarEdicaoOS({ clienteTelefone: '(21) 99999-0000' }), { clienteTelefone: '5521999990000' });
  assert.throws(() => validarEdicaoOS({}), ValidationError);
  assert.throws(() => validarEdicaoOS({ marca: '' }), ValidationError);
  assert.throws(() => validarEdicaoOS({ placa: '123' }), ValidationError);
  assert.throws(() => validarEdicaoOS({ status: 'ENTREGUE' }), /Dados da edição inválidos/);
});
