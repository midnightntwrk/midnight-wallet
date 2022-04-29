{ name, std, lib, actionLib, ... } @ args:

{
  inputs.build = ''
    "midnight-wallet/ci/build": {
      ok: true
      ${actionLib.common.inputStartCue}
    }
  '';

  output = { build }:
    actionLib.common.output args
      build.value."midnight-wallet/ci/build";

  job = { build }:
    std.chain args [
      actionLib.simpleJob
      (actionLib.common.task
        build.value."midnight-wallet/ci/build")
      (std.script "bash" ''
        sbt scalafmtCheckAll
      '')
    ];
}
