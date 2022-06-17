package io.iohk.midnight.wallet.clients.platform.examples

import io.circe.Json
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync
import io.iohk.midnight.wallet.domain.Receipt.*
import io.iohk.midnight.wallet.domain.*
import java.time.Instant

@SuppressWarnings(Array("org.wartremover.warts.Throw"))
object RollForward {

  // Trying to parse the height of this block will fail with Decoder[BigInt]
  // There's some issue with parsing big numbers in Scala.js
  val veryBigHeightJson: String =
    """{
    |  "protocol": "LocalBlockSync",
    |  "type": "RollForward",
    |  "payload": {
    |    "header": {
    |      "blockHash": "5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38",
    |      "parentBlockHash": "a001ec24fa51f84d828b2ee2ffc071ca7fbad64b7b08ab0c07c09b558c936d7f",
    |      "height": 17019280400900805248,
    |      "timestamp": "1969-12-31T23:59:59.999231476Z"
    |    },
    |    "body": {
    |      "transactionResults": [
    |        {
    |          "kind": "lares",
    |          "transaction": {
    |            "hash": "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7",
    |            "timestamp": "1969-12-31T23:59:53.999509747Z",
    |            "type": "deploy",
    |            "contractSource": "(((ntdkmey qirpm) (vktdzt)) ((wzslgw bjytykow clrbmexk zhh kvve) (kqlm xxn) (grioz) (dmijarh rpl fbubzqo)) ((isk catqjlp) (lhlsukj dnrnuzep) (irqr txol pvlt cknazte) (flxxjvl ieit xcxy vjxbe pxyvv) (isxsnmfd lebsuq)))",
    |            "publicState": "(jzwuc)",
    |            "transitionFunctionCircuits": {
    |              "tzgpxu": "6232e241fc01f4",
    |              "yjrwyne": "e050935684748401"
    |            }
    |          },
    |          "result": {
    |            "type": "ZKFailure",
    |            "message": ""
    |          }
    |        }
    |      ]
    |    }
    |  }
    |}""".stripMargin

  val veryBigHeightObject: LocalBlockSync.RollForward =
    LocalBlockSync.RollForward(
      Block(
        Block.Header(
          Some(Hash[Block]("5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38")),
          Hash[Block]("a001ec24fa51f84d828b2ee2ffc071ca7fbad64b7b08ab0c07c09b558c936d7f"),
          Block
            .Height(BigInt("17019280400900805248"))
            .getOrElse(throw new Exception("Invalid height")),
          Instant.parse("1969-12-31T23:59:59.999231476Z"),
        ),
        List(
          TransactionWithReceipt(
            DeployTransaction(
              Some(
                Hash[DeployTransaction](
                  "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7",
                ),
              ),
              Instant.parse("1969-12-31T23:59:53.999509747Z"),
              ContractSource(
                "(((ntdkmey qirpm) (vktdzt)) ((wzslgw bjytykow clrbmexk zhh kvve) (kqlm xxn) (grioz) (dmijarh rpl fbubzqo)) ((isk catqjlp) (lhlsukj dnrnuzep) (irqr txol pvlt cknazte) (flxxjvl ieit xcxy vjxbe pxyvv) (isxsnmfd lebsuq)))",
              ),
              PublicState(Json.fromString("(jzwuc)")),
              TransitionFunctionCircuits(
                Map(
                  "tzgpxu" -> "6232e241fc01f4",
                  "yjrwyne" -> "e050935684748401",
                ),
              ),
            ),
            ZKFailure(""),
          ),
        ),
      ),
    )

  val validJson: String =
    """{
      |  "protocol": "LocalBlockSync",
      |  "type": "RollForward",
      |  "payload": {
      |    "header": {
      |      "blockHash": "5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38",
      |      "parentBlockHash": "a001ec24fa51f84d828b2ee2ffc071ca7fbad64b7b08ab0c07c09b558c936d7f",
      |      "height": 17019280400900804,
      |      "timestamp": "1969-12-31T23:59:59.999231476Z"
      |    },
      |    "body": {
      |      "transactionResults": [
      |        {
      |          "kind": "lares",
      |          "transaction": {
      |            "hash": "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7",
      |            "timestamp": "1969-12-31T23:59:53.999509747Z",
      |            "type": "deploy",
      |            "contractSource": "(((ntdkmey qirpm) (vktdzt)) ((wzslgw bjytykow clrbmexk zhh kvve) (kqlm xxn) (grioz) (dmijarh rpl fbubzqo)) ((isk catqjlp) (lhlsukj dnrnuzep) (irqr txol pvlt cknazte) (flxxjvl ieit xcxy vjxbe pxyvv) (isxsnmfd lebsuq)))",
      |            "publicState": "(jzwuc)",
      |            "transitionFunctionCircuits": {
      |              "tzgpxu": "6232e241fc01f4",
      |              "yjrwyne": "e050935684748401"
      |            }
      |          },
      |          "result": {
      |            "type": "ZKFailure",
      |            "message": ""
      |          }
      |        },
      |        {
      |          "kind": "lares",
      |          "transaction": {
      |            "hash": "b56301fff26c8bef150180614360257aaa2dfd3ff83c76fbeaf1e800ffd7013e",
      |            "nonce": "42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c",
      |            "timestamp": "1970-01-01T00:00:05.000338337Z",
      |            "type": "call",
      |            "contractHash": "6acdd89eaa541e5f1ec1d180db28bec37b664cffb054209e00c009af71b920f5",
      |            "transitionFunction": "frti",
      |            "proof": "b9162804002be5",
      |            "publicTranscript": "(((nvki csuu agaivib yskmjy czjbr) (noomw ipkjwmm iblzcvh)))"
      |          },
      |          "result": {
      |            "type": "ZKFailure",
      |            "message": "󡝊򿭨𝅳S!a<…7"
      |          }
      |        },
      |        {
      |          "kind": "lares",
      |          "transaction": {
      |            "hash": "ff5e6698fe52cb03927b63bca0ffcd52010d750cf3c4e0d667d69dae112c8067",
      |            "nonce": "42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c",
      |            "timestamp": "1969-12-31T23:59:53.999328452Z",
      |            "type": "call",
      |            "contractHash": "b2df87e43900da7ef6c7033101918a63e2e7720197a4fda1109fbdd5008c0d3d",
      |            "transitionFunction": "swbible",
      |            "proof": "c33fde2301a0",
      |            "publicTranscript": "(((wxsu oycpjo)) rhivvwld)"
      |          },
      |          "result": {
      |            "type": "ZKFailure",
      |            "message": "5[>"
      |          }
      |        },
      |        {
      |          "kind": "lares",
      |          "transaction": {
      |            "hash": "ec010f8d78002249653e586948d78e580fa201ff7ae43fe718266aff38949f2b",
      |            "nonce": "42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c",
      |            "timestamp": "1970-01-01T00:00:02.000163029Z",
      |            "type": "call",
      |            "contractHash": "f4af74842040ff011c27c2c2186c9fe800ca927f28a2927f00413399fe5833aa",
      |            "transitionFunction": "ohjzia",
      |            "proof": "",
      |            "publicTranscript": "(((czx) (hveob lzaivnr masgam oqm fpim)) uhjz ((ehud udm) (fejtf)) wioogh ((qrozkap zxgk) (qwam pppb) (ygli pqdj zono)))"
      |          },
      |          "result": {
      |            "type": "ContractFailure",
      |            "code": -1044804445,
      |            "message": "R®\t'"
      |          }
      |        },
      |        {
      |          "kind": "lares",
      |          "transaction": {
      |            "hash": "3bd0ee87a5412292873efc9c97445e748897ca5e19005ad26db64e2ac8a670f8",
      |            "timestamp": "1969-12-31T23:59:53.999949120Z",
      |            "type": "deploy",
      |            "contractSource": "(((pled xvvfl) (mbihktp ouaef xintf lahb uvzktkt)))",
      |            "publicState": "(((ftoag) (cetaingp xjncx)) ((vwskt)))",
      |            "transitionFunctionCircuits": {
      |              "bkiub": "7962f578f4b8da79",
      |              "rwew": "2a06c9012bf82a8a",
      |              "wfnt": "345b49c381ff0152"
      |            }
      |          },
      |          "result": {
      |            "type": "ZKFailure",
      |            "message": "}RS󜎧￶1 "
      |          }
      |        },
      |        {
      |          "kind": "lares",
      |          "transaction": {
      |            "hash": "a0d8210a830019c8f9ff5701e204732c2400e4166c00564e3cc7066c5fc5664b",
      |            "timestamp": "1969-12-31T23:59:52.999482627Z",
      |            "type": "deploy",
      |            "contractSource": "(((evsimv bemylguz qhdli) (dvxa rles lkb) (odh oqnl acbj bhvebbz lhpfpvhy) (psumgf yfvbqmr)) ykcthemd)",
      |            "publicState": "(((yeloh imoivojk bjkc yfppohpi)) rirton (nra (fpvoaxq sngjuy cxin snkxnwj yko) cxku))",
      |            "transitionFunctionCircuits": {
      |              "kcyt": "ee",
      |              "nafna": "01e0826ab00001",
      |              "nzim": "6fab",
      |              "ptzi": "19d1b2a0ab",
      |              "tvdiakd": "67d53aff15c5",
      |              "wwus": "f201bdbdf3",
      |              "ygxo": "6b382d340bff1637",
      |              "yjeab": "9cd703ae53ff",
      |              "zabcut": "0c825216b72b25"
      |            }
      |          },
      |          "result": {
      |            "type": "Success"
      |          }
      |        }
      |      ]
      |    }
      |  }
      |}""".stripMargin

  val validObject: LocalBlockSync.RollForward =
    LocalBlockSync.RollForward(
      Block(
        Block.Header(
          Some(Hash[Block]("5e51016f56030e0159ff9f01f02effa719ffb75c0115b7377d98551e6f8c7a38")),
          Hash[Block]("a001ec24fa51f84d828b2ee2ffc071ca7fbad64b7b08ab0c07c09b558c936d7f"),
          Block
            .Height(BigInt("17019280400900804"))
            .getOrElse(throw new Exception("Invalid height")),
          Instant.parse("1969-12-31T23:59:59.999231476Z"),
        ),
        List(
          TransactionWithReceipt(
            DeployTransaction(
              Some(
                Hash[DeployTransaction](
                  "bf01a04df7212606c575d2b2b353805d8900e1696607aa63875bcf54809e7dc7",
                ),
              ),
              Instant.parse("1969-12-31T23:59:53.999509747Z"),
              ContractSource(
                "(((ntdkmey qirpm) (vktdzt)) ((wzslgw bjytykow clrbmexk zhh kvve) (kqlm xxn) (grioz) (dmijarh rpl fbubzqo)) ((isk catqjlp) (lhlsukj dnrnuzep) (irqr txol pvlt cknazte) (flxxjvl ieit xcxy vjxbe pxyvv) (isxsnmfd lebsuq)))",
              ),
              PublicState(Json.fromString("(jzwuc)")),
              TransitionFunctionCircuits(
                Map(
                  "tzgpxu" -> "6232e241fc01f4",
                  "yjrwyne" -> "e050935684748401",
                ),
              ),
            ),
            ZKFailure(""),
          ),
          TransactionWithReceipt(
            CallTransaction(
              Some(
                Hash[CallTransaction](
                  "b56301fff26c8bef150180614360257aaa2dfd3ff83c76fbeaf1e800ffd7013e",
                ),
              ),
              Nonce("42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c"),
              Instant.parse("1970-01-01T00:00:05.000338337Z"),
              Hash[DeployTransaction](
                "6acdd89eaa541e5f1ec1d180db28bec37b664cffb054209e00c009af71b920f5",
              ),
              TransitionFunction("frti"),
              Some(Proof("b9162804002be5")),
              PublicTranscript(
                Json.fromString("(((nvki csuu agaivib yskmjy czjbr) (noomw ipkjwmm iblzcvh)))"),
              ),
            ),
            ZKFailure("󡝊򿭨𝅳S!a<…7"),
          ),
          TransactionWithReceipt(
            CallTransaction(
              Some(
                Hash[CallTransaction](
                  "ff5e6698fe52cb03927b63bca0ffcd52010d750cf3c4e0d667d69dae112c8067",
                ),
              ),
              Nonce("42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c"),
              Instant.parse("1969-12-31T23:59:53.999328452Z"),
              Hash[DeployTransaction](
                "b2df87e43900da7ef6c7033101918a63e2e7720197a4fda1109fbdd5008c0d3d",
              ),
              TransitionFunction("swbible"),
              Some(Proof("c33fde2301a0")),
              PublicTranscript(Json.fromString("(((wxsu oycpjo)) rhivvwld)")),
            ),
            ZKFailure("5[>"),
          ),
          TransactionWithReceipt(
            CallTransaction(
              Some(
                Hash[CallTransaction](
                  "ec010f8d78002249653e586948d78e580fa201ff7ae43fe718266aff38949f2b",
                ),
              ),
              Nonce("42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c"),
              Instant.parse("1970-01-01T00:00:02.000163029Z"),
              Hash[DeployTransaction](
                "f4af74842040ff011c27c2c2186c9fe800ca927f28a2927f00413399fe5833aa",
              ),
              TransitionFunction("ohjzia"),
              Some(Proof("")),
              PublicTranscript(
                Json.fromString(
                  "(((czx) (hveob lzaivnr masgam oqm fpim)) uhjz ((ehud udm) (fejtf)) wioogh ((qrozkap zxgk) (qwam pppb) (ygli pqdj zono)))",
                ),
              ),
            ),
            ContractFailure(
              -1044804445,
              "R®\t'",
            ),
          ),
          TransactionWithReceipt(
            DeployTransaction(
              Some(
                Hash[DeployTransaction](
                  "3bd0ee87a5412292873efc9c97445e748897ca5e19005ad26db64e2ac8a670f8",
                ),
              ),
              Instant.parse("1969-12-31T23:59:53.999949120Z"),
              ContractSource(
                "(((pled xvvfl) (mbihktp ouaef xintf lahb uvzktkt)))",
              ),
              PublicState(Json.fromString("(((ftoag) (cetaingp xjncx)) ((vwskt)))")),
              TransitionFunctionCircuits(
                Map(
                  "bkiub" -> "7962f578f4b8da79",
                  "rwew" -> "2a06c9012bf82a8a",
                  "wfnt" -> "345b49c381ff0152",
                ),
              ),
            ),
            ZKFailure("}RS󜎧￶1 "),
          ),
          TransactionWithReceipt(
            DeployTransaction(
              Some(
                Hash[DeployTransaction](
                  "a0d8210a830019c8f9ff5701e204732c2400e4166c00564e3cc7066c5fc5664b",
                ),
              ),
              Instant.parse("1969-12-31T23:59:52.999482627Z"),
              ContractSource(
                "(((evsimv bemylguz qhdli) (dvxa rles lkb) (odh oqnl acbj bhvebbz lhpfpvhy) (psumgf yfvbqmr)) ykcthemd)",
              ),
              PublicState(
                Json.fromString(
                  "(((yeloh imoivojk bjkc yfppohpi)) rirton (nra (fpvoaxq sngjuy cxin snkxnwj yko) cxku))",
                ),
              ),
              TransitionFunctionCircuits(
                Map(
                  "kcyt" -> "ee",
                  "nafna" -> "01e0826ab00001",
                  "nzim" -> "6fab",
                  "ptzi" -> "19d1b2a0ab",
                  "tvdiakd" -> "67d53aff15c5",
                  "wwus" -> "f201bdbdf3",
                  "ygxo" -> "6b382d340bff1637",
                  "yjeab" -> "9cd703ae53ff",
                  "zabcut" -> "0c825216b72b25",
                ),
              ),
            ),
            Success,
          ),
        ),
      ),
    )
}
