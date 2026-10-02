# From capture to trusted knowledge

OneAgent separates saving information from trusting an interpretation of it. This keeps the original material intact and lets you review what the agent understood.

## The complete journey

### 1. You capture the information

You can use the OneAgent form or capture directly from VS Code Chat.

With the form, open **Settings → Quick actions → Capture memory**. Add:

- a content type, such as meeting, feedback, decision, risk, or document;
- a title;
- one primary entity: the main person, team, product, project, or other subject;
- optional related entities and their relationship;
- the original text.

Choose the primary entity you would look under later. Related entities add useful connections without changing the main subject.

## Capture directly from VS Code Chat

Open VS Code Chat and use the OneAgent participant with `@memory /ingest`. The full command is useful when starting a new conversation. If `@memory` is already selected for the current conversation, you can type `/ingest` directly.

Choose the shortcut that matches what you want to save:

### Paste text

Type the command followed by the original text:

```text
@memory /ingest The checkout review raised a question about guest payment support.
```

OneAgent uses a Markdown heading as the capture title when one is available; otherwise, it uses the first non-empty line. Keep the original wording when the exact source matters.

### Attach one or more files

1. Type `@memory /ingest`.
2. Type `#file` and select a file, or use the Chat attachment control.
3. Repeat the attachment step if you have more files.
4. Send the message.

Each attached file becomes its own capture. If files are attached, they are the content OneAgent captures; use a separate message when you also want to capture pasted text.

### Capture selected text from the editor

1. Select the passage in the open editor.
2. Open VS Code Chat without closing the document.
3. Send `@memory /ingest` with no text or file attached.

Only the selected passage is captured.

### Capture the entire open document

1. Open the document and clear any text selection.
2. Open VS Code Chat.
3. Send `@memory /ingest` with no text or file attached.

OneAgent captures the complete open document. If no text, attachment, selection, or readable document is available, it asks you to provide content and does not create an empty capture.

### What the chat command does

The chat shortcut follows the same trusted ingestion journey as the form:

1. it saves the original content as a local capture;
2. it indexes the capture for search;
3. it tries to extract sourced suggestions;
4. it places those suggestions in **Inbox** for human review.

The chat reports the capture identifier when it finishes. If suggestion extraction cannot finish, the original capture remains saved and indexed; you can resume its curation later from OneAgent.

Your [Active Context](active-context.md) also applies:

- in **guided** mode, the selected context guides organization and search without creating a hard boundary;
- in **strict** mode, OneAgent asks you to choose an in-scope primary entity. Strict ingestion requires source access set to **snippets** or **full**.

If you need a reminder while you are in Chat, ask:

`@memory /oneagent-help How can I ingest content from chat?`

OneAgent answers from its bundled guides and provides a button that opens this guide directly.

### 2. OneAgent saves the original locally

The capture is written as a Markdown file in the workspace's private OneAgent area. That file is the source of truth: OneAgent does not replace your original text with an AI summary.

### 3. OneAgent indexes the text

The text is divided into useful passages and added to the local SQLite full-text index. The capture then appears in **Sources**.

Common indexing statuses are:

- **indexed**: ready for search;
- **indexing**: still being processed;
- **failed**: the original is safe, but indexing must be retried;
- **stale**: the saved classification or content changed and the search copy needs refreshing.

### 4. Analysis extracts suggestions

Analysis can identify sourced information such as a decision, risk, question, task, insight, or feature request. Each suggestion keeps an exact excerpt from the capture.

Regular captures may be analyzed automatically when automatic curation is enabled. Manual notes are different: saving a note never analyzes it automatically; use **Analyze note** only when you want suggestions.

If analysis is unavailable, the capture still remains saved. It can be analyzed later.

### 5. You review the result

Open **Inbox** and select the sourced-information package. Check:

- the proposed interpretation;
- the entity it would enrich;
- the exact source excerpt;
- its confidence and evidence status.

You can accept, reject, edit, propose a correction, or merge selected information. Nothing becomes trusted knowledge merely because the agent suggested it.

### 6. Accepted information becomes trusted memory

Accepted information becomes available to entity detail, search, graph context, and Context Packs. Rejected and superseded information stays in history for audit, but is not treated as current knowledge.

A graph change or wiki page is a separate decision. Accepting sourced information does not silently create an entity, relation, or document.

## What happens when you edit a capture

OneAgent saves the new Markdown and indexes it again. If the body, content type, or primary entity changes, interpretations tied to the old version are made stale or superseded. They remain visible in history, and the new version can be analyzed again.

## If processing fails

Do not capture the same material again. Open **Sources**, read the status, fix the reported problem, and use **Reingest**. For several failed captures, use **Settings → Runtime actions → Reingest failed**.

See [Analyze and Inbox](analyze-and-inbox.md) for the review workflow and [Local knowledge and search](local-ai-and-embeddings.md) for indexing.
