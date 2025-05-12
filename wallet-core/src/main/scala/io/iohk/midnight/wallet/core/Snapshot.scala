package io.iohk.midnight.wallet.core

import io.circe.*
import io.circe.generic.semiauto.*
import io.circe.parser.decode
import io.circe.syntax.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.HexUtil

final case class Snapshot[LocalState, Transaction](
    state: LocalState,
    txHistory: Seq[Transaction],
    offset: Option[data.Transaction.Offset],
    protocolVersion: ProtocolVersion,
    networkId: zswap.NetworkId,
) {
  def serialize(using Encoder[Snapshot[LocalState, Transaction]]): String =
    this.asJson.noSpaces
}

class SnapshotInstances[LocalState, Transaction](using
    ls: zswap.LocalState.IsSerializable[LocalState],
    ts: zswap.Transaction.IsSerializable[Transaction],
)(using
    zswap.Transaction.Transaction[Transaction, ?],
) {
  private type TSnapshot = Snapshot[LocalState, Transaction]

  def parse(serialized: String): Either[Throwable, TSnapshot] =
    decode[TSnapshot](serialized)

  def create(using networkId: zswap.NetworkId): TSnapshot =
    Snapshot(ls.create(), Seq.empty, None, ProtocolVersion.V1, networkId)

  given (using zswap.NetworkId): Encoder[LocalState] =
    Encoder.instance(localState => HexUtil.encodeHex(localState.serialize).asJson)
  given Encoder[zswap.NetworkId] = Encoder[String].contramap(_.name)
  given (using zswap.NetworkId): Encoder[Transaction] = Encoder.instance(_.serialize.asJson)
  given Encoder[data.Transaction.Offset] = Encoder.encodeBigInt.contramap(_.value)
  given Encoder[ProtocolVersion] = Encoder[Int].contramap(_.version)
  given Encoder[TSnapshot] = Encoder.instance { snapshot =>
    given zswap.NetworkId = snapshot.networkId
    deriveEncoder[TSnapshot].apply(snapshot)
  }

  given (using zswap.NetworkId): Decoder[LocalState] =
    Decoder[String].emapTry(HexUtil.decodeHex).map(ls.deserialize)
  given (using zswap.NetworkId): Decoder[Transaction] =
    Decoder[String].emapTry(HexUtil.decodeHex).map(ts.deserialize)
  given Decoder[data.Transaction.Offset] = Decoder[BigInt].map(data.Transaction.Offset.apply)
  given Decoder[ProtocolVersion] = Decoder[Int].emapTry(ProtocolVersion.fromInt(_).toTry)
  given Decoder[zswap.NetworkId] = Decoder[String].emapTry(zswap.NetworkId.fromString)
  given Decoder[TSnapshot] =
    Decoder
      .instance(_.get[zswap.NetworkId]("networkId"))
      .flatMap { networkId =>
        given zswap.NetworkId = networkId
        deriveDecoder[TSnapshot]
      }
}
