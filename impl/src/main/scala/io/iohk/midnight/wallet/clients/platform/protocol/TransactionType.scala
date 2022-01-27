package io.iohk.midnight.wallet.clients.platform.protocol

object TransactionType extends Enumeration:
  val Discriminator: String = "type"
  val Call = Value("call")
  val Deploy = Value("deploy")
