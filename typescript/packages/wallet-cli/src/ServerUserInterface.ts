import { TxRequestState, TxRequestStates } from '@midnight/wallet-server-api';
import chalk from 'chalk';
import type { ReadlineType } from './lib/Readline';

interface Request {
  id: string;
  payload: {
    fee: string;
  };
}

interface Response {
  id: string;
  state: TxRequestState;
}

export class ServerUserInterface {
  // Turborepo e.g. cannot forward input properly, which crashes the CLI,
  // so we're working around this limitation with a dedicated flag
  // https://github.com/vercel/turbo/issues/1235
  constructor(private readonly readline: ReadlineType, private readonly confirmAll: boolean) {}

  printHeader(address: string, balance: bigint): void {
    this.readline.clear();
    this.readline.print('--------------------------------------------------------------------------');
    this.readline.print(`${chalk.yellow('Address:')} ${address}`);
    this.readline.print(`${chalk.green('Balance:')} ${balance} ${chalk.cyan('DST')}`);
  }

  async requestSign(request: Request): Promise<Response> {
    const state = await this.printRequest(request);

    return {
      id: request.id,
      state,
    };
  }

  async printRequest(request: Request): Promise<typeof TxRequestStates.approved | typeof TxRequestStates.rejected> {
    this.readline.print('--------------------------------------------------------------------------');
    this.readline.print(chalk.blue('Signing request:'));

    this.readline.print(`Micro DAO has requested you to sign a transaction.`);

    this.readline.print(
      `This will cost you ${chalk.cyan('DST')} ${request.payload.fee} related to executing contract + some fee.`,
    );

    this.readline.print('');
    const answer = await this.collectRequestAnswer(request);
    return answer ? TxRequestStates.approved : TxRequestStates.rejected;
  }

  async collectRequestAnswer(request: Request): Promise<boolean> {
    if (this.confirmAll) {
      this.readline.print(chalk.yellowBright('Signing Transaction?'));
      return true;
    }

    const answer = await this.readline.question(chalk.yellowBright('Sign Transaction? [Y/N]: '));

    switch (answer.toLowerCase().trim()) {
      case 'y':
        return true;
      case 'n':
        return false;
      default:
        this.readline.print('Please enter "Y" or "N"');
        return await this.collectRequestAnswer(request);
    }
  }
}
