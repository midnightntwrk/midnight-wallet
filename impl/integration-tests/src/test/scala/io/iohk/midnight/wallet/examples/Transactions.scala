package io.iohk.midnight.wallet.examples

import io.iohk.midnight.wallet.domain.{
  CallTransaction,
  ContractSource,
  DeployTransaction,
  Hash,
  Proof,
  PublicState,
  PublicTranscript,
  TransitionFunction,
  TransitionFunctionCircuits,
}
import java.time.Instant

object Transactions {

  val validCallTx =
    CallTransaction(
      Some(
        Hash[CallTransaction]("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
      ),
      Instant.parse("1969-12-31T23:59:59.999391332Z"),
      Hash[DeployTransaction]("2b00640f0a326ee59f56e7e7cef101a285df5e860c45d9ff8f940eecc57e4015"),
      TransitionFunction("jyfq"),
      Some(Proof("eaa2c823a6db")),
      PublicTranscript(
        "((ezccs) ((vjffpyut pwhf htpicj lhey)) uhvjawi ((fvwlj obep waflvy lvhzwj) (ycff iqtr bxbbj) (kdsh nailyhu)) ((heptdrbx nvuya qzsmwxvy qhue) (jjfafrt hnnu hsfl) (bsln oouvn fscpka zzjdhkp)))",
      ),
    )

  val validDeployTx =
    DeployTransaction(
      Some(
        Hash[DeployTransaction](
          "8b6655003a00d300cbd6c160d2f869013a64e55908271bcfc4ff79c22844a5fe",
        ),
      ),
      Instant.parse("1969-12-31T23:59:57.999536559Z"),
      ContractSource(
        "(((winslsi iqcw) (fato dnvuai hhgtq) itef (etbac oogasl ywbdiejp nqcuyo) (mpnyar)) ((ihfvj beitt wkimfnq vyzwjttu) (gwcmih) (ozsx hbbyy tljv) (geodfwv) (hzi hkcayl)) ((crdyzw yrujnv mkxwcoxq) (avnlnwws qjgm) (ovtene bvdbriax nwjwb fhqzzu) (hiworg)))",
      ),
      PublicState(
        "(((mufu kggff jjhk zgxymchm urffrrf) (ngeub ttvcjta) tmkirsvs (qzg rqfq btmqyxh) (ikpcme bnjdvmd jbmdi)))",
      ),
      TransitionFunctionCircuits(
        Map(
          "ozcvtjnz" -> "ad",
          "clbdy" -> "85dce76fc6a8",
          "vhk" -> "5407a800dc02986ff9",
          "owldy" -> "90324a20",
          "kvc" -> "004d7e7910ac9ccbb7",
          "sinvl" -> "d4fa113ee14107a1",
        ),
      ),
    )
}
