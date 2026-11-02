import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { STATUS, STATUS_LABEL, STATUS_PAINEL, validarEdicaoOS, validarNovaOS } from './domain.js';

function tokensIguais(recebido, esperado) {
  const a = createHash('sha256').update(String(recebido)).digest();
  const b = createHash('sha256').update(String(esperado)).digest();
  return timingSafeEqual(a, b);
}

export function criarApp({ repo, hub, managerToken, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Operações de escrita exigem o token do gerente (enviado pelo app do celular).
  function exigirGerente(req, res, next) {
    if (!managerToken) return next();
    const cabecalho = req.get('authorization') || '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
    if (!token || !tokensIguais(token, managerToken)) {
      return res.status(401).json({ erro: 'Token do gerente inválido ou ausente' });
    }
    return next();
  }

  app.get('/health', (req, res) => res.json({ status: 'ok', servico: 'os-service', clientesTempoReal: hub.total }));

  app.get('/api/status', (req, res) => {
    res.json(Object.values(STATUS).map((codigo) => ({
      codigo,
      rotulo: STATUS_LABEL[codigo],
      noPainel: STATUS_PAINEL.includes(codigo),
    })));
  });

  app.post('/api/auth/verificar', exigirGerente, (req, res) => res.status(204).end());

  app.get('/api/painel', (req, res) => {
    const ordens = repo.listar();
    const resumo = Object.fromEntries(STATUS_PAINEL.map((s) => [s, 0]));
    for (const ordem of ordens) resumo[ordem.status] += 1;
    res.json({ geradoEm: new Date().toISOString(), resumo, total: ordens.length, ordens });
  });

  app.get('/api/ordens', (req, res) => {
    res.json(repo.listar({ incluirEntregues: req.query.incluirEntregues === 'true' }));
  });

  app.get('/api/ordens/:id', (req, res) => {
    const ordem = repo.buscar(req.params.id);
    res.json({ ...ordem, historico: repo.historico(ordem.id) });
  });

  app.post('/api/ordens', exigirGerente, (req, res) => {
    const ordem = repo.criar(validarNovaOS(req.body));
    hub.emitir('ordem_criada', ordem);
    res.status(201).location(`/api/ordens/${ordem.id}`).json(ordem);
  });

  app.patch('/api/ordens/:id', exigirGerente, (req, res) => {
    const { ordem, alterados } = repo.editar(req.params.id, validarEdicaoOS(req.body));
    if (alterados.length) hub.emitir('ordem_atualizada', { ordem, statusAnterior: ordem.status, camposAlterados: alterados });
    res.json({ ...ordem, camposAlterados: alterados });
  });

  app.patch('/api/ordens/:id/status', exigirGerente, (req, res) => {
    const { status, observacao } = req.body ?? {};
    const { ordem, evento } = repo.atualizarStatus(req.params.id, status, { observacao });
    hub.emitir('ordem_atualizada', { ordem, statusAnterior: evento.dados.statusAnterior });
    res.json(ordem);
  });

  app.get('/api/eventos/stream', (req, res) => hub.conectar(req, res));

  app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

  // eslint-disable-next-line no-unused-vars
  app.use((erro, req, res, next) => {
    if (erro.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    if (erro.httpStatus) {
      return res.status(erro.httpStatus).json({ erro: erro.message, detalhes: erro.detalhes });
    }
    logger.error(erro);
    return res.status(500).json({ erro: 'Erro interno' });
  });

  return app;
}
