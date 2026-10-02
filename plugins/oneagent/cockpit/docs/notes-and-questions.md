# Notes and questions

Use **Notes** for information you want to keep without preparing a full capture: a thought, a point to clarify, a reminder, or a question that should not be lost.

## Create a note

1. Open **Notes**.
2. Select **+ Note**.
3. Choose **Note** or **Question**.
4. Select the entity the item concerns, or keep **General** and classify it later.
5. Add a title, or leave it empty to use the first line.
6. Write naturally and select **Save note**.

The note is stored locally and indexed for search. Saving it does not start AI analysis.

In VS Code Chat, use `@memory /note Your note text` to save a note immediately under **General**. In Agent mode, ask to save a note in OneAgent Notes; the **Create OneAgent Note** tool can attach it to an existing entity when you specify one. Both paths make the note visible in **Notes** without starting analysis. You can classify it later. A strict context requires full source access; with several selected entities, specify the note's primary entity.

## Bring it back at the right time

- Select **Show in Today** for a note that needs follow-up.
- Open questions appear in **Today** until they are resolved or archived.
- Use **Mark resolved** when a question has an answer.
- Use **Archive** when an item no longer needs attention.
- Use **Restore** to make a resolved or archived item active again.

## Find notes quickly

The Notes toolbar can search the title, text, entity, or tag. You can also filter by:

- type: note or question;
- status: active, resolved, or archived;
- entity.

The entity filter includes notes where that entity is the primary or a related entity.

## Analyze only when useful

Select **Analyze note** when you want OneAgent to extract reviewable decisions, risks, tasks, insights, or other sourced information. The results go to **Inbox**; they are not accepted automatically.

Editing the note later updates its searchable version. If you move it to another entity or change its type, earlier analysis is kept as history but is no longer treated as current.

If saving succeeds but indexing reports a problem, your note is still safe locally. Fix the local search service and reingest it rather than recreating it.

See [Analyze and Inbox](analyze-and-inbox.md) for review and [Tasks and Today](tasks-and-today.md) for daily follow-up.
