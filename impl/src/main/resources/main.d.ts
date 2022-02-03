import { WalletInternal, CallResult } from 'api';

export class Wallet implements WalletInternal {
    static build(proverUri: string, platformUri: string): Promise<WalletInternal>

    call(
        deployTransactionHash: string,
        transitionFunction: string,
        publicTranscript: string
    ): Promise<CallResult>

    deploy(
        contractSource: string,
        publicState: string
    ): Promise<CallResult>

    sync(f: (event: Array<string>) => void): void

    getGUID(): Promise<string>

    close(): Promise<void>
}
