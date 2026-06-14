# Reterm shell integration — bash. See reterm-integration.zsh for the protocol.

if [[ -n "$RETERM_SHELL_INTEGRATION" ]]; then return 0; fi
export RETERM_SHELL_INTEGRATION=1

__reterm_osc() { printf '\e]%s\a' "$1"; }

__reterm_precmd() {
  local exit=$?
  __reterm_osc "133;D;$exit"
  __reterm_osc "7;file://${HOSTNAME}${PWD}"
  __reterm_osc "133;A"
}

__reterm_preexec() {
  # Ignore the precmd itself (DEBUG fires for everything).
  [[ "$BASH_COMMAND" == "__reterm_precmd"* ]] && return
  [[ "$COMP_LINE" != "" ]] && return
  local cmd_b64
  cmd_b64=$(printf '%s' "$BASH_COMMAND" | base64 | tr -d '\n ')
  __reterm_osc "6973;cmd;$cmd_b64"
  __reterm_osc "133;C"
}

trap '__reterm_preexec' DEBUG
PROMPT_COMMAND="__reterm_precmd${PROMPT_COMMAND:+; }$PROMPT_COMMAND"

__reterm_osc "7;file://${HOSTNAME}${PWD}"
__reterm_osc "133;A"

PS1="\[$(__reterm_osc 133\;B)\]$PS1"
