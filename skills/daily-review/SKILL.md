---
name: daily-review
description: Turn a day of notes and memory into a short review with decisions, open loops, and tomorrow's first action.
whenToUse: The user asks for a daily review, weekly reset, or "what should I focus on".
agents: "*"
tools:
  - memory_search
  - memory_get
  - remember
---

# Daily review

1. Search memory for today's and yesterday's notes (`daily/YYYY-MM-DD.md`) and any open decisions.
2. Read `USER.md` for standing preferences.
3. Summarise only what changed: decisions made, work completed, blockers, and open loops.
4. Choose one concrete first action for tomorrow. Do not produce a long journal.
5. If the user confirms a durable preference or decision, save it with `remember` (long-term) rather than only mentioning it.

Output shape:

- **Wins** (2–4 bullets)
- **Decisions**
- **Open loops**
- **First action tomorrow**

Keep the whole review under 250 words.
