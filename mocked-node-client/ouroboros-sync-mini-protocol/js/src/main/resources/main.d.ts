import { Observable } from 'rxjs';

export declare interface OuroborosSyncService<Block> {
    sync(): Observable<Block>
    close(): Promise<void>
}

export declare class OuroborosSyncServiceBuilder {
    static build<Block>(
        nodeUri: string,
        blockDecoder: Decoder<Block>,
        blockShow: Show<Block>,
        minLogLevel?: string
    ): Promise<OuroborosSyncService<Block>>
}

export interface Decoder<T> {
  decode(obj: unknown): DecodingResult<T>
}
export interface Show<T> {
  show(t: T): string
}

export type Success<A> = {
    value: A
}
export type Failure = {
    message: string
}
export declare type DecodingResult<A> = Success<A> | Failure;
