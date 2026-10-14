import { indexSourceFile } from '../../source-intake/src/index.ts';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteFile, resolvePhysicalPath, isPathInside, type WorkMemoryConfig } from '../../shared/src/index.ts';
import type { WorkMemoryDatabase } from '../../storage/src/index.ts';
import { globalWikiRoot, withWikiMetadata } from '../../wiki/src/index.ts';
import { upsertOkr, upsertKpi, recordKpiMeasurement, buildOutcomeSnapshot } from './index.ts';
type Obj = Record<string, any>;
export const careerSections = {
    liked: 'Ce que j’ai aimé vivre', lessLiked: 'Ce que j’ai moins aimé vivre', feeling: 'Synthèse de mon ressenti',
    learning: 'Dernières décisions et apprentissages', performance: 'Ma performance', next: 'Mes nouvelles décisions', managerFeedback: 'Après l’entretien'
};
export const careerOperations = ['list', 'mission-save', 'mission-version', 'interview-save', 'interview-create', 'interview-refresh', 'interview-reopen', 'measure', 'contribution-save', 'context', 'bilan', 'bilan-save', 'decision-task'] as const;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function obj(v: unknown): Obj { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Objet attendu.'); return v as Obj; }
function str(v: unknown, name: string, max = 20000, required = false): string {
    if (v === undefined || v === null) {
        if (required)
            throw new Error(`${name} est obligatoire.`);
        return '';
    }
    if (typeof v !== 'string' || v.includes('\0') || v.length > max || required && !v.trim())
        throw new Error(`${name} est invalide.`);
    return v;
}
function id(v: unknown): string { const s = str(v, 'Identifiant', 100, true); if (!/^[a-z0-9][a-z0-9_-]*$/i.test(s))
    throw new Error('Identifiant invalide.'); return s; }
function date(v: unknown, required = false): string { const s = str(v, 'Date', 10, required); if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T12:00:00Z')) || new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) !== s))
    throw new Error('Date invalide.'); return s; }
function choice(v: unknown, values: string[], fallback: string): string { const s = v === undefined ? fallback : str(v, 'Choix', 100); if (!values.includes(s))
    throw new Error(`Choix invalide : ${s}`); return s; }
function list(v: unknown, max = 100): Obj[] { if (v === undefined)
    return []; if (!Array.isArray(v) || v.length > max)
    throw new Error('Liste invalide ou trop longue.'); return v.map(obj); }
function numeric(v: unknown): number | undefined { if (v === undefined || v === null || v === '')
    return undefined; if (typeof v !== 'number' || !Number.isFinite(v))
    throw new Error('Valeur numérique invalide.'); return v; }
function url(v: unknown): string { const s = str(v, 'URL', 2000); if (s && !/^https?:\/\//i.test(s))
    throw new Error('URL HTTP(S) requise.'); if (s)
    new URL(s); return s; }
function unique(rows: Obj[]) { if (new Set(rows.map(r => r.id)).size !== rows.length)
    throw new Error('Identifiants dupliqués.'); return rows; }
function range(from: string, to: string) { if (from && to && from > to)
    throw new Error('La fin de période précède le début.'); }
function result(raw: Obj, missionId: string): Obj {
    const rid = raw.id ? id(raw.id) : randomUUID();
    return { id: rid, title: str(raw.title, 'Résultat clé', 400, true), kpiId: raw.kpiId ? id(raw.kpiId) : `${missionId}-${rid}`,
        unit: str(raw.unit, 'Unité', 60), baseline: numeric(raw.baseline), target: numeric(raw.target), direction: choice(raw.direction, ['increase', 'decrease', 'target'], 'increase'),
        dueDate: date(raw.dueDate), status: choice(raw.status, ['not_started', 'on_track', 'at_risk', 'off_track', 'achieved'], 'not_started'), comment: str(raw.comment, 'Commentaire') };
}
function goals(raw: unknown, missionId: string): Obj[] {
    return unique(list(raw, 50).map(g => ({ id: g.id ? id(g.id) : randomUUID(), okrId: g.okrId ? id(g.okrId) : '', title: str(g.title, 'Objectif', 400, true), why: str(g.why, 'Pourquoi'), actions: str(g.actions, 'Comment'),
        priority: choice(g.priority, ['must_win', 'important', 'complementary'], 'important'), status: choice(g.status, ['draft', 'active', 'at_risk', 'off_track', 'achieved', 'closed'], 'active'),
        results: unique(list(g.results, 20).map(r => result(r, missionId))) })));
}
function contribution(raw: Obj): Obj {
    return { id: raw.id ? id(raw.id) : randomUUID(), title: str(raw.title, 'Réalisation', 400, true), description: str(raw.description, 'Description'), impact: str(raw.impact, 'Impact'), date: date(raw.date || today(), true),
        origin: choice(raw.origin, ['outside', 'planned'], 'outside'), objectiveId: raw.objectiveId ? id(raw.objectiveId) : '', ref: str(raw.ref, 'Référence', 300), links: (raw.links === undefined ? [] : raw.links).map((s: unknown) => url(s)).filter(Boolean) };
}
function decisions(raw: unknown): Obj[] {
    return unique(list(raw, 100).map(d => ({ id: d.id ? id(d.id) : randomUUID(), title: str(d.title, 'Décision', 500, true), state: choice(d.state, ['open', 'in_progress', 'done', 'postponed', 'abandoned'], 'open'),
        comment: str(d.comment, 'Commentaire'), deadline: date(d.deadline), objectiveId: d.objectiveId ? id(d.objectiveId) : '', taskId: d.taskId ? id(d.taskId) : '' })));
}
function location(config: WorkMemoryConfig, missionId: string, name: string): string {
    const root = globalWikiRoot(config), file = path.join(root, 'missions', id(missionId), name);
    if (!isPathInside(resolvePhysicalPath(file), resolvePhysicalPath(root)) || fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink())
        throw new Error('Chemin de mémoire non sûr.');
    return file;
}
function read(file: string): Obj | undefined {
    if (!fs.existsSync(file))
        return;
    const bytes = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(bytes) > 4 * 1024 * 1024)
        throw new Error('Document de mission trop volumineux.');
    const line = bytes.match(/^oneagent_career: (.+)$/m)?.[1];
    if (!line)
        throw new Error('Métadonnées de mission absentes : conserver le document pour diagnostic.');
    const record = obj(JSON.parse(line));
    if (record.schema !== 'career.v1')
        throw new Error('Version de document inconnue.');
    return { ...record, revision: digest(bytes), file };
}
function checked(file: string, revision: unknown): Obj | undefined {
    const current = read(file);
    if (current ? revision !== current.revision : revision !== undefined && revision !== '')
        throw new Error('Ce document a changé. Ton brouillon est conservé ; relis la version actuelle avant de réessayer.');
    return current;
}
const snapshot = (m: Obj) => Object.fromEntries(['id', 'label', 'year', 'version', 'periodStart', 'periodEnd', 'role', 'perimeter', 'manager', 'functionalManager', 'description', 'additionalRole', 'goals', 'measurementSources'].map(k => [k, m[k]]));
function withMeasures(db: WorkMemoryDatabase, m: Obj, asOf?: string): Obj {
    return { ...m, goals: m.goals.map((g: Obj) => ({ ...g, results: g.results.map((r: Obj) => {
                const measurements = db.listKpiMeasurements(r.kpiId, { limit: 10000 }).filter(v => !asOf || v.measuredAt.slice(0, 10) <= asOf).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
                const v = measurements[0];
                return { ...r, currentValue: v?.value, measuredAt: v?.measuredAt, sourceUrl: (v && m.measurementSources?.[v.id]) || '', measurementNote: v?.note || '' };
            }) })) };
}
function markdown(record: Obj): string {
    const m = record.kind === 'mission' ? record : record.missionSnapshot;
    let body = `# ${record.label || record.title}\n\nPériode : ${record.periodStart || ''} → ${record.periodEnd || record.date || ''}\n\n`;
    if (record.kind === 'bilan')
        return withWikiMetadata(`---\noneagent_career: ${JSON.stringify(record)}\n---\n\n${record.text}`, { subject: { kind: 'mission', id: record.missionId }, home: { kind: 'mission', id: record.missionId }, related: [] });
    if (record.kind === 'mission') {
        body += `${m.description || ''}\n\n## Périmètre et rôle\n\n${m.role || ''}\n\n${m.perimeter || ''}\n\n`;
        for (const g of m.goals)
            body += `## ${g.title}\n\n${g.why || ''}\n\nPriorité : ${g.priority} · État : ${g.status}\n\n### Résultats clés\n\n${g.results.map((r: Obj) => `- ${r.title} — cible : ${r.target ?? 'à définir'} ${r.unit || ''}`).join('\n')}\n\n### Comment\n\n${g.actions || ''}\n\n`;
        body += `## Rôle additionnel\n\n${m.additionalRole || ''}\n\n`;
    }
    else {
        for (const [key, title] of Object.entries(careerSections))
            body += `## ${title}\n\n${record.sections[key] || ''}\n\n`;
        body += `## Avancement par objectif\n\n${(record.objectiveReviews || []).map((r: Obj) => `### ${m.goals.find((g: Obj) => g.id === r.objectiveId)?.title || r.objectiveId}\n\nRéalisations : ${r.achievements}\n\nDifficultés : ${r.obstacles}\n\n${r.comment}`).join('\n\n')}\n\n`;
        body += `## Décisions à suivre\n\n${record.decisions.map((d: Obj) => `- ${d.title} — ${d.state}${d.deadline ? ' · ' + d.deadline : ''}\n  ${d.comment || ''}`).join('\n')}\n\n`;
        body += `## Point sur les objectifs\n\n${m.goals.map((g: Obj) => `### ${g.title}\n\n${g.results.map((r: Obj) => `- ${r.title} : ${r.currentValue ?? 'non mesuré'} / ${r.target ?? 'à définir'} ${r.unit || ''} · ${r.measuredAt || 'aucune mesure'}`).join('\n')}`).join('\n\n')}\n\n`;
    }
    const cs = record.unplanned || record.contributions || [];
    body += `## Contributions et réalisations hors mission\n\n${cs.map((c: Obj) => `### ${c.title}\n\n${c.date} · ${c.origin}\n\n${c.description}\n\nImpact : ${c.impact}\n\n${c.links.join('\n')}`).join('\n\n')}\n`;
    return withWikiMetadata(`---\noneagent_career: ${JSON.stringify(record)}\n---\n\n${body}`, { subject: { kind: 'mission', id: record.missionId || record.id }, home: { kind: 'mission', id: record.missionId || record.id }, related: [] });
}
function write(config: WorkMemoryConfig, db: WorkMemoryDatabase, file: string, record: Obj, work?: () => void): Obj {
    const clean = { ...record };
    delete clean.revision;
    delete clean.file;
    clean.schema = 'career.v1';
    clean.updatedAt = new Date().toISOString();
    const old = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    try {
        db.runInImmediateTransaction(() => { work?.(); atomicWriteFile(file, markdown(clean)); indexSourceFile({ config, db }, { filePath: file, entityRefs: [{ kind: 'mission', id: clean.missionId || clean.id }], sourceType: 'wiki_page', createInbox: false }); });
    }
    catch (error) {
        if (old)
            atomicWriteFile(file, old.toString());
        else if (fs.existsSync(file))
            fs.unlinkSync(file);
        throw error;
    }
    return read(file)!;
}
function synchronize(db: WorkMemoryDatabase, m: Obj) {
    db.upsertEntity({ kind: 'mission', id: m.id, label: m.label, description: m.description, metadata: { ...db.getEntity('mission', m.id)?.metadata, careerVersion: m.version, careerYear: m.year } });
    for (const g of m.goals) {
        for (const r of g.results)
            if (!db.getEntity('kpi', r.kpiId) || r.kpiId.startsWith(m.id + '-'))
                upsertKpi(db, { id: r.kpiId, label: r.title, unit: r.unit || 'résultat', direction: r.direction, targetValue: r.target });
        upsertOkr(db, { id: g.okrId || `${m.id}-${g.id}`, label: g.title, objective: g.why, missionId: m.id, status: g.status, periodStart: m.periodStart || undefined, periodEnd: m.periodEnd || undefined,
            keyResults: g.results.map((r: Obj) => ({ id: r.id, title: r.title, status: r.status, baselineValue: r.baseline, targetValue: r.target, unit: r.unit, kpiId: r.kpiId, dueDate: r.dueDate || undefined })), kpiIds: g.results.map((r: Obj) => r.kpiId) });
    }
    const ids = new Set(m.goals.map((g: Obj) => g.okrId || `${m.id}-${g.id}`));
    for (const rel of db.listEntityRelations({ kind: 'mission', id: m.id }))
        if (rel.relationType === 'has_okr' && rel.sourceId === m.id && !ids.has(rel.targetId)) {
            const e = db.getEntity('okr', rel.targetId);
            if (e?.metadata?.outcome)
                db.upsertEntity({ ...e, metadata: { ...e.metadata, outcome: { ...(e.metadata.outcome as Obj), status: 'closed' } } });
        }
}
function all(config: WorkMemoryConfig, db: WorkMemoryDatabase) {
    const missions = db.listEntities('mission').map(e => read(location(config, e.id, 'career.md'))).filter(Boolean) as Obj[];
    const interviews: Obj[] = [];
    for (const m of missions) {
        const dir = path.dirname(location(config, m.id, 'career.md'));
        for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : [])
            if (/^ei-[a-z0-9_-]+\.md$/.test(name))
                interviews.push(read(location(config, m.id, name))!);
    }
    const existing = buildOutcomeSnapshot(db).missions.filter(m => !missions.some(record => record.id === m.id)).map(m => ({ id: m.id, label: m.label, template: { id: m.id, label: m.label, year: new Date().getFullYear(), description: m.description || '', periodStart: m.okrs[0]?.definition.periodStart?.slice(0, 10) || '', periodEnd: m.okrs[0]?.definition.periodEnd?.slice(0, 10) || '', goals: m.okrs.map(g => ({ id: g.id, okrId: g.id, title: g.label, why: g.objective || '', actions: '', priority: 'important', status: g.definition.status, results: g.keyResults.map(r => { const k = g.kpis.find(k => k.id === r.kpiId); return { id: r.id, title: r.title, kpiId: r.kpiId, unit: r.unit || k?.definition.unit || '', baseline: r.baselineValue, target: r.targetValue ?? k?.definition.targetValue, direction: k?.definition.direction === 'decrease' ? 'decrease' : k?.definition.direction === 'target' ? 'target' : 'increase', status: r.status, dueDate: r.dueDate || '' }; }) })) } }));
    return { missions: missions.map(m => withMeasures(db, m)), interviews: interviews.sort((a, b) => b.date.localeCompare(a.date)), existingMissions: existing };
}
function findMission(config: WorkMemoryConfig, missionId: unknown) { const file = location(config, id(missionId), 'career.md'), m = read(file); if (!m)
    throw new Error('Mission introuvable.'); return m; }
function findInterview(config: WorkMemoryConfig, missionId: unknown, interviewId: unknown) { const file = location(config, id(missionId), `ei-${id(interviewId)}.md`), e = read(file); if (!e)
    throw new Error('Entretien introuvable.'); return e; }
export function careerCommand(config: WorkMemoryConfig, db: WorkMemoryDatabase, operation: string, raw: unknown): Obj {
    const input = obj(raw);
    if (input.scope !== 'portfolio')
        throw new Error('Périmètre portfolio explicite requis.');
    if (!careerOperations.includes(operation as any))
        throw new Error('Opération de mission inconnue.');
    if (operation === 'list')
        return all(config, db);
    if (operation === 'bilan-save') {
        const m = findMission(config, input.missionId), year = Number(input.year);
        if (!Number.isInteger(year) || year < 2000 || year > 2200)
            throw new Error('Année invalide.');
        const file = location(config, m.id, `bilan-${year}.md`), old = checked(file, input.revision);
        return write(config, db, file, { schema: 'career.v1', kind: 'bilan', id: `${m.id}-${year}`, missionId: m.id, year, title: `Bilan ${year}`, text: str(input.text, 'Bilan', 200000, true), createdAt: old?.createdAt || new Date().toISOString() });
    }
    if (operation === 'mission-save') {
        const value = obj(input.mission), mid = value.id ? id(value.id) : `mission-${value.year || new Date().getFullYear()}-${randomUUID()}`;
        const file = location(config, mid, 'career.md'), old = checked(file, input.revision), merged = { ...old, ...value };
        const year = Number(merged.year || new Date().getFullYear());
        if (!Number.isInteger(year) || year < 2000 || year > 2200)
            throw new Error('Année invalide.');
        const start = date(merged.periodStart), end = date(merged.periodEnd);
        range(start, end);
        const m = { schema: 'career.v1', kind: 'mission', id: mid, label: str(merged.label, 'Mission', 400, true), year, version: old?.version || 1, history: old?.history || [],
            role: str(merged.role, 'Rôle'), perimeter: str(merged.perimeter, 'Périmètre'), manager: str(merged.manager, 'Manager', 300), functionalManager: str(merged.functionalManager, 'Manager fonctionnel', 300),
            description: str(merged.description, 'Description'), additionalRole: str(merged.additionalRole, 'Rôle additionnel'), periodStart: start, periodEnd: end,
            goals: goals(merged.goals, mid), unplanned: old?.unplanned || [], measurementSources: old?.measurementSources || {}, createdAt: old?.createdAt || new Date().toISOString() };
        return withMeasures(db, write(config, db, file, m, () => synchronize(db, m)));
    }
    if (operation === 'mission-version') {
        const m = findMission(config, input.missionId);
        checked(m.file, input.revision);
        const start = date(input.periodStart, true);
        if (m.periodStart && start <= m.periodStart)
            throw new Error('La nouvelle période doit commencer après la précédente.');
        range(start, m.periodEnd);
        const end = new Date(new Date(start + 'T12:00Z').getTime() - 86400000).toISOString().slice(0, 10);
        const old = snapshot(withMeasures(db, m, end));
        old.periodEnd = end;
        old.changeReason = str(input.reason, 'Raison', 2000, true);
        const next = { ...m, history: [...m.history, old], version: m.version + 1, periodStart: start, perimeter: str(input.perimeter, 'Périmètre', 20000, true) };
        return withMeasures(db, write(config, db, m.file, next, () => synchronize(db, next)));
    }
    if (operation === 'interview-create') {
        const m = findMission(config, input.missionId), d = date(input.date || today(), true), start = date(input.periodStart || m.periodStart || d, true), end = date(input.periodEnd || d, true);
        range(start, end);
        const known = all(config, db).interviews.filter(e => e.missionId === m.id && e.status === 'realized' && e.date < d);
        const prior = known[0], applicable = [...m.history, snapshot(m)].filter(v => !v.periodStart || v.periodStart <= d).sort((a, b) => b.version - a.version)[0];
        if (!applicable)
            throw new Error('Aucune version de mission applicable à cette date.');
        const eid = input.id ? id(input.id) : randomUUID(), file = location(config, m.id, `ei-${eid}.md`);
        if (read(file))
            throw new Error('Cet entretien existe déjà.');
        const e = { schema: 'career.v1', kind: 'interview', id: eid, missionId: m.id, title: str(input.title || `EI du ${d}`, 'Titre', 400, true), date: d, periodStart: start, periodEnd: end, status: 'draft',
            sections: Object.fromEntries(Object.keys(careerSections).map(k => [k, ''])), previousDecisions: prior?.decisions || [], decisions: [], contributions: m.unplanned.filter((c: Obj) => c.date >= start && c.date <= end),
            objectiveReviews: applicable.goals.map((g: Obj) => ({ objectiveId: g.id, achievements: '', obstacles: '', comment: '' })), missionSnapshot: withMeasures(db, { ...applicable, measurementSources: m.measurementSources }, end), createdAt: new Date().toISOString() };
        return write(config, db, file, e);
    }
    if (['interview-save', 'interview-refresh', 'interview-reopen', 'decision-task'].includes(operation)) {
        const e = findInterview(config, input.missionId, input.interviewId);
        checked(e.file, input.revision);
        if (operation === 'interview-reopen') {
            if (e.status !== 'realized')
                throw new Error('Seul un entretien réalisé peut être réouvert.');
            return write(config, db, e.file, { ...e, status: 'draft', revisions: [...(e.revisions || []), { at: new Date().toISOString(), record: { ...e, revisions: undefined, file: undefined, revision: undefined } }] });
        }
        if (e.status === 'realized')
            throw new Error('Cet entretien est réalisé. Réouvre-le explicitement pour ajouter une correction datée.');
        if (operation === 'interview-refresh')
            return write(config, db, e.file, { ...e, missionSnapshot: withMeasures(db, { ...e.missionSnapshot, measurementSources: findMission(config, e.missionId).measurementSources }, e.periodEnd) });
        if (operation === 'decision-task') {
            const decision = e.decisions.find((d: Obj) => d.id === input.decisionId);
            if (!decision)
                throw new Error('Décision introuvable.');
            if (decision.taskId)
                return e;
            return write(config, db, e.file, e, () => { const t = db.createTask({ title: decision.title, body: decision.comment, assignee: 'me', deadline: decision.deadline || undefined, tracking: { inPriorities: false } }); db.upsertTaskLink({ taskId: t.id, relationType: 'about', targetKind: 'mission', targetId: e.missionId }); decision.taskId = t.id; });
        }
        const v = obj(input.interview), merged = { ...e, ...v }, sections = obj(merged.sections), d = date(merged.date, true), start = date(merged.periodStart, true), end = date(merged.periodEnd, true);
        range(start, end);
        const next = { ...e, title: str(merged.title, 'Titre', 400, true), date: d, periodStart: start, periodEnd: end, status: choice(merged.status, ['draft', 'ready', 'realized'], 'draft'),
            objectiveReviews: list(merged.objectiveReviews, 50).map(r => { if (!e.missionSnapshot.goals.some((g: Obj) => g.id === r.objectiveId))
                throw new Error('Objectif de l’entretien introuvable.'); return { objectiveId: r.objectiveId, achievements: str(r.achievements, 'Réalisations'), obstacles: str(r.obstacles, 'Difficultés'), comment: str(r.comment, 'Commentaire') }; }), sections: Object.fromEntries(Object.keys(careerSections).map(k => [k, str(sections[k], k)])), previousDecisions: decisions(merged.previousDecisions), decisions: decisions(merged.decisions), contributions: unique(list(merged.contributions, 200).map(contribution)) };
        return write(config, db, e.file, next);
    }
    if (operation === 'measure') {
        const m = findMission(config, input.missionId);
        checked(m.file, input.revision);
        const key = m.goals.flatMap((g: Obj) => g.results).find((r: Obj) => r.id === input.resultId);
        if (!key)
            throw new Error('Résultat clé introuvable.');
        const value = numeric(input.value);
        if (value === undefined)
            throw new Error('Mesure obligatoire.');
        const d = date(input.date || today(), true);
        if (d > today())
            throw new Error('Une mesure ne peut pas être datée dans le futur.');
        const sourceUrl = url(input.sourceUrl), note = str(input.note, 'Note');
        m.measurementSources ||= {};
        const next = write(config, db, m.file, m, () => { const v = recordKpiMeasurement(db, { kpiId: key.kpiId, value, measuredAt: d + new Date().toISOString().slice(10), note }); m.measurementSources[v.id] = sourceUrl; });
        return withMeasures(db, next);
    }
    if (operation === 'contribution-save') {
        const m = findMission(config, input.missionId);
        checked(m.file, input.revision);
        const c = contribution(obj(input.contribution));
        const unplanned = [...m.unplanned.filter((old: Obj) => old.id !== c.id), c];
        return write(config, db, m.file, { ...m, unplanned });
    }
    if (operation === 'context')
        return context(config, db, input);
    return bilan(config, db, input);
}
function bilan(config: WorkMemoryConfig, db: WorkMemoryDatabase, input: Obj): Obj {
    const data = all(config, db), year = Number(input.year || new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2200)
        throw new Error('Année invalide.');
    const missions = data.missions.filter(m => m.year === year && (!input.missionId || m.id === input.missionId)), ids = new Set(missions.map(m => m.id));
    const from = date(input.from) || `${year}-01-01`, to = date(input.to) || `${year}-12-31`;
    range(from, to);
    missions.forEach((m,index) => { missions[index] = withMeasures(db,m,to); });
    const interviews = data.interviews.filter(e => ids.has(e.missionId) && e.date >= from && e.date <= to && (input.includeDrafts === true || e.status === 'realized'));
    const entries = new Map<string, Obj>();
    for (const m of missions)
        for (const c of m.unplanned)
            if (c.date >= from && c.date <= to)
                entries.set(c.id, { ...c, missionId: m.id, interviewIds: [] });
    for (const e of [...interviews].reverse())
        for (const c of e.contributions)
            if (c.date >= from && c.date <= to)
                entries.set(c.id, { ...c, missionId: e.missionId, interviewIds: [...(entries.get(c.id)?.interviewIds || []), e.id] });
    const contributions = [...entries.values()], outside = contributions.filter(c => c.origin === 'outside');
    const markdown = `# Bilan ${year}\n\n${from} → ${to}\n\n${missions.map(m => `## ${m.label}\n\n${[...m.history, snapshot(m)].map(v => `### Périmètre v${v.version} — ${v.periodStart || ''} → ${v.periodEnd || ''}\n\n${v.perimeter}\n\nRôle additionnel : ${v.additionalRole || ''}\n\n${v.goals.map((g: Obj) => `- ${g.title} · ${g.status}\n${g.results.map((r: Obj) => `  - ${r.title} : ${r.currentValue ?? 'non mesuré'} / ${r.target ?? 'à définir'} ${r.unit || ''} · ${r.measuredAt || ''}`).join('\n')}`).join('\n')}`).join('\n\n')}`).join('\n\n')}\n\n## Entretiens et réalisations\n\n${interviews.map(e => `### ${e.title}\n\n${e.sections.performance}\n\n${(e.objectiveReviews || []).map((r: Obj) => `### ${e.missionSnapshot.goals.find((g: Obj) => g.id === r.objectiveId)?.title || ''}\n\nRéalisations : ${r.achievements}\n\nDifficultés : ${r.obstacles}\n\n${r.comment}`).join('\n\n')}\n\n${e.missionSnapshot.goals.map((g: Obj) => `- ${g.title}\n${g.results.map((r: Obj) => `  - ${r.title} : ${r.currentValue ?? 'non mesuré'} / ${r.target ?? 'à définir'} ${r.unit || ''} · ${r.measuredAt || ''}`).join('\n')}`).join('\n')}\n\nApprentissages : ${e.sections.learning}\n\nRetours : ${e.sections.managerFeedback}`).join('\n\n')}\n\n## Réalisations liées aux objectifs\n\n${contributions.filter(c => c.origin === 'planned').map(c => `### ${c.title}\n\n${c.description}\n\nImpact : ${c.impact}\n\n${c.links.join('\n')}`).join('\n\n')}\n\n## Contributions hors mission\n\n${outside.map(c => `### ${c.title}\n\n${c.date}\n\n${c.description}\n\nImpact : ${c.impact}\n\n${c.links.join('\n')}`).join('\n\n')}\n`;
    return { year, from, to, missions, interviews, contributions, outside, markdown, draft: input.missionId ? read(location(config, id(input.missionId), `bilan-${year}.md`)) : undefined };
}
function context(config: WorkMemoryConfig, db: WorkMemoryDatabase, input: Obj): Obj {
    const m = findMission(config, input.missionId), e = input.interviewId ? findInterview(config, m.id, input.interviewId) : undefined;
    const from = e?.periodStart || m.periodStart || `${m.year}-01-01`, to = e?.periodEnd || today();
    const sources: Obj[] = [];
    for (const c of db.listCaptures({}).filter(c => c.createdAt.slice(0, 10) >= from && c.createdAt.slice(0, 10) <= to).slice(0, 40)) {
        if (!c.path)
            continue;
        const physical = resolvePhysicalPath(c.path);
        if (!isPathInside(physical, resolvePhysicalPath(config.workspaceRoot)) || !fs.existsSync(physical))
            continue;
        sources.push({ ref: `capture:${c.id}`, title: c.title, date: c.createdAt, file: c.path, content: fs.readFileSync(physical, 'utf8').slice(0, 8000) });
    }
    for (const t of db.listTasks().filter(t => t.updatedAt.slice(0, 10) >= from && t.updatedAt.slice(0, 10) <= to).slice(0, 60))
        sources.push({ ref: `task:${t.id}`, title: t.title, date: t.updatedAt, status: t.status, content: t.body || '', notes: t.notes || '' });
    return { bilan: input.purpose === 'bilan' ? bilan(config, db, { ...input, year: m.year }) : undefined, mission: withMeasures(db, m, to), interview: e, period: { from, to }, sources, sourceLimit: 100, notice: 'Les tâches sont datées par leur dernière modification, pas par une date de réalisation certaine. Le ressenti doit venir des écrits de la personne. Le contexte est un échantillon de la période ; signaler les informations manquantes.' };
}
