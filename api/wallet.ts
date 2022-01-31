import { Observable } from 'rxjs'

type Hash = string
type TransitionFunction = string
type PublicTranscript = string

type Failed = { reason: string }
type Succeed = { hash: Hash }
type CallResult = Failed | Succeed

type ContractSource = string
type PublicState = string

type SemanticEvent = string

type GUID = string

// The actual wallet interface
export interface Wallet {
    call(
        contractHash: Hash,
        transitionFunction: TransitionFunction,
        publicTranscript: PublicTranscript
    ): Promise<CallResult>

    deploy(
        contractSource: ContractSource,
        publicState: PublicState
    ): Promise<CallResult>

    sync(): Observable<Array<SemanticEvent>>

    getGUID(): Promise<GUID>
}

// A base implementation that wraps an internal implementation.
// The reason for this boilerplate is to avoid having the implementation to depend
// directly on rxjs Observable.
// This way, the wrapped implementation just needs to provide a method to register
// a callback function that will be executed for each event.
export class WalletBaseImpl implements Wallet {
    #wrapped: WalletInternal

    constructor(walletInternal: WalletInternal) {
        this.#wrapped = walletInternal;

    }

    call(contractHash: Hash,
         transitionFunction: TransitionFunction,
         publicTranscript: PublicTranscript
    ): Promise<CallResult> {
        return this.#wrapped.call(contractHash, transitionFunction, publicTranscript)
    }

    deploy(contractSource: ContractSource, publicState: PublicState): Promise<CallResult> {
        return this.#wrapped.deploy(contractSource, publicState)
    }

    sync(): Observable<Array<SemanticEvent>> {
        return new Observable((subscriber) => {
            this.#wrapped.sync(value => subscriber.next(value))
        })
    }

    getGUID(): Promise<GUID> {
        return this.#wrapped.getGUID()
    }
}

// The interface that finally implements the logic
export interface WalletInternal {
    call(
        deployTransactionHash: Hash,
        transitionFunction: TransitionFunction,
        publicTranscript: PublicTranscript
    ): Promise<CallResult>

    deploy(
        contractSource: ContractSource,
        publicState: PublicState
    ): Promise<CallResult>

    sync(f: (event: Array<SemanticEvent>) => void): void

    getGUID(): Promise<GUID>
}
