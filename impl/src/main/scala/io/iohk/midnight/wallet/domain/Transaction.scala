package io.iohk.midnight.wallet.domain

import io.iohk.midnight.wallet.domain.Hash
import java.time.Instant

sealed trait Transaction

case class CallTransaction(
    hash: Hash[CallTransaction],
    timestamp: Instant,
    contractHash: Hash[DeployTransaction],
    transitionFunction: TransitionFunction,
    proof: Option[Proof],
    publicTranscript: PublicTranscript,
) extends Transaction

case class DeployTransaction(
    hash: Hash[DeployTransaction],
    timestamp: Instant,
    contractSource: ContractSource,
    publicState: PublicState,
    transitionFunctionCircuits: TransitionFunctionCircuits,
) extends Transaction
