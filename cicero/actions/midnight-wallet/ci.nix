{ name, std, lib, actionLib, ... } @ args:

{
  inputs.start = ''
    "${name}": start: {
      ${actionLib.common.inputStartCue}
    }
  '';

  output = { start }:
    actionLib.common.output args start.value.${name}.start;

  job = { start }: let
    cfg = start.value.${name}.start;
  in std.chain args [
    actionLib.simpleJob

    (std.base { })

    (std.github.reportStatus cfg.statuses_url or null)

    (std.git.clone cfg)

    std.nix.develop

    # We should use nix build, but right now it's not possible
    # std.nix.build

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

    (std.wrapScript "bash" (next: ''
      set -x

      pushd wallet-core
      nix build .#midnight-wallet-node-modules
      ln -s "$(realpath result)"/node_modules .
      popd

      sbt scalafmtCheckAll coverage walletCore/test domainJS/test ogmiosSyncJS/test ogmiosTxSubmissionJS/test coverageReport

      ${lib.escapeShellArgs next}
    ''))
  ];
}
