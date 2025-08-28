import * as Either from 'effect/Either';

export const deriveWebSocketUrl = (url: URL | string): Either.Either<string, Error> => {
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
    return Either.left(new Error(`Failed to derive WebSocket URL from ${httpUrl.toString()}: ${error}`));
  }
};

export const createWebSocketUrl = (httpUrl: URL | string, wsUrl?: string): Either.Either<string, Error> => {
  if (wsUrl) {
    return Either.right(wsUrl);
  }

  return deriveWebSocketUrl(httpUrl);
};
