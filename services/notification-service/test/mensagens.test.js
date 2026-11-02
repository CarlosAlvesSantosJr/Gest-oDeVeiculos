import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarMensagem, statusSuportados } from '../src/mensagens.js';

const dados = {
  statusNovo: 'PRONTO_PARA_ENTREGA', clienteNome: 'Diego Rocha Silva', marca: 'Toyota', modelo: 'Corolla', placa: 'MNO1234',
  servico: 'Alinhamento e balanceamento',
};

test('mensagem de pronto para entrega é profissional e completa', () => {
  const { texto, variaveis } = montarMensagem(dados, { oficina: 'Mecânica Auto Marcas', horario: 'de segunda a sexta, das 8h às 18h' });
  const linhas = texto.split('\n');
  assert.equal(linhas[0], '*MECÂNICA AUTO MARCAS* 🔧', 'cabeçalho com o nome da oficina');
  assert.match(texto, /Olá, \*Diego\*!/);
  assert.match(texto, /\*pronto para retirada\*/);
  assert.match(texto, /🚗 \*Veículo:\* Toyota Corolla/);
  assert.match(texto, /🔖 \*Placa:\* MNO-1234/);
  assert.match(texto, /🛠️ \*Serviço:\* Alinhamento e balanceamento/);
  assert.match(texto, /🕗 \*Retirada:\* de segunda a sexta, das 8h às 18h\./);
  assert.equal(linhas.at(-1), '_Equipe Mecânica Auto Marcas_');
  assert.deepEqual(variaveis, ['Diego', 'Toyota Corolla', 'MNO-1234', 'Mecânica Auto Marcas']);
});

test('linha de serviço é omitida quando não informado', () => {
  const { texto } = montarMensagem({ ...dados, servico: '' });
  assert.doesNotMatch(texto, /Serviço:/);
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
