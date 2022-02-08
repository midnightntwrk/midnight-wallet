package io.iohk.midnight.wallet.examples

import io.iohk.midnight.wallet.domain.{
  CallTransaction,
  ContractSource,
  DeployTransaction,
  Hash,
  Nonce,
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
      Nonce("42321d49eaaa7f7c89d2d466b8a8f9a79c18446296dbd9c0f255c7d799a8e67c"),
      Instant.parse("1969-12-31T23:59:59.999391332Z"),
      Hash[DeployTransaction]("8b6655003a00d300cbd6c160d2f869013a64e55908271bcfc4ff79c22844a5fe"),
      TransitionFunction("jyfq"),
      Some(
        Proof(
          "af5b8e94cb989ffabbf01df2fd8a36dcf4c7842b9312dc787153018a90e3eaeab3b00aae9ac2dc450ffed0aeb53fef1760ce4fb5d2e21683e31bb70488b9e03ea41043cbfb577d7ac2190fe27ad6b48d4dfe3dfb01d3138367873a69c8a9c58c7a4fa27a3521d02161335814c830bc72414891cf06c996b2047e49f3babc6234189f7bfaddeb56734a9de9e4e7be3808d2cdd524e5fff039b58062b9c0a6fa1a841552aa6031c9306b434d5f1aad3116aba448f738074c29ac8cab6cc4f0130df33300f5506184f11b8f3aaf6d62b90a81ccca27e4bec47929b98380afbbaea855a27927b82be63f50638bebdf68a517c4db6eb931e5d27b90450bbc30b33eb65cac170f2205b6b67e0fe430c25eda0791bb73ec7add1f2a773f6a890ba59f87279cf67245339c8db86bbbf5ced30c97dfd051243e0f06c23333706d03743995c04a666b18c96103de25e7ebca1c568bc25e4f1a8395ec89bc772f6d3bff20216b07ea9ed20cb42c0b085038945361d702e861496ce9f47c7f855a12b4abf395a9f766d220e78029be6dda5b704253f72c2ab013152db4302748501eae24d6a0b56c36576328f8259a810be7c33a748442e72a1545b6bfbf622d1256f0f0acb06c228682bd1644648f43e452298820000cae7afc2ee4ca36881c9a76d35f909630c3515463fb3d2cfdcab03e93709f6dc4fc2b3998946367347e64183afce9aa8b6931b0698560e72dc4638ece278a8e0b6c741ac1f2b9156c2b6c04f5ae156d2e42a5151c89c4547121a6b6a25953288c771ff5e0fb50e6c25b61cbafe2ac4856c2916dc3d7912ab0388aa7a5fbde696d68bae6c3aec9609a7f8757ae9f942f5d90b36996e6958414546f3715961c27ceffa65783295960f170178b43547c2a06b0eba19b2f3c6a2b7f12ba35ba4729d4874e4abcbfe01ac6bfe2a4b375589633281db8e6779e2caa0fd414e136510187698eb7aba17af6312a856e113cb1422b7151c5a21336352ce22d16b7037157dfca164eae93942a1911ee04574f45b47851d41d29c205b7b5f523b558f54d4c13ab5421ef3d36da2491c2e181e8626411de58d37c8c08a2c3486964af5e27015fd5a276210818f327f47c0a256c1b17715bb8fd29c4619dc6baa546cc82a75d7ddb97dc1682b3abb7fd9a4743d4db3ec6ddc0bf86b951821de51867d172c03690b36d6d2bdaa7af33b83c441bd6f82c7e747500e18c9b6c239a26f4823935385796b3c4c1092078a57f209178837f4e4ae5a991219764b13f2391fc64fa87717d0478e14c61266b54cd9b31af14865e18ae2a470968c416b66fdc6ea1a1d619350ee3d0bb79b02d9b15253e9c437fb1a15f4bf74a88ae113a80dd996d52b0423c68f4514abadb9522c86cc16a21f9b5ea61d5dc89a39afe2dc10e6b5390e63faf53160be5b53ac2966918d2ea5b8e69334459e9db83b9676136720faa641723",
        ),
      ),
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
