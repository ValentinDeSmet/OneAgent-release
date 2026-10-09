# Context Packs

A Context Pack is the concrete information OneAgent prepares for one agent objective. It is versioned, bounded, and traceable to its sources.

## Prepare a pack

1. Build and activate an [Active Context](active-context.md).
2. In the graph context panel, describe the objective, for example:
   - “Prepare the checkout redesign review.”
   - “Summarize open risks before the steering meeting.”
   - “Draft the next implementation plan.”
3. Select **Prepare pack**.
4. Check the entity, source, observation, task, Inbox, and token counts.

OneAgent ranks relevant material within the active boundary, removes duplicates, respects source-access rules, and records provenance.

## Why the objective matters

The same Active Context can produce different packs. A meeting brief may favor decisions and open questions, while an implementation plan may favor specifications, risks, and tasks.

Preparing a new pack does not alter the graph or accept any suggestion.

## Versions and history

Each prepared pack is a snapshot with its own version. History helps you see what the agent received at a particular time.

Prepare a new pack when:

- the objective changes;
- the Active Context changes;
- important memory was added or reviewed;
- the panel reports that the selected pack is outdated.

Do not treat an old pack as automatically current. It preserves provenance; it does not silently absorb later changes.

## Context Pack compared with nearby concepts

- A **Graph View** remembers the visual setup.
- The **Active Context** defines the live boundary and policies.
- A **Context Pack** contains the actual selected information for one request.

You can reuse one Graph View, activate its context, and prepare several Context Packs for different objectives.

See [Graph views](graph-views.md) for visual presets and [Manage the agent context](active-context.md) for guided and strict boundaries.

## Automatic budget and complete document reads

New contexts default to automatic budgeting (0). OneAgent selects content for the
objective and adapts delivery to the model input capacity when the host exposes
it. A manual positive budget remains available. A pack is a selection, never an
access limit on the remaining documents. Copilot applications may have their own
transport and context limits; OneAgent does not force a one-million-token window.

Copilot tools `oneagent_list_memory` and `oneagent_read_document` discover and read
Markdown by catalogue ID. `oneagent_read_source` and `oneagent_read_note` also
return `nextOffset`, `totalChars` and `revision`. Continue with that offset and
revision until `nextOffset` is null. A changed document rejects a stale cursor.
VS Code exposes the same discovery and continuation through `workMemoryExpand`.
