# grep-merge.sh: the main file of the Bash `grep` merge (code-search, contract P1).
#
# Claude Code splices one guarded line into every Bash call of a session, written by
# hooks/grep-merge-env.ts:
#   case $- in *[vxr]*) ;; *) if [[ -r '<main>' && ! -o sourcetrace ]]; then builtin . '<main>'; fi ;; esac; :
# (one line; <main> is this file's path under the plugin's assets dir)
# so this file is sourced, never run, in bash 3.2 or later and in zsh, once or several
# times per call, and never under verbose or xtrace (both would print it to stderr), in a
# restricted shell (which refuses `.` of a path with a `/`) or under zsh SOURCE_TRACE.
#
# It is small and fixed on purpose: every sourcing after the first in a shell parses only
# these lines. The body, grep-merge-body.sh beside it, is sourced once per shell, guarded
# by the sentinel __cs_gm_done, through `builtin .`: a caller's function named `.` must
# not run here (under errexit it would abort the caller's command).
#
# Rules this file keeps, and why:
# - Aliases are suspended while the rest of this file and the body are parsed (the first
#   statement below), so a user alias on grep, rm, curl or printf cannot rewrite a
#   function definition. Each statement here is parsed after the one before it ran, so
#   the restore is the LAST statement: whatever followed it would be parsed with the
#   caller's aliases back on (review round 5: an alias on `unset` printed every call).
# - Sourcing prints nothing and returns 0. A missing or unreadable body defines nothing.
# - The body is named by basename only, beside this file. No absolute path is written.
# - __cs_gm_done is frozen: a later version that renamed it would wrap this wrapper.
# - Every other __cs_gm_ variable either file reads is set first, by the code that reads it
#   (review round 6): a value inherited from the environment or left by the caller is never
#   trusted. An inherited __cs_gm_done means no wrapper, which is the no-plugin behaviour.

# Cleared first (review round 6): only this sourcing may say aliases were on. An inherited
# or leftover value would make the restore below turn on aliases the caller had off.
__cs_gm_ra=
if [[ -n ${ZSH_VERSION-} ]]; then
  if [[ -o aliases ]]; then __cs_gm_ra=1; \builtin unsetopt aliases; fi
elif \builtin shopt -q expand_aliases; then
  __cs_gm_ra=1; \builtin shopt -u expand_aliases
fi

if [[ -z ${__cs_gm_done-} ]]; then
  if [[ -n ${ZSH_VERSION-} ]]; then builtin eval '__cs_gm_b=${(%):-%x}'
  else __cs_gm_b=${BASH_SOURCE[0]-}; fi
  __cs_gm_b=${__cs_gm_b%/*}/grep-merge-body.sh
  if [[ -f $__cs_gm_b && -r $__cs_gm_b ]]; then builtin . "$__cs_gm_b"; fi
  unset __cs_gm_b
fi

# One compound, parsed whole while aliases are still off; it returns 0 either way.
if [[ -n ${__cs_gm_ra-} ]]; then
  \builtin unset __cs_gm_ra
  if [[ -n ${ZSH_VERSION-} ]]; then \builtin setopt aliases; else \builtin shopt -s expand_aliases; fi
else
  \builtin unset __cs_gm_ra
fi
