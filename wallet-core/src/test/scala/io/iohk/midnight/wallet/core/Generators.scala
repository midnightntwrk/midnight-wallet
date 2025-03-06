package io.iohk.midnight.wallet.core

import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod.{Transaction as LedgerTransaction, *}
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.domain.{Address, ProgressUpdate, TokenTransfer}
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.given
import org.scalacheck.cats.implicits.*
import org.scalacheck.{Arbitrary, Gen, Shrink}
import scala.annotation.tailrec
import scala.scalajs.js

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
object Generators {
  final case class TransactionWithContext(
      transaction: LedgerTransaction,
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      coins: NonEmptyList[CoinInfo],
  )

  final case class OfferWithContext(
      offer: UnprovenOffer,
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      coinOutputs: NonEmptyList[CoinInfo],
  )

  @SuppressWarnings(Array("org.wartremover.warts.TryPartial", "org.wartremover.warts.Throw"))
  def keyGenerator(seed: Option[String] = None): SecretKeys = {
    val seedHex = seed.getOrElse(zswap.HexUtil.randomHex())

    val decodedSeed = zswap.HexUtil
      .decodeHex(seedHex)
      .get

    summon[zswap.SecretKeys.CanInit[SecretKeys]].fromSeed(decodedSeed)
  }

  private def noShrink[T]: Shrink[T] = Shrink.withLazyList(_ => LazyList.empty)

  given tokenTypeArbitrary: Arbitrary[TokenType] =
    Arbitrary { Gen.const(nativeToken()) }

  given coinInfoArbitrary: Arbitrary[CoinInfo] =
    Arbitrary {
      tokenTypeArbitrary.arbitrary.flatMap { tokenType =>
        Gen.posNum[Int].map(js.BigInt(_)).map(createCoinInfo(tokenType, _))
      }
    }

  private val localStateNoKeysGen: Gen[LocalStateNoKeys] =
    Gen.lzy(LocalStateNoKeys().pure[Gen])

  private val secretKeysGen: Gen[SecretKeys] =
    Gen.lzy(
      keyGenerator()
        .pure[Gen],
    )

  private lazy val addressGen: Gen[Address] =
    secretKeysGen
      .map(secretKeys =>
        zswap.Address(secretKeys.coinPublicKey, secretKeys.encryptionPublicKey).asString,
      )
      .map(Address.apply)

  given tokenTransferArbitrary: Arbitrary[TokenTransfer[TokenType]] = {
    Arbitrary {
      for {
        amount <- Gen.posNum[BigInt]
        tokenType <- tokenTypeArbitrary.arbitrary
        address <- addressGen
      } yield TokenTransfer(amount, tokenType, address)
    }
  }

  given tokenTransfersArbitrary(using
      tokenTransferArb: Arbitrary[TokenTransfer[TokenType]],
  ): Arbitrary[NonEmptyList[TokenTransfer[TokenType]]] = {
    Arbitrary {
      for {
        head <- tokenTransferArb.arbitrary
        tail <- Gen.nonEmptyListOf(tokenTransferArb.arbitrary)
      } yield NonEmptyList(head, tail)
    }
  }

  given unprovenOfferWithContextArbitrary: Arbitrary[OfferWithContext] = {
    Arbitrary {
      for {
        coins <- Gen
          .choose(2, 5)
          .flatMap(amount =>
            Gen.listOfN(amount, coinInfoArbitrary.arbitrary).map(NonEmptyList.fromListUnsafe),
          )
        unprovenTxAndState = buildOfferForCoins(coins)
      } yield OfferWithContext(
        unprovenTxAndState._1,
        unprovenTxAndState._2,
        unprovenTxAndState._3,
        coins,
      )
    }
  }

  given unprovenTransactionArbitrary: Arbitrary[UnprovenTransaction] = {
    Arbitrary {
      unprovenOfferWithContextArbitrary.arbitrary.map { offerWithContext =>
        UnprovenTransaction(offerWithContext.offer)
      }
    }
  }

  def generateCoinsFor(coinsData: NonEmptyList[(TokenType, BigInt)]): NonEmptyList[CoinInfo] = {
    coinsData.map(coinData => generateCoinsForAmount(coinData._1, coinData._2)).flatten
  }

  def generateCoinsForAmount(coinType: TokenType, amount: BigInt): NonEmptyList[CoinInfo] = {
    val coinsNumber = Gen.chooseNum(2, 5).sample.get
    val part = {
      val divider = amount / BigInt(coinsNumber)
      if (divider === BigInt(0)) BigInt(1)
      else divider
    }

    @tailrec
    def loop(amount: BigInt, acc: List[CoinInfo]): List[CoinInfo] = {
      val newAmount = amount - part
      if (newAmount > BigInt(0)) loop(newAmount, createCoinInfo(coinType, part.toJsBigInt) :: acc)
      else createCoinInfo(coinType, amount.toJsBigInt) :: acc
    }

    NonEmptyList.fromListUnsafe(loop(amount, List.empty))
  }

  // REMEMBER it is using external service, until we get a way to mock proofs
  given txWithContextArbitrary(using
      provingService: ProvingService[UnprovenTransaction, LedgerTransaction],
  ): Arbitrary[IO[TransactionWithContext]] = {
    Arbitrary {
      unprovenOfferWithContextArbitrary.arbitrary.map {
        case OfferWithContext(offer, state, secretKeys, coins) =>
          provingService
            .proveTransaction(UnprovenTransaction(offer))
            .map(tx => TransactionWithContext(tx, state, secretKeys, coins))
            .memoize
            .flatten
      }
    }
  }

  given txWithContextShrink: Shrink[IO[TransactionWithContext]] = noShrink

  private def buildOfferForCoins(
      coins: NonEmptyList[CoinInfo],
      ls: Option[LocalStateNoKeys] = None,
      seed: Option[String] = None,
  ): (UnprovenOffer, LocalStateNoKeys, SecretKeys) = {
    val state = ls.getOrElse(LocalStateNoKeys())
    val secretKeys = keyGenerator(seed)
    val baseOfferAndState = buildOfferForCoin(coins.head, state, secretKeys)
    coins.tail
      .foldLeft(baseOfferAndState: (UnprovenOffer, LocalStateNoKeys, SecretKeys)) {
        case ((accOffer, accState, _), coin) =>
          val (offerForCoin, newState, rSk) = buildOfferForCoin(coin, accState, secretKeys)
          (accOffer.merge(offerForCoin), newState, rSk)
      }
  }

  private def buildOfferForCoin(
      coin: CoinInfo,
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
  ): (UnprovenOffer, LocalStateNoKeys, SecretKeys) = {
    val output =
      UnprovenOutput.`new`(coin, secretKeys.coinPublicKey, secretKeys.encryptionPublicKey)
    val offer = UnprovenOffer.fromOutput(output, coin.`type`, coin.value)
    (offer, state.watchFor(secretKeys.coinPublicKey, coin), secretKeys)
  }

  def generateStateWithCoins(
      coins: NonEmptyList[CoinInfo],
      seed: Option[String] = None,
  ): (LocalStateNoKeys, SecretKeys) = {
    val (unprovenOffer, state, secretKeys) = buildOfferForCoins(coins, None, seed)
    val proofsErasedTx = UnprovenTransaction(unprovenOffer).eraseProofs()

    (state.applyProofErased(secretKeys, proofsErasedTx.guaranteedCoins.get), secretKeys)
  }

  def generateStateWithFunds(
      balanceData: NonEmptyList[(TokenType, BigInt)],
      seed: Option[String] = None,
  ): (LocalStateNoKeys, SecretKeys) =
    generateStateWithCoins(generateCoinsFor(balanceData), seed)

  def generateTransactionWithFundsFor(
      balanceData: NonEmptyList[(TokenType, BigInt)],
      state: LocalStateNoKeys,
      seed: String,
  ): (UnprovenTransaction, LocalStateNoKeys, SecretKeys) = {
    val (unprovenOffer, newState, secretKeys) =
      buildOfferForCoins(generateCoinsFor(balanceData), Some(state), Some(seed))

    (UnprovenTransaction(unprovenOffer), newState, secretKeys)
  }

  given ledgerTransactionArbitrary(using
      txWithContextArb: Arbitrary[IO[TransactionWithContext]],
  ): Arbitrary[IO[LedgerTransaction]] =
    Arbitrary {
      txWithContextArb.arbitrary
        .map(_.map(_.transaction))
    }

  given ledgerTransactionShrink: Shrink[IO[LedgerTransaction]] = noShrink

  private val ledgerSerialization =
    new LedgerSerialization[LocalStateNoKeys, LedgerTransaction]

  given transactionArbitrary(using
      provingService: ProvingService[UnprovenTransaction, LedgerTransaction],
      txWithContextArb: Arbitrary[IO[TransactionWithContext]],
  ): Arbitrary[IO[Transaction]] =
    Arbitrary {
      given zswap.NetworkId = zswap.NetworkId.Undeployed
      txWithContextArb.arbitrary
        .map(_.map(txWithContext => ledgerSerialization.toTransaction(txWithContext.transaction)))
    }

  given transactionShrink: Shrink[IO[Transaction]] = noShrink

  def ledgerTransactionsList(using
      provingService: ProvingService[UnprovenTransaction, LedgerTransaction],
      txArb: Arbitrary[IO[LedgerTransaction]],
  ): IO[Seq[LedgerTransaction]] =
    Gen
      .chooseNum(1, 5)
      .flatMap(Gen.listOfN(_, txArb.arbitrary).map(_.sequence))
      .sample
      .get

  given transactionsArbitrary(using
      provingService: ProvingService[UnprovenTransaction, LedgerTransaction],
      txArbitrary: Arbitrary[IO[Transaction]],
  ): Arbitrary[IO[List[Transaction]]] = {
    Arbitrary {
      Gen.listOfN(2, txArbitrary.arbitrary).map(_.sequence)
    }
  }

  val WalletStateGen: Gen[WalletStateService.State[
    CoinPublicKey,
    EncPublicKey,
    EncryptionSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    LedgerTransaction,
  ]] =
    (localStateNoKeysGen, secretKeysGen, Gen.posNum[BigInt]).mapN {
      (localState, secretKeys, balance) =>
        WalletStateService.State(
          secretKeys.coinPublicKey,
          secretKeys.encryptionPublicKey,
          secretKeys.encryptionSecretKey,
          Map(nativeToken() -> balance),
          Seq.empty,
          Seq.empty,
          Seq.empty,
          Seq.empty,
          Seq.empty,
          ProgressUpdate.empty,
        )
    }
}
