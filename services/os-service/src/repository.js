// Persistência em SQLite (node:sqlite) com Transactional Outbox:
// a alteração da OS e o evento a publicar são gravados na mesma transação.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, STATUS, validarTransicao } from './domain.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ordens (
  id               TEXT PRIMARY KEY,
  placa            TEXT NOT NULL,
  marca            TEXT NOT NULL,
  modelo           TEXT NOT NULL,
  cor              TEXT,
  cliente_nome     TEXT NOT NULL,
  cliente_telefone TEXT,
  servico          TEXT,
  status           TEXT NOT NULL,
  criado_em        TEXT NOT NULL,
  atualizado_em    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ordens_status ON ordens(status);
CREATE TABLE IF NOT EXISTS historico (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ordem_id        TEXT NOT NULL REFERENCES ordens(id),
  status_anterior TEXT,
  status_novo     TEXT NOT NULL,
  observacao      TEXT,
  ocorrido_em     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id           TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL,
  routing_key  TEXT NOT NULL,
  payload      TEXT NOT NULL,
  criado_em    TEXT NOT NULL,
  publicado_em TEXT,
  tentativas   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outbox_pendente ON outbox(publicado_em, criado_em);
`;

function mapearOrdem(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    placa: linha.placa,
    marca: linha.marca,
    modelo: linha.modelo,
    cor: linha.cor || '',
    clienteNome: linha.cliente_nome,
    clienteTelefone: linha.cliente_telefone,
    servico: linha.servico || '',
    status: linha.status,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

export function criarRepositorio(caminho = ':memory:', { agora = () => new Date() } = {}) {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const stmt = {
    inserir: db.prepare(`INSERT INTO ordens
      (id, placa, marca, modelo, cor, cliente_nome, cliente_telefone, servico, status, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    buscar: db.prepare('SELECT * FROM ordens WHERE id = ?'),
    ativaPorPlaca: db.prepare(`SELECT id FROM ordens WHERE placa = ? AND status <> '${STATUS.ENTREGUE}'`),
    listarAtivas: db.prepare(`SELECT * FROM ordens WHERE status <> '${STATUS.ENTREGUE}' ORDER BY atualizado_em ASC`),
    listarTodas: db.prepare('SELECT * FROM ordens ORDER BY atualizado_em DESC'),
    atualizarStatus: db.prepare('UPDATE ordens SET status = ?, atualizado_em = ? WHERE id = ?'),
    inserirHistorico: db.prepare(`INSERT INTO historico (ordem_id, status_anterior, status_novo, observacao, ocorrido_em)
      VALUES (?, ?, ?, ?, ?)`),
    historico: db.prepare(`SELECT status_anterior, status_novo, observacao, ocorrido_em
      FROM historico WHERE ordem_id = ? ORDER BY id ASC`),
    inserirOutbox: db.prepare(`INSERT INTO outbox (id, tipo, routing_key, payload, criado_em) VALUES (?, ?, ?, ?, ?)`),
    outboxPendentes: db.prepare(`SELECT * FROM outbox WHERE publicado_em IS NULL ORDER BY criado_em ASC, rowid ASC LIMIT ?`),
    marcarPublicado: db.prepare('UPDATE outbox SET publicado_em = ? WHERE id = ?'),
    registrarFalha: db.prepare('UPDATE outbox SET tentativas = tentativas + 1 WHERE id = ?'),
  };

  function transacao(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const resultado = fn();
      db.exec('COMMIT');
      return resultado;
    } catch (erro) {
      db.exec('ROLLBACK');
      throw erro;
    }
  }

  function enfileirarEvento(tipo, routingKey, dados, quando) {
    const evento = { eventId: randomUUID(), tipo, ocorridoEm: quando, dados };
    stmt.inserirOutbox.run(evento.eventId, tipo, routingKey, JSON.stringify(evento), quando);
    return evento;
  }

  function criar(dados) {
    return transacao(() => {
      if (stmt.ativaPorPlaca.get(dados.placa)) {
        throw new ConflictError(`Já existe uma ordem de serviço ativa para a placa ${dados.placa}`);
      }
      const id = randomUUID();
      const quando = agora().toISOString();
      stmt.inserir.run(id, dados.placa, dados.marca, dados.modelo, dados.cor ?? '', dados.clienteNome,
        dados.clienteTelefone ?? null, dados.servico ?? '', dados.status, quando, quando);
      stmt.inserirHistorico.run(id, null, dados.status, 'Entrada do veículo na oficina', quando);
      const ordem = mapearOrdem(stmt.buscar.get(id));
      enfileirarEvento('OS_CRIADA', 'os.criada', ordem, quando);
      return ordem;
    });
  }

  function buscar(id) {
    const ordem = mapearOrdem(stmt.buscar.get(id));
    if (!ordem) throw new NotFoundError(`Ordem de serviço ${id} não encontrada`);
    return ordem;
  }

  function atualizarStatus(id, statusNovo, { observacao = '' } = {}) {
    return transacao(() => {
      const atual = buscar(id);
      validarTransicao(atual.status, statusNovo);
      const quando = agora().toISOString();
      const obs = String(observacao ?? '').trim().slice(0, 300);
      stmt.atualizarStatus.run(statusNovo, quando, id);
      stmt.inserirHistorico.run(id, atual.status, statusNovo, obs, quando);
      const ordem = buscar(id);
      const evento = enfileirarEvento('OS_STATUS_ALTERADO', `os.status.${statusNovo}`, {
        osId: ordem.id,
        placa: ordem.placa,
        marca: ordem.marca,
        modelo: ordem.modelo,
        cor: ordem.cor,
        clienteNome: ordem.clienteNome,
        clienteTelefone: ordem.clienteTelefone,
        statusAnterior: atual.status,
        statusNovo,
        observacao: obs,
      }, quando);
      return { ordem, evento };
    });
  }

  const COLUNAS_EDITAVEIS = {
    placa: 'placa',
    marca: 'marca',
    modelo: 'modelo',
    cor: 'cor',
    clienteNome: 'cliente_nome',
    clienteTelefone: 'cliente_telefone',
    servico: 'servico',
  };
  const ROTULOS_CAMPOS = {
    placa: 'placa', marca: 'marca', modelo: 'modelo', cor: 'cor',
    clienteNome: 'nome do cliente', clienteTelefone: 'telefone', servico: 'serviço',
  };

  function editar(id, dados) {
    return transacao(() => {
      const atual = buscar(id);
      if (atual.status === STATUS.ENTREGUE) {
        throw new ConflictError('Ordem de serviço já foi entregue e não pode ser editada');
      }
      const alterados = Object.keys(dados).filter((c) => c in COLUNAS_EDITAVEIS && dados[c] !== atual[c]);
      if (!alterados.length) return { ordem: atual, alterados };

      if (alterados.includes('placa')) {
        const outra = stmt.ativaPorPlaca.get(dados.placa);
        if (outra && outra.id !== id) {
          throw new ConflictError(`Já existe uma ordem de serviço ativa para a placa ${dados.placa}`);
        }
      }

      const quando = agora().toISOString();
      const sets = alterados.map((c) => `${COLUNAS_EDITAVEIS[c]} = ?`).join(', ');
      db.prepare(`UPDATE ordens SET ${sets}, atualizado_em = ? WHERE id = ?`)
        .run(...alterados.map((c) => dados[c]), quando, id);
      stmt.inserirHistorico.run(id, atual.status, atual.status,
        `Dados alterados: ${alterados.map((c) => ROTULOS_CAMPOS[c]).join(', ')}`, quando);
      const ordem = buscar(id);
      enfileirarEvento('OS_DADOS_ALTERADOS', 'os.dados.alterados', {
        osId: id,
        camposAlterados: alterados,
        antes: Object.fromEntries(alterados.map((c) => [c, atual[c]])),
        depois: Object.fromEntries(alterados.map((c) => [c, ordem[c]])),
      }, quando);
      return { ordem, alterados };
    });
  }

  function listar({ incluirEntregues = false } = {}) {
    const linhas = incluirEntregues ? stmt.listarTodas.all() : stmt.listarAtivas.all();
    return linhas.map(mapearOrdem);
  }

  function historico(id) {
    buscar(id);
    return stmt.historico.all(id).map((h) => ({
      statusAnterior: h.status_anterior,
      statusNovo: h.status_novo,
      observacao: h.observacao || '',
      ocorridoEm: h.ocorrido_em,
    }));
  }

  function outboxPendentes(limite = 50) {
    return stmt.outboxPendentes.all(limite).map((linha) => ({
      id: linha.id,
      routingKey: linha.routing_key,
      tentativas: linha.tentativas,
      evento: JSON.parse(linha.payload),
    }));
  }

  return {
    criar,
    buscar,
    atualizarStatus,
    editar,
    listar,
    historico,
    outboxPendentes,
    marcarPublicado: (id) => stmt.marcarPublicado.run(agora().toISOString(), id),
    registrarFalha: (id) => stmt.registrarFalha.run(id),
    fechar: () => db.close(),
  };
}
