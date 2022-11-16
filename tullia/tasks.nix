{
  CI = {config, ...}: {
    preset = {
      nix.enable = true;
      github-ci = {
        enable = config.actionRun.facts != {};
        repo = "input-output-hk/midnight-wallet";
        sha = config.preset.github-ci.lib.getRevision "GitHub event" "";
      };
    };

    command.text = ''
      set -x

      pushd wallet-engine
      nix build .#midnight-wallet-node-modules
      ln -s "$(realpath result)"/node_modules .
      popd

      nix develop -L -c sbt verify
      nix develop -L -c sbt '++ 3.1.2 ogmiosSyncJS/test; ogmiosTxSubmissionJS/test'
      nix develop -L -c sbt 'walletEngine / IntegrationTest / test'
    '';

    memory = 1024 * 8;
    nomad = {
      resources.cpu = 5000;
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

      env.NIX_CONFIG = "netrc-file = ${config.env.HOME}/.netrc";
    };
  };

  CD = {config, ...}: {
    preset = {
      nix.enable = true;
      github-ci = {
        enable = config.actionRun.facts != {};
        repo = "input-output-hk/midnight-wallet";
        sha = config.preset.github-ci.lib.getRevision "GitHub tag pushed" "";
      };
    };

    command.text = ''
      set -x

      nix develop -L -c sbt '+ blockchainJS/publish; + blockchainJVM/publish; + ogmiosCoreJS/publish; + ogmiosCoreJVM/publish; + ogmiosSyncJS/publish; + ogmiosSyncJVM/publish; + ogmiosTxSubmissionJS/publish; + ogmiosTxSubmissionJVM/publish' || :

      nix develop -L -c sbt dist
      pushd wallet-engine
      nix develop -L -c yarn publish || :
      pushd ../ogmios-sync/js
      nix develop -L -c yarn publish || :
    '';

    memory = 1024 * 8;
    nomad = {
      resources.cpu = 5000;
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

      env.NIX_CONFIG = "netrc-file = ${config.env.HOME}/.netrc";
    };
  };
}
