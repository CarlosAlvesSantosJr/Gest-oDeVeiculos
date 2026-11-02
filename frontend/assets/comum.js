// Utilitários compartilhados pelo painel central e pelo app do gerente.
export const STATUS = [
  { codigo: 'AGUARDANDO_ORCAMENTO', rotulo: 'Aguardando Orçamento', curto: 'Orçamento', icone: '📋' },
  { codigo: 'AGUARDANDO_PECA', rotulo: 'Aguardando Peça', curto: 'Peça', icone: '📦' },
  { codigo: 'EM_ANDAMENTO', rotulo: 'Em Andamento', curto: 'Andamento', icone: '🔧' },
  { codigo: 'PRONTO_PARA_ENTREGA', rotulo: 'Pronto para Entrega', curto: 'Pronto', icone: '✅' },
];

export const rotuloStatus = (codigo) =>
  STATUS.find((s) => s.codigo === codigo)?.rotulo ?? (codigo === 'ENTREGUE' ? 'Entregue' : codigo);

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function formatarPlaca(placa) {
  const p = String(placa ?? '').toUpperCase();
  return /^[A-Z]{3}[0-9]{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export function tempoDesde(iso, agora = Date.now()) {
  const min = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h${min % 60 ? ` ${min % 60}min` : ''}`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
}

export function placaHTML(placa, classe = '') {
  return `<span class="placa ${classe}" aria-label="Placa ${esc(placa)}">
    <span class="placa-faixa">BRASIL</span><span class="placa-num">${esc(formatarPlaca(placa))}</span></span>`;
}

// Assina o stream SSE; reconecta sozinho e avisa o estado da conexão.
export function assinarEventos({ aoMudar, aoConectar, aoDesconectar }) {
  let fonte;
  function abrir() {
    fonte = new EventSource('/api/eventos/stream');
    fonte.onopen = () => aoConectar?.();
    fonte.onerror = () => aoDesconectar?.();
    fonte.addEventListener('ordem_criada', (e) => aoMudar('criada', JSON.parse(e.data)));
    fonte.addEventListener('ordem_atualizada', (e) => aoMudar('atualizada', JSON.parse(e.data)));
  }
  abrir();
  return () => fonte?.close();
}
