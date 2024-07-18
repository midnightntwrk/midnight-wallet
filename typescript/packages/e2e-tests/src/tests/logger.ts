import pinoPretty from 'pino-pretty';
import pino, { Logger } from 'pino';
import { createWriteStream } from 'node:fs';

export const createLogger = (): pino.Logger => {
  const pretty: pinoPretty.PrettyStream = pinoPretty({
    colorize: true,
    sync: true,
  });
  const level = 'info' as const;
  return pino(
    {
      level,
      depthLimit: 20,
    },
    pino.multistream([
      { stream: pretty, level: 'info' },
      { stream: createWriteStream(`./logs/e2e-tests-${new Date().toISOString()}.log`), level },
    ]),
  );
};

export const logger: Logger = createLogger();
