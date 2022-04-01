import { Wallet as WalletAPI, TxSubmissionResult } from '@midnight/wallet-api'

export class Wallet implements WalletAPI {
    call(
        deployTransactionHash: string,
        nonce: string,
        transitionFunction: string,
        publicTranscript: string
    ): Promise<TxSubmissionResult>

    deploy(
        contractSource: string,
        publicState: string
    ): Promise<TxSubmissionResult>

    sync(f: (event: Array<any>) => void): void

    getGUID(): Promise<string>

    close(): Promise<void>
}

export class WalletBuilder {
    static build(
        snarkieUri: string,
        platformUri: string,
        laresUri: string,
        includeCookies: boolean
    ): Promise<Wallet>
}
