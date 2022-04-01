{ name, std, lib, actionLib, ... } @ args:

{
  inputs.check-formatting = ''
    "midnight-wallet/ci/check-formatting": {
      ok: true
      ${actionLib.common.inputStartCue}
    }
  '';

  output = { check-formatting }:
    actionLib.common.output args
      check-formatting.value."midnight-wallet/ci/check-formatting";

  job = { check-formatting }:
    std.chain args [
      actionLib.simpleJob
      (actionLib.common.task
        check-formatting.value."midnight-wallet/ci/check-formatting")
      (std.script "bash" ''
        sbt test
      '')
    ];
}
