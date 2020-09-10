import WebSocket from 'ws';

import {
  Protoframe,
  ProtoframeMessageType,
  ProtoframeMessageResponse,
  ProtoframeMessageBody,
  ProtoframeDescriptor,
  ProtoframePayloadBody,
  ProtoframePayloadResponse,
  ProtoframeAction,
} from './types';
import { hasValue } from './util';

type SystemProtocol = {
  ping: {
    body: {};
    response: {};
  };
};

function mkPayloadType<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  action: ProtoframeAction,
  type: T,
): string {
  return `${protocol.type}#${action}#${type}`;
}

function mkPayloadBody<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  action: ProtoframeAction,
  type: T,
  body: ProtoframeMessageBody<P, T>,
): ProtoframePayloadBody<P, T> {
  return {
    body,
    type: mkPayloadType(protocol, action, type),
  };
}

function mkPayloadResponse<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  type: T,
  response: ProtoframeMessageResponse<P, T>,
): ProtoframePayloadResponse<P, T> {
  return {
    response,
    type: mkPayloadType(protocol, 'ask', type),
  };
}

function isPayloadBodyOfType<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  action: ProtoframeAction,
  type: T,
  payload: { type?: string; body?: unknown } | undefined,
): payload is ProtoframePayloadBody<P, T> {
  if (hasValue(payload)) {
    const payloadType = payload.type;
    if (hasValue(payloadType) && hasValue(payload.body)) {
      const [p, a, t] = payloadType.split('#');
      return p === protocol.type && a === action && t === type;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function isPayloadResponseOfType<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  R extends ProtoframePayloadResponse<P, T>
>(
  protocol: ProtoframeDescriptor<P>,
  type: T,
  payload: { type?: string; response?: unknown } | undefined,
): payload is R {
  if (hasValue(payload)) {
    const payloadType = payload.type;
    if (hasValue(payloadType) && hasValue(payload.response)) {
      const [p, a, t] = payloadType.split('#');
      return p === protocol.type && a === 'ask' && t === type;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function destroyAll(listeners: [WebSocket, (ev: any) => void][]): void {
  listeners.forEach(([w, l]) => w.removeEventListener('message', l));
  listeners.length = 0;
}

function awaitResponse<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  R extends ProtoframeMessageResponse<P, T>
>(
  webSocket: WebSocket,
  protocol: ProtoframeDescriptor<P>,
  type: T,
): Promise<R> {
  return new Promise((accept) => {
    const handle: (ev: any) => void = (ev) => {
      const payload = JSON.parse(ev.data);
      if (isPayloadResponseOfType(protocol, type, payload)) {
        webSocket.removeEventListener('message', handle);
        accept(payload.response);
      }
    };
    webSocket.addEventListener('message', handle);
  });
}

function handleTell0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  _R extends ProtoframeMessageResponse<P, T> & undefined
>(
  webSocket: WebSocket,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  handler: (body: ProtoframeMessageBody<P, T>) => void,
): [WebSocket, (ev: MessageEvent) => void] {
  const listener = (ev: any): void => {
    const payload = JSON.parse(ev.data);
    if (isPayloadBodyOfType(protocol, 'tell', type, payload)) {
      handler(payload.body);
    }
  };
  webSocket.addEventListener('message', listener);
  return [webSocket, listener];
}

function handleAsk0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  R extends ProtoframeMessageResponse<P, T> & {}
>(
  webSocket: WebSocket,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  handler: (body: ProtoframeMessageBody<P, T>) => Promise<R>,
): [WebSocket, (ev: MessageEvent) => void] {
  const listener = async (ev: any): Promise<void> => {
    console.log('ASK LISTENER TRIGGERED!');
    console.log(JSON.parse(ev.data));
    const payload = JSON.parse(ev.data);
    if (isPayloadBodyOfType(protocol, 'ask', type, payload)) {
      const response = await handler(payload.body);
      webSocket.send(
        JSON.stringify(mkPayloadResponse(protocol, type, response)),
      );
    }
  };
  webSocket.addEventListener('message', listener);
  return [webSocket, listener];
}

function tell0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  _R extends ProtoframeMessageResponse<P, T> & undefined
>(
  webSocket: WebSocket,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  body: ProtoframeMessageBody<P, T>,
): _R {
  return webSocket.send(
    JSON.stringify(mkPayloadBody(protocol, 'tell', type, body)),
  ) as _R;
}

async function ask0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  B extends ProtoframeMessageBody<P, T>,
  R extends ProtoframeMessageResponse<P, T> & {}
>(
  webSocket: WebSocket,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  body: B,
  timeout: number,
): Promise<R> {
  const run = new Promise<R>(async (accept, reject) => {
    const timeoutHandler = setTimeout(
      () => reject(new Error(`Failed to get response within ${timeout}ms`)),
      timeout,
    );
    const response = await awaitResponse(webSocket, protocol, type);
    clearTimeout(timeoutHandler);
    accept(response);
  });
  webSocket.send(JSON.stringify(mkPayloadBody(protocol, 'ask', type, body)));
  return run;
}

interface AbstractProtoframeSubscriber<P extends Protoframe> {
  /**
   * Handle a message that was sent with the [[ProtoframePublisher.tell]]
   * function.
   *
   * @param type The message type being handled
   * @param handler The handler function for the message
   */
  handleTell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(
    type: T,
    handler: (body: ProtoframeMessageBody<P, T>) => void,
  ): void;
}

interface AbstractProtoframePublisher<P extends Protoframe> {
  /**
   * Send a message to a receiving connector. This is a fire-and-forget emitter
   * that does not accept a response. If you want a request-response workflow,
   * use [[ProtoframePubsub.ask]].
   *
   * @param type The message type being sent
   * @param body The body of the message to send
   */
  tell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(
    type: T,
    body: ProtoframeMessageBody<P, T>,
  ): void;
}

interface AbstractProtoframePubsub<P extends Protoframe>
  extends AbstractProtoframeSubscriber<P>,
    AbstractProtoframePublisher<P> {
  /**
   * Send an "ask" message to the receiving connector. On the other end, a
   * connector would have invoked `handleAsk` in order to receive this message
   * and issue a response.
   *
   * The promise returned by this call will resolve when a response as been
   * received from the target connector, or if the timeout has been exceeded
   *
   * @param type The message type being asked
   * @param body The body of the ask message
   * @param timeout How long to wait for a response before the resulting promise
   *  is rejected with a timeout error.
   */
  ask<
    T extends ProtoframeMessageType<P>,
    B extends ProtoframeMessageBody<P, T>,
    R extends ProtoframeMessageResponse<P, T> & {}
  >(
    type: T,
    body: B,
    timeout?: number,
  ): Promise<R>;

  /**
   * Handle an "ask" message and provide a response. This is invoked when the
   * asking connector has invoked the `ask` method of the pubsub connector.
   *
   * @param type The message type being listened to
   * @param handler The message handler that eventually returns a response
   */
  handleAsk<
    T extends ProtoframeMessageType<P>,
    R extends ProtoframeMessageResponse<P, T> & {}
  >(
    type: T,
    handler: (body: ProtoframeMessageBody<P, T>) => Promise<R>,
  ): void;
}

export class ProtoframeSubscriber<P extends Protoframe>
  implements AbstractProtoframeSubscriber<P> {
  constructor(
    private readonly protocol: ProtoframeDescriptor<P>,
    private readonly webSocket: WebSocket,
  ) {}

  private listeners: [WebSocket, (ev: MessageEvent) => void][] = [];

  public handleTell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(type: T, handler: (body: ProtoframeMessageBody<P, T>) => void): void {
    this.listeners.push(
      handleTell0(this.webSocket, this.protocol, type, handler),
    );
  }

  destroy(): void {
    destroyAll(this.listeners);
  }
}

export class ProtoframePublisher<P extends Protoframe>
  implements AbstractProtoframePublisher<P> {
  /**
   * We are a "parent" page that is embedding an iframe, and we wish to connect
   * to that iframe in order to publish messages.
   *
   * @param protocol The protocol this connector will communicate with
   */

  private listeners: [WebSocket, (ev: any) => void][] = [];

  constructor(
    private readonly protocol: ProtoframeDescriptor<P>,
    private readonly webSocket: WebSocket,
  ) {}

  tell<T extends ProtoframeMessageType<P>, _R extends undefined>(
    type: T,
    body: P[T]['body'],
  ): void {
    tell0(this.webSocket, this.protocol, type, body);
  }

  destroy(): void {
    destroyAll(this.listeners);
  }
}

export class ProtoframePubsub<P extends Protoframe>
  implements AbstractProtoframePubsub<P> {
  /**
   * Connect to the target configured in the supplied pubsub connector by
   * sending ping requests over and over until we get a response.
   *
   * @param pubsub The pubsub connector to wait until is "connected" to its
   *  target
   * @param retries How many times to retry and ping the target. By default,
   *  this will retry 50 times (thus waiting 25 seconds total)
   * @param timeout How long to wait for a response from the target before
   *  retrying. By default the timeout is 500ms (thus waiting 25 seconds total)
   */

  /**
   * We are a "parent" page that is embedding an iframe, and we wish to connect
   * to that iframe for communication.
   *
   * @param protocol The protocol this connector will communicate with
   * @param webSocket The target Websocket we are connecting to
   */

  /**
   * We are an "iframe" page that will be embedded, and we wish to connect to a
   * parent page for communication.
   *
   * @param protocol The protocol this connector will communicate with
   * @param webSocket The target Websocket
   */
  public static webSocket<P extends Protoframe>(
    protocol: ProtoframeDescriptor<P>,
    webSocket: WebSocket,
  ): ProtoframePubsub<P> {
    return new ProtoframePubsub(protocol, webSocket);
  }

  private systemProtocol: ProtoframeDescriptor<SystemProtocol> = {
    type: `system|${this.protocol.type}`,
  };
  private listeners: [WebSocket, (ev: MessageEvent) => void][] = [];

  constructor(
    private readonly protocol: ProtoframeDescriptor<P>,
    private readonly webSocket: WebSocket,
  ) {
    // Answer internally to ping requests
    handleAsk0(webSocket, this.systemProtocol, 'ping', () =>
      Promise.resolve({}),
    );
  }

  /**
   * Send a 'ping' request to check if there is a listener open at the target
   * websocket. If this times out, then it means no listener was available *at the
   * time the ping request was sent*. Since requests are not buffered, then this
   * should be retried if we're waiting for some target websocket to start up and
   * load its assets. See `ProtoframePubsub.connect` as an implementation of
   * this functionality.
   *
   * @param timeout How long to wait for the reply before resulting in an error
   */
  public async ping({ timeout = 10000 }: { timeout?: number }): Promise<void> {
    await ask0(this.webSocket, this.systemProtocol, 'ping', {}, timeout);
  }

  public handleTell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(type: T, handler: (body: ProtoframeMessageBody<P, T>) => void): void {
    this.listeners.push(
      handleTell0(this.webSocket, this.protocol, type, handler),
    );
  }

  public tell<T extends ProtoframeMessageType<P>, _R extends undefined>(
    type: T,
    body: P[T]['body'],
  ): void {
    tell0(this.webSocket, this.protocol, type, body);
  }

  public handleAsk<
    T extends ProtoframeMessageType<P>,
    R extends P[T]['response'] & {}
  >(type: T, handler: (body: P[T]['body']) => Promise<R>): void {
    this.listeners.push(
      handleAsk0(this.webSocket, this.protocol, type, handler),
    );
  }

  public ask<
    T extends ProtoframeMessageType<P>,
    B extends P[T]['body'],
    R extends P[T]['response'] & {}
  >(type: T, body: B, timeout = 10000): Promise<R> {
    return ask0(this.webSocket, this.protocol, type, body, timeout);
  }

  destroy(): void {
    destroyAll(this.listeners);
  }
}
