import { WalletError as ScalaWalletError } from '@midnight-ntwrk/wallet';

export class WalletError extends Error {
  static fromScala(scalaWalletError: ScalaWalletError): WalletError {
    return new WalletError(`Wallet error: ${scalaWalletError.message}`, { cause: scalaWalletError });
  }

  static proving(err: Error): WalletError {
    return new WalletError(`Wallet proving error: ${err.message}`, { cause: err });
  }

  static submission(err: unknown): WalletError {
    const message: string = err && typeof err == 'object' && 'message' in err ? String(err.message) : '';
    return new WalletError(`Transaction submission error: ${message}`, { cause: err });
  }

  static other(err: unknown): WalletError {
    let message: string;
    if (err) {
      if (typeof err == 'object' && 'message' in err) {
        message = String(err.message);
      } else if (typeof err == 'string') {
        message = err;
      } else {
        message = '';
      }
    } else {
      message = '';
    }
    return new WalletError(`Other wallet error: ${message}`, { cause: err });
  }
}
