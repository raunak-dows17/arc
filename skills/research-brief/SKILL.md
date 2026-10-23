---
name: research-brief
description: Produce a decision-ready brief from local notes and workspace files, separating evidence from inference.
whenToUse: The user asks for research, a comparison, or a recommendation based on existing material.
agents: "*"
tools:
  - memory_search
  - memory_get
  - list_files
  - read_file
  - run_agent
---

# Research brief

1. Restate the question as one decision the user needs to make.
2. Search memory and list the workspace before reading broadly. Read only files that can change the answer.
3. Separate:
   - **Evidence** — direct quotes or concrete facts with file paths.
   - **Inference** — your interpretation, clearly labelled.
   - **Unknowns** — what would need external research or user input.
4. Give a recommendation with the strongest counterargument.
5. If the question is large and self-contained, delegate a read-only slice to the `researcher` sub-agent. Do not delegate more than one slice per turn.

Keep the brief under 600 words unless the user asks for depth.
