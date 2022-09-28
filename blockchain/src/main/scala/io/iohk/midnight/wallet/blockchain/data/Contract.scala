package io.iohk.midnight.wallet.blockchain.data

final case class Contract(publicOracle: Option[PublicOracle], privateOracle: Option[PrivateOracle])
