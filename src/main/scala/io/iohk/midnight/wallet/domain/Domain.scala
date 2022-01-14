package io.iohk.midnight.wallet.domain

import scala.scalajs.js

class ContractId

class ContractPrivateState derives CanEqual

class ContractPublicState

case class ContractState(privateState: ContractPrivateState, publicState: ContractPublicState)

class PublicTranscript

class Proof

class ProofId

enum ProofStatus derives CanEqual:
  case Done(proof: Proof)
  case InProgress

class Hash derives CanEqual

class TransitionFunction

case class Transaction(
    hash: Hash,
    timestamp: js.Date,
    contractId: ContractId,
    transitionFunction: TransitionFunction,
    proof: Proof,
    publicTranscript: PublicTranscript,
)

object Transaction:
  def apply(input: ContractInput, proof: Proof, timestamp: js.Date): Transaction =
    Transaction(
      Hash(),
      timestamp,
      input.contractId,
      input.transitionFunction,
      proof,
      input.publicTranscript,
    )

case class ContractInput(
    contractId: ContractId,
    publicTranscript: PublicTranscript,
    contractState: ContractState,
    transitionFunction: TransitionFunction,
)

case class CircuitValues(x: Int, y: Int, z: Int)
