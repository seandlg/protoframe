# protoframe-ws [WIP]

A small (dependency-free) library for defining _typed JSON protocols_ on top of `WebSockets`. **Heavily** based on [protoframe](https://github.com/mrvisser/protoframe).

## Problem

You have a `client`-`server` architecture and are using [ws](https://www.npmjs.com/package/ws) for `WebSocket`-based communcation. You would like to create some sort of JSON-based `API` for communication.

## Solution

This library allows you to define a protocol for this type of communication
supporting both fire-and-forget (`tell`) semantics, as well as request/response
(`ask`) semantics. It provides connector constructors that will facilitate the
sending and receiving of these messages across `clients` & `servers`.

This is achieved by creating a `ProtocolDescriptor`, which wraps a fully-connected Websocket (`readyState=1`) and provides an `object` that allows for _registering message handlers_ as well as _sending messages_.

`protoframe-ws` processes messages that were registered by it by creating `eventHandlers`. It is not involved with connection establishment & its `eventHandler` must be cleared when the connection is terminated.

## How?

`npm install protoframe-ws --save` [Coming soon]

### ProtoframeDescriptor

Your protocol is a simple interface that extends `Protoframe`. It consists of messages, that are either of `tell` or `ask` semantic. `ask` messages must have a `response` field, whereas `tell` messages must not.

Concretely, you define messages as `key-value`-pairs, where the `key` represents a message-identifier, and the `value` represents an `object`. This `object` has a `body` (for both `ask` and `tell` messages) and optionally a `response` (only for `ask` messages). Inside the `body` of both `body` & `response`, you define your typed message contents.

```typescript
import { Protoframe } from 'protoframe';

export interface CacheProtocol {
  // Get a key from a cache
  get: {
    body: {
      key: string;
    };
    response: {
      value: string | null;
    };
  };
  // Set a key in a cache
  set: {
    body: {
      key: string;
      value: string;
    };
  };
  // Delete an item in the cache
  delete: {
    body: {
      key: string;
    };
  };
}
```

Before getting started, you must further namespace your protocol. Essentially, you assign the
protocol a `type`, that is used to seperate different protocols from
one another. This way, you can have multiple protocols, with potentially
the same messages, seperate from one another.

```typescript
import { ProtoframeDescriptor } from 'protoframe';

const cacheProtocolDescriptor: ProtoframeDescriptor<cacheProtocol> = {
  type: 'cache',
};
```

### WebSocket connections

The actual connections are established as pure `websockets`. `protoframe` sits on top of these `websockets` to handle messaging.

Things look very similar for `clients` & `servers`, though the server creates multiple `ProtoframePubsub`s (one for each client).

**Server:**

```typescript
import WebSocket from 'ws';
import { ProtoframePubsub } from '../src';

// Array to hold all connections
const clientPubSubs: ProtoframePubsub[] = [];
const data = {};

(async () => {
  const wss = new WebSocket.Server({ port: 8080 });
  wss.on('connection', (ws) => {
    const clientPubSub = new ProtoframePubsub(cacheProtocolDescriptor, ws);
    // Cache the client for later use
    clientPubSubs.push(clientPubSub);
    clientPubSub.handleTell('set', ({ key, value }) => (data[key] = value));
    clientPubSub.handleTell('delete', ({ key }) => delete data[key]);
    clientPubSub.handleAsk('get', async ({ key }) => {
      const value = key in data ? data[key] : null;
      return { value };
    });
  });
})();
```

**Client:**

```typescript
import WebSocket from 'ws';
import { ProtoframePubsub } from '../src';

(async () => {
  const clientSocket = new WebSocket('ws://127.0.0.1:8080');
  const pubSub = new ProtoframePubsub(cacheProtocolDescriptor, clientSocket);
  pubSub.tell('setBar', { key: 'my key', value: 'my value' });
  // value = { value: 'my value' }
  const value = await pubSub.ask('getFoo', { key: 'my key' });
})();
```
