{ name, std, lib, actionLib, ... } @ args:

{
  inputs.ci = ''
    "midnight-wallet/ci": {
      ok: true
      ${actionLib.common.tagsInputStartCue}
    }
  '';

  job = { ci }: let
    cfg = ci.value."midnight-wallet/ci";
  in std.chain args [
    actionLib.simpleJob

    (std.base { })

    (std.github.reportStatus cfg.statuses_url or null)

    (std.git.clone cfg)

    std.nix.develop

    {
      template = std.data-merge.append [
        {
          destination = "secrets/netrc";
          data = ''
            machine github.com
            login git
            password {{with secret "kv/data/cicero/github"}}{{.Data.data.token}}{{end}}

            machine nexus.p42.at
            {{with secret "kv/data/cicero/nexus" -}}
              {{with .Data.data -}}
                login {{.user}}{{"\n" -}}
                password {{.password}}
              {{- end}}
            {{- end}}
          '';
        }
        {
          destination = "secrets/npm.env";
          env = true;
          data = ''
            # for `yarn install`, referenced in .npmrc
            NPM_TOKEN={{with secret "kv/data/cicero/nexus"}}{{.Data.data.token}}{{end}}

            # for `yarn publish`, looked up by yarn
            NPM_AUTH_TOKEN={{with secret "kv/data/cicero/nexus"}}{{.Data.data.token}}{{end}}

            # see README.md
            {{with secret "kv/data/cicero/nexus" -}}
              {{with .Data.data -}}
                MIDNIGHT_REPO_USER={{.user}}{{"\n" -}}
                MIDNIGHT_REPO_PASS={{.password}}
              {{- end}}
            {{- end}}
          '';
        }
      ];

      env.NIX_CONFIG = "netrc-file = /secrets/netrc";

      resources = {
        cpu = 10000;
        memory = 1024 * 8;
      };
    }

    (std.script "bash" ''
      set -x

      sbt '+ ogmiosSyncJS/publish; + ogmiosSyncJVM/publish; + ogmiosTxSubmissionJS/publish; + ogmiosTxSubmissionJVM/publish' || :

      sbt dist
      pushd wallet-core
      yarn publish || :
    '')
  ];
}
