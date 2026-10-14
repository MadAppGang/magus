# grep-merge-body.sh: the body of the Bash `grep` merge (code-search, contracts P1, P2).
#
# Sourced once per shell by grep-merge.sh, with aliases suspended. It saves Claude Code's
# `grep` function as __cs_cc_grep and defines a `grep` wrapper that always delegates to it.
# For a recursive search of a plain word whose output goes straight to the captured
# result, the wrapper also asks this session's code-search server, over its unix socket,
# for related locations the index knows and grep did not print, and appends them after
# grep's own output as one labelled block. Everything else is grep, untouched.
#
# The contract the wrapper keeps:
# - argv, stdout bytes, stderr bytes and the status are the delegate's. The block only
#   follows grep's stdout, only when grep's status is 0 or 1, and only when the server's
#   frame checks out byte for byte.
# - The pass-through path runs builtins only. Every word below is a reserved word, a bare
#   special builtin, a __cs_gm_ or __cs_cc_ function, or a command after `command` or
#   `builtin`, so no user function or alias can stand in for one of them.
# - The delegate runs in the caller's own context. `grep` and its delegate call never
#   `emulate`: only private helpers do, and each returns before the delegate starts, so a
#   zsh delegate sees the caller's options. With errexit on (bash `set -e`, zsh ERR_EXIT or
#   ERR_RETURN) the call always passes through, and on every pass-through the delegate is
#   the function's last command, with no status capture, so its own errexit and ERR-trap
#   behaviour is the behaviour the caller set up.
# - Nothing of ours can trip `set -e`, `set -u`, pipefail or zsh ERR_EXIT/ERR_RETURN: every
#   internal command sits inside a condition or ends in `|| :`, and every expansion that
#   may be unset uses a default.
# - Helpers that set a local LC_ALL run with their stderr discarded at the call site:
#   bash 4.1+ warns on stderr when it restores an exported LC_ALL naming a missing locale.
# - Every redirection that opens a file other than /dev/null sits inside a group whose
#   stderr is /dev/null: the open error of `cmd > f 2>/dev/null` reaches the caller.
# - Locale-sensitive byte counts run inside helpers with a local LC_ALL=C, so the
#   delegate always sees the caller's locale.
#
# Final-output identity (decision D1, branch A, measured in Claude Code). When this body
# is sourced, fd 1 and fd 2 are the one regular file Claude Code captures. The body keeps
# a duplicate of fd 1 and never writes to it. A call merges only while its own fd 1 is
# still that file: true for a plain call, `2>/dev/null`, `2>&1` and `{ ...; }`; false for
# `> f`, `>> f`, `&> f`, `> /dev/null`, a pipe and `$( )`. A subshell (`( ... )`, `... &`)
# fails the subshell test instead.
#
# __cs_gm_done and __cs_cc_grep are frozen names. A later version that renamed either
# would copy this wrapper as its own delegate, and `grep` would recurse forever. A body
# that finds __cs_cc_grep already defined, from any version, defines nothing.

__cs_gm_done=1

if builtin typeset -f __cs_cc_grep >/dev/null 2>&1; then
  :
else
  __cs_gm_cc=
  __cs_gm_ok=1
  # The wrapper's per-shell state, set here before any function reads it (review round 6):
  # an inherited __cs_gm_cpid could match a job of the caller's (and a merge would then
  # overwrite its `$!`), bash evaluates an inherited __cs_gm_seq as arithmetic, and an
  # inherited __cs_gm_slow would turn the merge off.
  __cs_gm_seq=0
  __cs_gm_slow=
  __cs_gm_cpid=

  # Copy Claude Code's grep. With no grep function (the Grep-tool opt-in sessions, where
  # grep is the system binary or an alias of it) the wrapper delegates to `command grep`.
  if builtin typeset -f grep >/dev/null 2>&1; then
    __cs_gm_ok=
    if [[ -n ${ZSH_VERSION-} ]]; then
      if \builtin functions -c grep __cs_cc_grep 2>/dev/null; then __cs_gm_ok=1; fi
    else
      # No xtrace handling here: the env line never sources this under `x` or `v`
      # (hooks/grep-merge-env.ts), and nothing else sources it.
      __cs_gm_src=$(builtin typeset -f grep 2>/dev/null) || __cs_gm_src=
      if [[ -n $__cs_gm_src ]]; then
        if builtin eval "__cs_cc_grep ${__cs_gm_src#grep }" 2>/dev/null; then __cs_gm_ok=1; fi
      fi
      unset __cs_gm_src
    fi
    if [[ -n $__cs_gm_ok ]]; then
      if builtin typeset -f __cs_cc_grep >/dev/null 2>&1; then __cs_gm_cc=1; else __cs_gm_ok=; fi
    fi
  fi

  if [[ -n $__cs_gm_ok ]]; then
    if [[ -n ${ZSH_VERSION-} ]]; then __cs_gm_sub=${ZSH_SUBSHELL:-0}; else __cs_gm_sub=${BASH_SUBSHELL:-0}; fi

    # The output identity: a duplicate of fd 1, taken only while fd 1 and fd 2 are the
    # same regular file. Nothing is ever written to it, and an open descriptor is never
    # redirected: bash before 4.1 probes 9 down to 3 and takes the first closed one.
    __cs_gm_fd=
    if [[ -f /dev/fd/1 && /dev/fd/1 -ef /dev/fd/2 ]]; then
      if [[ -n ${ZSH_VERSION-} || ${BASH_VERSINFO[0]-0} -gt 4 ]] \
        || [[ ${BASH_VERSINFO[0]-0} -eq 4 && ${BASH_VERSINFO[1]-0} -ge 1 ]]; then
        # Unset first: under NOCLOBBER zsh refuses `{var}>` while var holds any value,
        # even an empty one ("can't clobber parameter ... containing file descriptor 0").
        unset __cs_gm_fd
        if builtin eval 'exec {__cs_gm_fd}>&1'; then :; else __cs_gm_fd=; fi
        __cs_gm_fd=${__cs_gm_fd-}
      else
        __cs_gm_t=
        for __cs_gm_n in 9 8 7 6 5 4 3; do
          if [[ -z $__cs_gm_t ]]; then
            if { : >&$__cs_gm_n; } 2>/dev/null; then
              :
            else
              __cs_gm_t=1
              if builtin eval "exec $__cs_gm_n>&1"; then
                if [[ /dev/fd/$__cs_gm_n -ef /dev/fd/1 ]]; then __cs_gm_fd=$__cs_gm_n; fi
              fi
            fi
          fi
        done
        unset __cs_gm_t __cs_gm_n
      fi
    fi

    # ------------------------------------------------------------------ the wrapper
    #
    # `grep` never calls emulate and never captures the status of a pass-through: the
    # delegate is its last command. __cs_gm_start (eligibility, request, curl) and
    # __cs_gm_finish (wait, frame, cleanup, log) are private, emulate in zsh, and run
    # wholly before or after the delegate; their stderr is discarded at the call site.
    # The merge path is reached only with errexit off, so its status capture changes
    # nothing the caller set up. It captures with `||` (review round 5, measured): a
    # failing delegate as a plain statement ran a zsh ZERR trap (and a bash ERR trap under
    # `set -E`) once inside the wrapper and again for the wrapper's own return.

    function grep {
      local __cs_gm_rc=0 __cs_gm_dir= __cs_gm_sock= __cs_gm_req= __cs_gm_out= __cs_gm_pid= __cs_gm_mode=
      if __cs_gm_start "$@" 2>/dev/null; then
        if [[ -n ${__cs_gm_cc-} ]]; then
          __cs_cc_grep "$@" || __cs_gm_rc=$?
        else
          command grep "$@" || __cs_gm_rc=$?
        fi
        __cs_gm_finish 2>/dev/null
        return "$__cs_gm_rc"
      fi
      if [[ -n ${__cs_gm_cc-} ]]; then __cs_cc_grep "$@"; else command grep "$@"; fi
    }

    # Eligibility (D3, plus errexit and PWD from review round 1), in order; the first test
    # that fails names the pass reason, logged here, before the delegate runs. When every
    # test holds: write the request, start curl, and answer 0.
    function __cs_gm_start {
      local __cs_gm_why= __cs_gm_ee= __cs_gm_jc= __cs_gm_now=0 __cs_gm_bg=0
      # The caller's errexit is read BEFORE emulate, which resets it. So is `$!`: a merge
      # starts curl with `&`, which would overwrite the pid of a job the caller started
      # earlier in this call, and a later `kill $!` or `wait $!` would miss it (review
      # round 2). zsh's `$!` is 0 until a job starts; bash's is unset.
      # Job control too (review round 4): with it on, the shell can report the background
      # curl's completion (`[1]+ Done …`) on the caller's stderr.
      if [[ -n ${ZSH_VERSION-} ]]; then
        if [[ -o errexit || -o errreturn ]]; then __cs_gm_ee=1; fi
        if [[ -o monitor ]]; then __cs_gm_jc=1; fi
        __cs_gm_bg=${!-0}
        builtin emulate -L zsh
        __cs_gm_now=${ZSH_SUBSHELL:-0}
      else
        if [[ $- == *e* ]]; then __cs_gm_ee=1; fi
        if [[ $- == *m* ]]; then __cs_gm_jc=1; fi
        # bash 3.2 reports `$!` unbound under set -u even with a default (measured), so
        # nounset is off for this one read.
        if [[ $- == *u* ]]; then
          builtin shopt -u -o nounset; __cs_gm_bg=${!-0}; builtin shopt -s -o nounset
        else
          __cs_gm_bg=${!-0}
        fi
        __cs_gm_now=${BASH_SUBSHELL:-0}
      fi

      if [[ ${CODE_SEARCH_MERGE-} == 0 ]]; then __cs_gm_why=off
      elif [[ $- == *x* ]]; then __cs_gm_why=xtrace
      elif [[ -n $__cs_gm_ee ]]; then __cs_gm_why=errexit
      elif [[ $__cs_gm_bg != 0 && $__cs_gm_bg != "${__cs_gm_cpid-}" ]]; then __cs_gm_why=bgjob
      elif [[ -n $__cs_gm_jc ]]; then __cs_gm_why=jobctl
      elif [[ $__cs_gm_now != "${__cs_gm_sub-}" ]]; then __cs_gm_why=subshell
      elif [[ -z ${__cs_gm_fd-} ]]; then __cs_gm_why=nofd
      elif [[ -n ${__cs_gm_slow-} ]]; then __cs_gm_why=slow
      # A system grep (the delegate when Claude Code defined none) reads GREP_OPTIONS,
      # which the server never sees, so its rebuild of grep's matches could be wrong.
      elif [[ -n ${GREP_OPTIONS-} ]]; then __cs_gm_why=grepopts
      elif ! __cs_gm_classify "$@"; then __cs_gm_why=argv
      elif ! __cs_gm_sockok; then __cs_gm_why=nosock
      elif ! command -v curl >/dev/null 2>&1; then __cs_gm_why=nocurl
      elif [[ -f /dev/fd/1 && /dev/fd/1 -ef /dev/fd/$__cs_gm_fd ]]; then
        if [[ -z ${PWD-} ]]; then __cs_gm_why=nopwd; fi
      else __cs_gm_why=notfinal
      fi
      if [[ -n $__cs_gm_why ]]; then
        __cs_gm_log "pass:$__cs_gm_why"
        return 1
      fi

      # The request file is written by builtins, silently: a file that cannot be created
      # (read-only dir, full disk, the Bash sandbox) is grep alone. The name takes a
      # per-shell counter, never $RANDOM: reading $RANDOM advances a sequence the caller
      # may have seeded (review round 2).
      __cs_gm_seq=$(( ${__cs_gm_seq:-0} + 1 ))
      __cs_gm_req=$__cs_gm_dir/$PPID.$$.$__cs_gm_seq.req
      __cs_gm_out=${__cs_gm_req%.req}.out
      if ! { { builtin printf 'CSM1\0G\0%s\0%s\0%s\0%s\0' "$PPID" "$$" "${PWD-}" "$#"
               builtin printf '%s\0' "$@"; } > "$__cs_gm_req"; } 2>/dev/null; then
        command rm -f "$__cs_gm_req" 2>/dev/null || :
        __cs_gm_log "pass:nofile"
        return 1
      fi

      # The reply file is emptied first, by a builtin: curl writes -o only when bytes
      # arrive, so a file a killed shell left under this name (same pid, same counter)
      # would otherwise be read as this call's reply (review round 3). An empty file is
      # an invalid frame. `>|` because a caller's noclobber would refuse `>` here.
      { : >| "$__cs_gm_out"; } 2>/dev/null || :

      # curl overlaps the delegate. -q first, so no ~/.curlrc is read; its own output
      # goes only to the -o file.
      command curl -q --silent --unix-socket "$__cs_gm_sock" --max-time 1.5 \
        --max-filesize 16448 -H 'Expect:' -H 'Content-Type: application/octet-stream' \
        --data-binary "@$__cs_gm_req" -o "$__cs_gm_out" http://localhost/merge \
        </dev/null >/dev/null 2>&1 &
      __cs_gm_pid=$!
      # Our own curl now owns `$!`. Remembered, so a later grep in the same call does not
      # mistake it for a job of the caller's and pass through as `bgjob`.
      __cs_gm_cpid=$__cs_gm_pid
      return 0
    }

    # After the delegate: wait for curl, print the block when grep's status is 0 or 1 and
    # the frame checks out, remove both temp files, log.
    function __cs_gm_finish {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      local __cs_gm_blk=0 __cs_gm_crc=0
      # Only curl's own pid: a bare wait would also wait for the user's background jobs.
      if builtin wait "$__cs_gm_pid" 2>/dev/null; then :; else __cs_gm_crc=$?; fi
      # curl's 28 is its --max-time: the server accepted and never answered. Remembered for
      # this shell, so a loop of greps pays that 1.5 s once, not on every call (`slow`).
      if [[ $__cs_gm_crc -eq 28 ]]; then __cs_gm_slow=1; fi
      if [[ $__cs_gm_rc -lt 2 ]]; then
        if __cs_gm_readframe "$__cs_gm_out"; then __cs_gm_blk=1; fi
      fi
      command rm -f "$__cs_gm_req" "$__cs_gm_out" 2>/dev/null || :
      __cs_gm_log "merge rc=$__cs_gm_rc block=$__cs_gm_blk"
    }

    # One line per call to $CODE_SEARCH_MERGE_LOG, when it is set. A log that cannot be
    # written costs the log line and nothing else.
    function __cs_gm_log {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      if [[ -n ${CODE_SEARCH_MERGE_LOG-} ]]; then
        { builtin printf '%s grep %s\n' "$$" "$1" >> "$CODE_SEARCH_MERGE_LOG"; } 2>/dev/null || :
      fi
    }

    # The socket (P4): under the first absolute $TMPDIR or $XDG_RUNTIME_DIR, one trailing
    # slash removed, whose socket path fits 100 bytes. The shared rule (`sessionSocket` in
    # mcp/grep/socket.ts) as far as builtins reach: the dir a real directory and the socket
    # a real socket, neither a symlink, both owned by this uid. Builtins cannot read the
    # dir's mode; the socket's owner check closes the same hole, since no other user can
    # create a socket owned by this uid. Sets the wrapper's __cs_gm_dir and __cs_gm_sock.
    function __cs_gm_sockok {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      local LC_ALL=C __cs_gm_x= __cs_gm_s=
      __cs_gm_dir=
      __cs_gm_sock=
      for __cs_gm_x in "${TMPDIR-}" "${XDG_RUNTIME_DIR-}"; do
        if [[ -z $__cs_gm_sock && $__cs_gm_x == /* ]]; then
          __cs_gm_x=${__cs_gm_x%/}
          __cs_gm_s=$__cs_gm_x/code-search-$UID/$PPID.sock
          if [[ ${#__cs_gm_s} -le 100 ]]; then
            __cs_gm_dir=$__cs_gm_x/code-search-$UID
            __cs_gm_sock=$__cs_gm_s
          fi
        fi
      done
      if [[ -n $__cs_gm_sock && -d $__cs_gm_dir && ! -L $__cs_gm_dir && -O $__cs_gm_dir ]] \
        && [[ -S $__cs_gm_sock && ! -L $__cs_gm_sock && -O $__cs_gm_sock ]]; then
        return 0
      fi
      return 1
    }

    # The server's frame, printed only when every check holds:
    #   CSM1 <n>\n then exactly n bytes, n from 1 to 16384 with no leading zero; the block's
    #   first line starts with the header prefix, its last line is the end marker, it has
    #   at least three lines, and the file ends in a newline.
    # Bytes are counted under the local LC_ALL=C, and the block is printed once, after all
    # checks, so an invalid frame prints nothing at all.
    function __cs_gm_readframe {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      local LC_ALL=C __cs_gm_l= __cs_gm_i=0 __cs_gm_n=0 __cs_gm_sum=0
      local __cs_gm_buf= __cs_gm_bad= __cs_gm_last= __cs_gm_nl=$'\n'
      if [[ -f $1 ]]; then :; else return 1; fi
      { while IFS= builtin read -r __cs_gm_l; do
          __cs_gm_i=$((__cs_gm_i + 1))
          if [[ $__cs_gm_i -eq 1 ]]; then
            case $__cs_gm_l in
              'CSM1 '[123456789]*)
                # n: 1 to 5 decimal digits, no leading zero (the pattern), at most 16384.
                __cs_gm_n=${__cs_gm_l#CSM1 }
                if [[ ${#__cs_gm_n} -gt 5 || $__cs_gm_n == *[!0123456789]* ]]; then
                  __cs_gm_n=0; __cs_gm_bad=1
                elif [[ $__cs_gm_n -gt 16384 ]]; then
                  __cs_gm_bad=1
                fi
                ;;
              *) __cs_gm_bad=1 ;;
            esac
          elif [[ -z $__cs_gm_bad ]]; then
            if [[ $__cs_gm_i -eq 2 && $__cs_gm_l != '--- code-search: '* ]]; then __cs_gm_bad=1; fi
            __cs_gm_sum=$((__cs_gm_sum + ${#__cs_gm_l} + 1))
            if [[ $__cs_gm_sum -gt $__cs_gm_n ]]; then __cs_gm_bad=1; fi
            __cs_gm_buf=$__cs_gm_buf$__cs_gm_l$__cs_gm_nl
            __cs_gm_last=$__cs_gm_l
          fi
        done < "$1"; } 2>/dev/null
      if [[ -n $__cs_gm_l || -n $__cs_gm_bad || $__cs_gm_i -lt 4 ]]; then return 1; fi
      if [[ $__cs_gm_sum -ne $__cs_gm_n || $__cs_gm_last != '--- end code-search ---' ]]; then return 1; fi
      builtin printf '%s' "$__cs_gm_buf"
      return 0
    }

    # ------------------------------------------------------------------ the classifier
    #
    # __cs_gm_classify ARGV... answers 0 when the server's parser (mcp/grep/bash-grep.ts,
    # parseBashGrep) would accept the argv, and sets __cs_gm_mode to `content` or `files`;
    # it answers 1 when the parser would decline. The two are kept in agreement by a drift
    # test over a shared table (mcp/grep/__testdata__/bash-grep-cases.json) and a generated
    # product of it. The parser decides; this only saves a fork on calls it would decline.
    #
    # The accepted forms (decision D6): short clusters of r R n l i w H s I F, optionally
    # ending in A, B or C with a count of 1 to 3 digits attached or as the next argument;
    # the long options listed below, values only after `=`; options after operands; `--`
    # ends options. The first operand is the pattern and must be word-like; then 0 to 16
    # paths, none empty, none `-`, none with a `..` segment. Recursion is required.

    function __cs_gm_classify {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      local __cs_gm_ncm= __cs_gm_cr=1
      __cs_gm_mode=
      # bash's nocasematch would let `-rL` match the `l` case, and `-rL` lists the files
      # WITHOUT a match. Matching here is always case-sensitive.
      if [[ -z ${ZSH_VERSION-} ]]; then
        if builtin shopt -q nocasematch 2>/dev/null; then __cs_gm_ncm=1; builtin shopt -u nocasematch; fi
      fi
      if __cs_gm_argv "$@"; then __cs_gm_cr=0; fi
      if [[ -n $__cs_gm_ncm ]]; then builtin shopt -s nocasematch; fi
      return "$__cs_gm_cr"
    }

    function __cs_gm_argv {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      local __cs_gm_a= __cs_gm_c= __cs_gm_r= __cs_gm_want= __cs_gm_end=
      local __cs_gm_rec= __cs_gm_fil= __cs_gm_np=0 __cs_gm_pat=
      for __cs_gm_a in "$@"; do
        if [[ -n $__cs_gm_want ]]; then
          # The value of a separated -A/-B/-C.
          if __cs_gm_count "$__cs_gm_a"; then __cs_gm_want=; else return 1; fi
        elif [[ -n $__cs_gm_end || $__cs_gm_a != -* || $__cs_gm_a == - ]]; then
          if [[ $__cs_gm_np -eq 0 ]]; then
            __cs_gm_pat=$__cs_gm_a
          elif [[ $__cs_gm_np -ge 17 ]]; then
            return 1
          elif [[ -z $__cs_gm_a || $__cs_gm_a == - ]]; then
            return 1
          else
            case /$__cs_gm_a/ in */../*) return 1 ;; esac
          fi
          __cs_gm_np=$((__cs_gm_np + 1))
        elif [[ $__cs_gm_a == -- ]]; then
          __cs_gm_end=1
        elif [[ $__cs_gm_a == --* ]]; then
          case $__cs_gm_a in
            --recursive|--dereference-recursive) __cs_gm_rec=1 ;;
            --files-with-matches) __cs_gm_fil=1 ;;
            --line-number|--ignore-case|--word-regexp|--with-filename|--no-messages|--fixed-strings|--color|--colour) ;;
            --color=auto|--color=never|--colour=auto|--colour=never) ;;
            --context=*|--after-context=*|--before-context=*)
              if __cs_gm_count "${__cs_gm_a#*=}"; then :; else return 1; fi
              ;;
            --include=*|--exclude=*|--exclude-dir=*)
              # The G rule (bash-grep.ts SIMPLE_GLOB): not empty, no leading `!`, none of
              # the five characters slash, comma, open brace, backslash, colon, and no
              # `**` (ugrep and the oracle read it differently, review round 4), and no
              # class opening with a literal `]`: `[]`, `[!]`, `[^]` (round 5, likewise).
              case ${__cs_gm_a#*=} in
                ''|'!'*|*[/,{\\:]*|*'**'*|*'[]'*|*'[!]'*|*'[^]'*) return 1 ;;
              esac
              ;;
            *) return 1 ;;
          esac
        else
          __cs_gm_r=${__cs_gm_a#-}
          while [[ -n $__cs_gm_r ]]; do
            __cs_gm_c=${__cs_gm_r%"${__cs_gm_r#?}"}
            __cs_gm_r=${__cs_gm_r#?}
            case $__cs_gm_c in
              r|R) __cs_gm_rec=1 ;;
              l) __cs_gm_fil=1 ;;
              n|i|w|H|s|I|F) ;;
              A|B|C)
                # The count ends the cluster: the rest of it, or the next argument.
                if [[ -n $__cs_gm_r ]]; then
                  if __cs_gm_count "$__cs_gm_r"; then __cs_gm_r=; else return 1; fi
                else
                  __cs_gm_want=1
                fi
                ;;
              *) return 1 ;;
            esac
          done
        fi
      done
      if [[ -n $__cs_gm_want || -z $__cs_gm_rec || $__cs_gm_np -eq 0 ]]; then return 1; fi
      if __cs_gm_wordlike "$__cs_gm_pat"; then :; else return 1; fi
      if [[ -n $__cs_gm_fil ]]; then __cs_gm_mode=files; else __cs_gm_mode=content; fi
      return 0
    }

    # A context count: 1 to 3 decimal digits.
    function __cs_gm_count {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      case $1 in
        [0123456789]|[0123456789][0123456789]|[0123456789][0123456789][0123456789]) return 0 ;;
      esac
      return 1
    }

    # Word-like (mcp/grep/pattern.ts, WORDLIKE_SOURCE): 3 to 100 characters; a letter or
    # `_`, then letters, digits and `_`, then at most three more words, each joined by one
    # space, `-` or `::`. Classes are spelled letter by letter: a range is locale-dependent.
    function __cs_gm_wordlike {
      if [[ -n ${ZSH_VERSION-} ]]; then builtin emulate -L zsh; fi
      local __cs_gm_q=$1 __cs_gm_s=
      if [[ ${#__cs_gm_q} -lt 3 || ${#__cs_gm_q} -gt 100 ]]; then return 1; fi
      case $__cs_gm_q in
        *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_:\ -]*) return 1 ;;
        [ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_]*) ;;
        *) return 1 ;;
      esac
      # `::` becomes `-`; a `:` left over was not part of a `::` separator.
      __cs_gm_q=${__cs_gm_q//::/-}
      case $__cs_gm_q in
        *:*|*[\ -][\ -]*|*[\ -]) return 1 ;;
      esac
      __cs_gm_s=${__cs_gm_q//[!\ -]/}
      if [[ ${#__cs_gm_s} -gt 3 ]]; then return 1; fi
      return 0
    }
  fi
  unset __cs_gm_ok
fi
:
