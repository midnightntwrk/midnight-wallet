{ cicero, lib }:

let
  inherit (cicero.lib) std;

  actionLib = import "${cicero}/action-lib.nix" {
    inherit std lib;
  };
in

actionLib // {
  common = {
    inputStartCue = ''
      clone_url:     string
      sha:           string
      statuses_url?: string
      ref?: "refs/heads/\(default_branch)" | =~"^refs/tags/v\\d+(\\.\\d+){0,2}$"
      default_branch?: string
    '';

    tagsInputStartCue = ''
      clone_url:     string
      sha:           string
      statuses_url?: string
      ref: =~"^refs/tags/v\\d+(\\.\\d+){0,2}$"
      default_branch?: string
    '';

    output = action: start: {
      success.${action.name} = {
        ok = true;
        inherit (start) clone_url sha;
      } // lib.optionalAttrs (start ? statuses_url) {
        inherit (start) statuses_url;
      } // lib.optionalAttrs (start ? ref) {
        inherit (start) ref default_branch;
      };
    };

    task = start: action: next:
      std.chain action [
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
            cpu = 15000;
            memory = 1024 * 6;
          };
        }

        next
      ];
  };
}
