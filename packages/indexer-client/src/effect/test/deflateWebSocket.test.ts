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
import { strToU8, zlibSync } from 'fflate';
import { GRAPHQL_TRANSPORT_WS_PROTOCOL } from 'graphql-ws';
import { describe, expect, it } from 'vitest';
import { GRAPHQL_TRANSPORT_WS_DEFLATE, makeDeflateWebSocket } from '../DeflateWebSocket.js';

/**
 * The socket the wrapper sits on top of. A hand-written fake rather than a mock: it records what the wrapper did to it
 * and lets a test deliver a frame, which is everything these tests need to observe.
 */
interface FakeSocket {
  readonly url: string | URL;
  readonly protocols: string | string[] | undefined;
  binaryType: WebSocket['binaryType'];
  readyState: number;
  protocol: string;
  onmessage: ((event: MessageEvent) => void) | null;
  readonly sent: string[];
  readonly closeCalls: { readonly code: number | undefined; readonly reason: string | undefined }[];
}

/**
 * A `typeof WebSocket` stand-in that opens no connection, appending each construction to `instances`.
 *
 * Mutation is deliberate and confined to this test fake: the wrapper reaches its underlying socket through assignments
 * and method calls, so recording them is inherently stateful. `.claude/rules/functional-style.md` permits this for test
 * setup.
 */
const makeFakeBase = (instances: FakeSocket[]): typeof WebSocket => {
  class FakeWebSocket implements FakeSocket {
    readonly url: string | URL;
    readonly protocols: string | string[] | undefined;
    binaryType: WebSocket['binaryType'] = 'blob';
    readyState = 0;
    protocol = '';
    onmessage: ((event: MessageEvent) => void) | null = null;
    readonly sent: string[] = [];
    readonly closeCalls: { readonly code: number | undefined; readonly reason: string | undefined }[] = [];

    constructor(url: string | URL, protocols?: string | string[]) {
      this.url = url;
      this.protocols = protocols;
      instances.push(this);
    }

    send(data: string): void {
      this.sent.push(data);
    }

    close(code?: number, reason?: string): void {
      this.closeCalls.push({ code, reason });
    }
  }

  // Type cast required because: `typeof WebSocket` describes the full DOM constructor, while the wrapper only ever
  // touches the members implemented above — implementing the remainder would add noise without adding coverage.
  return FakeWebSocket as unknown as typeof WebSocket;
};

/** The slice of the wrapper's surface `graphql-ws` uses, which is all these tests exercise. */
interface WrapperSocket {
  readonly readyState: number;
  readonly protocol: string;
  onmessage: WebSocket['onmessage'];
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Builds a standalone `ArrayBuffer` so `event.data instanceof ArrayBuffer` holds, as it does for a real binary frame. */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const binaryFrame = (data: ArrayBuffer): MessageEvent => new MessageEvent('message', { data });

const deflated = (json: string): ArrayBuffer => toArrayBuffer(zlibSync(strToU8(json)));

/** Constructs the wrapper over a fresh fake, returning both halves. */
const connect = (): { readonly socket: WrapperSocket; readonly fake: FakeSocket } => {
  const instances: FakeSocket[] = [];
  const DeflateWebSocket = makeDeflateWebSocket(makeFakeBase(instances));
  // Type cast required because: the constructor is typed to return `unknown` for graphql-ws's `webSocketImpl` option,
  // so the surface under test has to be named here.
  const socket = new DeflateWebSocket('ws://indexer.test/graphql/ws', GRAPHQL_TRANSPORT_WS_PROTOCOL) as WrapperSocket;
  return { socket, fake: instances[0] };
};

describe('makeDeflateWebSocket', () => {
  describe('subprotocol negotiation', () => {
    it('should offer the deflate subprotocol ahead of the standard one, replacing what graphql-ws asked for', () => {
      const { fake } = connect();

      // Both must be offered, deflate first: the indexer requires the standard protocol alongside the variant, and
      // ordering is what expresses the preference. graphql-ws's own single-protocol argument is discarded.
      expect(fake.protocols).toEqual([GRAPHQL_TRANSPORT_WS_DEFLATE, GRAPHQL_TRANSPORT_WS_PROTOCOL]);
    });

    it('should switch the underlying socket to arraybuffer frames', () => {
      const { fake } = connect();

      // Without this the compressed frames would arrive as Blobs and the inflate path would never match.
      expect(fake.binaryType).toBe('arraybuffer');
    });
  });

  describe('inbound frames', () => {
    it('should inflate a zlib binary frame into the text message graphql-ws expects', () => {
      const { socket, fake } = connect();
      const payload = JSON.stringify({ type: 'next', id: '1', payload: { data: { blocks: [1, 2, 3] } } });
      const received: MessageEvent[] = [];
      socket.onmessage = (event) => received.push(event);

      fake.onmessage?.(binaryFrame(deflated(payload)));

      expect(received).toHaveLength(1);
      expect(received[0].data).toBe(payload);
    });

    it('should pass a corrupt binary frame through untouched, leaving graphql-ws to reject it', () => {
      const { socket, fake } = connect();
      // Not valid zlib — inflation must fail.
      const corrupt = binaryFrame(toArrayBuffer(new Uint8Array([0x00, 0x01, 0x02, 0x03])));
      const received: MessageEvent[] = [];
      socket.onmessage = (event) => received.push(event);

      fake.onmessage?.(corrupt);

      // The very same event, not a rewritten one: graphql-ws's message parsing then fails and closes the socket with
      // 4400 Bad Response, which is the right treatment for a malformed server message. Swallowing it or throwing
      // inside the handler would both strand the client instead.
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(corrupt);
    });

    it('should leave text frames untouched', () => {
      const { socket, fake } = connect();
      // Messages below the server's 256 B compression threshold stay plain text and must not be touched.
      const ack = new MessageEvent('message', { data: JSON.stringify({ type: 'connection_ack' }) });
      const received: MessageEvent[] = [];
      socket.onmessage = (event) => received.push(event);

      fake.onmessage?.(ack);

      expect(received).toEqual([ack]);
    });

    it('should clear the underlying handler when onmessage is set to null', () => {
      const { socket, fake } = connect();
      socket.onmessage = () => undefined;

      socket.onmessage = null;

      // A wrapper that installed its own closure regardless would keep the socket referenced and keep delivering.
      expect(fake.onmessage).toBeNull();
    });
  });

  describe('delegation to the underlying socket', () => {
    it('should report the underlying readyState and negotiated protocol', () => {
      const { socket, fake } = connect();
      fake.readyState = 1;
      fake.protocol = GRAPHQL_TRANSPORT_WS_DEFLATE;

      expect(socket.readyState).toBe(1);
      expect(socket.protocol).toBe(GRAPHQL_TRANSPORT_WS_DEFLATE);
    });

    it('should forward sends and closes', () => {
      const { socket, fake } = connect();

      socket.send('{"type":"ping"}');
      socket.close(1000, 'done');

      expect(fake.sent).toEqual(['{"type":"ping"}']);
      expect(fake.closeCalls).toEqual([{ code: 1000, reason: 'done' }]);
    });

    it('should expose the readyState constants graphql-ws reads off the constructor', () => {
      const DeflateWebSocket = makeDeflateWebSocket(makeFakeBase([]));

      expect([
        DeflateWebSocket.CONNECTING,
        DeflateWebSocket.OPEN,
        DeflateWebSocket.CLOSING,
        DeflateWebSocket.CLOSED,
      ]).toEqual([0, 1, 2, 3]);
    });
  });
});
