# Graph views

A Graph View is a saved visual preset. It remembers how you filtered and arranged the graph for a topic, meeting, review, or recurring activity.

## Build a useful view

1. Open **Memory graph**.
2. Choose a perspective:
   - **Overview** for the wider graph;
   - **Focus** for the area around one entity;
   - **Dependencies** for a product and connected products.
3. Search for a node or adjust the entity and relationship filters.
4. Choose whether hidden nodes disappear or remain faded.
5. Optionally change the layout, grouping, focus level, or pinned nodes.
6. Select **＋** beside **View: none** and give the view a clear name.

When you change a saved view, a dot shows that it has unsaved changes. Use **✓** to update it, or **＋** to save the changes as another view. The other controls let you rename, duplicate, compare, or delete it.

## Graph View, Active Context, and Context Pack

These three objects have different jobs:

| Item | What it does | Does it constrain the agent? |
| --- | --- | --- |
| **Graph View** | Saves what you see: filters, perspective, focus, and visual context choices. | No, not by itself. |
| **Active Context** | Defines the live entities and policies the agent should follow. | Yes in guided or strict mode. |
| **Context Pack** | Selects and records the concrete information prepared for one objective. | It is the payload produced inside the active boundary. |

A Graph View can store a context draft. The draft only affects the agent after you select **Activate view** or **Activate draft**.

## Use visible nodes as a starting point

Switch from **Navigate** to **Context**, open the context panel, and select **Use visible nodes**. Review the selected entities and policies before activating them. Visible nodes are a convenient starting point, not an automatic security boundary.

Next: [manage the Active Context](active-context.md) or [prepare a Context Pack](context-packs.md).
