#!/bin/sh
# p08-sourcing-cost.sh — what the grep merge's source line costs on every Bash call (P0-8).
#
# Usage: sh p08-sourcing-cost.sh <path to assets/grep-merge.sh> [N]     (N defaults to 1000)
#
# WHAT IT MEASURES. Claude Code runs each Bash call in a fresh shell that splices the session
# env script in first, so with the merge on, every call evaluates the guarded source line and
# parses the wrapper's main and body files once. For /bin/zsh and /bin/bash, and for 1 and 3
# copies of the line, it runs five reps. Each rep starts a fresh shell that defines a
# stand-in for Claude Code's snapshot `grep` function, then runs N iterations of
# {eval the exact env line 1 or 3 times; reset to a fresh call's state}, with stdout and
# stderr to one regular file (so the body takes its fd-1 duplicate, as in a real call).
# A base run does the reset alone. Cost per call = (src - base) / N.
#
# HOW TO READ IT. One line per shell and line count:
#   <shell> lines=<k> N=<n> per-call cost (ms): <5 values>  median=<m>  [wrapper-defined]
# The median is the number to quote. `[wrapper-defined]` means EVERY src rep of that line
# defined the whole wrapper (Claude Code's grep copied, and the body's helpers through its
# last one). `[NO-WRAPPER]` means at least one rep did not: the line measures nothing and
# must not be recorded, and the probe exits 1.
# Exit status: 0 every line measured; 1 a measurement is void (a rep failed or printed a
# non-number, the env line printed output a real Bash call would show, or NO-WRAPPER);
# 2 bad arguments or a missing prerequisite. On a failed rep or unexpected output nothing
# is printed on stdout: the reason goes to stderr, so no partial number can be recorded.
# Accepted cost and budgets: the code-search grep-merge ai-doc, §5 "Costs" and §6.
#
# Self-contained: it writes its inner script and stand-in snapshot into a temp directory and
# removes it on exit. Needs perl with Time::HiRes for the sub-millisecond clock.

set -u

usage() {
  echo "usage: sh $0 <path to assets/grep-merge.sh> [N]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
asset=$1
n=${2:-1000}
case $n in '' | *[!0-9]*) usage ;; esac
[ "$n" -gt 0 ] || usage
[ -r "$asset" ] || { echo "p08: cannot read $asset" >&2; exit 2; }
# The env line holds an absolute path, so the probe uses one too.
asset=$(cd "$(dirname "$asset")" && pwd -P)/$(basename "$asset")

fail() {
  echo "p08: $1" >&2
  exit "${2:-1}"
}

# Prerequisites, checked before anything is measured.
for tool in perl mktemp sed sort head cat rm dirname basename; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing prerequisite: $tool" 2
done
perl -MTime::HiRes=time -e 1 >/dev/null 2>&1 || fail "missing prerequisite: perl module Time::HiRes" 2
[ -x /bin/zsh ] || [ -x /bin/bash ] || fail "missing prerequisite: neither /bin/zsh nor /bin/bash" 2

work=$(mktemp -d "${TMPDIR:-/tmp}/p08.XXXXXX") || fail "mktemp failed" 2
trap 'rm -rf "$work"' EXIT
trap 'exit 130' INT TERM

# Stand-in for the `grep` function Claude Code's shell snapshot defines (2.1.299 shape).
# It is only defined, never called, so the binary path it names does not matter.
cat >"$work/snap-grep.sh" <<'SNAP'
function grep {
  local _cc_a
  for _cc_a in ${1+"$@"}; do
    case "$_cc_a" in -*-filter*|-*-pager*|-*-view*|-*-format-open*|-*-config*|---*|-@*|-*-save-config*|-[Zz]*|-[!-]*[Zz]*|--null|--null-data) command grep ${1+"$@"}; return ;; esac
  done
  local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"
  [[ -x $_cc_bin ]] || _cc_bin=$HOME/.local/bin/claude
  if [[ ! -x $_cc_bin ]]; then command grep ${1+"$@"}; return; fi
  if [[ -n ${ZSH_VERSION:-} ]]; then
    ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl ${1+"$@"}
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl ${1+"$@"}
  else
    (exec -a ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl ${1+"$@"})
  fi
}
SNAP

# inner.sh MODE LINES N ASSET — run by zsh or bash. MODE=src: per iteration, eval the real
# env line LINES times, then reset to a fresh call's state. MODE=base: the reset alone.
# Prints elapsed ms and the wrapper sanity result on fd 3.
cat >"$work/inner.sh" <<'INNER'
mode=$1 lines=$2 n=$3 asset=$4
here=${0%/*}
. "$here/snap-grep.sh"
if [ -n "${ZSH_VERSION-}" ]; then functions -c grep __p08_orig; else eval "__p08_orig () $(declare -f grep | sed 1d)"; fi
line="case \$- in *[vxr]*) ;; *) if [[ -r '$asset' && ! -o sourcetrace ]]; then builtin . '$asset'; fi ;; esac; :"
reset() {
  if [ -n "${__cs_gm_fd-}" ]; then
    if [ -n "${ZSH_VERSION-}" ]; then exec {__cs_gm_fd}>&-; else eval "exec ${__cs_gm_fd}>&-"; fi
  fi
  unset -f grep __cs_cc_grep __cs_gm_start __cs_gm_finish __cs_gm_log __cs_gm_sockok __cs_gm_readframe __cs_gm_classify __cs_gm_argv __cs_gm_count __cs_gm_wordlike 2>/dev/null
  unset __cs_gm_done __cs_gm_cc __cs_gm_sub __cs_gm_fd __cs_gm_seq __cs_gm_slow __cs_gm_cpid 2>/dev/null
  if [ -n "${ZSH_VERSION-}" ]; then functions -c __p08_orig grep; else eval "grep () $(declare -f __p08_orig | sed 1d)"; fi
}
t0=$(perl -MTime::HiRes=time -e 'printf "%.6f", time')
i=0
while [ $i -lt $n ]; do
  if [ "$mode" = src ]; then
    j=0; while [ $j -lt $lines ]; do eval "$line"; j=$((j+1)); done
  fi
  reset
  i=$((i+1))
done
t1=$(perl -MTime::HiRes=time -e 'printf "%.6f", time')
# Sanity, checked once at the end: a src run must have defined the whole wrapper, from
# Claude Code's copied grep to the body's last helper, so a body that stopped part way fails.
if [ "$mode" = src ]; then
  eval "$line"
  ok=wrapper-defined
  for f in __cs_cc_grep __cs_gm_classify __cs_gm_wordlike; do
    typeset -f "$f" >/dev/null 2>&1 || ok=NO-WRAPPER
  done
else ok=-; fi
perl -e "printf \"%.3f %s\n\", ($t1-$t0)*1000, \"$ok\"" >&3
INNER

is_ms() {
  case $1 in '' | *[!0-9.]* | .* | *. | *.*.*) return 1 ;; esac
  return 0
}

# One timed inner run: sets `out` to "<ms> <ok>", or fails the whole probe with no numbers.
inner() {
  out=$("$1" "$work/inner.sh" "$2" "$3" "$n" "$asset" 3>&1 >"$work/out.txt" 2>&1) ||
    fail "$1 $2 run failed (lines=$3, rep=$4); no numbers printed"
  is_ms "${out%% *}" || fail "$1 $2 run printed no time (lines=$3, rep=$4): '$out'; no numbers printed"
  if [ -s "$work/out.txt" ]; then
    echo "p08: UNEXPECTED OUTPUT from $1 $2 run (lines=$3, rep=$4):" >&2
    head -5 "$work/out.txt" >&2
    fail "the env line printed output; no numbers printed"
  fi
}

# Every line is held back until every rep has succeeded.
report=""
void=0
for sh in /bin/zsh /bin/bash; do
  if [ ! -x "$sh" ]; then
    report="$report$sh not found; skipped
"
    continue
  fi
  for lines in 1 3; do
    : >"$work/costs.txt"
    costs=""
    ok=wrapper-defined
    for rep in 1 2 3 4 5; do
      inner "$sh" base "$lines" "$rep"
      b=${out%% *}
      inner "$sh" src "$lines" "$rep"
      s=${out%% *}
      [ "${out#* }" = wrapper-defined ] || ok=NO-WRAPPER
      c=$(perl -e 'printf "%.3f", ($ARGV[0] - $ARGV[1]) / $ARGV[2]' "$s" "$b" "$n") ||
        fail "perl failed computing a cost; no numbers printed"
      echo "$c" >>"$work/costs.txt"
      costs="$costs $c"
    done
    [ "$ok" = wrapper-defined ] || void=1
    med=$(sort -n "$work/costs.txt" | sed -n 3p)
    report="$report$sh lines=$lines N=$n per-call cost (ms):$costs  median=$med  [$ok]
"
  done
done
printf '%s' "$report"
[ "$void" -eq 0 ] || fail "NO-WRAPPER in at least one rep; these numbers are void"
