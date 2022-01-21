package io.iohk.midnight.wallet.domain

import scala.scalajs.js

class ContractSource

class PublicTranscript

class Proof

class ProofId

enum ProofStatus derives CanEqual:
  case Done(proof: Proof)
  case InProgress

class Hash derives CanEqual

type DeployTransactionHash = Hash

class TransitionFunction

sealed trait Transaction:
  val hash: Hash
  val timestamp: js.Date

case class CallTransaction(
    hash: Hash,
    timestamp: js.Date,
    deployTransactionHash: DeployTransactionHash,
    transitionFunction: TransitionFunction,
    proof: Proof,
    publicTranscript: PublicTranscript,
) extends Transaction

object CallTransaction:
  def apply(input: CallContractInput, proof: Proof, timestamp: js.Date): CallTransaction =
    CallTransaction(
      Hash(),
      timestamp,
      input.contractHash,
      input.transitionFunction,
      proof,
      input.publicTranscript,
    )

case class DeployTransaction(
    hash: DeployTransactionHash,
    timestamp: js.Date,
    contractSource: ContractSource,
    transitionFunctionCircuits: TransitionFunctionCircuits,
) extends Transaction

object DeployTransaction:
  def apply(
      input: DeployContractInput,
      transitionFunctionCircuits: TransitionFunctionCircuits,
      timestamp: js.Date,
  ): DeployTransaction =
    DeployTransaction(
      Hash(),
      timestamp,
      input.contractSource,
      transitionFunctionCircuits,
    )

case class CallContractInput(
    contractHash: DeployTransactionHash,
    publicTranscript: PublicTranscript,
    transitionFunction: TransitionFunction,
)

case class DeployContractInput(
    contractSource: ContractSource,
)

case class CircuitValues(x: Int, y: Int, z: Int)

class TransitionFunctionCircuits
