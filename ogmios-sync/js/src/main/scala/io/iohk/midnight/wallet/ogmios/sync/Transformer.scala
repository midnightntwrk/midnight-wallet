package io.iohk.midnight.wallet.ogmios.sync

import io.iohk.midnight.wallet.blockchain.data
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce
import typings.midnightMockedNodeApi.blockMod.{Block, BlockBody, BlockHeader}
import typings.midnightMockedNodeApi.contractMod.Contract
import typings.midnightMockedNodeApi.oracleMod.{PrivateOracle, PublicOracle}
import typings.midnightMockedNodeApi.queryMod.Query
import typings.midnightMockedNodeApi.transactionMod.{
  CallTransaction,
  DeployTransaction,
  Transaction,
}
import typings.midnightMockedNodeApi.transcriptMod.Transcript

private object Transformer {
  // There's a ScalablyTyped issue that generates incorrect imports,
  // effectively restricting us from using constants defined in wallet-api
  // See https://github.com/ScalablyTyped/Converter/issues/476
  private val CallTxType = "Call"
  private val DeployTxType = "Deploy"
  private val PublicOracleType = "Public"
  private val PrivateOracleType = "Private"

  def transformBlock(block: data.Block): Block[Transaction] =
    Block(transformBlockBody(block.body), transformBlockHeader(block.header))

  private def transformBlockBody(body: data.Block.Body): BlockBody[Transaction] =
    BlockBody(body.transactionResults.map(transformTx).toJSArray)

  private def transformTx(tx: data.Transaction): Transaction =
    tx match {
      case callTx: data.CallTransaction     => transformCallTx(callTx)
      case deployTx: data.DeployTransaction => transformDeployTx(deployTx)
    }

  private def transformCallTx(tx: data.CallTransaction): CallTransaction =
    CallTransaction(
      tx.address.value,
      tx.functionName.value,
      tx.hash.value,
      tx.nonce.value,
      tx.proof.value,
      transformTranscript(tx.publicTranscript),
      new js.Date(tx.timestamp.toString),
      CallTxType,
    )

  private def transformTranscript(transcript: data.Transcript): Transcript =
    transcript.value.map(transformQuery).toJSArray

  private def transformQuery(q: data.Query): Query =
    Query(q.arg, q.functionName.value, q.result)

  private def transformDeployTx(tx: data.DeployTransaction): DeployTransaction =
    DeployTransaction(
      transformContract(tx.contract),
      tx.hash.value,
      new js.Date(tx.timestamp.toString),
      tx.transitionFunctionCircuits.value.toJSArray,
      DeployTxType,
    )

  private def transformContract(contract: data.Contract): Contract = {
    val result = Contract()
    contract.publicOracle.foreach { publicOracle =>
      result.setPublicOracle(
        PublicOracle(transformTranscript(publicOracle.transcript), PublicOracleType),
      )
    }
    contract.privateOracle.foreach { privateOracle =>
      result.setPrivateOracle(
        PrivateOracle(transformTranscript(privateOracle.transcript), PrivateOracleType),
      )
    }
    result
  }

  private def transformBlockHeader(header: data.Block.Header): BlockHeader =
    BlockHeader(
      header.hash.value,
      header.height.value.toDouble,
      header.parentHash.value,
      new js.Date(header.timestamp.toString),
    )
}
