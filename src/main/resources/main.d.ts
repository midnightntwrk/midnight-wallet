declare module 'midnight-wallet';

type Failed = { reason: string }
type Succeed = { hash: string }
export type CallResult = Failed | Succeed

export class Wallet {
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

export class WalletBuilder {
    static build(proverUri: string, platformUri: string, laresUri: string): Promise<Wallet>
}
