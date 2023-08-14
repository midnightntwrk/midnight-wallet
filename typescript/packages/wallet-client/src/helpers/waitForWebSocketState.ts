import { firstValueFrom, interval, filter, catchError, of, map } from 'rxjs';
import { WebSocket } from 'ws';

export const WebSocketStates = {
  connecting: 0,
  open: 1,
  closing: 2,
  closed: 3,
};

export const waitForWebSocketState = async (ws: WebSocket, state: keyof typeof WebSocketStates): Promise<boolean> => {
  return await firstValueFrom(
    interval(5).pipe(
      map(() => ws.readyState),
      filter((readyState) => readyState === WebSocketStates[state]),
      map(() => true),
      catchError(() => of(false)),
    ),
  );
};
