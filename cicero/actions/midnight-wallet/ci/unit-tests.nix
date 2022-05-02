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

      rec {
        template = std.data-merge.append [{
          destination = "secrets/npm_auth";
          data = env.NPM_AUTH_TOKEN;
        }];
        env.NPM_AUTH_TOKEN = ''{{with secret "kv/data/cicero/nexus"}}{{.Data.data.token}}{{end}}'';
      }

      (std.script "bash" ''
        sbt test
      '')
    ];
}
