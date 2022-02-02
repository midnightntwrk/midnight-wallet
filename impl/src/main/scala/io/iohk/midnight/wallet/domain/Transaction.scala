package io.iohk.midnight.wallet.domain

import io.iohk.midnight.wallet.domain.Hash
import io.iohk.midnight.wallet.domain.Proof

import java.time.Instant

sealed trait Transaction

final case class CallTransaction(
    hash: Option[Hash[CallTransaction]],
    timestamp: Instant,
    contractHash: Hash[DeployTransaction],
    transitionFunction: TransitionFunction,
    proof: Option[Proof],
    publicTranscript: PublicTranscript,
) extends Transaction

final case class DeployTransaction(
    hash: Option[Hash[DeployTransaction]],
    timestamp: Instant,
    contractSource: ContractSource,
    publicState: PublicState,
    transitionFunctionCircuits: TransitionFunctionCircuits,
) extends Transaction
