package io.iohk.midnight.wallet.ouroboros.sync.examples

import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash

object FindIntersect {

  val validJson: String =
    """{
      |  "protocol" : "LocalBlockSync",
      |  "type" : "FindIntersect",
      |  "payload" : [
      |    "0fef6d9d541901ff7a01babc95422d0278a252edfd23e8bc34b39a6c8d79279b",
      |    "89e9d960f86d15861b0adf00045176483f7fc0e70689f85fa74b186393004dc8",
      |    "b0bb3e570193576223428516f80acaf55975a50153a201e010ff41c1cae4c037",
      |    "9e90bc9960ae39b24ea873348a83471ccc095657c567c0470a66464c536001af",
      |    "5b6a2ca110a5227cd546cfbf016afa7b9073ff11a9ff81e2ff8c00d1e50973a2"
      |  ]
      |}""".stripMargin

  val validObject: LocalBlockSync.Send.FindIntersect =
    LocalBlockSync.Send.FindIntersect(
      Seq(
        Hash("0fef6d9d541901ff7a01babc95422d0278a252edfd23e8bc34b39a6c8d79279b"),
        Hash("89e9d960f86d15861b0adf00045176483f7fc0e70689f85fa74b186393004dc8"),
        Hash("b0bb3e570193576223428516f80acaf55975a50153a201e010ff41c1cae4c037"),
        Hash("9e90bc9960ae39b24ea873348a83471ccc095657c567c0470a66464c536001af"),
        Hash("5b6a2ca110a5227cd546cfbf016afa7b9073ff11a9ff81e2ff8c00d1e50973a2"),
      ),
    )
}
