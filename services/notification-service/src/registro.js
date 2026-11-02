// Registro das notificações enviadas + controle de idempotência por eventId
// (o broker entrega "at-least-once", então o mesmo evento pode chegar mais de uma vez).
// Persistido em SQLite para sobreviver a reinícios do serviço.
import { DatabaseSync } from 'node:sqlite';

export function criarRegistro({ caminho = ':memory:', limite = 500 } = {}) {
  const db = new DatabaseSync(caminho);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS notificacoes (
      seq           INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id      TEXT NOT NULL,
      placa         TEXT,
      status        TEXT NOT NULL,
      dados         TEXT NOT NULL,
      registrado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_evento ON notificacoes(event_id, status);
    CREATE INDEX IF NOT EXISTS idx_notif_placa ON notificacoes(placa);
  `);

  const stmt = {
    processado: db.prepare(`SELECT 1 FROM notificacoes WHERE event_id = ? AND status <> 'FALHA' LIMIT 1`),
    inserir: db.prepare('INSERT INTO notificacoes (event_id, placa, status, dados, registrado_em) VALUES (?, ?, ?, ?, ?)'),
    listar: db.prepare('SELECT dados, registrado_em FROM notificacoes ORDER BY seq DESC LIMIT ?'),
    listarPorPlaca: db.prepare('SELECT dados, registrado_em FROM notificacoes WHERE placa = ? ORDER BY seq DESC LIMIT ?'),
  };

  const mapear = (linha) => ({ ...JSON.parse(linha.dados), registradoEm: linha.registrado_em });

  return {
    jaProcessado: (eventId) => Boolean(stmt.processado.get(eventId)),
    registrar(item) {
      stmt.inserir.run(item.eventId, item.placa ?? null, item.status, JSON.stringify(item), new Date().toISOString());
    },
    listar: ({ placa } = {}) =>
      (placa ? stmt.listarPorPlaca.all(placa, limite) : stmt.listar.all(limite)).map(mapear),
    fechar: () => db.close(),
  };
}
