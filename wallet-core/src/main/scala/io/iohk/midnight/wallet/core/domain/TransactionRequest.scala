package io.iohk.midnight.wallet.core.domain

import io.iohk.midnight.wallet.blockchain.data.{
  DeployTransaction,
  Hash,
  Nonce,
  PublicTranscript,
  TransitionFunction,
}

final case class TransactionRequest(
    contractId: Hash[DeployTransaction],
    publicTranscript: PublicTranscript,
    witness: Witness,
    function: TransitionFunction,
    nonce: Nonce,
)
