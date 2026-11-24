import { runMemoryCommand } from './cli-bridge.ts';
import { careerOperations, careerSections } from '../../impact/src/career.ts';

const deleteOperations = ['interview-delete', 'contribution-delete'] as const;
const editOperations = careerOperations.filter((operation) => !(deleteOperations as readonly string[]).includes(operation));
const sectionKeys = Object.entries(careerSections).map(([key, title]) => `${key} (${title})`).join(', ');

/** Exact payloads, so the agent can create and fill every element without guessing field names. */
const inputReference = [
  'Operation payload (scope is added for you). Dates are YYYY-MM-DD. Every write after a read needs the revision returned by list (or by the previous write) for that document; a stale revision is refused, re-read with list and retry. New IDs are generated; keep existing IDs on edits.',
  'list: {} → missions (with goals, results and current measures), interviews (newest first) and existingMissions.',
  'mission-save: {mission:{id?, label, year, periodStart, periodEnd, role, perimeter, manager, functionalManager, description, additionalRole, goals:[{id?, title, why, actions, priority: must_win|important|complementary, status: draft|active|at_risk|off_track|achieved|closed, results:[{id?, title, unit, baseline, target, direction: increase|decrease|target, dueDate, status: not_started|on_track|at_risk|off_track|achieved, comment}]}]}, revision?}. Creates the mission without id; with id, only the given fields change, but goals (when given) is the complete list: a goal left out is closed.',
  'mission-version: {missionId, revision, periodStart, perimeter, reason} → closes the current scope the day before and keeps it in history (role or scope change).',
  'measure: {missionId, revision, resultId, value, date?, sourceUrl?, note?} → dated KPI measure of a key result (never in the future).',
  'contribution-save: {missionId, revision, contribution:{id?, title, description, impact, date, origin: outside|planned, objectiveId?, ref?, links:[https URLs]}} → achievement inside or OUTSIDE the mission; with an existing id it is replaced.',
  'interview-create: {missionId, date, periodStart?, periodEnd?, title?, id?} → draft EI holding the mission version applicable at that date, its measures as of periodEnd, the decisions of the previous realized EI and the contributions of the period.',
  `interview-save: {missionId, interviewId, revision, interview:{title?, date?, periodStart?, periodEnd?, status: draft|ready|realized, sections:{${sectionKeys}}, objectiveReviews:[{objectiveId, achievements, obstacles, comment}], decisions:[{id?, title, state: open|in_progress|done|postponed|abandoned, comment, deadline, objectiveId}], contributions:[contribution]}}. Give the complete sections object and lists. objectiveId values come from interview.missionSnapshot.goals. Setting status realized freezes the EI.`,
  'interview-reopen: {missionId, interviewId, revision} → back to draft, keeping a dated copy of the realized version. interview-refresh: {missionId, interviewId, revision} → updates the measures of a draft EI.',
  'decision-task: {missionId, interviewId, revision, decisionId} → creates a task for that decision, only when the user asks.',
  'context: {missionId, interviewId?, purpose?: bilan} → mission, EI and dated notes/tasks of the period as evidence for drafting.',
  'bilan: {year, missionId?, from?, to?, includeDrafts?} → computed annual summary and Markdown draft. bilan-save: {missionId, year, text, revision?} → saves the annual bilan text.',
  'Importing past EIs: save the mission first, then create and fill each EI in chronological order (oldest first) so each one carries the decisions of the previous; set status realized last. Copy the user\'s own words into the sections; never invent feelings, KPI values or manager feedback.'
].join('\n');

const schema = (operations: readonly string[], input: string) => ({
  type: 'object', additionalProperties: false,
  properties: { scope: { type: 'string', enum: ['portfolio'] }, operation: { type: 'string', enum: [...operations] }, input: { type: 'object', description: input } },
  required: ['scope', 'operation', 'input']
});
export const careerToolSchema = schema(editOperations, inputReference);

export const careerTools = [
  { name: 'oneagent_career', description: 'Create, read and edit the private annual mission (goals, key results, dated scope versions, KPI measures), individual interviews (EI: create, fill every section, objective reviews, decisions, contributions, mark realized, reopen), contributions inside or OUTSIDE the mission with their impact and evidence, and the annual bilan. Use it to import past EIs at the user\'s request. Realized interviews hold immutable mission/metric snapshots; reopen explicitly for corrections. context returns evidence for drafting; propose generated text to the user before saving it. Ordinary decisions become tasks only via decision-task at user request and never become priorities automatically. mission-version preserves the previous scope; do not overwrite history after a role change. Deleting an EI or a contribution uses oneagent_career_delete. Require portfolio and respect the active strict context. No sharing or HR submission.', inputSchema: careerToolSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: 'oneagent_career_delete', description: 'At the user\'s explicit request, permanently delete an individual interview (EI) or a contribution, for example one imported by mistake. Tasks created from an EI decision stay. Confirm the exact item (title, date) with the user first; irreversible. Require portfolio and respect the active strict context.', inputSchema: schema(deleteOperations, 'interview-delete: {missionId, interviewId, revision}. contribution-delete: {missionId, revision, contributionId} (revision of the mission, from list).'), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }
];

export async function callCareerTool(configPath: string, name: string, raw: unknown) {
  const tool = careerTools.find((candidate) => candidate.name === name);
  if (!tool || !raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Outil de mission invalide.');
  const v = raw as Record<string, unknown>;
  const allowed = tool.inputSchema.properties.operation.enum;
  if (v.scope !== 'portfolio' || typeof v.operation !== 'string' || !allowed.includes(v.operation) || !v.input || typeof v.input !== 'object' || Array.isArray(v.input))
    throw new Error('Périmètre, opération et input obligatoires.');
  return runMemoryCommand(configPath, ['career', v.operation, '--stdin', '--json', '--context-scope', 'active'], JSON.stringify({ ...v.input, scope: 'portfolio' }));
}
