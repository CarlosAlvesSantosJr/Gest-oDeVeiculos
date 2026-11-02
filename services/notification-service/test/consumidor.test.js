import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPOLOGIA, decidirFalha, montarTopologia } from '../src/consumidor.js';
import { ErroWhatsApp } from '../src/whatsapp.js';

test('erro temporário é retentado com backoff exponencial', () => {
  const erro = new ErroWhatsApp('HTTP 500');
  assert.deepEqual(decidirFalha(erro, 1, { backoffMs: 1000 }), { acao: 'retentar', atrasoMs: 1000 });
  assert.deepEqual(decidirFalha(erro, 2, { backoffMs: 1000 }), { acao: 'retentar', atrasoMs: 2000 });
  assert.deepEqual(decidirFalha(erro, 3, { backoffMs: 1000 }), { acao: 'retentar', atrasoMs: 4000 });
});

test('vai para DLQ ao exceder tentativas', () => {
  assert.equal(decidirFalha(new Error('x'), 5, { maxTentativas: 5 }).acao, 'dlq');
});

test('erro permanente e JSON inválido vão direto para DLQ', () => {
  assert.equal(decidirFalha(new ErroWhatsApp('número inválido', { permanente: true }), 1).acao, 'dlq');
  let erroJson;
  try { JSON.parse('{x'); } catch (e) { erroJson = e; }
  assert.equal(decidirFalha(erroJson, 1).acao, 'dlq');
});

test('topologia declara exchange topic, DLX, fila durável com DLQ e bindings de status', async () => {
  const chamadas = [];
  const canal = new Proxy({}, { get: (_, metodo) => async (...args) => chamadas.push([metodo, ...args]) });
  await montarTopologia(canal);
  assert.deepEqual(chamadas, [
    ['assertExchange', TOPOLOGIA.exchange, 'topic', { durable: true }],
    ['assertExchange', TOPOLOGIA.dlx, 'fanout', { durable: true }],
    ['assertQueue', TOPOLOGIA.dlq, { durable: true }],
    ['bindQueue', TOPOLOGIA.dlq, TOPOLOGIA.dlx, ''],
    ['assertQueue', TOPOLOGIA.fila, { durable: true, deadLetterExchange: TOPOLOGIA.dlx }],
    ['bindQueue', TOPOLOGIA.fila, TOPOLOGIA.exchange, 'os.status.*'],
  ]);
});
