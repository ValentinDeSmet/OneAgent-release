# Local knowledge and search

OneAgent keeps entity knowledge in Markdown files under `wiki/`. SQLite stores the relationships, tasks, observations, evidence and a full-text search index. Search and capture indexing run locally without oMLX or a separate embedding model.

## Search

Enter words from a page, capture, entity name or observation. OneAgent searches the indexed source chunks and shows their citations. Search planes let you distinguish accepted observations, provisional signals, active sources and history.

Full-text search works best with distinctive words, names and terms used in the source. Similar ideas written with entirely different wording may not match automatically. Follow entity links and use an agent Context Pack to explore the surrounding work.

## Existing installations

The first start after updating backs up the SQLite database, wiki and captures under `.work-memory/backups/knowledge-…/`. Existing entity pages are preserved; missing pages are created. Original source text without a remaining file is recovered from SQLite chunks under `wiki/imported-sources/`.

Open **Settings → Diagnose** to see the source and chunk counts. No embedding backend or model setup is required.

## Optional language-model analysis

**Analyze** and automated curation can use the language model selected in VS Code. Its data handling depends on that provider and your organization's policy. Saving a manual note does not start Analyze.

See [Troubleshooting](troubleshooting.md) for indexing errors.
