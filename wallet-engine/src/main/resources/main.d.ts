import { Observable } from 'rxjs'
import { Transaction } from "@midnight/ledger";
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

    static calculateCost(tx: Transaction): bigint

    static generateInitialState(): string
}
