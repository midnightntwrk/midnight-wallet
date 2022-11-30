import { Observable } from 'rxjs'
import { Transaction } from "@midnight/ledger";
import { FilterService, Wallet } from '@midnight/wallet-api'

export interface HasBalance {
    balance(): Observable<bigint>
}

export interface Resource {
    start(): void
    close(): Promise<void>
}

export class WalletBuilder {
    static build(
        nodeUri: string,
        initialState?: string,
        minLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error'
    ): Promise<FilterService & Wallet & HasBalance & Resource>

    static calculateCost(tx: Transaction): bigint

    static generateInitialState(): string
}
