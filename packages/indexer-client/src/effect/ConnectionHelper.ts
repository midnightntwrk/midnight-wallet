// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as Either from 'effect/Either';
import { URLError, FailedToDeriveWebSocketUrlError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';

export const deriveWebSocketUrl = (url: URL | string): Either.Either<string, URLError> => {
  const httpUrl = typeof url === 'string' ? new URL(url) : url;
  try {
    const wsUrl = new URL(httpUrl);

    // Convert protocol
    wsUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    // Ensure pathname ends with '/ws'
    if (!wsUrl.pathname.endsWith('/')) {
      wsUrl.pathname += '/';
    }
    wsUrl.pathname += 'ws';

    return Either.right(wsUrl.toString());
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return Either.left(
      new FailedToDeriveWebSocketUrlError({
        message: `Failed to derive WebSocket URL from ${httpUrl.toString()}`,
        cause: error,
      }),
    );
  }
};

export const createWebSocketUrl = (httpUrl: URL | string, wsUrl?: string): Either.Either<string, URLError> => {
  if (wsUrl) {
    return Either.right(wsUrl);
  }

  return deriveWebSocketUrl(httpUrl);
};
