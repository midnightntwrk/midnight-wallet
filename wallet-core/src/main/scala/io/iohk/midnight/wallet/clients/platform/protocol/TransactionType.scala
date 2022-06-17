package io.iohk.midnight.wallet.clients.platform.protocol

import enumeratum.EnumEntry.Lowercase
import enumeratum.*

sealed trait TransactionType extends EnumEntry with Lowercase

object TransactionType extends Enum[TransactionType] {
  val Discriminator: String = "type"

  case object Call extends TransactionType
  case object Deploy extends TransactionType

  val values: IndexedSeq[TransactionType] = findValues
}
