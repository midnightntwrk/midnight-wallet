package io.iohk.midnight.wallet.ogmios.core.protocol

import io.iohk.midnight.wallet.util.Enumeration

private[ogmios] sealed abstract class TransactionType(val entryName: String)
    extends Enumeration.Value(entryName)

object TransactionType {
  val Discriminator: String = "type"
  case object Call extends TransactionType("call")
  case object Deploy extends TransactionType("deploy")

  implicit val enumInstance: Enumeration[TransactionType] = new Enumeration[TransactionType] {
    override val Discriminator: String = TransactionType.Discriminator
    override val allValues: Seq[TransactionType] = Seq(Call, Deploy)
  }
}
