import { Block, Transaction } from '@midnight/mocked-node-api';
import { Observable } from 'rxjs';

export interface OgmiosSyncService {
    sync(): Observable<Block<Transaction>>

    close(): Promise<void>
}

export class OgmiosSyncServiceBuilder {
    static build(nodeUri: string): Promise<OgmiosSyncService>
}
