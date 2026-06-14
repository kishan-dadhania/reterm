# Reterm shell integration — zsh
#
# Emits OSC sequences so the host can carve the raw PTY stream into discrete
# command entries:
#   ESC]133;A BEL              — prompt about to start (acts as "previous command boundary")
#   ESC]133;B BEL              — command input start (right after prompt printed)
#   ESC]6973;cmd;<b64> BEL     — command text (base64 utf-8), emitted in preexec
#   ESC]133;C BEL              — command output starts
#   ESC]133;D;<exit> BEL       — command finished
#   ESC]7;file://host/<path> BEL — current working directory

if [[ -n "$RETERM_SHELL_INTEGRATION" ]]; then return 0; fi
export RETERM_SHELL_INTEGRATION=1

# If launched with our own ZDOTDIR (to inject this file), fall through to the
# user's real zshrc afterward.
if [[ -n "$RETERM_USER_ZDOTDIR" ]]; then
  export ZDOTDIR="$RETERM_USER_ZDOTDIR"
  unset RETERM_USER_ZDOTDIR
  [[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
fi

__reterm_osc() { printf '\e]%s\a' "$1"; }

__reterm_precmd() {
  local exit=$?
  __reterm_osc "133;D;$exit"
  __reterm_osc "7;file://${HOST}${PWD}"
  __reterm_osc "133;A"
}

__reterm_preexec() {
  # $1 contains the command as typed
  local cmd_b64
  cmd_b64=$(print -rn -- "$1" | base64 | tr -d '\n ')
  __reterm_osc "6973;cmd;$cmd_b64"
  __reterm_osc "133;C"
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __reterm_precmd
add-zsh-hook preexec __reterm_preexec

# Emit cwd + a synthetic boundary at startup so the first command has context
__reterm_osc "7;file://${HOST}${PWD}"
__reterm_osc "133;A"

# Inject command-input-start marker into prompt
PS1="%{$(printf '\e]133;B\a')%}$PS1"
