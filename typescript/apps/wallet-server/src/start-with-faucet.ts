import { FaucetClient } from '@midnight/faucet';
import { ZSwapLocalState } from '@midnight/ledger';
import { ServerConfig } from './config';
import { runServer } from './run-server';

export async function startWithFaucet(config: ServerConfig): Promise<void> {
  const walletInitialState = new ZSwapLocalState();
  const faucetClient = FaucetClient.create(config.faucetUrl);
  const response = await faucetClient.requestTokens(walletInitialState.coinPublicKey);
  console.log(
    `Request to faucet succeeded, awaiting ${
      response.coinInfo.value
    } DST in transaction with id ${response.transactionIdentifier.serialize().toString('hex')}`,
  );
  walletInitialState.watchFor(response.coinInfo);
  return await runServer(config, walletInitialState);
}
