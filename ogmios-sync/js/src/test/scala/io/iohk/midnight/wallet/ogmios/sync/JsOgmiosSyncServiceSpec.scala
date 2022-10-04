package io.iohk.midnight.wallet.ogmios.sync

import cats.data.NonEmptyList
import cats.effect.{IO, Ref}
import fs2.Stream
import io.iohk.midnight.js.interop.facades.rxjs.Observable
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.blockchain.data.Generators.*
import io.iohk.midnight.wallet.ogmios.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import typings.midnightMockedNodeApi.transactionMod.{
  CallTransaction as ApiCallTx,
  DeployTransaction as ApiDeployTx,
}

class JsOgmiosSyncServiceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  // We need to test at least one call and one deploy transactions
  private val nonEmptyTxListGen: Gen[NonEmptyList[Transaction]] =
    for {
      callTx <- callTransactionGen
      deployTx <- deployTransactionGen
      other <- Gen.listOf(transactionGen)
    } yield NonEmptyList(callTx, deployTx :: other)

  private val blockGen =
    for {
      txList <- nonEmptyTxListGen
      blockHeader <- blockHeaderGen
    } yield Block(blockHeader, Block.Body(txList.toList))

  test("Should sync") {
    // There's some issue that makes it super slow to run a forAll so just sampling 1
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val block = blockGen.sample.get
    val blockTxs = block.body.transactionResults
    val observable = new JsOgmiosSyncService(() => Stream.emit(block), IO.unit).sync()
    val firstBlock = IO.fromPromise(IO.pure(Observable.firstValueFrom(observable)))

    firstBlock.map { obtainedBlock =>
      // Compare the block
      assertEquals(obtainedBlock.header.hash, block.header.hash.value)
      assertEquals(obtainedBlock.header.parentHash, block.header.parentHash.value)
      assertEquals(obtainedBlock.header.height, block.header.height.value.toDouble)

      // Compare the transactions
      obtainedBlock.body.transactionResults.zip(blockTxs).foreach {
        case (obtainedTx, expectedTx: CallTransaction) =>
          // It's impossible to pattern match on JS object
          // We can only expect it to be the corresponding type to the Scala object
          @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
          val callTx = obtainedTx.asInstanceOf[ApiCallTx]
          assertEquals(callTx.hash, expectedTx.hash.value)
          assertEquals(callTx.nonce, expectedTx.nonce.value)
          assertEquals(callTx.proof, expectedTx.proof.value)
          assertEquals(callTx.functionName, expectedTx.functionName.value)

        case (obtainedTx, expectedTx: DeployTransaction) =>
          // It's impossible to pattern match on JS object
          // We can only expect it to be the corresponding type to the Scala object
          @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
          val deployTx = obtainedTx.asInstanceOf[ApiDeployTx]
          assertEquals(deployTx.hash, expectedTx.hash.value)
          assertEquals(
            deployTx.transitionFunctionCircuits.toSeq,
            expectedTx.transitionFunctionCircuits.value,
          )
      }
    }
  }

  test("Should close") {
    for {
      ref <- Ref.of[IO, Boolean](false)
      service = new JsOgmiosSyncService(() => Stream.empty, ref.set(true))
      _ <- IO.fromPromise(IO.pure(service.close()))
      result <- ref.get
    } yield assert(result)
  }
}
