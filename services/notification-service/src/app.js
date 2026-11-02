import express from 'express';

export function criarApp({ registro, provedor, consumidor }) {
  const app = express();
  app.disable('x-powered-by');

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

  app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  return app;
}
