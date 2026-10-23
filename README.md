# Local Autonomous Agent

A local-first autonomous assistant CLI powered by **Ollama** and **`qwen3:8b`**, written in TypeScript with clean architecture. It keeps Markdown memory, loads skills on demand, runs a bounded tool loop, and delegates self-contained work to sequential sub-agents — all without cloud LLM calls.

Tuned for a **16 GB RAM** machine. `qwen3:8b` is the recommended maximum model size.

## Requirements

- Node.js 20+ (tested on Node 26)
- [Ollama](https://ollama.com) running locally
- The Qwen3 8B model:

```bash
ollama pull qwen3:8b
ollama serve
```

## Setup

```bash
npm install
npm start
```

The defaults work without a `.env` file. To customise:

```bash
cp .env.example .env
```

## Two separate directories

The agent has private state and a filesystem workspace. Keeping them apart means memory and session logs never become visible to file tools.

| Path | Default | Purpose |
| --- | --- | --- |
| `AGENT_HOME` | `./.agent-home` | Private memory, skills, profiles, sessions, run records, audit log |
| `WORKSPACE_DIR` | `./sandbox` | The only filesystem world exposed to `list_files`, `read_file`, and `write_file` |

`SANDBOX_DIR` is still accepted as a legacy alias for `WORKSPACE_DIR`. Existing transcripts in `sandbox/.agent/sessions` are copied once into `AGENT_HOME/sessions` when the new store is empty.

```text
.agent-home/
  STANDING_ORDERS.md
  agents/                 # optional user profiles: <id>.md
  skills/                 # optional user skills: <name>/SKILL.md
  memory/
    USER.md
    MEMORY.md
    daily/YYYY-MM-DD.md
  sessions/               # full transcripts (JSON v2)
  runs/                   # sub-agent run records
  audit.jsonl             # event audit trail
```

## Usage

```text
  Local Autonomous Agent
  profile  assistant
  model    qwen3:8b
  workspace /path/to/project/sandbox
  home     /path/to/project/.agent-home
  session  20261023T100304Z-89e582ca
  /help for commands · Ctrl+C cancels a running turn · Ctrl+D exits

› create notes/plan.md with a short weekly plan, then read it back
```

Anything that does not start with `/` is sent to the agent as a task.

### Commands

| Command | Description |
| --- | --- |
| `/help` | Show all commands |
| `/new [profile]` | Start a new session, optionally with an agent profile |
| `/sessions` | List saved root and child sessions |
| `/history [id]` | Show recent messages for the current session or a child id |
| `/status` | Profile, paths, usage, and context estimate |
| `/tools` | List tools available to the current profile |
| `/memory` | Show `USER.md`, `MEMORY.md`, and recent daily notes |
| `/search <query>` | Keyword-search Markdown memory |
| `/remember [daily] <text>` | Save a durable memory note |
| `/skills` | List installed skills |
| `/skill <name>` | Show a skill body |
| `/skill reload` | Re-scan skill directories |
| `/agents` | List agent profiles |
| `/agent <name> <task>` | Run a sub-agent directly |
| `/tasks` | List sub-agent runs for this session |
| `/task <id>` | Show one run, its status, and summary |
| `/compact` | Summarize older history now |
| `/cancel` | Cancel the running turn (Ctrl+C also works) |
| `/sandbox [path]` | Show the workspace and a directory listing |
| `/model` | Show the configured model |
| `/exit` | Quit (Ctrl+D also works) |

Ctrl+C cancels the running turn without exiting. Press it twice on an idle prompt to exit.

## Agent profiles

Profiles isolate context and enforce least privilege. Built-ins:

| Profile | Tools | Steps | Can spawn | Purpose |
| --- | --- | --- | --- | --- |
| `assistant` | all | 12 | yes | Default assistant: memory, notes, research, files, delegation |
| `researcher` | read-only + memory + skills | 8 | no | Investigation and synthesis |
| `reviewer` | read-only + memory + skills | 8 | no | Critical review |
| `writer` | read-only + `write_file` + skills | 8 | no | Drafting and editing files |

Override or add profiles with Markdown files in `AGENT_HOME/agents/<id>.md`:

```markdown
---
name: planner
description: Weekly planning and prioritisation
tools: [list_files, read_file, memory_search, memory_get, load_skill, write_file]
skills: "*"
maxSteps: 8
canSpawn: false
memoryWrite: false
readOnly: false
---

You are a pragmatic planner. Turn goals into a small, ordered plan.
```

A user file with the same id replaces the built-in profile. User profiles default to a safe, read-only tool set unless tools are listed.

## Skills

Skills are lazy-loaded instruction packages. The system prompt contains only the name, description, and "when to use" hint; the body enters context only when the model calls `load_skill`.

Skill directories are merged in this order, with later directories overriding earlier ones by name:

1. `<repo>/skills` (bundled)
2. `AGENT_HOME/skills`
3. `WORKSPACE_DIR/.skills`

Format:

```markdown
---
name: research-brief
description: Produce a decision-ready brief from local material.
whenToUse: The user asks for research or a comparison.
agents: "*"            # or [assistant, researcher]
tools: [memory_search, read_file]
---

Instructions...
```

Bundled skills: `daily-review`, `meeting-notes`, and `research-brief`.

## Markdown memory

Memory is plain Markdown, editable by the user at any time:

- `USER.md` — stable preferences and facts about the user.
- `MEMORY.md` — durable decisions and notes, appended by `remember`.
- `daily/YYYY-MM-DD.md` — dated notes; successful turns are auto-captured by default.

Retrieval uses **MiniSearch** keyword scoring, not embeddings, which keeps the memory budget for the model itself. Daily notes for today and yesterday are included in context, with per-file character caps and a total `MAX_MEMORY_CHARS` budget.

## Sequential sub-agents

`run_agent` delegates one self-contained task to a bounded profile. The parent turn blocks until the child finishes, so only one model request is ever in flight on the 16 GB machine.

- Depth defaults to 1; children cannot spawn more agents.
- Profiles with `canSpawn: true` cannot be used as children.
- Each child gets an isolated transcript, its own profile and tool allowlist, and a compact summary return.
- The child's full transcript is stored as a normal session (`parentId`, `depth`), and the run is stored in `AGENT_HOME/runs` for `/tasks`.
- Per-turn delegation is capped by `MAX_SUBAGENTS_PER_TURN` (default 2) and each run by `MAX_SUBAGENT_RUN_MS` (default 5 minutes).

## Context compaction

The full transcript stays on disk. Before a turn, if the working transcript exceeds ~70% of `MAX_CONTEXT_CHARS`, older messages are replaced by a model-written summary. The newest `KEEP_RECENT_MESSAGES` messages stay verbatim. `/compact` forces it. Failed compaction never fails the turn; normal history trimming still bounds the request.

## Security and safety

- Workspace paths are jailed, with traversal, absolute-path, and symlink-escape checks.
- Sensitive paths are denied for reads, writes, and listings: `.env*`, `secrets/`, `.git/`, private keys, and SSH material.
- Writes are auto-allowed inside the workspace; there is no shell or network tool in this milestone. When those tools are added, they must go through an approval gate.
- The reserved `.agent` state directory is blocked inside the workspace.
- Tool calls are validated with Zod; observations are truncated; consecutive duplicate calls are blocked.
- Child profiles are enforced in both the prompt and the dispatcher, not just by instructions.
- `audit.jsonl` records turn, tool, memory-write, and sub-agent events. Tool arguments/results are truncated and sensitive keys are redacted.

There is intentionally **no shell execution, delete, web browsing, browser automation, channels, cron/heartbeat, Docker sandboxing, embeddings, or UI** in this milestone.

## Agent loop

1. Append the user prompt to the session.
2. Compact older history if needed.
3. Assemble a bounded context: profile instructions, standing orders, memory, skill index, tool schemas, and recent history.
4. Ask Ollama for a constrained JSON decision:

   ```json
   { "thought": "...", "tool": { "name": "read_file", "args": {} }, "final": null }
   ```

   or

   ```json
   { "thought": "...", "tool": null, "final": "the answer" }
   ```

5. Two mutually exclusive `anyOf` branches prevent the model from setting both `tool` and `final`.
6. Validate and execute one tool; append the observation and continue.
7. Record token usage, enforce step/delegation budgets, and abort cleanly on Ctrl+C.

## Architecture

```text
src/
  domain/
    entities/          agent-session, agent-profile, skill, sub-agent-run
    events/            typed agent events
    services/          sensitive-path policy
    value-objects/     decision, tool call
    ports/             LLM, tools, sandbox, stores, memory, skills, profiles, runner
    errors/
  application/
    usecases/          run-agent-turn, execute-tool, compact-session, sub-agent-runner
    services/          context assembler, system prompt, tool registry, policy sandbox
  infrastructure/
    bootstrap/         AGENT_HOME creation and legacy-session migration
    llm/               Ollama adapter, decision schema, serialized adapter
    memory/            Markdown memory store, MiniSearch, standing orders
    skills/            SKILL.md repository
    profiles/          built-in + Markdown profile repository
    sandbox/           filesystem jail
    persistence/       session v2 and run-record JSON stores
    events/            in-memory event bus and JSONL audit
    tools/             file, memory, skill, remember, run_agent
    cli/               REPL and terminal renderer
    config/env.ts
  main.ts              composition root
```

Dependency direction is inward. The domain has no Node.js, filesystem, network, or CLI imports. Infrastructure implements domain ports; the composition root wires everything.

## 16 GB tuning

| Setting | Default | Why |
| --- | --- | --- |
| `OLLAMA_MODEL` | `qwen3:8b` | Fits alongside the OS on 16 GB |
| `OLLAMA_NUM_CTX` | `8192` | Bounded KV cache |
| `OLLAMA_NUM_PREDICT` | `1024` | Caps generation length |
| `OLLAMA_TEMPERATURE` | `0.2` | Less drift in the decision protocol |
| `OLLAMA_KEEP_ALIVE` | `10m` | Avoids reloading between turns |
| `MAX_AGENT_STEPS` | `12` | Stops runaway loops |
| `MAX_CONTEXT_MESSAGES` | `16` | Sends only recent history |
| `MAX_CONTEXT_CHARS` | `16000` | Hard character budget |
| `MAX_MEMORY_CHARS` | `6000` | Caps memory in the prompt |
| `KEEP_RECENT_MESSAGES` | `8` | Verbatim window after compaction |
| `MAX_SUBAGENT_STEPS` | `8` | Child budget |
| `MAX_SUBAGENTS_PER_TURN` | `2` | Delegation cap |
| `MAX_SUBAGENT_RUN_MS` | `300000` | Child timeout |

Qwen3 thinking mode is disabled (`think: false`). A `SerializedLlmAdapter` funnels every decision and compaction request through one promise chain, so parent and child never infer at the same time.

## Configuration

All settings are optional environment variables; see `.env.example`.

| Variable | Default |
| --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `qwen3:8b` |
| `OLLAMA_NUM_CTX` | `8192` |
| `OLLAMA_NUM_PREDICT` | `1024` |
| `OLLAMA_TEMPERATURE` | `0.2` |
| `OLLAMA_TOP_P` | `0.9` |
| `OLLAMA_KEEP_ALIVE` | `10m` |
| `OLLAMA_TIMEOUT_MS` | `180000` |
| `MAX_AGENT_STEPS` | `12` |
| `MAX_CONTEXT_MESSAGES` | `16` |
| `MAX_CONTEXT_CHARS` | `16000` |
| `MAX_OBSERVATION_CHARS` | `4000` |
| `MAX_MEMORY_CHARS` | `6000` |
| `MAX_SKILL_INDEX_CHARS` | `2500` |
| `KEEP_RECENT_MESSAGES` | `8` |
| `MEMORY_AUTO_CAPTURE` | `true` |
| `AGENT_HOME` | `./.agent-home` |
| `AGENT_PROFILE` | `assistant` |
| `WORKSPACE_DIR` | `./sandbox` |
| `SANDBOX_DIR` | legacy alias for `WORKSPACE_DIR` |
| `MAX_SUBAGENT_STEPS` | `8` |
| `MAX_SUBAGENT_DEPTH` | `1` |
| `MAX_SUBAGENTS_PER_TURN` | `2` |
| `MAX_SUBAGENT_RUN_MS` | `300000` |

## Scripts

```bash
npm start         # run the CLI
npm run dev       # run with file watching
npm run typecheck # TypeScript, no emit
npm test          # 71 unit/integration tests via node:test + tsx
npm run build     # compile to out/
npm run start:prod
```

The suite covers path policy, sandbox escapes, profile/skill parsing, Markdown memory and retrieval, context assembly, compaction, decision parsing, the agent loop, dispatcher permission checks, serialized inference, session v1→v2 compatibility, audit redaction, and sub-agent isolation/depth limits.

## Deferred roadmap

Phases 3–5 build on these boundaries: approval-gated shell/network tools, web research, cron/heartbeat and standing-order automation, channels/nodes, optional sandboxed execution, embeddings, and a UI. The Gateway-style control plane and browser automation are intentionally out of scope for now.
