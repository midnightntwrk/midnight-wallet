import { WalletError as ScalaWalletError } from '@midnight-ntwrk/wallet';

export class WalletError extends Error {
  static fromScala(scalaWalletError: ScalaWalletError): WalletError {
    return new WalletError(`Wallet error: ${scalaWalletError.message}`, { cause: scalaWalletError });
  }

  static proving(err: Error): WalletError {
    return new WalletError(`Wallet proving error: ${err.message}`, { cause: err });
  }
}
