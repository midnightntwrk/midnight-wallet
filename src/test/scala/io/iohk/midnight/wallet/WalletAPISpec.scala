package io.iohk.midnight.wallet

import cats.Id
import io.iohk.midnight.wallet.api.WalletAPI
import io.iohk.midnight.wallet.circuit.CircuitValuesExtractorStub
import io.iohk.midnight.wallet.clients.{PlatformClientStub, ProverClientStub}
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Generators.*
import io.iohk.midnight.wallet.store.InMemoryPrivateStateStore
import io.iohk.midnight.wallet.transaction.TransactionBuilderStub
import org.scalacheck.Prop.{forAll, propBoolean}
import org.scalacheck.Properties

trait WalletAPISpec:
  val privateStateStore = InMemoryPrivateStateStore()
  val transactionBuilder = TransactionBuilderStub()
  val circuitValuesExtractor = CircuitValuesExtractorStub()
  val proverClient = ProverClientStub()
  val platformClient = PlatformClientStub()

  val walletCoreApi =
    WalletAPI.Live[Id](
      privateStateStore,
      transactionBuilder,
      circuitValuesExtractor,
      proverClient,
      platformClient
    )

object WalletAPICallContractSpec
    extends Properties("WalletCoreAPI.callContract")
    with WalletAPISpec:
  property("a hash is returned") = forAll(contractInputGen) { (input: ContractInput) =>
    walletCoreApi.callContract(input).isInstanceOf[Hash]
  }

  property("private state is updated") = forAll(contractInputGen) { (input: ContractInput) =>
    walletCoreApi.callContract(input)
    privateStateStore.getState(input.contract).contains(input.contractState.privateState)
  }

  property("private state is separated") = forAll(contractInputGen, contractInputGen) {
    (input1: ContractInput, input2: ContractInput) =>
      walletCoreApi.callContract(input1)
      walletCoreApi.callContract(input2)

      privateStateStore.getState(input1.contract) != privateStateStore.getState(input2.contract)
  }

object WalletAPIGetPrivateStateSpec
    extends Properties("WalletCoreAPI.getPrivateState")
    with WalletAPISpec:
  property("initial state is empty") = forAll(contractGen) { (contract: Contract) =>
    walletCoreApi.getPrivateState(contract).isEmpty
  }

  property("state is updated") = forAll(contractGen) { (contract: Contract) =>
    val contractState = ContractPrivateState()
    privateStateStore.setState(contract, contractState)
    walletCoreApi.getPrivateState(contract) == Some(contractState)
  }
