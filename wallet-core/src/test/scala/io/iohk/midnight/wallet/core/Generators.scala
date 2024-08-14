package io.iohk.midnight.wallet.core

import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.wallet.zswap.{Address as LedgerAddress, Transaction as LedgerTransaction, *}
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.domain.{Address, ProgressUpdate, TokenTransfer}
import io.iohk.midnight.wallet.core.services.ProvingService
import org.scalacheck.cats.implicits.*
import org.scalacheck.{Arbitrary, Gen, Shrink}
import scala.annotation.tailrec

@SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
object Generators {
  final case class TransactionWithContext(
      transaction: LedgerTransaction,
      state: LocalState,
      coins: NonEmptyList[CoinInfo],
  )

  final case class OfferWithContext(
      offer: UnprovenOffer,
      state: LocalState,
      coinOutputs: NonEmptyList[CoinInfo],
  )

  private def noShrink[T]: Shrink[T] = Shrink.withLazyList(_ => LazyList.empty)

  given tokenTypeArbitrary: Arbitrary[TokenType] =
    Arbitrary { Gen.const(TokenType.Native) }

  given coinInfoArbitrary: Arbitrary[CoinInfo] =
    Arbitrary {
      tokenTypeArbitrary.arbitrary.flatMap { tokenType =>
        Gen.posNum[Int].map(BigInt(_)).map(CoinInfo(tokenType, _))
      }
    }

  private val localStateGen: Gen[LocalState] =
    Gen.lzy(LocalState().pure[Gen])

  private lazy val addressGen: Gen[Address] =
    localStateGen
      .map(state => LedgerAddress(state.coinPublicKey, state.encryptionPublicKey).asString)
      .map(Address.apply)

  given tokenTransferArbitrary: Arbitrary[TokenTransfer] = {
    Arbitrary {
      for {
        amount <- Gen.posNum[BigInt]
        tokenType <- tokenTypeArbitrary.arbitrary
        address <- addressGen
      } yield TokenTransfer(amount, tokenType, address)
    }
  }

  given tokenTransfersArbitrary(using
      tokenTransferArb: Arbitrary[TokenTransfer],
  ): Arbitrary[NonEmptyList[TokenTransfer]] = {
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
      } yield OfferWithContext(unprovenTxAndState._1, unprovenTxAndState._2, coins)
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
      if (newAmount > BigInt(0)) loop(newAmount, CoinInfo(coinType, part) :: acc)
      else CoinInfo(coinType, amount) :: acc
    }

    NonEmptyList.fromListUnsafe(loop(amount, List.empty))
  }

  // REMEMBER it is using external service, until we get a way to mock proofs
  given txWithContextArbitrary(using
      provingService: ProvingService[IO],
  ): Arbitrary[IO[TransactionWithContext]] = {
    Arbitrary {
      unprovenOfferWithContextArbitrary.arbitrary.map {
        case OfferWithContext(offer, state, coins) =>
          provingService
            .proveTransaction(UnprovenTransaction(offer))
            .map(tx => TransactionWithContext(tx, state, coins))
            .memoize
            .flatten
      }
    }
  }

  given txWithContextShrink: Shrink[IO[TransactionWithContext]] = noShrink

  private def buildOfferForCoins(
      coins: NonEmptyList[CoinInfo],
      localState: Option[LocalState] = None,
  ): (UnprovenOffer, LocalState) = {
    val state = localState.getOrElse(LocalState())
    val baseOfferAndState = buildOfferForCoin(coins.head, state)
    coins.tail
      .foldLeft(baseOfferAndState) { case ((accOffer, accState), coin) =>
        val (offerForCoin, newState) = buildOfferForCoin(coin, accState)
        (accOffer.merge(offerForCoin), newState)
      }
  }

  private def buildOfferForCoin(coin: CoinInfo, state: LocalState): (UnprovenOffer, LocalState) = {
    val output = UnprovenOutput(coin, state.coinPublicKey, state.encryptionPublicKey)
    val offer = UnprovenOffer.fromOutput(output, coin.tokenType, coin.value)
    (offer, state.watchFor(coin))
  }

  def generateStateWithCoins(coins: NonEmptyList[CoinInfo]): LocalState = {
    val (tx, state) = buildOfferForCoins(coins).leftMap(UnprovenTransaction(_).eraseProofs)
    tx.guaranteedCoins.fold(state)(state.applyProofErased)
  }

  def generateStateWithFunds(balanceData: NonEmptyList[(TokenType, BigInt)]): LocalState =
    generateStateWithCoins(generateCoinsFor(balanceData))

  def generateTransactionWithFundsFor(
      balanceData: NonEmptyList[(TokenType, BigInt)],
      state: LocalState,
  ): (UnprovenTransaction, LocalState) = {
    buildOfferForCoins(generateCoinsFor(balanceData), Some(state)).leftMap(
      UnprovenTransaction(_),
    )
  }

  given ledgerTransactionArbitrary(using
      txWithContextArb: Arbitrary[IO[TransactionWithContext]],
  ): Arbitrary[IO[LedgerTransaction]] =
    Arbitrary {
      txWithContextArb.arbitrary
        .map(_.map(_.transaction))
    }

  given ledgerTransactionShrink: Shrink[IO[LedgerTransaction]] = noShrink

  given transactionArbitrary(using
      provingService: ProvingService[IO],
      txWithContextArb: Arbitrary[IO[TransactionWithContext]],
  ): Arbitrary[IO[Transaction]] =
    Arbitrary {
      txWithContextArb.arbitrary
        .map(_.map(txWithContext => LedgerSerialization.toTransaction(txWithContext.transaction)))
    }

  given transactionShrink: Shrink[IO[Transaction]] = noShrink

  def ledgerTransactionsList(using
      provingService: ProvingService[IO],
      txArb: Arbitrary[IO[LedgerTransaction]],
  ): IO[Seq[LedgerTransaction]] =
    Gen
      .chooseNum(1, 5)
      .flatMap(Gen.listOfN(_, txArb.arbitrary).map(_.sequence))
      .sample
      .get

  given transactionsArbitrary(using
      provingService: ProvingService[IO],
      txArbitrary: Arbitrary[IO[Transaction]],
  ): Arbitrary[IO[List[Transaction]]] = {
    Arbitrary {
      Gen.listOfN(2, txArbitrary.arbitrary).map(_.sequence)
    }
  }

  val WalletStateGen: Gen[WalletStateService.State] =
    (localStateGen, Gen.posNum[BigInt]).mapN { (localState, balance) =>
      WalletStateService.State(
        localState.coinPublicKey,
        localState.encryptionPublicKey,
        localState.encryptionSecretKey,
        Map(TokenType.Native -> balance),
        Seq.empty,
        Seq.empty,
        Seq.empty,
        Seq.empty,
        ProgressUpdate.empty,
      )
    }
}
