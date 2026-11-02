import { validarEdicaoOS } from './domain.js';

// Aplica a regra de iniciais maiúsculas (e o 9 dos celulares) aos veículos ativos cadastrados antes dela existir.
// Registros que não passam na validação atual são mantidos como estão.
export function normalizarCadastrosAtivos(repo, { logger = console } = {}) {
  let corrigidos = 0;
  for (const ordem of repo.listar()) {
    try {
      const dados = validarEdicaoOS({
        marca: ordem.marca, modelo: ordem.modelo, cor: ordem.cor, clienteNome: ordem.clienteNome,
        ...(ordem.clienteTelefone ? { clienteTelefone: ordem.clienteTelefone } : {}),
      });
      if (repo.editar(ordem.id, dados).alterados.length) corrigidos += 1;
    } catch (erro) {
      logger.warn(`[normalizacao] OS ${ordem.placa} mantida sem ajuste: ${erro.message}`);
    }
  }
  return corrigidos;
}
