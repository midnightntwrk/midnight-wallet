import { Either, HashSet, Stream } from 'effect';
import {
  UnshieldedState,
  UnshieldedStateDecoder,
  UnshieldedStateEncoder,
} from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import { Balance, TokenType, UnshieldedWalletState } from '@midnight-ntwrk/wallet-api';
import { ParseError } from 'effect/ParseResult';

export const toWalletState = (
  stateStream: Stream.Stream<UnshieldedState>,
  address: string,
): Stream.Stream<UnshieldedWalletState> =>
  stateStream.pipe(
    Stream.map(
      (state) =>
        ({
          address,
          availableBalances: HashSet.reduce(state.utxos, {} as Record<TokenType, Balance>, (acc, utxo) => ({
            ...acc,
            [utxo.type]: (acc[utxo.type] || 0n) + utxo.value,
          })),
          pendingBalances: HashSet.reduce(state.pendingUtxos, {} as Record<TokenType, Balance>, (acc, utxo) => ({
            ...acc,
            [utxo.type]: (acc[utxo.type] || 0n) + utxo.value,
          })),
          transactionHistory: undefined,
          syncProgress: state.syncProgress
            ? {
                applyGap:
                  (state.syncProgress?.highestTransactionId ?? 0) - (state.syncProgress?.currentTransactionId ?? 0),
                synced: state.syncProgress?.highestTransactionId === state.syncProgress?.currentTransactionId,
              }
            : undefined,
        }) as UnshieldedWalletState,
    ),
  );

export const serializeWalletState = (state: UnshieldedState): string => {
  const encodedResult = UnshieldedStateEncoder(state);

  if (Either.isLeft(encodedResult)) {
    throw new Error(`Failed to encode state: ${encodedResult.left.message}`);
  }

  return JSON.stringify(encodedResult.right);
};

export const deserializeWalletState = (serializedState: string): Either.Either<UnshieldedState, ParseError> => {
  const parsedState = JSON.parse(serializedState) as unknown;

  return UnshieldedStateDecoder(parsedState);
};
