// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { strFromU8, unzlibSync } from 'fflate';
import { GRAPHQL_TRANSPORT_WS_PROTOCOL } from 'graphql-ws';

/**
 * The indexer's opt-in compression subprotocol. Servers offering it send graphql-transport-ws JSON messages of >= 256
 * bytes as binary frames containing the zlib-compressed (RFC 1950) UTF-8 JSON; smaller messages remain plain text
 * frames. See midnight-indexer `indexer-api/src/infra/api/v4/ws_deflate.rs` for the wire format.
 */
export const GRAPHQL_TRANSPORT_WS_DEFLATE = 'graphql-transport-ws+deflate';

/**
 * The wrapper's constructor shape, as consumed by `graphql-ws`'s `webSocketImpl` option (typed `unknown` there).
 * Deliberately not `typeof WebSocket`: only the surface `graphql-ws` uses is implemented — which includes the
 * readyState constants it reads off the constructor itself, hence their presence here.
 */
export type DeflateWebSocketConstructor = {
  new (url: string | URL, protocols?: string | string[]): unknown;
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSING: number;
  readonly CLOSED: number;
};

/**
 * Creates a WebSocket-constructor for `graphql-ws`'s `webSocketImpl` option that negotiates the indexer's
 * {@link GRAPHQL_TRANSPORT_WS_DEFLATE} subprotocol and transparently inflates the resulting binary frames back into the
 * text messages `graphql-ws` expects.
 *
 * `graphql-ws` hardcodes the offered subprotocol to `graphql-transport-ws`, so this wrapper replaces the offer with
 * both protocols; per the indexer's wire contract the standard protocol must be offered alongside the deflate variant.
 * Against a server that does not offer the deflate variant, negotiation falls back to the standard protocol and this
 * wrapper is a pass-through.
 *
 * Only the surface `graphql-ws` actually uses is exposed: the readyState statics, `readyState`, `send`, `close`, and
 * the `onopen`/`onmessage`/`onclose`/`onerror` setters.
 *
 * @param Base - The underlying WebSocket constructor (default: the global `WebSocket`)
 */
export const makeDeflateWebSocket = (Base: typeof WebSocket = WebSocket): DeflateWebSocketConstructor =>
  class DeflateWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly #socket: WebSocket;

    // graphql-ws passes its hardcoded subprotocol as the second argument; it is deliberately
    // ignored and replaced with the deflate + standard pair.
    constructor(url: string | URL, _protocols?: string | string[]) {
      this.#socket = new Base(url, [GRAPHQL_TRANSPORT_WS_DEFLATE, GRAPHQL_TRANSPORT_WS_PROTOCOL]);
      this.#socket.binaryType = 'arraybuffer';
    }

    get readyState(): number {
      return this.#socket.readyState;
    }

    get protocol(): string {
      return this.#socket.protocol;
    }

    set onopen(handler: WebSocket['onopen']) {
      this.#socket.onopen = handler;
    }

    set onclose(handler: WebSocket['onclose']) {
      this.#socket.onclose = handler;
    }

    set onerror(handler: WebSocket['onerror']) {
      this.#socket.onerror = handler;
    }

    set onmessage(handler: WebSocket['onmessage']) {
      this.#socket.onmessage =
        handler &&
        ((event) => {
          handler.call(this.#socket, event.data instanceof ArrayBuffer ? inflate(event) : event);
        });
    }

    send(data: string): void {
      this.#socket.send(data);
    }

    close(code?: number, reason?: string): void {
      this.#socket.close(code, reason);
    }
  };

// On a corrupt frame the original binary event is passed through instead: graphql-ws's own
// message parsing then fails and closes the socket with 4400 Bad Response, which is exactly
// the treatment a malformed server message deserves.
const inflate = (event: MessageEvent): MessageEvent => {
  try {
    // Type cast required because: the `instanceof ArrayBuffer` check at the call site narrows
    // `event.data`, but the narrowing does not survive extraction into this helper.
    const data = strFromU8(unzlibSync(new Uint8Array(event.data as ArrayBuffer)));
    return new MessageEvent('message', { data });
  } catch {
    return event;
  }
};
