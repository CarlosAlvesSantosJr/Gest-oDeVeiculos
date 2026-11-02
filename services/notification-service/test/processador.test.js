import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarProcessador, telefoneCanonico } from '../src/processador.js';
import { criarRegistro } from '../src/registro.js';
import { ErroWhatsApp } from '../src/whatsapp.js';

const silencioso = { info() {}, warn() {}, error() {} };

function evento(extra = {}, eventId = 'ev-1') {
  return {
    eventId,
    tipo: 'OS_STATUS_ALTERADO',
    dados: {
      osId: 'os-1', placa: 'ABC1D23', marca: 'Fiat', modelo: 'Uno', clienteNome: 'Ana',
      clienteTelefone: '5511999998888', statusAnterior: 'EM_ANDAMENTO', statusNovo: 'PRONTO_PARA_ENTREGA', ...extra,
    },
  };
}

let enviadas;
let registro;
let processar;
let falhar;

beforeEach(() => {
  enviadas = [];
  falhar = null;
  registro = criarRegistro();
  const provedor = {
    nome: 'teste',
    async enviar(msg) {
      if (falhar) throw falhar;
      enviadas.push(msg);
      return { id: `id-${enviadas.length}` };
    },
  };
  processar = criarProcessador({
    provedor, registro, statusNotificaveis: ['PRONTO_PARA_ENTREGA'], oficina: 'Oficina Teste', logger: silencioso,
  });
});

test('envia WhatsApp quando o veículo fica pronto para entrega', async () => {
  const r = await processar(evento());
  assert.equal(r.acao, 'enviado');
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].para, '5511999998888');
  assert.match(enviadas[0].texto, /pronto para retirada/);
  const [item] = registro.listar();
  assert.equal(item.status, 'ENVIADA');
  assert.equal(item.idProvedor, 'id-1');
  assert.equal(item.placa, 'ABC1D23');
});

test('ignora status não configurados e outros tipos de evento', async () => {
  assert.equal((await processar(evento({ statusNovo: 'EM_ANDAMENTO' }))).acao, 'ignorado');
  assert.equal((await processar({ tipo: 'OS_CRIADA', dados: {} })).acao, 'ignorado');
  assert.equal((await processar(null)).acao, 'ignorado');
  assert.equal(enviadas.length, 0);
});

test('é idempotente: evento duplicado não gera segunda mensagem', async () => {
  await processar(evento());
  assert.equal((await processar(evento())).acao, 'duplicado');
  assert.equal(enviadas.length, 1);
});

test('mesmo veículo pronto novamente (novo evento) gera nova mensagem', async () => {
  await processar(evento({}, 'ev-1'));
  await processar(evento({}, 'ev-2'));
  assert.equal(enviadas.length, 2);
});

test('cliente sem telefone é registrado e não envia', async () => {
  const r = await processar(evento({ clienteTelefone: null }));
  assert.equal(r.acao, 'ignorado');
  assert.equal(registro.listar()[0].status, 'SEM_TELEFONE');
});

test('falha no provedor é registrada, propagada e permite nova tentativa', async () => {
  falhar = new ErroWhatsApp('timeout');
  await assert.rejects(processar(evento()), /timeout/);
  assert.equal(registro.listar()[0].status, 'FALHA');
  falhar = null;
  assert.equal((await processar(evento())).acao, 'enviado');
});

test('com lista de permitidos, só envia para os números da lista', async () => {
  const restrito = criarProcessador({
    provedor: { nome: 'teste', enviar: async (m) => { enviadas.push(m); return { id: 'x' }; } },
    registro,
    statusNotificaveis: ['PRONTO_PARA_ENTREGA'],
    permitidos: ['5548999990000'],
    logger: silencioso,
  });
  const bloqueado = await restrito(evento());
  assert.equal(bloqueado.acao, 'ignorado');
  assert.equal(registro.listar()[0].status, 'NAO_PERMITIDO');
  assert.equal(enviadas.length, 0);

  const liberado = await restrito(evento({ clienteTelefone: '5548999990000' }, 'ev-2'));
  assert.equal(liberado.acao, 'enviado');
  assert.equal(enviadas[0].para, '5548999990000');
});

test('lista de permitidos reconhece o mesmo celular com e sem o 9', async () => {
  const restrito = criarProcessador({
    provedor: { nome: 'teste', enviar: async (m) => { enviadas.push(m); return { id: 'x' }; } },
    registro,
    statusNotificaveis: ['PRONTO_PARA_ENTREGA'],
    permitidos: ['5548999990000'],
    logger: silencioso,
  });
  assert.equal((await restrito(evento({ clienteTelefone: '554899990000' }))).acao, 'enviado');
  assert.equal(telefoneCanonico('554899990000'), '5548999990000');
  assert.equal(telefoneCanonico('554832221111'), '554832221111', 'fixo não muda');
});

test('registro filtra por placa', async () => {
  await processar(evento());
  await processar(evento({ placa: 'XYZ9999' }, 'ev-9'));
  assert.equal(registro.listar({ placa: 'XYZ9999' }).length, 1);
  assert.equal(registro.listar().length, 2);
});
