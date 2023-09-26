package io.iohk.midnight.wallet.core

import io.iohk.midnight.wallet.zswap.{
  MerkleTreeCollapsedUpdate,
  TokenType,
  Transaction,
  UnprovenTransaction,
}

package object domain {
  final case class Address(address: String) extends AnyVal

  sealed trait ProvingRecipe
  sealed trait BalanceTransactionRecipe extends ProvingRecipe

  final case class TransactionToProve(transaction: UnprovenTransaction) extends ProvingRecipe
  final case class BalanceTransactionToProve(toProve: UnprovenTransaction, toBalance: Transaction)
      extends BalanceTransactionRecipe
  final case class NothingToProve(transaction: Transaction) extends BalanceTransactionRecipe

  final case class TokenTransfer(amount: BigInt, tokenType: TokenType, receiverAddress: Address)

  final case class TransactionHash(hash: String) extends AnyVal

  final case class TransactionIdentifier(txId: String) extends AnyVal

  final case class ViewingUpdate(
      merkleTreeUpdate: MerkleTreeCollapsedUpdate,
      transactionDiff: Vector[Transaction],
  )

  final case class Seed(seed: Array[Byte]) extends AnyVal
}
