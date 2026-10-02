# Start using OneAgent

This guide starts after OneAgent is installed. You only need an open folder in Visual Studio Code; no command line is required.

## Open your workspace

1. In Visual Studio Code, choose **File → Open Folder…**.
2. Select the folder that contains the work you want OneAgent to remember.
3. Click the **OneAgent** icon in the left activity bar.

By default, OneAgent keeps a separate local memory for each workspace. The first time it opens, it prepares that memory automatically.

To use an existing memory across several product repositories, set **OneAgent: Config Path** in VS Code **User Settings** to its absolute configuration path, then reload the window. Your notes and graph stay in that shared memory while the open folder identifies the product you are working on. This does not move or merge existing memories.

## Ask for help from VS Code Chat

Open VS Code Chat and select the OneAgent participant with `@memory`.

- Send `@memory /oneagent-help` to see the available guides.
- Add a question to receive an answer grounded in the bundled guides, for example:

  `@memory /oneagent-help How do I ingest a document from chat?`

The response includes a button that opens the most relevant guide directly inside OneAgent. This help command reads the documentation shipped with the extension; it does not need to search your workspace memory.

## Know the main screens

- **Today** shows work and information that need attention.
- **Memory graph** shows entities and how they are related.
- **Tasks** is your linked work list.
- **Notes** keeps manual thoughts and open questions.
- **Inbox** holds information and changes that need your review.
- **Sources** shows saved captures and indexed documents.
- **Settings** shows health, configuration, and common actions.

## Save something useful

Choose the action that matches your need:

- For a quick thought or question, open **Notes**, select **+ Note**, link an entity, and save.
- For an action, open **Tasks** and select **Add task**.
- For a meeting summary, document, feedback, or larger piece of information, open **Settings → Quick actions → Capture memory**.
- To capture without leaving VS Code Chat, use `@memory /ingest` with pasted text, an attached file, selected editor text, or the open document.

Linking an entity is important. It tells OneAgent what the item concerns and makes entity filters and focused searches useful later.

## Check that it worked

- A note appears in **Notes**.
- A task appears in **Tasks**.
- A capture appears in **Sources** with its indexing status.
- The linked entity can show the new item in its detail panel.

Use the refresh button at the bottom of the OneAgent navigation bar if a recent change is not visible yet.

## A good first session

1. Add or confirm the main entities you work with.
2. Save one note or question.
3. Create one linked task.
4. Capture one useful document or summary.
5. Open **Today** to see what OneAgent brings together.

Next: [learn how a capture becomes trusted knowledge](capture-and-ingestion.md), or [understand entities and the graph](entities-and-graph.md).

## Private memory and product repositories

Linked repositories are reference sources. Accepting a wiki proposal writes and indexes the page in your private memory; it no longer copies the page into a product repository. Adding a product does not generate wiki or BMAD folders in the linked clone. Existing projected files remain unchanged for explicit review.

The legacy wiki `sync` action is blocked. The development CLI can prepare, verify and restore a structured private archive with `memory export-private`, `memory verify-private` and `memory restore-private`; retention of cited evidence and Context Pack history is explicit. A future private backup repository is configured separately from products, and is never selected from entity links. The development CLI command `memory destinations` inspects these bindings without changing them. The development CLI also provides `memory preview-private` and `memory publish-private`: publication requires a verified private GitHub destination and the exact reviewed digest. This is explicit CLI functionality, with no automatic sync or extension UI action. Local recovery backups remain available and are not intended for Git publication.

### External reference indexing (development CLI)

`reindex --entity repository:<id> --include bmad --branch main --json` selects a reference branch on its first successful scan. Later scans reuse that choice. The index retains historical citations, records Git provenance and local drafts, and marks confirmed missing documents without deleting their evidence. A failed or incomplete scan retains the previous index. Existing repository maintenance surfaces report a reindex failure until the initial branch is selected; this increment does not change their Git update policy. These changes are available in source and are not installed by editing the repository.
