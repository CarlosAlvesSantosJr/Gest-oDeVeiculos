import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { criarApp } from './app.js';
import { criarConsumidor } from './consumidor.js';
import { criarProcessador } from './processador.js';
import { criarRegistro } from './registro.js';
import { criarProvedor } from './whatsapp.js';

const config = {
  porta: Number(process.env.PORT ?? 3002),
  dbPath: process.env.DB_PATH ?? './data/notificacoes.db',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  statusNotificaveis: (process.env.NOTIFICAR_STATUS ?? 'PRONTO_PARA_ENTREGA').split(',').map((s) => s.trim()).filter(Boolean),
  oficina: process.env.OFICINA_NOME ?? 'nossa oficina',
  horario: process.env.OFICINA_HORARIO ?? 'em nosso horário de atendimento',
  maxTentativas: Number(process.env.MAX_TENTATIVAS ?? 5),
  backoffMs: Number(process.env.BACKOFF_MS ?? 2000),
  permitidos: (process.env.WHATSAPP_PERMITIDOS ?? '').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean),
  managerToken: process.env.MANAGER_TOKEN ?? '',
};

const provedor = criarProvedor(process.env);
if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const registro = criarRegistro({ caminho: config.dbPath });
const processar = criarProcessador({
  provedor, registro, statusNotificaveis: config.statusNotificaveis, oficina: config.oficina, horario: config.horario,
  permitidos: config.permitidos,
});
const consumidor = criarConsumidor({
  url: config.rabbitUrl, processar, opcoesFalha: { maxTentativas: config.maxTentativas, backoffMs: config.backoffMs },
});

console.info(`[notification-service] provedor WhatsApp: ${provedor.nome}; notifica: ${config.statusNotificaveis.join(', ')}`);
if (config.permitidos.length) console.info(`[notification-service] modo restrito: só envia para ${config.permitidos.join(', ')}`);
provedor.iniciar?.().catch((erro) => console.error(`[notification-service] falha ao iniciar WhatsApp: ${erro.message}`));
consumidor.iniciar();

const servidor = criarApp({ registro, provedor, consumidor, managerToken: config.managerToken })
  .listen(config.porta, () => console.info(`[notification-service] ouvindo na porta ${config.porta}`));

async function encerrar() {
  servidor.close();
  await consumidor.parar();
  await provedor.parar?.();
  registro.fechar();
  process.exit(0);
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
