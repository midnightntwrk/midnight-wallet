import { Wallet as WalletAPI, TxSubmissionResult } from '@midnight/wallet-api'
import { Observable } from 'rxjs'

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

    sync(): Observable<Array<any>>

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
