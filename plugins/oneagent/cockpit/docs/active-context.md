# Manage the agent context

The Active Context tells OneAgent which part of memory matters for agent work. It starts from selected entities, expands through allowed relationships and depth, then applies policies such as dates and source access.

## Create a context

1. Open **Memory graph**.
2. Switch from **Navigate** to **Context**.
3. Click nodes to include them, or select **Use visible nodes**.
4. Review the selected entities in the context panel.
5. Choose a mode, depth, and source access.
6. Select **Activate draft** or **Activate view**.

If you change the draft after activation, activate it again. Until then, the previous context remains active.

## Choose the right mode

- **disabled**: the selection has no effect on agent work. Use this for unrestricted workspace memory.
- **guided**: the agent prefers the selected area. It may use relevant information outside it, but must identify that information as outside the context.
- **strict**: the selection is a hard boundary. Reads and changes outside it are blocked, and the agent must say when the permitted information is insufficient.

Start with **guided** for exploration. Use **strict** when isolation matters, such as work limited to one customer, product, confidential topic, or approval boundary.

## Choose source access

Source access matters most in strict mode:

- **none**: do not expose source documents or source text;
- **metadata**: allow details such as source title and status, but not its text;
- **snippets**: allow relevant excerpts with provenance;
- **full**: allow complete in-scope source content when needed.

Analysis and evidence review normally need **snippets** or **full**. If a strict context uses **none** or **metadata**, OneAgent may correctly refuse a content-based action.

## Other useful policies

- **Depth** controls how many graph-neighbor levels can be included.
- **Allowed relations** limits which links may expand the context.
- **From / To** limits information by date.
- **Observation validation** and **Evidence status** filter the quality of included knowledge.
- **Token budget** limits how much can be prepared for the agent.
- **Refresh policy** controls whether a view is frozen, monitored for suggestions, or dynamically recalculated.

## The important distinction

A [Graph View](graph-views.md) is a reusable visual preset. The **Active Context** is the live behavioral policy. A [Context Pack](context-packs.md) is a versioned selection of actual content prepared for one objective inside that policy.

If strict mode hides an expected item, check the selected entity, depth, allowed relationships, date range, and source access before widening the boundary.
