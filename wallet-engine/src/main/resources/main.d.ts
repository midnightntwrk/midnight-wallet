import { Observable } from 'rxjs'
import { FilterService, Wallet } from '@midnight/wallet-api'

export interface HasBalance {
    balance(): Observable<bigint>
}

export interface Closeable {
    close(): void
}

export class WalletBuilder {
    static build(
        nodeUri: string,
        initialState?: string
    ): Promise<FilterService & Wallet & HasBalance & Closeable>

    static generateInitialState(): string
}
