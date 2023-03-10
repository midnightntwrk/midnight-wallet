let
  common = {
    config,
    lib,
    ...
  }: {
    preset = {
      nix.enable = true;

      github.ci = {
        enable = config.actionRun.facts != {};
        repository = "input-output-hk/midnight-wallet";
      };
    };

    memory = 1024 * 8;

    nomad = {
      resources.cpu = 5000;

      driver = lib.mkDefault "exec";

      templates = [
        {
          destination = "${config.env.HOME}/.netrc";
          data = ''
            machine github.com
            login git
            password {{with secret "kv/data/cicero/github"}}{{.Data.data.token}}{{end}}

            machine api.github.com
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
            {{with secret "kv/data/cicero/nexus" -}}
              {{with .Data.data -}}
                MIDNIGHT_REPO_USER={{.user}}{{"\n" -}}
                MIDNIGHT_REPO_PASS={{.password}}
              {{- end}}
            {{- end}}
          '';
        }
        {
          destination = "${config.env.HOME}/.npmrc";
          data = ''
            @midnight:registry=https://nexus.p42.at/repository/npm-midnight/
            //nexus.p42.at/repository/npm-midnight/:_authToken={{with secret "kv/data/cicero/nexus"}}{{.Data.data.token}}{{end}}
          '';
        }
        {
          destination = "${config.env.HOME}/.config/nix/nix.conf";
          data = ''
            access-tokens = github.com={{with secret "kv/data/cicero/github"}}{{.Data.data.token}}{{end}}
          '';
        }
      ];

      env.NIX_CONFIG = ''
        netrc-file = ${config.env.HOME}/.netrc
      '';
    };
  };

  linkEnv = {pkgs, ...}: {
    dependencies = [
      (pkgs.runCommand "/usr/bin/env" {} ''
        mkdir -p $out/usr/bin
        ln -s ${pkgs.coreutils}/bin/env $out/usr/bin/env
      '')
    ];
  };
in {
  CI = {config, ...}: {
    imports = [common linkEnv];

    preset.github.ci = {
      remote = config.preset.github.lib.readRepository "GitHub Push or PR" "";
      revision = config.preset.github.lib.readRevision "GitHub Push or PR" "";
    };

    command.text = ''
      set -x

      nix fmt -- -c flake.nix tullia/

      nix develop .#no-proofs -L -c sbt verify
      nix develop .#real-proofs -L -c sbt IntegrationTest/test

      nix develop -L -c sbt dist
      pushd examples
      nix develop -L -c yarn install --frozen-lockfile
      nix develop -L -c yarn lint
      nix develop -L -c yarn test
    '';
  };

  CD = {config, ...}: {
    imports = [common linkEnv];

    preset.github.ci = {
      remote = config.preset.github.lib.readRepository "GitHub Tag" "";
      revision = config.preset.github.lib.readRevision "GitHub Tag" "";
    };

    command.text = ''
      set -x

      nix develop -L -c sbt '+ blockchainJS/publish; + blockchainJVM/publish' || :

      nix develop -L -c sbt dist
      pushd wallet-engine
      nix develop -L -c yarn publish || :
    '';
  };
}
