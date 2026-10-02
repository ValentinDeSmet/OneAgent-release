# Troubleshooting

Start with **OneAgent → Settings → Runtime actions → Diagnose**. If the message is not enough, select **Open output** to view the detailed OneAgent log.

## OneAgent is missing or blank

1. Confirm that a folder is open in Visual Studio Code.
2. Open **Extensions**, find OneAgent, and confirm it is enabled.
3. Open the Command Palette and run **Developer: Reload Window**.
4. Open OneAgent again and select the refresh button.

## A note or capture is saved but not searchable

The Markdown original remains available even if indexing fails.

1. Open **Sources** and check its indexing status.
2. Select **Reingest** on the capture, or use **Settings → Runtime actions → Reingest failed**.
3. Run **Diagnose** and inspect **OneAgent Output** if indexing still fails.

Do not create a duplicate just to retry processing. No embedding backend is needed.

## Analyze does not start or fails

- Confirm that a language model is available and signed in through Visual Studio Code.
- Make sure a strict context includes the item and permits **snippets** or **full** source access.
- Run Analyze or curation again after fixing the cause.

The original note or capture remains saved when analysis fails.

## Strict Context hides or blocks something

Strict mode is designed to fail closed.

1. Open the graph context panel.
2. Check the selected entities, depth, allowed relations, and date range.
3. Check **Source access**.
4. Activate the edited draft again.

Only widen or clear the boundary when that is genuinely appropriate. Use guided mode for exploration, not as a workaround for a required isolation policy.

## A Context Pack is outdated

Refresh the workspace, reactivate the changed context or view, enter the current objective, and select **Prepare pack** again. Old versions stay available for provenance.

## An update does not install

1. Run **Settings → Check for updates** again.
2. Open **OneAgent Output** and read the latest update message.
3. Check that Visual Studio Code can reach GitHub.
4. If needed, download the latest VSIX from the public release page and install it manually.

See [Updates and what's new](updates-and-whats-new.md).

## Avoid accidental data loss

**Reset test data** is not a repair action. It removes local test memory. Do not use it on a real workspace unless you intentionally want to reset that data.

When asking for help, share the OneAgent version, the action you ran, the exact error, and the relevant lines from **OneAgent Output**.
