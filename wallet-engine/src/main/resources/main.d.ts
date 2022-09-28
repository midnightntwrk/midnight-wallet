import { FilterService, Wallet } from '@midnight/wallet-api'

export interface CloseableWallet {
    close(): void
}

export class WalletBuilder {
    static build(
        proverUri: string,
        nodeUri: string,
        includeCookies: boolean
    ): Promise<FilterService & Wallet & CloseableWallet>
}
