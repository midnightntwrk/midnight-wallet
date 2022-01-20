type Hash = string
type TransitionFunction = string
type PublicTranscript = string
type StateUpdate = (state: ContractPrivateState) => Promise<ContractPrivateState>

type Failed = { reason: string }
type Succeed = { hash: Hash }
type CallResult = Failed | Succeed

type ContractAddress = Hash
type ContractPrivateState = string
type ContractSource = string

interface Wallet {
    call(
        deployTransactionHash: Hash,
        transitionFunction: TransitionFunction,
        publicTranscript: PublicTranscript,
        privateStateUpdate: StateUpdate,
    ): Promise<CallResult>

    deploy(
        contractSource: ContractSource,
        initialState: ContractPrivateState,
    ): Promise<CallResult>
}
