# Local Autonomous Agent

A local-first autonomous agent CLI powered by **Ollama** and **`qwen3:8b`**, written in TypeScript with clean architecture. The agent runs a tool-use loop inside an interactive REPL and can only read or write files inside its own `sandbox/` directory.

Tuned for a **16 GB RAM** machine, with `qwen3:8b` as the recommended maximum model size.

## Requirements

- Node.js 20+ (tested on Node 26)
- [Ollama](https://ollama.com) running locally
- The Qwen3 8B model:

```bash
ollama pull qwen3:8b
ollama serve        # if it is not already running
```

8B is the ceiling for this setup. Do not switch to 14B+ models on 16 GB RAM; the default context size and `keep_alive` assume an 8B model.

## Setup

```bash
npm install
npm start
```

That's it — the defaults work without a `.env` file. To customise, copy the sample config:

```bash
cp .env.example .env
```

## Usage

```
  Local Autonomous Agent
  model    qwen3:8b
  sandbox  /path/to/project/sandbox
  session  20261023T073234Z-78c8f509 (resumed)
  /help for commands · Ctrl+C cancels a running turn · Ctrl+D exits

› create notes/haiku.md with a haiku about local models, then read it back

  ◆ I'll write the file first.
  → write_file {"path":"notes/haiku.md","content":"..."}
  ✓ Wrote 73 bytes to "notes/haiku.md".
  ◆ Now I'll read it back.
  → read_file {"path":"notes/haiku.md"}
  ✓ "notes/haiku.md" (lines 1-3 of 3): 1 | ...
  ◆ Done.

  final
  I created notes/haiku.md with the haiku you asked for.
```

Anything that does not start with `/` is sent to the agent as a task.

### Commands

| Command     | Description                          |
| ----------- | ------------------------------------ |
| `/help`     | Show help                            |
| `/new`      | Start a new, empty session           |
| `/sessions` | List saved sessions                  |
| `/history`  | Show the last 20 messages            |
| `/tools`    | List available tools                 |
| `/sandbox`  | Show the sandbox root and contents   |
| `/model`    | Show the configured model            |
| `/exit`     | Quit (Ctrl+D also works)             |

Ctrl+C cancels the running agent turn without exiting the CLI. Press it twice on an idle prompt to exit.

### Sessions

Each launch resumes the most recently updated session. Transcripts are saved after every turn to:

```
sandbox/.agent/sessions/<timestamp>-<id>.json
```

The `.agent` directory is hidden from agent tools. `/new` starts a fresh session; old transcripts remain available via `/sessions`.

## Tools

The first version deliberately ships a small, safe tool surface:

| Tool          | Description                                                       |
| ------------- | ----------------------------------------------------------------- |
| `list_files`  | List one sandbox directory (use `.` for the root)                 |
| `read_file`   | Read a text file with line numbers and optional line ranges       |
| `write_file`  | Create/overwrite a complete text file; parent dirs are created    |

There is no shell execution, delete, web search, or network tool.

## Sandbox guarantees

- Root defaults to `./sandbox` and is created on startup.
- Absolute paths and `..` escapes are rejected.
- Symbolic-link escapes are detected with a realpath check.
- The reserved `.agent` state directory is blocked.
- Reads are capped at 256 KB, writes at 1 MB, and listings at 500 entries.

## Architecture

```
src/
  domain/                     # pure entities, value objects, ports, errors
    entities/agent-session.ts
    value-objects/agent-decision.ts, tool-call.ts
    ports/llm.port.ts, tool.port.ts, sandbox.port.ts, session-store.port.ts
  application/                # use cases + application services
    usecases/run-agent-turn.usecase.ts
    usecases/execute-tool.usecase.ts
    services/tool-registry.ts, context-builder.ts, system-prompt.ts
  infrastructure/             # Ollama, filesystem sandbox, tools, JSON store, CLI
    llm/ollama.adapter.ts, decision.schema.ts
    sandbox/node-fs-sandbox.adapter.ts
    tools/*.tool.ts
    persistence/json-session.store.ts
    cli/repl.ts, terminal.renderer.ts
    config/env.ts
  shared/                     # small cross-cutting helpers
  main.ts                     # composition root
```

Dependency direction is inward only. The domain has no Node.js, filesystem, network, or CLI imports. The application layer depends on ports; the infrastructure layer implements them.

### Agent loop

1. The user prompt is appended to the session.
2. The model receives a system prompt, the recent (trimmed) transcript, and the tool catalogue.
3. Ollama is asked for a **constrained JSON decision**:

   ```json
   { "thought": "...", "tool": { "name": "read_file", "args": {} }, "final": null }
   ```

   or

   ```json
   { "thought": "...", "tool": null, "final": "the answer" }
   ```

4. The JSON schema uses two mutually exclusive `anyOf` shapes, so the grammar prevents the model from setting both `tool` and `final`.
5. Invalid JSON gets one automatic retry with the parse error attached; then the turn fails gracefully.
6. A tool call is validated and executed; its result is added as an observation and the loop continues.
7. Safety: max 12 steps, consecutive duplicate calls are blocked, Ctrl+C aborts the request, and observations are truncated.

## 16 GB tuning

| Setting               | Default | Why                                                     |
| --------------------- | ------- | ------------------------------------------------------- |
| `OLLAMA_MODEL`        | `qwen3:8b` | Fits comfortably alongside the OS on 16 GB          |
| `OLLAMA_NUM_CTX`      | `8192`  | Bounded KV cache; enough for the trimmed transcript      |
| `OLLAMA_TEMPERATURE`  | `0.2`   | Less drift in the decision protocol                      |
| `OLLAMA_KEEP_ALIVE`   | `10m`   | Avoids reloading the model between turns                 |
| `MAX_AGENT_STEPS`     | `12`    | Stops runaway loops                                      |
| `MAX_CONTEXT_MESSAGES`| `16`    | Only recent history is sent to the model                 |
| `MAX_CONTEXT_CHARS`   | `16000` | Hard character budget for the transcript                 |

Qwen3 thinking mode is disabled (`think: false`) because it is slow and consumes context. Only one model request runs at a time — important once sub-agents share the same Ollama instance.

Startup checks `/api/tags`, reports an install command if `qwen3:8b` is missing, and warns if the selected model is larger than 9 GB.

## Configuration

All settings are optional environment variables; see `.env.example`.

| Variable               | Default                  |
| ---------------------- | ------------------------ |
| `OLLAMA_BASE_URL`      | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL`         | `qwen3:8b`               |
| `OLLAMA_NUM_CTX`       | `8192`                   |
| `OLLAMA_TEMPERATURE`   | `0.2`                    |
| `OLLAMA_TOP_P`         | `0.9`                    |
| `OLLAMA_KEEP_ALIVE`    | `10m`                    |
| `OLLAMA_TIMEOUT_MS`    | `180000`                 |
| `MAX_AGENT_STEPS`      | `12`                     |
| `MAX_CONTEXT_MESSAGES` | `16`                     |
| `MAX_CONTEXT_CHARS`    | `16000`                  |
| `MAX_OBSERVATION_CHARS`| `4000`                   |
| `SANDBOX_DIR`          | `./sandbox`              |

## Scripts

```bash
npm start         # run the CLI
npm run dev       # run with file watching
npm run typecheck # TypeScript, no emit
npm test          # unit tests (node:test via tsx)
npm run build     # compile to out/
npm run start:prod
```

Tests cover the sandbox path jail (traversal, absolute paths, symlinks, reserved state), tool argument validation and file tools, decision parsing/retries, the agent loop (tool then final, max steps, duplicate calls, abort), context trimming, and session persistence.

## Roadmap: sub-agents

The boundaries are in place for a multi-agent phase:

- `LLMPort` and `ToolPort` are independent of Ollama and the filesystem.
- `RunAgentTurnUseCase` is a reusable worker loop.
- Sessions already persist structured transcripts.
- The sandbox is a shared, path-jailed resource.

A future orchestrator can expose a `run_agent` tool whose handler starts a worker session with a role-specific system prompt and a restricted tool subset. To stay within 16 GB, workers should run **sequentially against the single loaded model** rather than in parallel.

## Troubleshooting

**`Could not reach Ollama at ...`**
Start Ollama with `ollama serve` and confirm `curl http://127.0.0.1:11434/api/tags` works.

**`Model "qwen3:8b" is not installed`**
Run `ollama pull qwen3:8b`.

**The model loops or ignores the protocol**
Lower `OLLAMA_TEMPERATURE`, keep the tool set small, and prefer concrete tasks. The constrained JSON grammar plus the duplicate-call guard handle most local-model failure modes.

**Slow responses**
Confirm `OLLAMA_MODEL` is `qwen3:8b`, keep `OLLAMA_NUM_CTX` at 8192 or lower, and avoid running other large local models at the same time.
