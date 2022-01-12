package io.iohk.midnight.wallet.domain

class Contract

class ContractPrivateState derives CanEqual

class ContractPublicState

case class ContractState(privateState: ContractPrivateState, publicState: ContractPublicState)

class Transcript

class Proof

class ProofId

enum ProofStatus derives CanEqual:
  case Done(proof: Proof)
  case InProgress

class Hash derives CanEqual

case class Transaction(hash: Hash)

case class ContractInput(contract: Contract, transcript: Transcript, contractState: ContractState)

case class CircuitValues(x: Int, y: Int, z: Int)
