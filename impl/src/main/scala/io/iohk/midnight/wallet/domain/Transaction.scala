package io.iohk.midnight.wallet.domain

import io.iohk.midnight.wallet.domain
import scala.scalajs.js

sealed trait Transaction:
  val timestamp: js.Date

case class CallTransaction(
    hash: CallTransaction.Hash,
    timestamp: js.Date,
    deployTransactionHash: DeployTransaction.Hash,
    transitionFunction: TransitionFunction,
    proof: Proof,
    publicTranscript: PublicTranscript,
) extends Transaction

object CallTransaction:
  opaque type Hash = domain.Hash
  object Hash:
    def apply(): Hash = domain.Hash()

case class DeployTransaction(
    hash: DeployTransaction.Hash,
    timestamp: js.Date,
    contractSource: ContractSource,
    transitionFunctionCircuits: TransitionFunctionCircuits,
) extends Transaction

object DeployTransaction:
  opaque type Hash = domain.Hash
  object Hash:
    def apply(): Hash = domain.Hash()
