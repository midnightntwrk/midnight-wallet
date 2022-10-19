import { FilterService, Wallet } from '@midnight/wallet-api'

export interface CloseableWallet {
    close(): void
}

export class WalletBuilder {
    static build(
        nodeUri: string
    ): Promise<FilterService & Wallet & CloseableWallet>
}
