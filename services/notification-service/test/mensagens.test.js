import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarMensagem, statusSuportados } from '../src/mensagens.js';

const dados = {
  statusNovo: 'PRONTO_PARA_ENTREGA', clienteNome: 'Diego Rocha Silva', marca: 'Toyota', modelo: 'Corolla', placa: 'MNO1234',
};

test('mensagem de pronto para entrega cita primeiro nome, veículo, placa e oficina', () => {
  const { texto, variaveis } = montarMensagem(dados, { oficina: 'Oficina do Zé', horario: 'até as 18h' });
  assert.match(texto, /^Olá, Diego!/);
  assert.match(texto, /Toyota Corolla/);
  assert.match(texto, /MNO-1234/);
  assert.match(texto, /PRONTO PARA ENTREGA/);
  assert.match(texto, /Oficina do Zé/);
  assert.match(texto, /até as 18h/);
  assert.deepEqual(variaveis, ['Diego', 'Toyota Corolla', 'MNO-1234', 'Oficina do Zé']);
});

test('placa Mercosul é mantida sem hífen', () => {
  const { texto } = montarMensagem({ ...dados, placa: 'BRA2E19' });
  assert.match(texto, /BRA2E19/);
});

test('há modelo para os 4 status do painel', () => {
  assert.deepEqual(statusSuportados().sort(),
    ['AGUARDANDO_ORCAMENTO', 'AGUARDANDO_PECA', 'EM_ANDAMENTO', 'PRONTO_PARA_ENTREGA']);
  for (const status of statusSuportados()) {
    assert.ok(montarMensagem({ ...dados, statusNovo: status }).texto.length > 20);
  }
});

test('status sem modelo lança erro', () => {
  assert.throws(() => montarMensagem({ ...dados, statusNovo: 'ENTREGUE' }));
});
