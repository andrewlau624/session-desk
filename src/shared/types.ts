export interface PrLink {
  repo: string
  number: number
  url: string
  /** Filled in from GitHub once fetched; absent until then or if `gh` is unavailable. */
  info?: PrInfo
  /** The local checkout of an open PR's branch, compared with the PR on GitHub. */
  local?: LocalSync
  /** Where a recently merged PR is live. */
  deploy?: DeployInfo
}

export interface LocalSync {
  /** Worktree (or main checkout) on the PR's branch, relative to the workspace. */
  worktree: string
  /** Local commits not on the PR: work that was never pushed. Null when the PR head isn't fetched locally. */
  ahead: number | null
  /** PR commits not in the worktree. Null as above. */
  behind: number | null
}

export interface PrInfo {
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  draft: boolean
  headRef: string
  /** Ticket IDs its branch, title or description names (upper-case). */
  mentions?: string[]
  /** Checks, reviews and Greptile; fetched for open PRs only. */
  status?: PrStatus
  /** Merged PRs: the commit that landed on the base branch, and when. */
  mergeOid?: string
  mergedAt?: string
}

/**
 * Whether a merged PR is live in an environment. live/pending: the release tag
 * the environment pins does / doesn't contain the merge commit. untracked:
 * nothing reliable to read (a manual deploy, say).
 */
export type DeployState =
  | { state: 'live' | 'pending'; tag: string }
  | { state: 'untracked'; why?: string }
  | { state: 'unknown'; tag?: string }

export interface PrStatus {
  headOid: string
  /** When it became reviewable: opened as ready, or marked ready after starting as a draft. */
  readyAt: string
  checks: 'passing' | 'failing' | 'running' | 'none'
  review: 'approved' | 'changes_requested' | 'review_required' | null
  /** Review threads not marked resolved (an unanswered one reads as open in GitHub). */
  unresolvedThreads: number
  greptile: GreptileStatus
}

/**
 * Greptile's auto-review is off on these repos, so it reviews only when asked
 * (`@greptileai review`), and its summary goes stale as commits land.
 * none: Greptile is on the repo (it has posted, e.g. a status notice) but
 * hasn't reviewed. requested: asked after its last summary.
 * current: last reviewed commit is the PR head. behind: commits since.
 */
export type GreptileStatus =
  /** Greptile has never posted on the PR: it isn't on this repo, so say nothing. */
  | { state: 'absent' }
  | { state: 'none' }
  | { state: 'requested'; at: string }
  | { state: 'current'; confidence: number | null }
  | { state: 'behind'; behindBy: number | null; confidence: number | null }

export interface SessionSummary {
  id: string
  /** The session's .jsonl under ~/.claude/projects. */
  transcriptPath: string
  /** Directory the session was started in; `claude --resume` must run from here. */
  startCwd: string
  title: string
  /** Where the title came from, so the UI can show auto-titles more quietly. */
  titleSource: 'custom' | 'ai' | 'prompt' | 'id'
  /** Ticket identifiers (e.g. ENG-123), strongest link first. */
  tickets: string[]
  /** How tickets[0] was decided: set by hand, from a PR's branch, or inferred from the transcript. */
  ticketSource: 'manual' | 'pr' | 'transcript' | null
  prs: PrLink[]
  entrypoint: string
  lastActivity: number
  /** Set when another Claude process (CLI or desktop app) currently has this session open. */
  liveElsewhere: { pid: number; entrypoint: string } | null
  /** Hidden from the main list (app-side only; Claude Code is unaware). */
  archived: boolean
  /** The sidebar group the session is filed under, or null for its project folder. */
  groupId: string | null
  /** Shown in the Pinned section. Pinning keeps the group, as in the desktop app. */
  pinned: boolean
  /**
   * What Claude is doing, from the Claude Code hooks: working on a turn, or
   * waiting for you (turn finished, question asked, permission needed). Null
   * when no process has the session open or the hooks aren't installed.
   */
  activity: { state: 'working' | 'waiting'; at: number; event: string } | null
  /**
   * Plan mode in this session: never used, a plan shown but not approved
   * (rejected, or the session ended at the prompt), or a plan approved.
   */
  plan: 'none' | 'proposed' | 'approved'
  /** It has edited files or opened a PR: the work has started. */
  worked: boolean
  /** When its last turn ended (ms), from the transcript; 0 if none recorded. */
  turnEndedAt: number
}

/** A user-made sidebar section, like a custom group in the Claude desktop app. */
export interface SessionGroup {
  id: string
  name: string
  collapsed: boolean
}

/**
 * How a rename was applied. `applied`: Claude Code recorded the new title.
 * `prefilled`: the session is running here, so `/rename …` was typed into its
 * prompt for you to send with Enter.
 */
export type RenameResult = 'applied' | 'prefilled'

export interface PtyStartRequest {
  /** Terminal key: an existing session id to resume, or a fresh uuid for a new session. */
  sessionId: string
  resume: boolean
  cwd: string
  cols: number
  rows: number
  /** Display name for a new session (`claude --name`). */
  name?: string
  /** Ticket a new session was started for; the main process briefs Claude on it. */
  ticket?: string
  /** Start (or resume) the ticket's session with this opening turn; needs `ticket`. */
  kickoff?: Kickoff
  /** For an open-pr kickoff. */
  prBranch?: PrBranch
}

/**
 * The opening turn when a card moves into In Progress. plan: a first plan.
 * replan: plan in a session that already talked but never planned or edited.
 * represent: show an unapproved plan again. continue: pick the work back up.
 * open-pr: open a PR for a branch, written as Claude normally writes them.
 * The plan kinds run in Claude Code's plan mode, which can't edit until you approve.
 */
export type Kickoff = 'plan' | 'replan' | 'represent' | 'continue' | 'open-pr'

/** The branch an open-pr turn is about. */
export type PrBranch = Pick<TicketBranch, 'repo' | 'branch' | 'label'>

/**
 * safe: nothing would be lost (PR merged or closed, or no commits of its own).
 * active: everything is pushed, but it's still in use upstream (open PR, or a pushed branch without one).
 * blocked: removing it would lose work, or something is running in it.
 * missing: the folder is gone; git just still lists it.
 */
export type WorktreeVerdict = 'safe' | 'active' | 'blocked' | 'missing'

/** A checkout whose branch (or worktree folder) names the ticket: where its work is happening. */
export interface TicketBranch {
  /** Repo folder name under the workspace, e.g. api. */
  repo: string
  branch: string
  /** The checkout, relative to the workspace when inside it. */
  label: string
  /** owner/name on GitHub, when origin is there. */
  slug: string | null
  /** The repo's default branch, e.g. main. */
  defaultBranch: string
  /** origin has the branch. */
  pushed: boolean
  /** Local commits origin doesn't have yet (all of `ahead` when never pushed); null if it couldn't be told. */
  unpushed: number | null
  /** Commits on the branch that the default branch doesn't have. */
  ahead: number | null
  /** Uncommitted and untracked entries. */
  changes: number
}

export interface WorktreeInfo {
  /** Repo folder name under the workspace, e.g. api. */
  repo: string
  repoPath: string
  path: string
  /** Path relative to the workspace when inside it. */
  label: string
  branch: string | null
  ticket: string | null
  missing: boolean
  locked: boolean
  /** Command name of a process whose working directory is inside it. */
  inUseBy: string | null
  /** Uncommitted and untracked (not ignored) entries. */
  changes: number
  /** Ignored files that aren't regenerable build output (.env, local settings); removal deletes them. */
  notableIgnored: string[]
  /** Local commits not in the PR / remote branch / default branch; null when it couldn't be told. */
  unpushed: number | null
  /** What `unpushed` was counted against. */
  pushState: 'pr' | 'branch' | 'never'
  pr: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; draft: boolean; url: string } | null
  lastCommitAt: number
  /** When the worktree was added (its .git file's birth time). */
  createdAt: number
  verdict: WorktreeVerdict
  reason: string
}

/** What else exists about a ticket: its evidence folders and Claude Code memory notes. */
export interface TicketContext {
  /** evidence/<TICKET> (any case) and evidence/PR-<n> for the session's PRs. */
  evidence: { path: string; label: string; files: number; modifiedAt: number }[]
  /** Memory notes mentioning the ticket, ones named for it first. */
  notes: { path: string; name: string; description: string; project: string; mentions: number }[]
}

/** A session whose conversation matched a transcript search. */
export interface SearchHit {
  sessionId: string
  /** Messages containing every query word. */
  matches: number
  lastMatchAt: number
  /** Up to three matching excerpts, newest first. */
  snippets: { role: 'you' | 'claude'; text: string; at: number }[]
}

/** A claude.ai artifact a session published or opened. */
export interface ArtifactRecord {
  url: string
  title: string
  /** The one-line description given when it was (last) published. */
  description: string
  /** False when sessions only opened it. */
  published: boolean
  firstAt: number
  lastAt: number
  sessions: { id: string; kind: 'publish' | 'open' }[]
  /** Tickets named in it, then its sessions' tickets. */
  tickets: string[]
  /** Removed from the list by the user; still on claude.ai. */
  hidden: boolean
}

/**
 * Per-project settings from `.session-desk.json` in the project folder, so
 * the file can be committed and shared. Everything is optional.
 */
export interface ProjectConfig {
  /** Where a ticket's worktree goes, relative to the project folder. Default `{repo}-wt/{ticket}`. */
  worktrees: string
  /** Folder of per-ticket notes and evidence (`<folder>/<TICKET>`); null for none. Default `evidence`. */
  contextFolder: string | null
  /** Deploy environments in order, the first being production. Default: prod and staging. */
  environments: { id: string; label: string }[]
  /** owner/repo -> its services and how to find what each environment runs. */
  deploy: Record<string, { services: DeployService[] }>
}

/**
 * Something deployed on its own. A repo that ships as one is a single service
 * with no name and no paths; a monorepo lists its services, each with the
 * paths it's built from, so a PR counts only for the services it touched.
 */
export interface DeployService {
  name: string | null
  /** Globs (`**`, `*`, `?`); a pattern without any is a folder prefix. Null: the whole repo. */
  paths: string[] | null
  /** Environment id -> how to find what it runs. */
  envs: Record<string, DeploySource>
}

/**
 * Where a merged PR is live, per service it touched: every environment in the
 * project's order, the first being production. Empty when nothing is tracked.
 */
export type DeployInfo = { service: string | null; envs: { id: string; label: string; state: DeployState }[] }[]

/**
 * How to find what an environment runs. pin: a GitOps file pins a release tag
 * (an image entry in a kustomization); branch: it deploys a branch; githubDeployment:
 * GitHub's Deployments API for that environment; latestTag: the newest tag matching a pattern;
 * workflowRun: the newest successful run of a GitHub Actions workflow (optionally on a branch);
 * untracked: nothing reliable to read (the reason is shown, e.g. "deployed by hand").
 */
export type DeploySource =
  | { pin: { repo: string; path: string; image: string } }
  | { branch: string }
  | { githubDeployment: string }
  | { latestTag: string }
  | { workflowRun: { workflow: string; branch?: string } }
  | { untracked: string }

/** What the app made of the project folder's config file. */
export interface ProjectConfigStatus {
  /** The file's path, whether or not it exists. */
  file: string
  state: 'none' | 'loaded' | 'invalid'
  /** Why the file was rejected (the app then uses defaults). */
  error?: string
  /** One line per setting, for Settings. */
  summary: string[]
}

export interface Settings {
  /** Projects folder; null until chosen (first run for a new user). */
  workspace: string | null
  /** Chosen in Settings, rather than found automatically. */
  workspaceChosen: boolean
  claudeDir: string
  /** True when it's the default (~/.claude or the shell's CLAUDE_CONFIG_DIR). */
  claudeDirIsDefault: boolean
  /** Session transcripts found there; 0 suggests the wrong folder. */
  claudeDirSessions: number
  /** The project folder's .session-desk.json; null without a project folder. */
  project: ProjectConfigStatus | null
}

/**
 * The Claude Code status hook for this user. outdated: entries are in place
 * but ~/.session-desk/hook.sh differs from the app's copy.
 */
export interface HookStatus {
  settingsPath: string
  state: 'installed' | 'outdated' | 'partial' | 'missing'
}

export type Column = 'todo' | 'in_progress' | 'waiting' | 'in_review' | 'done'

export const COLUMNS: { id: Column; label: string }[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'waiting', label: 'Waiting Response' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' }
]

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  url: string
  priorityLabel: string
  /** The git branch Linear suggests for the issue, e.g. me/eng-123. */
  branchName: string
  /** Markdown; may be empty. */
  description: string
  state: { id: string; name: string; type: string; color: string }
  /** PRs Linear's GitHub integration attached to the issue. */
  prs: PrLink[]
}

/** A board card's PRs, to show and mark in a session that is about another ticket. */
export interface PrFocus {
  ticket: string
  prUrls: string[]
}

export interface BoardCard {
  issue: LinearIssue
  column: Column
  /** Sessions whose primary ticket is this issue, most recent first. */
  sessionIds: string[]
  /**
   * Sessions about another ticket that opened one of this card's PRs, most
   * recent first: where a ticket without a session of its own was worked on.
   */
  prSessionIds: string[]
  /** The ticket's own PRs: Linear-attached ones that name it, plus linked sessions' PRs on a branch naming it. */
  prs: PrLink[]
  /**
   * Attached in Linear but naming another ticket, e.g. the PR that caused a bug:
   * context, not this ticket's work, so no state chip and no automatic moves.
   */
  relatedPrs: PrLink[]
}

export interface Board {
  cycle: { number: number; endsAt: string } | null
  /** None of my teams has an active cycle, so the cards are my assigned issues instead. */
  noCycles?: boolean
  cards: BoardCard[]
  /** Automatic moves: which of the app's rules are on, and Linear's own GitHub rules for the team. */
  automation?: { start: boolean; review: boolean; linear: { event: string; state: string }[] }
}

/** The connected Linear workspace: its URL key (linear.app/<key>) and every team's ticket prefix. */
export interface LinearWorkspace {
  urlKey: string
  teamKeys: string[]
}

/** `workspace` is the last one seen, kept for offline use and for links while disconnected. */
export type LinearStatus =
  | { connected: true; viewer: string; workspace: LinearWorkspace }
  | { connected: false; error?: string; workspace?: LinearWorkspace }

export interface DeskApi {
  listSessions(): Promise<SessionSummary[]>
  defaultCwd(): Promise<string>
  /** Starts (or re-attaches to) a terminal; resolves with output to replay when re-attaching. */
  ptyStart(req: PtyStartRequest): Promise<string>
  ptyWrite(sessionId: string, data: string): void
  ptyResize(sessionId: string, cols: number, rows: number): void
  ptyKill(sessionId: string): Promise<void>
  /** Checkouts whose branch or folder names the ticket (local git only). */
  ticketBranches(ticket: string): Promise<TicketBranch[]>
  /** Sends a kickoff turn to a session open here and idle at its prompt; false if it isn't open. */
  ptyKickoff(sessionId: string, ticket: string, kind: Kickoff, prBranch?: PrBranch): Promise<boolean>
  onPtyData(cb: (sessionId: string, data: string) => void): () => void
  onPtyExit(cb: (sessionId: string, code: number) => void): () => void
  onSessionsChanged(cb: () => void): () => void
  /** Pin a session to a ticket, overriding detection; null returns it to detection. */
  linkSession(sessionId: string, ticket: string | null): Promise<void>
  renameSession(sessionId: string, name: string): Promise<RenameResult>
  archiveSession(sessionId: string, archived: boolean): Promise<void>
  revealTranscript(sessionId: string): Promise<void>
  /** Moves the session's transcript and its per-session Claude Code files to the macOS Trash. */
  deleteSession(sessionId: string): Promise<void>
  /** Files a session under a group; null returns it to the main Sessions list. */
  moveSession(sessionId: string, groupId: string | null): Promise<void>

  listGroups(): Promise<SessionGroup[]>
  createGroup(name: string): Promise<SessionGroup>
  renameGroup(groupId: string, name: string): Promise<void>
  /** Removes the group; its sessions return to the main list (nothing is deleted). */
  deleteGroup(groupId: string): Promise<void>
  setGroupCollapsed(groupId: string, collapsed: boolean): Promise<void>
  pinSession(sessionId: string, pinned: boolean): Promise<void>
  /** Project-folder sections (keyed by path) the user has collapsed. */
  listCollapsedProjects(): Promise<string[]>
  setProjectCollapsed(path: string, collapsed: boolean): Promise<void>
  /** Resumes the session in a new Terminal.app window. */
  openInTerminal(sessionId: string): Promise<void>

  linearStatus(): Promise<LinearStatus>
  /** Saves (encrypted via the macOS Keychain) and verifies a Linear personal API key; null forgets it. */
  linearSetKey(key: string | null): Promise<LinearStatus>
  getBoard(): Promise<Board>
  getIssue(identifier: string): Promise<LinearIssue | null>
  ticketContext(ticket: string | null, prNumbers: number[]): Promise<TicketContext>
  listArtifacts(): Promise<ArtifactRecord[]>
  /** Removes an artifact from the list (or restores it); doesn't touch claude.ai. */
  setArtifactHidden(url: string, hidden: boolean): Promise<void>
  /** Searches your prompts and Claude's replies across every session (not tool output). */
  searchTranscripts(query: string): Promise<SearchHit[]>
  /** Opens an evidence folder in Finder or a memory note in the default editor; nothing else. */
  openContextPath(path: string): Promise<void>
  /** Posts `@greptileai review` on an open PR. */
  requestGreptileReview(prUrl: string): Promise<void>
  moveCard(identifier: string, column: Column): Promise<Board>

  openExternal(url: string): void
  /** Every extra worktree of every repo in the workspace; takes several seconds. */
  listWorktrees(): Promise<WorktreeInfo[]>
  /** Removes a worktree from the last listing (keeps its branch). */
  removeWorktree(path: string): Promise<void>
  /** Clears stale entries for a repo's missing worktrees. */
  pruneWorktrees(repoPath: string): Promise<void>
  /** Tells the main process which session is on screen, so it isn't notified about it. */
  setActiveSession(sessionId: string | null): void
  getSettings(): Promise<Settings>
  hookStatus(): Promise<HookStatus>
  /** The exact settings.json change (unified diff); empty when nothing would change. */
  hookPreview(action: 'install' | 'uninstall'): Promise<string>
  hookApply(action: 'install' | 'uninstall'): Promise<HookStatus>
  /** Opens a folder picker for a setting; resolves with the settings after (unchanged if cancelled). */
  pickFolder(key: 'workspace' | 'claudeDir'): Promise<Settings>
  resetFolder(key: 'workspace' | 'claudeDir'): Promise<Settings>
  onSettingsChanged(cb: () => void): () => void
  /** Writes a starter .session-desk.json in the project folder (never overwrites). */
  createProjectConfig(): Promise<Settings>
  /** Opens the project's .session-desk.json in the default editor. */
  openProjectConfig(): Promise<void>
  /** The app menu's Settings… item. */
  onOpenSettings(cb: () => void): () => void
  /** A message from the main process for the in-app toast (e.g. an automatic Linear move). */
  onNotice(cb: (text: string) => void): () => void
  /** A notification was clicked: show this session. */
  onNavigateToSession(cb: (sessionId: string) => void): () => void
}
