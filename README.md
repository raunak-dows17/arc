# ARC — Autonomous Regenerative Companion

ARC is a free, local-first companion agent for a Windows 11 laptop. It runs
entirely on local **Ollama** models, keeps durable Markdown memory, loads
skills on demand, delegates bounded work to sequential sub-agents, and is
designed around explicit approval boundaries for anything that leaves the
machine.

- **Production runtime:** Windows 11, 16 GB RAM, AMD iGPU with 4 GB dedicated
  memory.
- **Development runtime:** macOS. Windows-specific path and credential
  behaviour is tested on macOS from day one.
- **No cloud LLM calls.** Models are selected from the local Ollama instance.
- **Read-only by default for the outside world.** Social analysis and email
  ingestion will never post, reply, delete, or mark messages read. Email is
  read + notify only.
- **Free-first integrations.** Official APIs and free tiers, cached where
  possible.

> **Current milestone: Phase 4 — local tools and web access.** Chat, memory,
> skills, sub-agents, model routing, Tev1 decision-model support, the
> fail-closed approval boundary, OS credential storage, Windows-safe paths,
> `arc doctor`, approval-gated PowerShell, workspace search/edit tools, and
> Brave web search/fetch are in place. Email, social analysis, Telegram, and the
> always-on scheduler are the next phases.

## Requirements

- Node.js 20 or newer
- [Ollama](https://ollama.com) 0.35 or newer for the decision-model endpoint
- Local models:

```bash
ollama pull qwen3:8b
ollama pull qwen2.5-coder:7b
ollama pull tev1:0.8b
```

`qwen3:8b` is the recommended maximum generative model for 16 GB RAM.
`tev1:0.8b` is a small pre-classifier, not a chat model or tool-call
generator.

## Quick start

```bash
npm install
cp .env.example .env
npm run doctor
npm start
```

`npm run doctor` checks Node, private-state separation, Ollama, installed
models, the OS keyring, Brave Search configuration, memory, and disk without
running inference.

Once built, the package exposes an `arc` command:

```bash
npm run build
npm link          # optional, makes `arc` available on your PATH
arc doctor
arc secrets set brave.api-key
arc
```

The Brave key is optional until you use `web_search`. It belongs in the OS
credential store, never in `.env`.

On Windows, run the same commands from PowerShell. The production paths should
look like this in `.env`:

```dotenv
ARC_HOME=C:\Users\Raunak Pandey\AppData\Local\ARC\agent-home
ARC_WORKSPACE=C:\Users\Raunak Pandey\Projects\arc-workspace
ARC_PROFILE=arc
```

Use a dedicated workspace such as `arc-workspace` until the active-project
boundary is implemented. Pointing `ARC_WORKSPACE` at all of `Projects` would
let workspace tools touch every project in that folder; select one project at a
time for now. `ARC_HOME` must stay outside `ARC_WORKSPACE`. If it does not, ARC
refuses to start because private memory, sessions, and audit logs would become
visible to file tools.

## Commands

Inside the REPL:

| Command | Purpose |
| --- | --- |
| `/help` | Show commands |
| `/new [profile]` | Start a fresh session |
| `/sessions` | List saved sessions |
| `/history [id]` | Show recent messages |
| `/status` | Profile, paths, usage, and context estimate |
| `/tools` | List tools allowed for the current profile |
| `/sandbox [path]` | Show the workspace and a directory listing |
| `/memory` | Show `USER.md`, `MEMORY.md`, and recent daily notes |
| `/search <query>` | Search Markdown memory |
| `/remember [daily] <text>` | Save a durable note |
| `/skills`, `/skill <name>` | List or inspect skills |
| `/agents` | List profiles |
| `/agent <name> <task>` | Run a sub-agent directly |
| `/tasks`, `/task <id>` | Inspect sub-agent runs |
| `/compact` | Summarize older history now |
| `/cancel` | Cancel the running turn |
| `/model` | Show the configured main model |

Anything else is sent to ARC as a task.

Secrets are managed outside the REPL:

```bash
arc secrets list
arc secrets set brave.api-key
arc secrets check brave.api-key
arc secrets delete brave.api-key
```

`set` uses a hidden prompt. Secrets are never accepted as command-line
arguments, so they do not land in shell history.

## Models and routing

| Role | Default | Notes |
| --- | --- | --- |
| Main / research | `qwen3:8b` | General reasoning, writing, memory, tool calls |
| Coding | `qwen2.5-coder:7b` | Coding profiles and coding tasks |
| Decision pre-classifier | `tev1:0.8b` | Ollama `/v1/systemone`; yes/no, choice, score |
| Compaction | main model | Summarizes old transcript history |

The model router selects a model by task/profile. `SerializedLlmAdapter`
guarantees that only one generative or decision-model request runs at a time,
including parent turns, sub-agents, and future email watchers. This matters on
a 16 GB machine.

Tev1 is deliberately **not** used to generate tool calls. It answers named
questions about a state, for example “does this email need attention?” or “is
this a billing, scheduling, or personal message?” Uncertain decisions should be
escalated to the main model.

Recommended Ollama service limits:

```text
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
```

If `qwen2.5-coder:7b` spills to shared memory, lower `ARC_NUM_CTX` from 8192 to
4096 first.

## Web and coding tools

- **`web_search`** uses the Brave Search API free tier. The first network call
  in a session asks for approval; choosing “session” reuses that grant for the
  rest of the session. Results are cached in memory for five minutes.
- **`web_fetch`** retrieves a public page as bounded text. Loopback, private,
  link-local, metadata, and reserved addresses are blocked, and every redirect
  is re-checked. Responses are capped at 512 KB and 20,000 readable characters
  by default.
- **`search_files`** finds literal text across the workspace while skipping
  dependency, build, and binary content.
- **`replace_in_file`** performs exact-string edits and requires a unique match
  unless `replace_all` is explicit. `write_file` remains available for complete
  rewrites.
- **`shell`** uses PowerShell on Windows and the login shell on macOS/Linux.
  Every command asks for approval, even after a network session grant. Shell
  commands run with the user's privileges and can reach outside the workspace.

The built-in `coder` profile combines the coding and web tools with
approval-gated shell access. Web content is always marked untrusted; the model
is instructed not to follow instructions found inside pages.

## Two separate directories

| Path | Default | Purpose |
| --- | --- | --- |
| `ARC_HOME` | `./.arc` on macOS; `%LOCALAPPDATA%\ARC\agent-home` on Windows | Private memory, skills, profiles, sessions, run records, audit log |
| `ARC_WORKSPACE` | `./sandbox` | The only filesystem world exposed to file tools |

A tighter production layout is a dedicated `arc-workspace` folder as the
workspace and `%LOCALAPPDATA%\ARC\agent-home` as private state. Workspace writes
are auto-allowed inside that boundary; sensitive paths are blocked. Use one
project at a time until the active-project selector is implemented.

Legacy names are still accepted during migration: `AGENT_HOME`,
`AGENT_PROFILE`, `WORKSPACE_DIR`, `SANDBOX_DIR`, and `OLLAMA_*` variables.
ARC-prefixed names win when both are present.

## Security model

ARC assumes the model can make mistakes or be manipulated by content it reads.

- **Path policy:** sensitive paths such as `.env`, `secrets/`, `.git/config`,
  private keys, and SSH material are blocked even if they appear inside the
  workspace.
- **Portable path validation:** drive-letter paths, UNC/device paths, alternate
  data streams (`file.txt:stream`), reserved Windows device names, and
  trailing-dot/space segments are rejected on every platform.
- **Sandbox:** reads and writes resolve through symlink checks and must stay
  inside the workspace. `.agent` and `.arc` directories inside the workspace
  are reserved and hidden.
- **Approval boundary:** tools marked `requiresApproval` fail closed unless a
  human approves. Timeouts, cancellation, a closed terminal, and a missing
  human channel all become denials. Network tools can be granted once per
  session; shell commands always require a fresh approval. Approval requests
  and decisions are written to the audit log.
- **Web safety:** `web_fetch` rejects non-HTTP(S) schemes, embedded
  credentials, non-default ports, private/loopback/link-local/metadata
  addresses, and DNS names that resolve into them. Redirects are re-checked.
  Fetched content is labelled untrusted and never treated as instructions.
- **Secrets:** use the Windows Credential Manager through the keyring adapter;
  never put tokens in `.env`, memory, prompts, or audit logs. `arc secrets set`
  reads from a hidden prompt. `arc doctor` performs a keyring probe and reports
  whether the Brave key is present.
- **Audit:** events are written as JSONL under `ARC_HOME/audit.jsonl` with
  sensitive keys redacted, including approval requests and decisions.
- **Telegram:** bot chat is not end-to-end encrypted. Send summaries and
  notifications, not full email bodies or secrets.

## Windows 11 always-on setup

ARC is designed to run at user logon, non-admin, under the same Windows account
that owns the Credential Manager entries.

1. Install Node 20+ and Ollama.
2. Put the source at `C:\Users\Raunak Pandey\Projects\arc`.
3. Create `.env` with the production `ARC_HOME` and `ARC_WORKSPACE` above.
4. Run `npm install`, `npm run build`, and `npm run doctor`.
5. If you want web search, run `npm link` and then
   `arc secrets set brave.api-key`.
6. Create a Task Scheduler task triggered **At log on**, with
   `node C:\Users\Raunak Pandey\Projects\arc\out\main.js` as the action and the
   project folder as the start-in directory.
7. Keep the user session logged in and locked.
8. Disable sleep and hibernation while on AC power.
9. Verify `arc doctor` after a reboot.

A per-user logon task is preferred over running as `SYSTEM`: `SYSTEM` may not
be able to read the user's Credential Manager entries. Sleep, reboot, or logoff
will interrupt Telegram and email watchers; ARC is always-on only while the
Windows session is available.

## Configuration

Copy `.env.example` to `.env`. Canonical variables include:

| Variable | Default |
| --- | --- |
| `ARC_HOME` | `./.arc` (macOS) / `%LOCALAPPDATA%\ARC\agent-home` (Windows) |
| `ARC_WORKSPACE` | `./sandbox` |
| `ARC_PROFILE` | `arc` |
| `ARC_MODEL` | `qwen3:8b` |
| `ARC_CODING_MODEL` | `qwen2.5-coder:7b` |
| `ARC_RESEARCH_MODEL` | `qwen3:8b` |
| `ARC_DECISION_MODEL` | `tev1:0.8b` |
| `ARC_NUM_CTX` | `8192` |
| `ARC_KEEP_ALIVE` | `10m` |
| `ARC_MAX_AGENT_STEPS` | `12` |
| `ARC_MAX_SUBAGENTS_PER_TURN` | `2` |
| `ARC_WEB_SEARCH_TIMEOUT_MS` | `15000` |
| `ARC_WEB_FETCH_TIMEOUT_MS` | `20000` |
| `ARC_WEB_MAX_BYTES` | `524288` |
| `ARC_WEB_MAX_CHARS` | `20000` |
| `ARC_WEB_MAX_RESULTS` | `8` |
| `ARC_WEB_CACHE_TTL_MS` | `300000` |
| `ARC_SHELL_TIMEOUT_MS` | `60000` |
| `ARC_SHELL_MAX_OUTPUT_BYTES` | `65536` |

Network tool approvals may be granted for the current session. Shell commands
never inherit a session grant.

## Skills and profiles

Built-in profiles: `arc` (default, all tools), `researcher` (read-only, with
web research), `reviewer` (read-only), `writer` (workspace writes only), and
`coder` (workspace coding, web, and approval-gated shell). Add or override
profiles with Markdown frontmatter in `ARC_HOME/agents/<id>.md`.

Skills are loaded from, in order:

1. `<repo>/skills`
2. `ARC_HOME/skills`
3. `ARC_WORKSPACE/.skills`

Later directories override earlier ones. `agents:` frontmatter limits a skill
to named profiles; `tools:` limits the tools a skill may use.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The test suite covers the agent loop, context assembly, compaction, sub-agent
isolation, profile policy, approval fail-closed behaviour and session grants,
Brave search, SSRF-safe fetch, workspace search/edit tools, shell timeouts and
cancellation, Tev1 response parsing, model routing, OS-keyring injection,
Windows path hardening, sandbox containment, memory, sessions, skills,
events/redaction, secrets CLI, and `arc doctor`.

## Project layout

```text
src/
  domain/           entities, value objects, ports, path/security rules
  application/      use cases, context assembly, routing, approvals
  infrastructure/   Ollama, event bus, persistence, CLI, keyring, tools
  shared/           small utilities
skills/             built-in Markdown skills
```

## Roadmap

- **Phase 4 (complete):** Brave web search/fetch, SSRF protection, workspace
  search/edit tools, approval-gated PowerShell, interactive CLI approvals, and
  the secrets CLI.
- **Phase 5:** read-only Gmail IMAP ingestion, Tev1 notification triage,
  Telegram remote chat and notifications.
- **Phase 6:** read-only YouTube and Instagram performance analysis, content
  suggestions.
- **Phase 7:** always-on Windows hardening, installer or standalone build,
  npm distribution.

## Troubleshooting

- **“Model … is not installed”** — run the `ollama pull` command shown by
  `arc doctor`.
- **Ollama is unreachable** — start `ollama serve` and confirm
  `ARC_OLLAMA_BASE_URL`.
- **ARC_HOME must be outside ARC_WORKSPACE** — move private state out of the
  workspace; this is intentional.
- **Keyring probe fails** — make sure ARC is running as the same logged-in
  user that owns the Windows Credential Manager entries.
- **`web_search` says it is not configured** — run
  `arc secrets set brave.api-key`. The key must be from the Brave Search API,
  not a general Brave browser key.
- **`web_fetch` says an address is blocked** — ARC refuses private, loopback,
  metadata, and reserved destinations by design. Use a public URL.
- **A shell command needs approval every time** — this is intentional. Even a
  session network grant never applies to `shell`.
- **Slow coding responses** — reduce `ARC_NUM_CTX` to 4096 and keep
  `OLLAMA_MAX_LOADED_MODELS=1`.

## License

MIT
