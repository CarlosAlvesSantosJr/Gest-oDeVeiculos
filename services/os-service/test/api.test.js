import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/app.js';
import { criarRepositorio } from '../src/repository.js';
import { criarHubSSE } from '../src/sse.js';

const TOKEN = 'segredo-gerente';
const silencioso = { warn() {}, info() {}, error() {} };
let servidor;
let base;
let repo;
let hub;

before(async () => {
  hub = criarHubSSE();
  // O repositório é trocado a cada teste através deste proxy.
  const repoProxy = new Proxy({}, { get: (_, prop) => repo[prop] });
  servidor = criarApp({ repo: repoProxy, hub, managerToken: TOKEN, logger: silencioso }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  hub.fechar();
  servidor.close();
});

beforeEach(() => { repo = criarRepositorio(':memory:'); });

const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const novaOS = {
  placa: 'QWE4R56', marca: 'Fiat', modelo: 'Argo', clienteNome: 'Bruno', clienteTelefone: '11987650002',
  servico: 'Troca de embreagem',
};

async function criar(corpo = novaOS) {
  return fetch(`${base}/api/ordens`, { method: 'POST', headers: auth, body: JSON.stringify(corpo) });
}

async function mudarStatus(id, status, headers = auth) {
  return fetch(`${base}/api/ordens/${id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
}

test('GET /health', async () => {
  const resp = await fetch(`${base}/health`);
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).status, 'ok');
});

test('GET /api/status lista os status com rótulos', async () => {
  const lista = await (await fetch(`${base}/api/status`)).json();
  assert.equal(lista.filter((s) => s.noPainel).length, 4);
  assert.ok(lista.some((s) => s.rotulo === 'Pronto para Entrega'));
});

test('POST /api/ordens exige token do gerente', async () => {
  const semToken = await fetch(`${base}/api/ordens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novaOS),
  });
  assert.equal(semToken.status, 401);
  const tokenErrado = await fetch(`${base}/api/ordens`, {
    method: 'POST', headers: { ...auth, Authorization: 'Bearer errado' }, body: JSON.stringify(novaOS),
  });
  assert.equal(tokenErrado.status, 401);
});

test('POST /api/auth/verificar valida o token', async () => {
  assert.equal((await fetch(`${base}/api/auth/verificar`, { method: 'POST', headers: auth })).status, 204);
  assert.equal((await fetch(`${base}/api/auth/verificar`, { method: 'POST' })).status, 401);
});

test('POST /api/ordens cria OS (201) e aparece no painel', async () => {
  const resp = await criar();
  assert.equal(resp.status, 201);
  const os = await resp.json();
  assert.equal(os.placa, 'QWE4R56');
  assert.equal(resp.headers.get('location'), `/api/ordens/${os.id}`);

  const painel = await (await fetch(`${base}/api/painel`)).json();
  assert.equal(painel.total, 1);
  assert.equal(painel.resumo.AGUARDANDO_ORCAMENTO, 1);
  assert.equal(painel.resumo.PRONTO_PARA_ENTREGA, 0);
  assert.equal(painel.ordens[0].marca, 'Fiat');
});

test('POST /api/ordens com dados inválidos retorna 400 com detalhes', async () => {
  const resp = await criar({ placa: '123' });
  assert.equal(resp.status, 400);
  const corpo = await resp.json();
  assert.ok(Array.isArray(corpo.detalhes) && corpo.detalhes.length > 0);
});

test('POST /api/ordens com JSON malformado retorna 400', async () => {
  const resp = await fetch(`${base}/api/ordens`, { method: 'POST', headers: auth, body: '{quebrado' });
  assert.equal(resp.status, 400);
});

test('POST /api/ordens com placa já ativa retorna 409', async () => {
  await criar();
  assert.equal((await criar()).status, 409);
});

test('PATCH status percorre o fluxo completo até a entrega', async () => {
  const os = await (await criar()).json();
  for (const status of ['AGUARDANDO_PECA', 'EM_ANDAMENTO', 'PRONTO_PARA_ENTREGA', 'ENTREGUE']) {
    const resp = await mudarStatus(os.id, status);
    assert.equal(resp.status, 200, status);
    assert.equal((await resp.json()).status, status);
  }
  const detalhe = await (await fetch(`${base}/api/ordens/${os.id}`)).json();
  assert.equal(detalhe.historico.length, 5);
  const painel = await (await fetch(`${base}/api/painel`)).json();
  assert.equal(painel.total, 0, 'veículo entregue sai do painel');
  const todas = await (await fetch(`${base}/api/ordens?incluirEntregues=true`)).json();
  assert.equal(todas.length, 1);
});

test('PATCH status: 401 sem token, 404 OS inexistente, 409 transição inválida, 400 status desconhecido', async () => {
  const os = await (await criar()).json();
  assert.equal((await mudarStatus(os.id, 'EM_ANDAMENTO', { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await mudarStatus('inexistente', 'EM_ANDAMENTO')).status, 404);
  assert.equal((await mudarStatus(os.id, 'ENTREGUE')).status, 409);
  assert.equal((await mudarStatus(os.id, 'XPTO')).status, 400);
});

async function editar(id, corpo, headers = auth) {
  return fetch(`${base}/api/ordens/${id}`, { method: 'PATCH', headers, body: JSON.stringify(corpo) });
}

test('POST /api/ordens devolve nomes com iniciais maiúsculas', async () => {
  const os = await (await criar({ ...novaOS, clienteNome: 'bruno de souza', marca: 'FIAT', modelo: 'argo' })).json();
  assert.equal(os.clienteNome, 'Bruno de Souza');
  assert.equal(os.marca, 'Fiat');
  assert.equal(os.modelo, 'Argo');
});

test('PATCH /api/ordens/:id edita dados do veículo', async () => {
  const os = await (await criar()).json();
  const resp = await editar(os.id, { modelo: 'argo trekking', cor: 'cinza', clienteTelefone: '21 99999-0000' });
  assert.equal(resp.status, 200);
  const editada = await resp.json();
  assert.equal(editada.modelo, 'Argo Trekking');
  assert.equal(editada.cor, 'Cinza');
  assert.equal(editada.clienteTelefone, '5521999990000');
  assert.deepEqual(editada.camposAlterados, ['modelo', 'cor', 'clienteTelefone']);
  const detalhe = await (await fetch(`${base}/api/ordens/${os.id}`)).json();
  assert.match(detalhe.historico.at(-1).observacao, /Dados alterados/);
});

test('PATCH /api/ordens/:id: 401 sem token, 400 inválido, 404 inexistente, 409 placa em uso', async () => {
  const os = await (await criar()).json();
  await criar({ ...novaOS, placa: 'ZZZ1A23' });
  assert.equal((await editar(os.id, { cor: 'Azul' }, { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await editar(os.id, { clienteNome: '123' })).status, 400);
  assert.equal((await editar(os.id, { status: 'ENTREGUE' })).status, 400);
  assert.equal((await editar('inexistente', { cor: 'Azul' })).status, 404);
  assert.equal((await editar(os.id, { placa: 'ZZZ1A23' })).status, 409);
});

test('rota inexistente retorna 404 JSON', async () => {
  const resp = await fetch(`${base}/api/nada`);
  assert.equal(resp.status, 404);
  assert.ok((await resp.json()).erro);
});

test('SSE envia ordem_criada e ordem_atualizada em tempo real ao painel', async () => {
  const controle = new AbortController();
  const resp = await fetch(`${base}/api/eventos/stream`, { signal: controle.signal });
  assert.equal(resp.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const leitor = resp.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';

  async function aguardarEvento(nome) {
    while (!buffer.includes(`event: ${nome}`)) {
      const { value, done } = await leitor.read();
      if (done) throw new Error('stream encerrado');
      buffer += decodificador.decode(value);
    }
    const bloco = buffer.slice(buffer.indexOf(`event: ${nome}`)).split('\n\n')[0];
    buffer = buffer.slice(buffer.indexOf(bloco) + bloco.length);
    return JSON.parse(bloco.split('\n').find((l) => l.startsWith('data: ')).slice(6));
  }

  while (hub.total === 0) await new Promise((r) => setTimeout(r, 5));
  const os = await (await criar()).json();
  const criada = await aguardarEvento('ordem_criada');
  assert.equal(criada.id, os.id);

  await mudarStatus(os.id, 'PRONTO_PARA_ENTREGA');
  const atualizada = await aguardarEvento('ordem_atualizada');
  assert.equal(atualizada.ordem.status, 'PRONTO_PARA_ENTREGA');
  assert.equal(atualizada.statusAnterior, 'AGUARDANDO_ORCAMENTO');
  controle.abort();
});
