{ name, std, lib, actionLib, ... }@args:

{
  inputs.unit-tests = ''
    "midnight-wallet/ci/unit-tests": {
      ref: "refs/heads/main"
      ok: true
      ${actionLib.common.inputStartCue}
    }
  '';

  output = { unit-tests }:
    let unit-tests-value = unit-tests.value."midnight-wallet/ci/unit-tests";
    in lib.recursiveUpdate (actionLib.common.output args unit-tests-value) {
      success."midnight-wallet/ci" = {
        ok = true;
        revision = unit-tests-value.sha;
      };
    };

  job = { unit-tests }:
    std.chain args [
      actionLib.simpleJob

      (actionLib.common.task unit-tests.value."midnight-wallet/ci/unit-tests")

      rec {
        template = std.data-merge.append [{
          destination = "secrets/npm_auth";
          data = env.NPM_TOKEN;
        }];
        env.NPM_TOKEN = ''{{with secret "kv/data/cicero/nexus"}}{{.Data.data.token}}{{end}}'';
      }

      (std.script "bash" ''
        set -x
        yarn set version 3.1.1
        yarn install
        yarn npm publish
      '')
    ];
}
