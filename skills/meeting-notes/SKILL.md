---
name: meeting-notes
description: Convert a transcript or rough notes into decisions, owners, deadlines, and follow-up actions.
whenToUse: The user provides meeting notes, a call transcript, or asks to extract action items.
agents: "*"
tools:
  - memory_search
  - remember
  - write_file
---

# Meeting notes

Extract, in this order:

1. **Context** — one sentence: who met and why.
2. **Decisions** — final decisions only, with the rationale if stated.
3. **Actions** — each with an owner and a deadline; write "unassigned" or "no date" when absent.
4. **Open questions** — unresolved items that need another conversation.
5. **Risks** — only concrete risks mentioned or directly implied.

Rules:

- Never invent an owner or date.
- Keep names and project names exactly as written.
- If asked to save the result, write a Markdown file in the workspace and report the path.
- Save durable decisions with `remember` only when the user asks for that.
