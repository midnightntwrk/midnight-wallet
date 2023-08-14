import { readFileSync } from 'fs';
import { JsonGenesisCodec } from '@midnight/genesis-gen';
import { ZSwapLocalState } from '@midnight/ledger';
import { pipe } from 'fp-ts/function';
import { either } from 'fp-ts';
import { PathReporter } from 'io-ts/PathReporter';

export const getInitialWalletState = (
  genesisFilePath: string,
  walletId: string | number,
): ZSwapLocalState | undefined => {
  const genesisFile = readFileSync(genesisFilePath, 'utf8');

  const result = JsonGenesisCodec.decode(genesisFile);

  return pipe(
    result,
    either.map((genesis) => {
      console.log('GENESIS', genesis);

      return genesis.wallets[walletId];
    }),
    either.getOrElseW((errors) => {
      console.log('ERRORS', errors);

      console.error(PathReporter.report(result));
      return undefined;
    }),
  );
};
