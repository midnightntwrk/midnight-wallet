package io.iohk.midnight.wallet.domain

final case class TransactionRequest(
    contractId: Hash[DeployTransaction],
    publicTranscript: PublicTranscript,
    witness: Witness,
    function: TransitionFunction,
    nonce: Nonce,
)
