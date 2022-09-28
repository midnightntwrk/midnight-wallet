package io.iohk.midnight.wallet.blockchain.data

sealed trait Oracle {
  def transcript: Transcript
}

final case class PublicOracle(override val transcript: Transcript) extends Oracle

final case class PrivateOracle(override val transcript: Transcript) extends Oracle
