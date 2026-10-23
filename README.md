# ARC — Autonomous Regenerative Companion

ARC is a free, provider-neutral companion agent for Windows, macOS, and Linux.
It can use cloud models from Google Gemini, Groq, OpenRouter, Cerebras,
Mistral, GitHub Models, or any OpenAI-compatible endpoint, and can optionally
use local **Ollama** models. It keeps durable Markdown memory, loads skills on
demand, delegates bounded work to sequential sub-agents, and keeps explicit
approval boundaries for anything that leaves the machine.

- **Runs on Windows, macOS, and Linux.** Paths, credential storage, shell
  commands, and workspace boundaries are platform-aware.
- **Cloud-first by default when a provider key exists.** Local Ollama is
  optional. ARC does not automatically load a large local model on a
  memory-constrained machine.
- **Read-only by default for the outside world.** Social analysis and email
  ingestion never post, reply, delete, or mark messages read. Email is
  read + notify only.
- **Free-first integrations.** Official APIs and free tiers, cached where
  possible. Provider limits and model ids change, so setup discovers the
  current model list.

> **Current milestone: Phase 5 + provider layer.** Chat, memory, skills,
> sub-agents, provider routing, Gemini and OpenAI-compatible adapters, device
> detection, `arc setup`, read-only Gmail ingestion, Telegram remote chat, the
> fail-closed approval boundary, OS credential storage, and cross-platform
> workspace tools are in place.

## Requirements

- Node.js 20 or newer
- One of:
  - an API key for a cloud provider (recommended), or
  - [Ollama](https://ollama.com) with local models if you explicitly want
    local inference
- Optional: a Brave Search API key for `web_search`
- Optional: a Gmail app password for read-only email notifications
- Optional: a Telegram bot token for remote chat

Local models are never required. If you do use Ollama on a 16 GB machine,
`qwen3:8b` is a reasonable upper bound for generative work, and `tev1:0.8b` is
a small pre-classifier rather than a chat or tool-call model.

## Quick start

```bash
npm install
cp .env.example .env
npm run build
npm link          # optional, makes `arc` available on your PATH
arc setup
arc doctor
arc
```

`arc setup` detects the device, lists providers, stores the provider key in the
OS credential store, discovers available models, and writes non-secret routing
choices to `ARC_HOME/models.json`.

Provider keys are never stored in `.env`, source, logs, or `models.json`:

```bash
arc secrets set provider.google.api-key
arc secrets set provider.groq.api-key
arc secrets set provider.openrouter.api-key
arc secrets list
```

`arc doctor` checks Node, private-state separation, the OS keyring, the
selected provider and models, Brave Search, email, Telegram, memory, and disk
without running inference.

Default private state locations:

| Platform | `ARC_HOME` default |
| --- | --- |
| Windows | `%LOCALAPPDATA%\ARC\agent-home` |
| macOS | `~/Library/Application Support/ARC/agent-home` |
| Linux | `$XDG_STATE_HOME/arc/agent-home` or `~/.local/state/arc/agent-home` |

`ARC_WORKSPACE` defaults to `./sandbox` in the current project. `arc setup`
shows the resolved path, and you can override it with `ARC_WORKSPACE`. Keep
`ARC_HOME` outside `ARC_WORKSPACE`; ARC refuses to start otherwise because
private memory, sessions, and audit logs would become visible to file tools.

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

Process commands:

| Command | Purpose |
| --- | --- |
| `arc` | Start the interactive terminal REPL |
| `arc setup` | Detect the device, add a provider key, and choose models |
| `arc models` | Show provider/model routing and key status |
| `arc models set <role> <provider>/<model>` | Change one routing role |
| `arc models fallback <provider>/<model> [...]` | Set a fallback chain |
| `arc providers` | List provider presets and key status |
| `arc providers add <id> <https-base-url>` | Add a custom OpenAI-compatible provider |
| `arc providers remove <id>` | Remove an unused custom provider |
| `arc serve` | Run Telegram chat and/or the read-only Gmail watcher |
| `arc doctor` | Check paths, keyring, selected providers/models, email, and Telegram |
| `arc secrets ...` | Manage OS-keyring entries |

Secrets are managed outside the REPL:

```bash
arc secrets list
arc secrets set provider.google.api-key
arc secrets set provider.groq.api-key
arc secrets set brave.api-key
arc secrets set gmail.app-password
arc secrets set telegram.bot-token
arc secrets check telegram.bot-token
arc secrets delete telegram.bot-token
```

`set` uses a hidden prompt. Secrets are never accepted as command-line
arguments, so they do not land in shell history.

## Models and routing

`arc setup` writes `ARC_HOME/models.json` with a provider/model pair for each
role:

| Role | Purpose |
| --- | --- |
| `main` | General reasoning, writing, memory, and tool calls |
| `research` | Research profiles |
| `coding` | Coding profiles and coding tasks |
| `triage` | Cheap/fast email and notification classification |
| `compaction` | Summarizes old transcript history |

Provider presets include Google Gemini, Groq, OpenRouter, Cerebras, Mistral,
GitHub Models, and optional Ollama. Any other OpenAI-compatible endpoint can be
added with a base URL and key account. The setup wizard queries each provider’s
model list, so it is not tied to a hardcoded catalog.

Fallbacks are optional but recommended:

```bash
arc models fallback groq/llama-3.3-70b-versatile openrouter/meta-llama/llama-3.3-70b-instruct:free
```

`SerializedLlmAdapter` still funnels model calls through one promise chain. This
avoids free-tier bursts and keeps local inference from stacking requests on a
small machine.

For Ollama, keep the service serialized:

```text
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
```

Tev1 remains supported as a local triage model through Ollama’s
`/v1/systemone` endpoint. Cloud triage uses a provider-neutral JSON classifier
and only sees sender, subject, timestamp, and a short snippet.

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

## Email and Telegram

### Read-only Gmail notifications

ARC can poll an unread Gmail mailbox and send a short notification when the
selected triage model thinks a message deserves attention. The triage role can
be local Tev1 or a cheap cloud model. It is deliberately one-way:

- The mailbox is opened with IMAP `EXAMINE`/read-only mode.
- Message bodies are fetched with `BODY.PEEK`, so ARC never sets `\Seen`.
- There is no send, reply, delete, move, archive, or flag-changing code path.
- Deduplication uses mailbox `UIDVALIDITY` plus the last processed UID, because
  unread mail keeps appearing on every poll.
- The triage model sees only sender, subject, timestamp, and a short snippet.
  If triage is unavailable, ARC falls back to notifying so important mail is
  not silently missed; the message is labelled `triage unavailable`.
- Cloud triage is opt-in through the `triage` role. Choose local Tev1 if you do
  not want email metadata sent to a provider.

Setup:

1. Enable 2-Step Verification on the Google account.
2. Create a Google **app password** for ARC.
3. Enable IMAP access in Gmail settings.
4. Store the app password with `arc secrets set gmail.app-password`.
5. Set `ARC_EMAIL_ENABLED=true` and `ARC_EMAIL_ADDRESS` in `.env`.
6. Run `arc serve`.

The first run processes up to `ARC_EMAIL_MAX_MESSAGES` recent unread messages.
Later polls use the saved cursor. The state file contains only UIDVALIDITY and a
UID; it does not store message bodies.

### Telegram remote chat

1. Create a private bot with [@BotFather](https://t.me/BotFather).
2. Store the token with `arc secrets set telegram.bot-token`.
3. Send a message to the bot, then use the Telegram `getUpdates` API or a
   helper bot to find your numeric chat id.
4. Set `ARC_TELEGRAM_ENABLED=true` and
   `ARC_TELEGRAM_ALLOWED_CHAT_IDS=<your-id>` in `.env`.
5. Run `arc serve` and message the bot.

Only allowlisted numeric chat ids can use the bot. Each chat gets its own ARC
session. `/new` starts a fresh conversation, `/status` shows the session,
`/stop` cancels the active turn, and `/help` lists commands. Tool approvals are
sent to the chat that owns the session. Reply with `yes <request-id>` or
`no <request-id>`; session-scoped network tools also accept
`session <request-id>`. Shell commands always require a fresh `yes`.

Telegram bot chats are not end-to-end encrypted. ARC sends summaries,
notifications, and short email snippets, never full mail bodies or secrets.

## Two separate directories

| Path | Default | Purpose |
| --- | --- | --- |
| `ARC_HOME` | Per-user OS state directory (see Quick start) | Private memory, skills, profiles, sessions, run records, audit log, `models.json` |
| `ARC_WORKSPACE` | `./sandbox` in the current project | The only filesystem world exposed to file tools |

Use one project at a time. Workspace writes are auto-allowed inside that
boundary; sensitive paths are blocked. `ARC_HOME` must stay outside
`ARC_WORKSPACE`.

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
- **Secrets:** use the OS credential store (Windows Credential Manager, macOS
  Keychain, or Linux Secret Service) through the keyring adapter; never put
  tokens in `.env`, memory, prompts, or audit logs. `arc secrets set` reads from
  a hidden prompt. `arc doctor` performs a keyring probe and reports which
  provider keys are present.
- **Audit:** events are written as JSONL under `ARC_HOME/audit.jsonl` with
  sensitive keys redacted, including approval requests and decisions.
- **Telegram:** bot chat is not end-to-end encrypted. Send summaries and
  notifications, not full email bodies or secrets.

## Always-on setup

ARC is designed to run non-admin under the same user account that owns the OS
keyring entries. Install Node 20+, clone or install the package, create `.env`
from `.env.example`, and run:

```bash
npm install
npm run build
arc setup
arc doctor
```

For email or Telegram:

```bash
arc secrets set gmail.app-password
arc secrets set telegram.bot-token
arc doctor
```

`arc serve` starts only the channels enabled in `.env`; it refuses to start
when both email and Telegram are disabled.

Platform-specific supervision:

- **Windows:** create a Task Scheduler task triggered **At log on**, with
  `node <path-to-arc>\out\main.js serve` as the action and the project folder as
  the start-in directory. Use a per-user task, not `SYSTEM`, so the task can
  read the user's Credential Manager entries.
- **macOS:** create a LaunchAgent in `~/Library/LaunchAgents` that runs
  `node <path-to-arc>/out/main.js serve` at login.
- **Linux:** create a user `systemd` service (`systemctl --user`) that runs
  `node <path-to-arc>/out/main.js serve`.

Keep the user session logged in, disable sleep while on AC power, and verify
`arc doctor` and `arc serve` after a reboot. Sleep, reboot, or logoff interrupts
the watchers; ARC is always-on only while the user session is available.

## Configuration

Copy `.env.example` to `.env`. Canonical variables include:

| Variable | Default |
| --- | --- |
| `ARC_HOME` | Per-user OS state directory |
| `ARC_WORKSPACE` | `./sandbox` |
| `ARC_PROFILE` | `arc` |
| `ARC_MODEL_PROVIDER` | Provider id; overrides `models.json` for legacy/CI runs |
| `ARC_MODEL` | Main model id (legacy/Ollama when no `models.json`) |
| `ARC_CODING_MODEL` | Coding model id (legacy/Ollama when no `models.json`) |
| `ARC_RESEARCH_MODEL` | Research model id |
| `ARC_DECISION_MODEL` | Triage model id |
| `ARC_NUM_CTX` | `8192` (Ollama only) |
| `ARC_KEEP_ALIVE` | `10m` (Ollama only) |
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
| `ARC_EMAIL_ENABLED` | `false` |
| `ARC_EMAIL_ADDRESS` | required when email is enabled |
| `ARC_EMAIL_IMAP_HOST` | `imap.gmail.com` |
| `ARC_EMAIL_IMAP_PORT` | `993` |
| `ARC_EMAIL_MAILBOX` | `INBOX` |
| `ARC_EMAIL_POLL_INTERVAL_MS` | `300000` |
| `ARC_EMAIL_LOOKBACK_DAYS` | `2` |
| `ARC_EMAIL_MAX_MESSAGES` | `10` |
| `ARC_EMAIL_SNIPPET_CHARS` | `800` |
| `ARC_EMAIL_TRIAGE_THRESHOLD` | `0.65` |
| `ARC_EMAIL_NOTIFY_ON_TRIAGE_FAILURE` | `true` |
| `ARC_TELEGRAM_ENABLED` | `false` |
| `ARC_TELEGRAM_ALLOWED_CHAT_IDS` | required when Telegram is enabled |
| `ARC_TELEGRAM_NOTIFY_CHAT_ID` | first allowed chat id |
| `ARC_TELEGRAM_POLL_TIMEOUT_SEC` | `30` |

Network tool approvals may be granted for the current session. Shell commands
never inherit a session grant. Email and Telegram are disabled by default; both
require secrets in the OS keyring, not in `.env`.

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
cancellation, Tev1 and cloud decision parsing, provider routing and fallback,
JSON repair, device classification, model config, OS-keyring injection,
cross-platform path hardening, sandbox containment, memory, sessions, skills,
events/redaction, secrets CLI, read-only Gmail source and UIDVALIDITY dedupe,
email triage and watcher fallback, Telegram API/approval/chat routing, and
`arc doctor`.

## Project layout

```text
src/
  domain/           entities, value objects, ports, path/security rules
  application/      use cases, context assembly, routing, approvals
  infrastructure/   provider adapters, event bus, persistence, CLI, keyring, tools
  shared/           small utilities
skills/             built-in Markdown skills
```

## Roadmap

- **Phase 4 (complete):** Brave web search/fetch, SSRF protection, workspace
  search/edit tools, approval-gated PowerShell, interactive CLI approvals, and
  the secrets CLI.
- **Phase 5 (complete):** read-only Gmail IMAP ingestion, notification triage,
  Telegram remote chat and notifications.
- **Provider layer (complete):** Gemini and OpenAI-compatible providers,
  optional Ollama, device detection, `arc setup`/`arc models`, fallback chains,
  JSON repair, and cross-platform state paths.
- **Phase 6:** read-only YouTube and Instagram performance analysis, content
  suggestions.
- **Phase 7:** always-on hardening, installer or standalone build, npm
  distribution.

## Troubleshooting

- **“Provider … needs an API key”** — run `arc secrets set
  provider.<id>.api-key`, then `arc doctor`.
- **“Model … is not installed”** — this only applies to a selected Ollama
  model. Run the `ollama pull` command shown by `arc doctor`, or choose a cloud
  provider with `arc setup`.
- **Ollama is unreachable** — start `ollama serve` and confirm
  `ARC_OLLAMA_BASE_URL`, or switch to a cloud provider.
- **ARC_HOME must be outside ARC_WORKSPACE** — move private state out of the
  workspace; this is intentional.
- **Keyring probe fails** — make sure ARC is running as the same logged-in user
  that owns the OS keyring entries. On Linux, install a Secret Service provider
  such as GNOME Keyring or KWallet.
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
