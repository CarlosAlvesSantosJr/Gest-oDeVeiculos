// Hub de Server-Sent Events: empurra mudanças em tempo real para o painel central e celulares.
export function criarHubSSE({ intervaloPingMs = 25000 } = {}) {
  const clientes = new Set();

  function conectar(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    clientes.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), intervaloPingMs);
    req.on('close', () => {
      clearInterval(ping);
      clientes.delete(res);
    });
  }

  function emitir(evento, dados) {
    const mensagem = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const cliente of clientes) cliente.write(mensagem);
  }

  return {
    conectar,
    emitir,
    get total() { return clientes.size; },
    fechar() {
      for (const cliente of clientes) cliente.end();
      clientes.clear();
    },
  };
}
