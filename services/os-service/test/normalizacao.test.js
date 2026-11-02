import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCadastrosAtivos } from '../src/normalizacao.js';
import { criarRepositorio } from '../src/repository.js';

const silencioso = { warn() {}, info() {}, error() {} };
const base = { placa: 'ABC1234', clienteTelefone: '5511999998888', servico: '', status: 'AGUARDANDO_ORCAMENTO' };

test('corrige maiúsculas de cadastros antigos e ignora os que já estão corretos', () => {
  const repo = criarRepositorio(':memory:');
  // Inserção direta simula dados gravados antes da regra existir.
  repo.criar({ ...base, marca: 'toyota', modelo: 'etios', cor: 'prata', clienteNome: 'carlos da silva' });
  repo.criar({ ...base, placa: 'XYZ9876', marca: 'Fiat', modelo: 'Uno', cor: 'Branco', clienteNome: 'Ana Souza' });

  assert.equal(normalizarCadastrosAtivos(repo, { logger: silencioso }), 1);
  const corrigida = repo.listar().find((o) => o.placa === 'ABC1234');
  assert.equal(corrigida.marca, 'Toyota');
  assert.equal(corrigida.modelo, 'Etios');
  assert.equal(corrigida.cor, 'Prata');
  assert.equal(corrigida.clienteNome, 'Carlos da Silva');
  assert.equal(normalizarCadastrosAtivos(repo, { logger: silencioso }), 0, 'segunda execução não altera nada');
});

test('completa o 9 de celulares antigos gravados sem ele', () => {
  const repo = criarRepositorio(':memory:');
  repo.criar({ ...base, clienteTelefone: '554891624394', marca: 'Fiat', modelo: 'Uno', cor: '', clienteNome: 'Ana' });
  assert.equal(normalizarCadastrosAtivos(repo, { logger: silencioso }), 1);
  assert.equal(repo.listar()[0].clienteTelefone, '5548991624394');
});

test('cadastro antigo inválido é mantido sem interromper os demais', () => {
  const repo = criarRepositorio(':memory:');
  repo.criar({ ...base, marca: 'vw', modelo: 'gol', cor: '', clienteNome: 'cliente 01' });
  repo.criar({ ...base, placa: 'XYZ9876', marca: 'fiat', modelo: 'uno', cor: '', clienteNome: 'ana' });
  assert.equal(normalizarCadastrosAtivos(repo, { logger: silencioso }), 1);
  assert.equal(repo.listar().find((o) => o.placa === 'ABC1234').clienteNome, 'cliente 01');
});
