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
  [
    { name: 'server', obj: wss },
    { name: 'clientWebsocket', obj: clientWebsocket },
    { name: 'serverWebsocket', obj: serverWebsocket },
  ].forEach(({ name, obj }) => {
    try {
      obj.close();
    } catch {
      console.log(`Cannot close ${name}. ${name} not running.`);
    }
  });
  wss = new WebSocket.Server({ port: 8080 });
  const promisifiedServerSocket = new Promise<WebSocket>((resolve) => {
    wss.on('connection', (ws) => {
      resolve(ws);
    });
  });
  clientWebsocket = await new Promise<WebSocket>((resolve) => {
    const cs = new WebSocket('ws://127.0.0.1:8080');
    cs.on('open', () => {
      resolve(cs);
    });
  });
  serverWebsocket = await promisifiedServerSocket;
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
    it('should get info from the caching server.', async () => {
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
