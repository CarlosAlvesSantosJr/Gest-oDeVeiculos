// Publicador RabbitMQ (exchange topic) com reconexão preguiçosa e publisher confirms.
import amqp from 'amqplib';

export function criarPublicadorRabbit({ url, exchange = 'oficina.eventos', logger = console }) {
  let conexao = null;
  let canal = null;

  async function garantirCanal() {
    if (canal) return canal;
    const novaConexao = await amqp.connect(url);
    novaConexao.on('error', (erro) => logger.warn(`[rabbitmq] erro de conexão: ${erro.message}`));
    novaConexao.on('close', () => {
      conexao = null;
      canal = null;
    });
    const novoCanal = await novaConexao.createConfirmChannel();
    novoCanal.on('close', () => { canal = null; });
    await novoCanal.assertExchange(exchange, 'topic', { durable: true });
    conexao = novaConexao;
    canal = novoCanal;
    logger.info(`[rabbitmq] conectado, exchange "${exchange}"`);
    return canal;
  }

  async function publicar(routingKey, evento) {
    const ch = await garantirCanal();
    await new Promise((resolve, reject) => {
      ch.publish(exchange, routingKey, Buffer.from(JSON.stringify(evento)), {
        persistent: true,
        contentType: 'application/json',
        messageId: evento.eventId,
        type: evento.tipo,
        timestamp: Date.now(),
      }, (erro) => (erro ? reject(erro) : resolve()));
    });
  }

  async function fechar() {
    try { await conexao?.close(); } catch { /* já fechada */ }
  }

  return { publicar, fechar };
}
