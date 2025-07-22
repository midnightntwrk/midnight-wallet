import pinoPretty from 'pino-pretty';
import pino, { Logger } from 'pino';
import fs, { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const createLogger = (): pino.Logger => {
  const pretty: pinoPretty.PrettyStream = pinoPretty({
    colorize: true,
    sync: true,
  });
  const level = 'info';
  return pino(
    {
      level,
      depthLimit: 20,
    },
    pino.multistream([
      { stream: pretty, level: 'info' },
      { stream: createWriteStream(`./src/logs/e2e-tests-${new Date().toISOString()}.log`), level },
    ]),
  );
};

export const logger: Logger = createLogger();
