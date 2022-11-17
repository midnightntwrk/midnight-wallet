package io.iohk.midnight.wallet.ogmios.sync

import cats.syntax.show.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.util.implicits.ShowInstances.instantShow
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce
import typings.midnightMockedNodeApi.anon.Hash
import typings.midnightMockedNodeApi.blockMod.{Block, BlockBody, BlockHeader}
import typings.midnightMockedNodeApi.transactionMod.*

private object Transformer {
  def transformBlock(block: data.Block): Block[Transaction] =
    Block(transformBlockBody(block.body), transformBlockHeader(block.header))

  private def transformBlockBody(body: data.Block.Body): BlockBody[Transaction] =
    BlockBody(body.transactionResults.map(transformTx).toJSArray)

  private def transformTx(tx: data.Transaction): Transaction =
    Transaction(tx.body, Hash(tx.header.hash.value))

  private def transformBlockHeader(header: data.Block.Header): BlockHeader =
    BlockHeader(
      header.hash.value,
      header.height.value.toDouble,
      header.parentHash.value,
      new js.Date(header.timestamp.show),
    )
}
