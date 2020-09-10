import WebSocket from 'ws';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import jasmine = require('jasmine');

import { ProtoframePubsub } from '../src';
import { cacheProtocol, CacheProtocol } from './protocols/cache';

let wss: WebSocket.Server,
  clientWebsocket: WebSocket,
  serverWebsocket: WebSocket;

async function createCacheWithClient(): Promise<
  [
    ProtoframePubsub<CacheProtocol>,
    ProtoframePubsub<CacheProtocol>,
    { [key: string]: string },
  ]
> {
  console.log('Starting server');
  wss = new WebSocket.Server({ port: 8080 });
  const promisifiedServerSocket = new Promise<WebSocket>((resolve) => {
    wss.on('connection', (ws) => {
      console.log('Server received connection!');
      resolve(ws);
      ws.on('message', (msg) => {
        console.log('Server received message');
        console.log(msg);
      });
    });
  });
  clientWebsocket = await new Promise<WebSocket>((resolve) => {
    const cs = new WebSocket('ws://127.0.0.1:8080');
    cs.on('open', () => {
      resolve(cs);
    });
    cs.on('message', (msg) => {
      console.log('Client received message');
      console.log(msg);
    });
  });
  serverWebsocket = await promisifiedServerSocket;
  console.log('Resolved client & server');
  const server = new ProtoframePubsub(cacheProtocol, serverWebsocket);
  const client = new ProtoframePubsub(cacheProtocol, clientWebsocket);

  const data: { [key: string]: string } = {};
  server.handleTell('set', ({ key, value }) => (data[key] = value));
  server.handleTell('delete', ({ key }) => delete data[key]);
  server.handleAsk('get', async ({ key }) => {
    const value = key in data ? data[key] : null;
    return { value };
  });
  return [server, client, data];
}

async function testFullyFunctionalCache(
  client: ProtoframePubsub<CacheProtocol>,
): Promise<void> {
  // There should be no value
  expect((await client.ask('get', { key: 'key0' })).value).toBeNull;

  // Set a value
  client.tell('set', { key: 'key0', value: 'value' });

  // There should now be a value
  expect((await client.ask('get', { key: 'key0' })).value).toBe('value');

  // Delete the value
  client.tell('delete', { key: 'key0' });

  // There should no longer be a value
  expect((await client.ask('get', { key: 'key0' })).value).toBeNull();
}

describe('ProtoframePubsub', () => {
  describe('ask', () => {
    it('should allow two way communication across a window', async () => {
      const [server, client] = await createCacheWithClient();
      try {
        await testFullyFunctionalCache(client);
      } finally {
        server.destroy();
        client.destroy();
      }
    });
  });
});
