{
  CI = {config, ...}: {
    preset = {
      nix.enable = true;

      github = let
        enable = config.actionRun.facts != {};
        repository = "input-output-hk/midnight-wallet";
        revision = config.preset.github.lib.readRevision "GitHub event" "";
      in {
        ci = {
          inherit enable repository revision;
        };
        status = {
          inherit enable repository revision;
          enableActionName = false;
        };
      };
    };

    command.text = ''
      set -x

      nix develop -L -c sbt verify
      nix develop -L -c sbt '++ 3.2.1 ouroborosSyncMiniProtocolJS/test; ouroborosTxSubmissionMiniProtocolJS/test'
      nix develop -L -c sbt dist
      pushd examples
      nix develop -L -c yarn install --frozen-lockfile
      mkdir -p /usr/bin/ && touch /usr/bin/env
      ln -fs "$(nix develop -L -c which env)" /usr/bin/env
      nix develop -L -c yarn lint
      nix develop -L -c yarn test
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

      github = let
        enable = config.actionRun.facts != {};
        repository = "input-output-hk/midnight-wallet";
        revision = config.preset.github.lib.readRevision "GitHub tag pushed" "";
      in {
        ci = {
          inherit enable repository revision;
        };
        status = {
          inherit enable repository revision;
          enableActionName = false;
        };
      };
    };

    command.text = ''
      set -x

      nix develop -L -c sbt '+ blockchainJS/publish; + blockchainJVM/publish; + ouroborosCoreJS/publish; + ouroborosCoreJVM/publish; + ouroborosSyncMiniProtocolJS/publish; + ouroborosSyncMiniProtocolJVM/publish; + ouroborosTxSubmissionMiniProtocolJS/publish; + ouroborosTxSubmissionMiniProtocolJVM/publish' || :

      nix develop -L -c sbt dist
      pushd wallet-engine
      nix develop -L -c yarn publish || :
      pushd ../ouroboros-sync-mini-protocol/js
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
