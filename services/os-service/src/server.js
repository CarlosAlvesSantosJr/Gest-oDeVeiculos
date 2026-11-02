import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { criarApp } from './app.js';
import { criarPublicadorRabbit } from './broker.js';
import { validarNovaOS } from './domain.js';
import { normalizarCadastrosAtivos } from './normalizacao.js';
import { criarRelayOutbox } from './outbox.js';
import { criarRepositorio } from './repository.js';
import { VEICULOS_DEMO } from './seed.js';
import { criarHubSSE } from './sse.js';

const config = {
  porta: Number(process.env.PORT ?? 3001),
  dbPath: process.env.DB_PATH ?? './data/oficina.db',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  exchange: process.env.RABBITMQ_EXCHANGE ?? 'oficina.eventos',
  managerToken: process.env.MANAGER_TOKEN ?? '',
  seedDemo: process.env.SEED_DEMO === 'true',
};

if (!config.managerToken) {
  console.warn('[os-service] MANAGER_TOKEN não definido: escrita liberada sem autenticação!');
}

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const repo = criarRepositorio(config.dbPath);

if (config.seedDemo && repo.listar({ incluirEntregues: true }).length === 0) {
  for (const veiculo of VEICULOS_DEMO) repo.criar(validarNovaOS(veiculo));
  console.info(`[os-service] ${VEICULOS_DEMO.length} veículos de demonstração cadastrados`);
}

const corrigidos = normalizarCadastrosAtivos(repo);
if (corrigidos) console.info(`[os-service] ${corrigidos} cadastro(s) ajustado(s) para iniciais maiúsculas`);

const hub = criarHubSSE();
const publicador = criarPublicadorRabbit({ url: config.rabbitUrl, exchange: config.exchange });
const relay = criarRelayOutbox({ repo, publicar: publicador.publicar });
relay.iniciar();

const servidor = criarApp({ repo, hub, managerToken: config.managerToken })
  .listen(config.porta, () => console.info(`[os-service] ouvindo na porta ${config.porta}`));

async function encerrar(sinal) {
  console.info(`[os-service] ${sinal} recebido, encerrando...`);
  relay.parar();
  hub.fechar();
  servidor.close();
  await publicador.fechar();
  repo.fechar();
  process.exit(0);
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
