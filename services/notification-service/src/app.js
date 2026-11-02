import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

function tokensIguais(recebido, esperado) {
  const a = createHash('sha256').update(String(recebido)).digest();
  const b = createHash('sha256').update(String(esperado)).digest();
  return timingSafeEqual(a, b);
}

export function criarApp({ registro, provedor, consumidor, managerToken = '' }) {
  const app = express();
  app.disable('x-powered-by');

  // Pareamento e desconexão do WhatsApp são restritos ao gerente.
  function exigirGerente(req, res, next) {
    if (!managerToken) return next();
    const cabecalho = req.get('authorization') || '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
    if (!token || !tokensIguais(token, managerToken)) {
      return res.status(401).json({ erro: 'Token do gerente inválido ou ausente' });
    }
    return next();
  }

  app.get('/health', (req, res) => {
    const ok = consumidor?.conectado ?? true;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degradado',
      servico: 'notification-service',
      provedorWhatsApp: provedor.nome,
      broker: ok ? 'conectado' : 'desconectado',
    });
  });

  // Auditoria das mensagens enviadas (usado pelo painel do gerente e pelos testes E2E).
  app.get('/api/notificacoes', (req, res) => {
    res.json(registro.listar({ placa: req.query.placa ? String(req.query.placa).toUpperCase() : undefined }));
  });

  // Estado da conexão do WhatsApp (QR code / código de pareamento quando o provedor é "web").
  app.get('/api/whatsapp/status', exigirGerente, (req, res) => {
    res.json(provedor.status?.() ?? { provedor: provedor.nome, estado: 'conectado' });
  });

  app.post('/api/whatsapp/desconectar', exigirGerente, async (req, res) => {
    if (!provedor.desconectar) return res.status(409).json({ erro: `Provedor ${provedor.nome} não usa sessão` });
    await provedor.desconectar();
    return res.status(202).json({ mensagem: 'Sessão encerrada; um novo pareamento será solicitado' });
  });

  app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  return app;
}
