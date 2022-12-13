package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.midnightLedger.mod.{Transaction as LedgerTransaction, *}
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.blockchain.data.Generators.{hashGen, heightGen, instantGen}
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

import scala.annotation.tailrec
import scala.scalajs.js

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
object Generators {
  private val tokenType = nativeToken()

  final case class TransactionWithContext(
      transaction: LedgerTransaction,
      state: ZSwapLocalState,
      coins: List[CoinInfo],
  )

  val coinInfoGen: Gen[CoinInfo] =
    Gen.posNum[Int].map(js.BigInt(_)).map(new CoinInfo(_, tokenType))

  def generateCoinsFor(amount: js.BigInt): List[CoinInfo] = {
    val coinsNumber = Gen.chooseNum(2, 5).sample.get
    val part = amount / js.BigInt(coinsNumber)

    @tailrec
    def loop(amount: js.BigInt, acc: List[CoinInfo]): List[CoinInfo] = {
      val newAmount = amount - part
      if (newAmount > js.BigInt(0)) loop(newAmount, new CoinInfo(part, nativeToken()) :: acc)
      else new CoinInfo(amount, nativeToken()) :: acc
    }

    loop(amount, List.empty)
  }

  val ledgerTransactionGen: Gen[TransactionWithContext] =
    Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, coinInfoGen)).map { coins =>
      val (tx, state) = buildTransaction(coins)
      TransactionWithContext(tx, state, coins)
    }

  def generateLedgerTransaction(): TransactionWithContext =
    Generators.ledgerTransactionGen.sample.get

  def buildTransaction(coins: List[CoinInfo]): (LedgerTransaction, ZSwapLocalState) = {
    val state = new ZSwapLocalState()
    val builder = new TransactionBuilder(new LedgerState())
    coins
      .foldLeft((builder, state)) { case ((builder, state), coin) =>
        val output = ZSwapOutputWithRandomness.`new`(coin, state.coinPublicKey)
        val deltas = new ZSwapDeltas()
        deltas.insert(tokenType, -coin.value)
        val offer = new ZSwapOffer(js.Array(), js.Array(output.output), js.Array(), deltas)
        builder.addOffer(offer, output.randomness)
        state.watchFor(coin)
        (builder, state)
      }
      .leftMap(_.intoTransaction().transaction)
  }

  def generateStateWithCoins(coins: List[CoinInfo]): ZSwapLocalState = {
    val (mintTx, state) = buildTransaction(coins)
    state.applyLocal(mintTx)
    state
  }

  def generateStateWithFunds(amount: js.BigInt): ZSwapLocalState =
    generateStateWithCoins(generateCoinsFor(amount))

  val ledgerTransactionsList: Seq[LedgerTransaction] =
    Gen
      .chooseNum(1, 5)
      .flatMap(Gen.listOfN(_, ledgerTransactionGen.map(_.transaction)))
      .sample
      .get

  val zSwapCoinPublicKeyGen: Gen[ZSwapCoinPublicKey] =
    ledgerTransactionGen.map(_.state).map(_.coinPublicKey)

  val balanceGen: Gen[js.BigInt] = Gen.posNum[Int].map(js.BigInt(_))

  val transactionGen: Gen[Transaction] =
    ledgerTransactionGen.map(_.transaction).map(LedgerSerialization.toTransaction)

  private val blockHeaderGen: Gen[Block.Header] =
    (hashGen[Block], hashGen[Block], heightGen, instantGen).mapN(Block.Header.apply)

  def blockGen(txs: Seq[Transaction]): Gen[Block] =
    blockHeaderGen.map(Block(_, Block.Body(txs)))
}
