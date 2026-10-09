#!/bin/sh
# Session Desk status hook. Records whether a Claude Code session is working or
# waiting on you, as one small JSON file per session in ~/.session-desk/status.
#
# Installed as a user-level Claude Code hook, so it runs for every session (CLI
# and the desktop app). It must stay invisible to Claude: it prints nothing and
# always exits 0. Stdout from some hooks (UserPromptSubmit) becomes context.
#
# Event -> state, measured on Claude Code 2.1.29x:
#   working: UserPromptSubmit, PostToolUse, PostToolUseFailure
#   waiting: PermissionRequest (permission prompts and AskUserQuestion; fires
#            immediately, the permission_prompt Notification ~6s later),
#            Stop, StopFailure, Notification
#   cleared: SessionEnd (not sent when the process is killed, so the app only
#            trusts a status while a process has the session open)

dir="$HOME/.session-desk/status"
input=$(cat)

# Values read here are plain identifiers. A string field holding the same text
# (a prompt, say) has its quotes escaped and cannot match "key":"value".
field() { printf '%s' "$input" | sed -n "s/.*\"$1\" *: *\"\([^\"]*\)\".*/\1/p" | head -n 1; }

sid=$(field session_id)
case "$sid" in '' | *[!0-9a-f-]*) exit 0 ;; esac

event=$(field hook_event_name)
case "$event" in
  UserPromptSubmit | PostToolUse | PostToolUseFailure) state=working ;;
  PermissionRequest | Stop | StopFailure | Notification) state=waiting ;;
  SessionEnd)
    rm -f "${dir:?}/${sid:?}" 2>/dev/null
    exit 0
    ;;
  *) exit 0 ;;
esac

# Skip the write when nothing changed (PostToolUse fires on every tool call).
# The event is kept current too: after a dismissed question or permission
# prompt, Stop replaces PermissionRequest, which is how the app tells an idle
# prompt from an open dialog. A Notification while already waiting only
# repeats why (idle_prompt follows Stop, permission_prompt follows
# PermissionRequest), so the cause recorded first stays.
if [ "$event" = Notification ]; then
  grep -q '"state":"waiting"' "$dir/$sid" 2>/dev/null && exit 0
else
  grep -q "\"state\":\"$state\",\"event\":\"$event\"" "$dir/$sid" 2>/dev/null && exit 0
fi

mkdir -p "$dir" 2>/dev/null || exit 0
tmp="$dir/.$sid.$$"
printf '{"state":"%s","event":"%s","at":%s}\n' "$state" "$event" "$(date +%s)" >"$tmp" 2>/dev/null &&
  mv -f "$tmp" "$dir/$sid" 2>/dev/null
exit 0
