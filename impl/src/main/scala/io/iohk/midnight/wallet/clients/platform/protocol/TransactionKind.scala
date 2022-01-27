package io.iohk.midnight.wallet.clients.platform.protocol

sealed trait TransactionKind

object TransactionKind extends Enumeration:
  val Discriminator: String = "kind"
  val Lares = Value("lares")
