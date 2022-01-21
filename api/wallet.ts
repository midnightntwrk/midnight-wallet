type Hash = string
type TransitionFunction = string
type PublicTranscript = string

type Failed = { reason: string }
type Succeed = { hash: Hash }
type CallResult = Failed | Succeed

type ContractAddress = Hash
type ContractSource = string

interface Wallet {
    call(
        deployTransactionHash: Hash,
        transitionFunction: TransitionFunction,
        publicTranscript: PublicTranscript
    ): Promise<CallResult>

    deploy(
        contractSource: ContractSource
    ): Promise<CallResult>
}
