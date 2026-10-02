# Analyze and Inbox

Analyze asks an agent to interpret saved source material. Inbox is the human review step that prevents suggestions from silently becoming trusted knowledge or graph changes.

## What Analyze does

For a note or capture, analysis can propose sourced information such as:

- a factual claim or insight;
- a decision;
- an open question;
- a task or feature request;
- a risk, metric, or relationship.

Each item should include an exact source excerpt. Analysis does not rewrite the original source.

Regular captures may be analyzed automatically when automatic curation is enabled. Notes are only analyzed when you select **Analyze note**.

## Review sourced information

1. Open **Inbox**.
2. Select a sourced-information package.
3. Compare each interpretation with its exact evidence.
4. Check the information type and linked entity.
5. Accept, reject, edit, or select several items for a batch action.

For an already accepted item, editing creates a proposed correction so the reviewed version remains auditable. Merge requires a reason. Rejection can include instructions when you want the agent to try again.

Accepted information enriches an existing entity when one is selected. It does not create an entity or relationship.

## Review change proposals

Inbox can also contain graph or wiki proposals. These are separate from sourced information:

- inspect the proposed change and its evidence;
- use **Preview graph** or another preview when available;
- accept only if the target and effect are correct;
- reject with clear correction instructions when needed.

A wiki page is optional. OneAgent should suggest one only when a durable synthesis is useful and accepted evidence supports it.

## Understand the history

Reviewed, rejected, corrected, and superseded items remain available for provenance. Stale evidence is clearly marked and cannot be newly accepted as current.

If analysis fails, the saved note or capture remains intact. Check [Troubleshooting](troubleshooting.md), then run **Analyze note**, **Curate**, or **Curate Pending Captures** again.

For the earlier steps, see [From capture to trusted knowledge](capture-and-ingestion.md).
