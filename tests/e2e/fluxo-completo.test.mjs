// Teste ponta a ponta contra a stack em Docker (gateway -> os-service -> RabbitMQ -> notification-service).
// Uso: docker compose up -d --build && npm run test:e2e
import { before, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const TOKEN = process.env.MANAGER_TOKEN ?? 'gerente123';
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Placa única por execução (formato Mercosul) para o teste poder rodar várias vezes.
const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const sorteio = (n) => Array.from({ length: n }, () => letras[Math.floor(Math.random() * 26)]).join('');
const PLACA = `${sorteio(3)}${Math.floor(Math.random() * 10)}${sorteio(1)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;

async function aguardar(condicao, { timeoutMs = 30000, intervaloMs = 500, descricao }) {
  const limite = Date.now() + timeoutMs;
  let ultimo;
  while (Date.now() < limite) {
    try {
      ultimo = await condicao();
      if (ultimo) return ultimo;
    } catch (erro) { ultimo = erro; }
    await esperar(intervaloMs);
  }
  throw new Error(`Timeout aguardando: ${descricao} (último: ${ultimo})`);
}

before(async () => {
  await aguardar(async () => (await fetch(`${BASE}/api/painel`)).ok, { timeoutMs: 90000, descricao: 'gateway/os-service' });
});

test('painel central e app do gerente são servidos pelo gateway', async () => {
  const painel = await fetch(`${BASE}/`);
  assert.equal(painel.status, 200);
  assert.match(await painel.text(), /Auto Marcas · Painel/);
  assert.equal((await fetch(`${BASE}/assets/logo-512.png`)).headers.get('content-type'), 'image/png');
  const gerente = await fetch(`${BASE}/gerente/`);
  assert.equal(gerente.status, 200);
  assert.match(await gerente.text(), /Acesso do gerente/);
  // Sem a barra final, o redirecionamento deve manter host e porta (acesso pelo celular).
  const semBarra = await fetch(`${BASE}/gerente`, { redirect: 'manual' });
  assert.equal(semBarra.status, 301);
  assert.equal(semBarra.headers.get('location'), '/gerente/');
  const seguindo = await fetch(`${BASE}/gerente`);
  assert.equal(seguindo.status, 200);
  assert.equal(new URL(seguindo.url).port, new URL(BASE).port);
  const manifesto = await fetch(`${BASE}/gerente/manifest.webmanifest`);
  assert.equal((await manifesto.json()).start_url, '/gerente/');
});

test('fluxo completo: entrada -> peça -> andamento -> pronto (WhatsApp) -> entregue', async () => {
  // Painel conectado ao stream de tempo real
  const controle = new AbortController();
  const stream = await fetch(`${BASE}/api/eventos/stream`, { signal: controle.signal });
  assert.equal(stream.status, 200);
  const leitor = stream.body.getReader();
  let recebido = '';
  const lendo = (async () => {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        recebido += dec.decode(value);
      }
    } catch { /* abortado */ }
  })();

  // Gerente cadastra o veículo pelo celular
  const criar = await fetch(`${BASE}/api/ordens`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      placa: PLACA, marca: 'Renault', modelo: 'Kwid', cor: 'Branco',
      // Telefone com DDD 00 não existe: o teste nunca envia WhatsApp real para ninguém.
      clienteNome: 'MARIA DA SILVA TESTE', clienteTelefone: '(00) 90000-0000', servico: 'Teste E2E',
    }),
  });
  assert.equal(criar.status, 201);
  const os = await criar.json();
  assert.equal(os.clienteNome, 'Maria da Silva Teste', 'nome com iniciais maiúsculas');

  // Gerente corrige dados do veículo pela aba de edição
  const edicao = await fetch(`${BASE}/api/ordens/${os.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ cor: 'prata', modelo: 'kwid zen' }),
  });
  assert.equal(edicao.status, 200);
  assert.equal((await edicao.json()).modelo, 'Kwid Zen');

  // Sem token não altera
  const negado = await fetch(`${BASE}/api/ordens/${os.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'EM_ANDAMENTO' }),
  });
  assert.equal(negado.status, 401);

  for (const status of ['AGUARDANDO_PECA', 'EM_ANDAMENTO', 'PRONTO_PARA_ENTREGA']) {
    const r = await fetch(`${BASE}/api/ordens/${os.id}/status`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status }) });
    assert.equal(r.status, 200, `mudança para ${status}`);
  }

  // Painel central reflete o status
  const painel = await (await fetch(`${BASE}/api/painel`)).json();
  const noPainel = painel.ordens.find((o) => o.id === os.id);
  assert.equal(noPainel.status, 'PRONTO_PARA_ENTREGA');
  assert.equal(noPainel.marca, 'Renault');

  // Stream SSE recebeu as atualizações
  await aguardar(() => recebido.includes('PRONTO_PARA_ENTREGA') && recebido.includes(os.id), {
    timeoutMs: 5000, intervaloMs: 100, descricao: 'evento SSE',
  });

  // Mensageria: notification-service consumiu o evento e enviou o WhatsApp
  const notificacoes = await aguardar(async () => {
    const lista = await (await fetch(`${BASE}/api/notificacoes?placa=${PLACA}`)).json();
    return lista.length ? lista : null;
  }, { descricao: 'WhatsApp de veículo pronto' });
  assert.equal(notificacoes.length, 1, 'apenas o status PRONTO_PARA_ENTREGA gera WhatsApp');
  // ENVIADA no modo mock; com WhatsApp real o número fictício (DDD 00) não existe ou está fora da lista de permitidos.
  assert.ok(['ENVIADA', 'NAO_PERMITIDO', 'FALHA'].includes(notificacoes[0].status), notificacoes[0].status);
  assert.equal(notificacoes[0].para, '5500900000000');
  assert.match(notificacoes[0].texto, /Renault Kwid Zen/, 'mensagem usa os dados editados');
  assert.match(notificacoes[0].texto, /pronto para retirada/);

  // Entrega remove do painel
  const entregue = await fetch(`${BASE}/api/ordens/${os.id}/status`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'ENTREGUE' }),
  });
  assert.equal(entregue.status, 200);
  const depois = await (await fetch(`${BASE}/api/painel`)).json();
  assert.ok(!depois.ordens.some((o) => o.id === os.id));

  controle.abort();
  await lendo;
});
