# Session Desk

Desktop app that groups Claude Code sessions with their Linear tickets and PRs, and runs the real `claude` CLI for each one in an embedded terminal.

## Run

```bash
npm install
npm run dev
```

If `npm run dev` fails with `Electron uninstall`, the Electron binary didn't download: run `node node_modules/electron/install.js`.

### Tests

```bash
npm test
```

About 150 tests in a few seconds, no network and no access to your real `~/.claude` or settings: the scanner reads fixture transcripts, the store and hook installer use temp folders, and the worktree tests build real git repos with a local bare remote. Covered: ticket linking and its rule order, board columns and Waiting Response, the Greptile parser, worktree verdicts and removal guards, the status hook's event mapping and silence, and the installer's idempotence and clean uninstall.

### Install as an app

```bash
npm run install-app
```

Builds `Session Desk.app` (Apple Silicon, ad-hoc signed; no developer certificate needed to run it on this Mac) and copies it to `~/Applications`, removing an older copy of yours from `/Applications` (another user's copy there is left alone). Quit the installed copy first; the script refuses to replace a running app. The menu bar's Session Desk menu has **Open at Login** (installed app only) and the notification settings.

**Signing.** `install-app` re-signs the build with a stable identity when the keychain has one: `SESSION_DESK_SIGNING_IDENTITY` if set, else any "Developer ID Application" identity, else a self-signed "Session Desk Local Signing" certificate. A stable identity keeps the app's designated requirement the same across builds, so macOS asks for Keychain access to the saved Linear key once, not after every rebuild. With none, the build stays ad-hoc signed and macOS re-asks each time (the app waits until you answer). The first signed build asks once to let `codesign` use the key.

Only one copy runs at a time: launching a second (say, the installed app while `npm run dev` is up) just focuses the first. Dev and the installed app share their state folder, `~/Library/Application Support/session-desk`. The exception is the Linear key, which macOS ties to the app's identity, so each copy asks for it once.

### Badge and notifications

The Dock badge counts open sessions waiting on you. When one starts waiting, a notification says why (finished its turn, needs an answer or permission, stopped with an error); clicking it opens that session. You're not notified about the session on screen in a focused window. By default you're also not notified for sessions open in Claude desktop or a terminal, which notify on their own; "Include Sessions Open in Other Apps" turns those on. macOS asks once whether Session Desk may send notifications.

### Settings (⌘,)

Per user, so each account on a Mac has its own:

- **Projects folder**: new sessions start here (so they keep its CLAUDE.md and auto-memory), and its repos, worktrees, context folder and `.session-desk.json` are read from here. The folder can hold several repos side by side, or be a single repo. Taken from `SESSION_DESK_CWD` when set; otherwise the app asks on first launch.
- **Claude Code folder**: where sessions, transcripts and memory notes live. Defaults to `$CLAUDE_CONFIG_DIR` from your login shell, else `~/.claude`. A non-default folder is passed to every `claude` the app starts (as `CLAUDE_CONFIG_DIR`), so sessions and the app agree.
- **Linear** connection.

Each user installs their own copy (`npm run install-app` → their `~/Applications`), so one account's install never replaces another's; app state, the Keychain-held Linear key and the status files are per user too.

## Project settings (`.session-desk.json`)

A project folder can hold a `.session-desk.json` with settings for that project. It can be committed, so teammates share it. Settings (⌘,) shows what was loaded, or why the file was rejected (the defaults then apply), and can create a starter file. Saving the file takes effect straight away. Switch projects with File → Switch Project (⇧⌘O) or File → Recent Projects.

Every key is optional:

```json
{
  "worktrees": "{repo}-wt/{ticket}",
  "contextFolder": "evidence",
  "environments": [
    { "id": "prod", "label": "prod" },
    { "id": "stag", "label": "staging" }
  ],
  "deploy": {
    "octo-org/backend": {
      "prod": { "pin": { "repo": "octo-org/gitops", "path": "clusters/prod/backend/kustomization.yaml", "image": "/octo-org/backend$" } },
      "stag": { "branch": "staging" }
    },
    "acme/web": { "prod": { "githubDeployment": "Production" }, "stag": { "untracked": "manual deploy" } },
    "acme/cli": { "prod": { "latestTag": "v*" } },
    "acme/mono": {
      "services": {
        "api": { "paths": ["services/api", "packages/shared/**"], "prod": { "workflowRun": { "workflow": "deploy-api.yml", "branch": "main" } } },
        "worker": { "paths": ["services/worker/**"], "prod": { "githubDeployment": "worker-production" } }
      }
    }
  }
}
```

`worktrees` is where a ticket's worktree goes, relative to the folder holding the repo (so beside it), with `{repo}` and `{ticket}` (lower-cased) filled in. `contextFolder` is the folder of per-ticket notes shown in the Ticket panel; `null` turns it off.

`deploy` maps each repo, by environment id, to how its current release is found:

| Source | Release | Fits |
|---|---|---|
| `pin` | The tag a GitOps file pins for an image (`images:` entry in a kustomization) | Argo CD / Flux syncing a deploy repo |
| `branch` | The commit the branch is at | Deploys from a branch, e.g. `production` |
| `githubDeployment` | The newest successful GitHub deployment to that environment | Vercel, GitHub Actions environments, anything reporting Deployments |
| `latestTag` | The newest tag matching a glob, by commit date | Release-on-tag |
| `workflowRun` | The commit of the newest successful run of a workflow (`{ "workflow": "deploy.yml", "branch": "main" }`) | GitHub Actions deploys without `environment:` (with it, `githubDeployment` is more exact) |
| `untracked` | Nothing; the reason is shown | Manual deploys with nothing reliable to read |

`environments` are listed nearest production first, and their labels are what the PR panels say: "✓ In prod", "On staging, not in prod yet", "Not deployed yet". Board cards flag only what isn't in production.

**Monorepos.** A repo whose parts deploy separately lists `services`, each with the `paths` it's built from (globs: `**` any depth, `*` and `?` within a folder; a plain path is a folder prefix) and its own environments. A merged PR counts only for the services its changed files touch, and shows each: "api: ✓ In prod · worker: Not deployed yet". A PR touching none (docs, say) shows nothing.

## How sessions are linked

Everything is read from `~/.claude/projects/*/*.jsonl`; nothing is written there.

- **Title**: `/rename` title, else the auto title, else the first prompt.
- **PRs**: the `pr-link` entries Claude Code records when a session opens a PR. State, title and head branch come from `gh` (your existing login).
- **Primary ticket**, first match wins:
  1. A link set by hand (Ticket panel → Change), or made by starting a session from a board card.
  2. A ticket ID (`ENG-123`) named in the session's title.
  3. The ticket the session's PR branches agree on (the only one, or twice as common as the next).
  4. Transcript inference: branches the session switched to, worktree paths it worked in (`api-wt/eng-123`), the branch checked out at start, the first prompt.

Sessions run by the SDK (`entrypoint: sdk-cli`) are hidden.

Ticket IDs are recognised by the connected Linear workspace's team keys (all teams the account can see, e.g. `ENG`, `OPS`), saved per project for offline use; until a project connects Linear, nothing is treated as a ticket. Ticket links use the workspace's own URL key, and stay plain text until it's known.

## Workflow board

Connect Linear from the sidebar footer with a personal API key. Each project folder has its own connection, so projects in different Linear workspaces each show their own board, ticket prefixes and links; switching project switches them (a project not yet connected shows the Connect button). Keys are kept by the app, never in `.session-desk.json`, encrypted with Electron `safeStorage` (a Keychain-held key) and only sent to api.linear.app. A connection made before this was per project belongs to the project folder that was open when the app was updated.

The board shows your issues in the active cycle, excluding canceled and duplicate ones. If none of your teams has an active cycle (you don't use cycles, or are between them), it shows the issues assigned to you instead: everything open, backlog and triage included, plus what you finished in the last 14 days (up to 500, most recently updated kept). One team with an active cycle is enough to keep the board to the cycle. The automatic moves below act on whatever the board holds, so without cycles they can move any ticket assigned to you, not only this cycle's. Columns map from Linear states: unstarted/backlog/triage → To Do, started → In Progress (or In Review when the state's name says review), completed → Done. Dragging a card sets the matching Linear state.

Waiting Response is local to this app; Linear keeps the issue In Progress. A ticket that is In Progress in Linear shows there while any of its sessions is waiting on you (turn finished, permission prompt, AskUserQuestion), and returns to In Progress when you answer. Dragging a card there by hand holds it until one of its sessions next starts working. Tickets in other Linear states stay where Linear has them.

### Moving a card into In Progress

Dragging a card into In Progress here (never a move made in Linear, by you, a teammate or Linear's own automation) also starts or picks up the ticket's work, once Linear has accepted the move:

| The ticket's own session | What happens |
|---|---|
| None yet | A new session named `ENG-123 title` starts in the background, in Claude Code's plan mode, briefed on the ticket and asked to plan it from the description |
| Has talked but never planned or edited | It's resumed in plan mode and asked to plan, building on what was discussed |
| Showed a plan that was never approved | It's resumed in plan mode and asked to present the plan again |
| Has an approved plan, edits or a PR | It's resumed and asked to continue where it left off |
| Open here and idle at its prompt | The same turn is typed into it |
| Open here and working, or showing a question or permission prompt | Left alone: typing would answer the dialog |
| Open in another app | Left alone, with a note to continue it there |

Plan mode can read but not edit until you approve. When the plan is ready, or Claude asks something, the card moves to Waiting Response; once you answer it moves back to In Progress. Only the ticket's own sessions count, not one that merely opened its PR.

One gap the hooks can't see: dismissing a question or permission prompt with Esc ends the turn without running any hook. The app reads that from the transcript instead (a turn that ended after the hook's last waiting event means idle at the prompt).

### Status hook

Activity comes from a user-level Claude Code hook, so it covers sessions in the CLI and in the Claude desktop app, not just ones run here.

Install it from **Settings → Waiting status hook → Install…**, which shows the exact `settings.json` change first and backs the file up. Each user on a Mac installs it for themselves, into their own Claude Code folder's `settings.json`. The Workflow view says so when it's missing. From a terminal instead:

```bash
npm run hooks -- --dry-run    # show the settings.json diff
npm run hooks                 # install (backs settings.json up first)
npm run hooks -- --uninstall  # remove only our entries
```

The app and the script share the same rules (`src/main/hookSettings.ts`), and the app ships its own copy of the hook script.

`hooks/status-hook.sh` (copied to `~/.session-desk/hook.sh`; Settings shows *outdated* when that copy differs from the app's) writes `~/.session-desk/status/<session-id>` with `working` or `waiting`. It prints nothing and always exits 0. It runs synchronously, because async hooks can finish out of order. Event mapping, measured on Claude Code 2.1.29x:

| State | Events |
|---|---|
| working | `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure` |
| waiting | `PermissionRequest` (permission prompts and AskUserQuestion, immediately), `Stop`, `StopFailure`, `Notification` |
| cleared | `SessionEnd` |

A killed process sends no `SessionEnd`, so a status only counts while a process has the session open (here, or per `~/.claude/sessions/`).

Clicking a card opens its most recent linked session, or starts a new one named `ENG-123 <title>` and linked to the ticket.

## Worktrees for ticket sessions

A session started from a card is briefed through `--append-system-prompt` (`src/main/ticketBrief.ts`) with the ticket's title, link and description. The brief tells Claude to work out which repos the change belongs in, then for each one create or reuse a worktree at the project's `worktrees` layout (default `<repo>-wt/<ticket>`, beside each repo) on Linear's suggested branch (e.g. `me/eng-123`), cut from a freshly fetched default branch. When the project folder is itself a single repo, there's no choosing: its worktree goes beside it (`api-wt/eng-123` next to `api`). Every edit, build and test happens there; main checkouts are left alone. Nothing is created until Claude starts on the work, and repos it only reads get no worktree.

The brief applies only to new sessions started from the board; resuming a session doesn't repeat it. Without Linear it still gets the ticket id.

### Automatic moves (opt-in)

Session Desk menu → **Linear Automation**. Off by default, because they change tickets on the team's board:

- **To Do → In Progress when a session starts working** on the ticket.
- **In Progress → In Review when a PR opens** (a PR becomes reviewable). Disabled when the team already has Linear's own GitHub rule for this (`review → In Review`); then only the first rule is available.

Moves go forward only, never touch In Review, Done or Canceled tickets, happen at most once per ticket per rule (a ticket you move back stays where you put it), and only react to sessions or PRs that started after the rule was turned on. Each move posts a notification. The Workflow top bar shows which rules are on and what Linear does by itself.

App state (links, Waiting overlay, encrypted key) is in `~/Library/Application Support/session-desk/session-desk.json`.

## Sidebar

Each session row has a `…` menu on hover (or right-click): Rename, Move to group, Archive, Delete. The title-bar menu has the same items plus Stop, Open in Terminal, copy commands and Show transcript.

- **Rename** goes through Claude Code, so the name shows everywhere `claude --resume` and the desktop app list sessions. A session running here gets `/rename <name>` typed into its prompt for you to send; one that isn't running is renamed with a brief headless `claude --resume <id> --name <name>`, which records the title without sending a turn.
- **Layout** follows the desktop app: Pinned, then custom groups, then one section per project folder (the session's starting directory, most recent first), then Archived. A folder header's `+` starts a new session in that folder.
- **Pin** puts a session in Pinned; it keeps its group and returns there when unpinned. Drop a row on Pinned to pin it, or on a folder header to take it out of its group and pins.
- **Groups** are sidebar sections like the desktop app's custom groups. Create one from the folder icon in the toolbar or from Move to group → New group, then drag sessions onto a group header or use the menu. Deleting a group returns its sessions to their folders. Pins, groups and archive state are app-side only.
- **Delete** moves the transcript, its sibling folder, `file-history/<id>` and `session-env/<id>` to the macOS Trash. It is refused while the session is open here or in another app.

## Jump to anything (⌘K)

⌘K (or the sidebar's search icon) opens a palette over everything: views, sessions (by title, ticket or folder), sprint tickets (opens the ticket's session or starts one), and **conversations**: every word you type must appear in one of your prompts or Claude's replies, in any session. ⌘1–9 open pinned sessions in sidebar order.

Conversation search covers prompts and replies only, not tool output: about 7 MB of text across ~100 transcripts (≈300 MB on disk). The index builds on first search (~1 s) and then updates per changed transcript; each search takes a few milliseconds, so results update as you type.

## Artifacts

The Artifacts view lists every claude.ai artifact a session published (the `Artifact` tool, or a connector such as Claude Docs creating one) or opened, newest first and merged by link: title (the published file's name or the doc's name), the one-line description from the latest publish, the tickets it relates to (named in it, or its sessions' tickets), the sessions it came from (click to open), and **Open ↗**. Links only *mentioned* in tool output (a grep, say) don't count. Each artifact's menu can **remove it from the list** (restore from "Show removed") or **delete it on claude.ai**: the app can't delete artifacts itself, so that opens it on claude.ai to delete there, and removes it from the list. Built from transcripts on first view (~1 s), then cached per transcript.

## Ticket context

Under the ticket, the session view lists what else exists about it:

- **Evidence**: folders in the project's context folder (`contextFolder`, `evidence/` by default) named for the ticket (any case: `ENG-123`, `eng-456`) or for one of the session's PRs (`PR-9107`), with file count and last change. Click to open in Finder.
- **Memory notes**: Claude Code memory notes (`~/.claude/projects/*/memory/*.md`) that mention the ticket. Notes named for it come first, then by number of mentions, with each note's one-line description. Click to open in your default editor. The `MEMORY.md` index and temp-folder projects are skipped.

Only those two kinds of path can be opened from here: folders inside the context folder, and `.md` files inside a memory folder (symlinks are judged by their target), so a click can never launch a program.

## PR status

Open PRs show checks, review decision, unresolved review threads and Greptile's standing, in the session's PR panel and (only what needs attention) on board cards. Where Greptile's automatic reviews are off, it reviews only when asked, and its summary goes stale as commits land:

| Greptile | Meaning |
|---|---|
| up to date | its summary's *Last reviewed commit* is the PR head |
| N commits behind / reviewed an older version | commits landed since; "older version" when the branch was rebased and the reviewed commit is gone |
| review requested | an `@greptileai review` comment is newer than its last summary |
| not reviewed | no summary; a `<!-- greptile-status -->` notice alone is not a review |

**Unpushed commits.** Each open PR is compared with the local worktree (or main checkout) on its branch. Local commits the PR on GitHub doesn't have show as "N local commits not pushed" (and "N unpushed" on board cards); commits on GitHub missing locally show quietly as "N newer on GitHub". If the PR's head was never fetched here, it says "Local branch differs from the PR" instead of guessing. Comparisons are cached by commit pair and re-run at most every 15 seconds.

**Merged vs. deployed.** For PRs merged in the last 30 days, the panel says where they are live: "In prod", "On staging, not in prod yet", or "Not deployed yet" (board cards show only "Not in prod"). What each environment runs comes from the project's `.session-desk.json` (`deploy`, see [Project settings](#project-settings-session-deskjson)); a PR is live there when that release contains its merge commit (GitHub's compare API; nothing is fetched locally). Repos the file doesn't list show nothing. Releases are re-read every 5 minutes; a "live" answer is final.

Greptile shows only on PRs where it has posted something (a review, or a "reviews are disabled" notice), i.e. repos it's installed on; elsewhere the PR line says nothing about it. **Ask Greptile to review** posts exactly `@greptileai review` as you, after a confirmation, and only on open PRs. Statuses refresh every 5 minutes, and immediately after asking.

## Worktrees

The Worktrees view lists every extra worktree of every repo directly under the workspace, in all layouts (`<repo>-wt-NNNN`, `<repo>-wt/eng-123`, `.claude/worktrees/…`). For each it shows the branch, ticket, PR, and what removing it would lose:

| Verdict | Meaning | Action |
|---|---|---|
| Safe | PR merged or closed (or no commits of its own, if older than 14 days), nothing uncommitted or unpushed, nothing running in it | Remove, also in bulk |
| Active | Everything pushed, but the PR is open, the branch is pushed without a PR, or it's new | Remove one at a time |
| Has work | Uncommitted changes, unpushed commits, unverifiable, or a process has its working directory inside | none |
| Missing | Folder gone; git still lists it | Clear stale entries (`git worktree prune`) |

Because PRs are squash-merged, "pushed" means no local commits beyond the PR's last head commit (or the remote branch, or the default branch if never pushed). Removal re-checks the worktree first, then runs `git worktree remove` without `--force`. Git itself refuses anything with changes. Branches are kept. The confirmation names any ignored files that aren't build output (`.env`, local settings), since removing the folder deletes them. A full check of ~60 worktrees takes about 20 seconds.

## Concurrency

Each session is its own `claude` process. Switching sessions hides a terminal; it never restarts it. A session already open in another process (the CLI or the desktop app, per `~/.claude/sessions/`) is not resumed automatically, because two processes writing one transcript corrupt it.

Spawned processes get a clean environment: `CLAUDE*`, `ANTHROPIC_*` and `MCP_*` variables are stripped, then an interactive login shell re-applies your own rc files. Without this, launching the app from inside a Claude session silently disables transcript saving in every child.
