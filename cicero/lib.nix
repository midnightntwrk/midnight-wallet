{ cicero, lib }:

let
  inherit (cicero.lib) std;

  actionLib = import "${cicero}/action-lib.nix" { inherit std lib; };

in actionLib // {
  common = {
    inputStartCue = ''
      clone_url:     string
      sha:           string
      statuses_url?: string
      ref?:          string
    '';

    output = action: start: {
      success.${action.name} = {
        ok = true;
        inherit (start) clone_url sha;
      } // lib.optionalAttrs (start ? statuses_url) {
        inherit (start) statuses_url;
      } // lib.optionalAttrs (start ? ref) {
        inherit (start) ref;
      };
    };

    task = start: action: next:
      std.chain action [
        (std.base {})

        (std.github.reportStatus start.statuses_url or null)

        {
          template = std.data-merge.append [{
            destination = "secrets/netrc";
            data = ''
              machine github.com
              login git
              password {{with secret "kv/data/cicero/github"}}{{.Data.data.token}}{{end}}
            '';
          }];

          resources = {
            cpu = 5000;
            memory = 1024 * 6;
          };
        }

        (std.git.clone start)

        std.nix.develop

        next
      ];
  };
}
