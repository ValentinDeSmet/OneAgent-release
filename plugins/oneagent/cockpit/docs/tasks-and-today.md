# Tasks and Today

Tasks record actions. Today brings the most relevant actions, questions, reviews, outcomes, and warnings into one operational screen.

## Create a useful task

1. Open **Tasks** and select **Add task**.
2. Enter a clear action title and optional description.
3. Choose a status: pending, open, in progress, blocked, ready, or done.
4. Choose a priority.
5. Assign it to **me** or **agent**.
6. Add a deadline when time matters.
7. Link the entity or entities the task concerns.

Entity links make the task visible in the right entity workspace and allow focused filtering. Use a precise relationship such as **blocked by**, **needed for**, or **supports** when it adds meaning.

## Organize the task board

Use the linked-entity filter to focus on one or more subjects. You can also group tasks by their linked entities and move their status as work progresses.

- **in progress** means work has started and stays visible in Today;
- **blocked** should explain what prevents progress;
- **ready** means the task can be started;
- **done** removes it from active work without erasing history.

## Follow personal requests in Priorities

Ordinary tasks stay outside **Priorités**, even with a high urgency or a deadline.
The list contains only requests created there and tasks explicitly added to it.
To follow an existing personal task, save any edits in its Tasks detail panel,
then choose **Ajouter aux priorités**. Its existing entity is reused when unambiguous;
otherwise choose an existing entity. This keeps the same task, all its fields and
links. **Retirer des priorités** leaves the underlying task available in Tasks.

Open **Priorités** in the cockpit navigation for a table of subject, description,
primary product, partner products/teams, requester, priority, deadline,
documentation URL, source URL and status. The linked entity appears
under the subject. Every new or edited request needs an existing entity; requests
from earlier versions without one stay visible under **Sans entité · à rattacher**.
A product is optional when the request is attached to a different entity type.

The default **Mon classement** order is shared with Copilot. Drag the ⠿ handle
before or after another row, or focus it and use Arrow Up / Down. Filters hide
rows without replacing the shared order. Column headings cycle ascending,
descending, then back to manual order; **Mon classement** restores it directly.
Dragging is available only in manual order. Newly added rows append once an
order has been established. Rank changes leave all task fields and links intact.

Click any column heading to apply an explicit sort. Open **Filtres par champ**
to combine text, entity, product, requester, priority, date range and URL filters.
The visible product/team filter matches primary or partner involvement. Nature
can show enrolled subjects and tasks, subjects only or tasks only; it never includes
ordinary tasks automatically. Each priority can be reclassified. The editor offers a searchable multi-select
for partners, a separate original Google Sheet URL, and **En cours** for work
that has started. Click the title or **Modifier** to edit any row. An entity that
is itself a product fixes the primary product; change that attachment to replace
it or add other products as partners.

Sorting and filtering cover all results before pagination. The counters follow
the field filters and nature selection. Estimated dates are
never flagged as firm overdue commitments. Open a subject to edit its full details.
The screen follows the cockpit theme and saves the same tasks and graph links.

Ask the agent to create or update a priority using **OneAgent Priorities** tools.
The agent can change every field; edits require the current task ID and revision.
Concurrent changes are reported rather than overwritten. An unknown entity must
be clarified or created through the existing graph workflow.

## Use Today

Open **Today** at the start of a work session. Depending on your workspace, it can show:

- due-soon, overdue, blocked, and agent-assigned tasks;
- open questions and notes marked **Show in Today**;
- Inbox items and contradictions to review;
- Context Views that may need attention;
- missions, OKRs, KPI trends, objectives, and upcoming reviews.

Today follows the active OneAgent context. In strict mode, it only shows permitted work.

## A simple daily routine

1. Refresh **Today**.
2. Resolve one blocked item or open question.
3. Review important Inbox suggestions.
4. Update task status and deadlines.
5. Prepare a fresh Context Pack before a substantial agent session.

See [Notes and questions](notes-and-questions.md) and [Context Packs](context-packs.md).


### Tasks supporting a priority

**Gérer les priorités liées** on a native task opens a choice of priorities to
attach to or detach from. Save the task form first. In Priorities, **Tâches**
opens an accordion with progress counts; create a native task, attach an existing
one, edit it or detach it. The same task can support several priorities and its
progress is shared with Tasks. Attaching never promotes the task itself, and
detaching or removing the parent priority never deletes it.

Priority periods use fixed Q1–Q4 quarter and year dropdowns, while firm dates
use the calendar. Work types are Discovery, technical study, implementation,
validation, documentation, other or unspecified. Work type, quarter and year
have multi-select filters based on the values present in the list. Ambiguous
legacy periods remain available until explicitly converted.
