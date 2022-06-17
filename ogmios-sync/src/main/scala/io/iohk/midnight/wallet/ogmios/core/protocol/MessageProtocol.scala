package io.iohk.midnight.wallet.ogmios.core.protocol

import io.iohk.midnight.wallet.util.Enumeration

private[ogmios] object MessageProtocol {
  sealed abstract class Type(val entryName: String) extends Enumeration.Value(entryName)

  object Type {
    val Discriminator: String = "protocol"
    case object LocalBlockSync extends Type("LocalBlockSync")
    case object LocalTxSubmission extends Type("LocalTxSubmission")

    implicit val enumInstance: Enumeration[Type] = new Enumeration[Type] {
      override val Discriminator: String = Type.Discriminator
      override val allValues: Seq[Type] = Seq(LocalBlockSync, LocalTxSubmission)
    }
  }
}
