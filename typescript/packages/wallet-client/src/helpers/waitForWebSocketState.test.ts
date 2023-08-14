import { test } from '@jest/globals';
import { WebSocketStates } from './waitForWebSocketState';

test('WebSocketStates dummy', () => {
  expect(WebSocketStates.connecting).toEqual(0);
});
