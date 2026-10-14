/** Mission, EI and annual bilan share the same private records in both hosts. */
function createCareerPage({ document, postMessage, openFile, openTask, openNote, openUrl, onActivate }) {
    const root = document.querySelector('#career'), win = document.defaultView;
    let mounted = false, loading = false, data = { missions: [], interviews: [], existingMissions: [] }, tab = 'mission', year = new Date().getFullYear(), missionId = '', interviewId = '', draft = null, kind = '', dirty = false, saving = false, failed = false, editVersion = 0, timer, stale = false;
    let suggestion = null, bilan = null;
    const pending = new Map();
    const labels = { liked: 'Ce que j’ai aimé vivre', lessLiked: 'Ce que j’ai moins aimé vivre', feeling: 'Synthèse de mon ressenti', learning: 'Dernières décisions et apprentissages', performance: 'Ma performance', next: 'Mes nouvelles décisions', managerFeedback: 'Après l’entretien' };
    const status = { draft: 'En préparation', ready: 'Prêt', realized: 'Réalisé', active: 'En cours', at_risk: 'À risque', off_track: 'En difficulté', achieved: 'Atteint', closed: 'Clos', not_started: 'À démarrer', on_track: 'En cours', open: 'À faire', in_progress: 'En cours', done: 'Réalisé', postponed: 'Reporté', abandoned: 'Abandonné', outside: 'Hors mission', planned: 'Liée à un objectif', must_win: 'Must Win', important: 'Important', complementary: 'Complémentaire' };
    const uid = () => win.crypto.randomUUID(), day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined)
        n.textContent = text; if (cls)
        n.className = cls; return n; };
    const button = (text, fn, cls = 'action') => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', () => { Promise.resolve(fn()).catch(showError); }); return b; };
    const api = (operation, input = {}) => new Promise((resolve, reject) => { const requestId = uid(), t = win.setTimeout(() => { pending.delete(requestId); reject(new Error('Confirmation non reçue. Le brouillon est conservé ; actualise avant de réessayer une création.')); }, 120000); pending.set(requestId, { resolve, reject, t }); postMessage({ type: 'careerRequest', operation, requestId, input: { scope: 'portfolio', ...input } }); });
    const ai = purpose => new Promise((resolve, reject) => { const requestId = uid(), t = win.setTimeout(() => { pending.delete(requestId); reject(new Error('La préparation IA a dépassé le délai. Ton texte est conservé.')); }, 180000); pending.set(requestId, { resolve, reject, t }); postMessage({ type: 'careerAi', requestId, input: { missionId: missionId || draft?.id, interviewId, purpose } }); });
    function showError(error) { const n = root.querySelector('.career-error'); if (n) {
        n.textContent = error.message || String(error);
        n.hidden = false;
    } }
    function updateStatus() { const n = root.querySelector('#career-save-status'); if (n)
        n.textContent = failed ? 'Brouillon conservé · sauvegarde à vérifier' : saving ? 'Enregistrement…' : dirty ? 'Modifications en attente' : 'Enregistré'; root.dataset.careerDirty = String(dirty || saving); }
    function baseline() { for (const n of root.querySelectorAll('input,textarea,select')) {
        if (n.tagName === 'SELECT')
            for (const o of n.options)
                o.defaultSelected = o.selected;
        else
            n.defaultValue = n.value;
    } }
    function field(parent, label, value, write, type = 'text', options) {
        const box = el('label', undefined, 'career-field');
        box.append(el('span', label));
        const n = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
        if (options)
            for (const [v, l] of options) {
                const o = el('option', l);
                o.value = v;
                n.append(o);
            }
        else if (type !== 'textarea')
            n.type = type;
        n.value = value ?? '';
        if (n.tagName === 'TEXTAREA') {
            n.rows = 4;
        }
        n.disabled = kind === 'interview' && draft?.status === 'realized';
        n.addEventListener(options ? 'change' : 'input', () => { write(type === 'number' ? (n.value === '' ? undefined : Number(n.value)) : n.value); touch(); });
        box.append(n);
        parent.append(box);
        return n;
    }
    const choices = values => values.map(v => [v, status[v] || v]);
    function touch() { dirty = true; failed = false; editVersion++; updateStatus(); win.clearTimeout(timer); timer = win.setTimeout(save, 700); }
    function valid() { return draft && (kind === 'mission' ? draft.label?.trim() : kind === 'bilan' ? draft.text?.trim() : draft.title?.trim()) && (draft.goals || []).every(g => g.title.trim() && g.results.every(r => r.title.trim())); }
    async function save() {
        win.clearTimeout(timer);
        if (!dirty || saving || failed)
            return;
        if (!valid()) {
            showError(new Error('Complète les titres pour enregistrer le brouillon.'));
            updateStatus();
            return;
        }
        const version = editVersion, sent = JSON.parse(JSON.stringify(draft));
        saving = true;
        updateStatus();
        try {
            const value = await api(kind === 'mission' ? 'mission-save' : kind === 'bilan' ? 'bilan-save' : 'interview-save', kind === 'bilan' ? { missionId: draft.missionId, year: draft.year, text: sent.text, revision: sent.revision } : kind === 'mission' ? { mission: sent, revision: sent.revision } : { missionId: sent.missionId, interviewId: sent.id, interview: sent, revision: sent.revision });
            if (kind === 'bilan')
                bilan.draft = value;
            else {
                const list = kind === 'mission' ? data.missions : data.interviews;
                const i = list.findIndex(v => v.id === value.id);
                if (i >= 0)
                    list[i] = value;
                else
                    list.push(value);
            }
            draft.revision = value.revision;
            draft.id = value.id;
            draft.file = value.file;
            if (kind === 'mission') {
                missionId = value.id;
                for (const g of draft.goals)
                    for (const r of g.results) {
                        const canonical = value.goals.flatMap(x => x.results).find(x => x.id === r.id);
                        if (canonical)
                            r.kpiId = canonical.kpiId;
                    }
            }
            if (version === editVersion) {
                dirty = false;
                baseline();
            }
        }
        catch (error) {
            failed = true;
            showError(error);
        }
        finally {
            saving = false;
            updateStatus();
            if (dirty && !failed && version !== editVersion)
                void save();
        }
    }
    async function settle() { await save(); return !dirty && !saving && !failed; }
    const editing = () => (root.contains(document.activeElement) && document.activeElement?.matches('input,textarea,select')) || Boolean(root.querySelector('dialog[open]'));
    async function load(force = false) {
        if(loading || dirty || saving || (!force && editing())) { stale = true; return; }
        loading = true;
        try {
            data = await api('list'); stale = false;
            if(!data.missions.some(m=>m.id===missionId)) missionId=data.missions.filter(m=>m.year===year).at(-1)?.id||'';
            let changed = !draft;
            if(draft && kind !== 'bilan') {
                const current=(kind==='mission'?data.missions:data.interviews).find(v=>v.id===draft.id);
                if(current && current.revision!==draft.revision) { draft=JSON.parse(JSON.stringify(current)); changed=true; }
            }
            if(changed || force) render();
            if(tab==='bilan') await buildBilan();
        } catch(error) { showError(error); }
        finally { loading=false; }
    }
    async function recover() {
        if (saving)
            return;
        const fresh = kind === 'bilan' ? await api('bilan', { year, missionId }) : await api('list');
        const current = kind === 'bilan' ? fresh.draft : (kind === 'mission' ? fresh.missions : fresh.interviews).find(v => v.id === draft?.id);
        if (!current) {
            showError(new Error('Aucune version enregistrée retrouvée. Ton brouillon reste affiché.'));
            return;
        }
        const readable = kind === 'mission' ? [current.label, current.role, current.perimeter, current.description, ...current.goals.map(g => g.title + '\n' + g.why + '\n' + g.actions)].join('\n\n') : kind === 'bilan' ? current.text : [current.title, ...Object.entries(labels).map(([key, label]) => label + '\n' + current.sections[key]), ...current.contributions.map(c => c.title + '\n' + c.description + '\nImpact : ' + c.impact)].join('\n\n');
        dialog('Relire la version enregistrée', form => { const text = plainField(form, 'Version actuelle', readable, 'textarea'); text.readOnly = true; form.append(el('p', 'Charger cette version remplace le brouillon affiché. Annuler le conserve.', 'muted')); return () => ({}); }, async () => {
            dirty = false;
            failed = false;
            if (kind === 'bilan') {
                bilan = fresh;
                draft = current;
                render();
            }
            else {
                data = fresh;
                selectDraft(current, kind);
            }
            updateStatus();
        });
    }
    function selectDraft(value, type) { draft = JSON.parse(JSON.stringify(value)); kind = type; dirty = false; failed = false; editVersion++; interviewId = type === 'interview' ? draft.id : ''; render(); }
    function header() {
        const h = el('div', undefined, 'career-header');
        const title = el('div');
        title.append(el('h1', 'Ma mission'), el('p', 'Objectifs, entretiens et contributions de l’année', 'muted'));
        h.append(title);
        const actions = el('div', undefined, 'career-actions');
        const ys = el('select');
        const years = new Set([...Array.from({length:5},(_,i)=>year-2+i),...data.missions.map(m=>m.year)]);
        for(const y of [...years].sort((a,b)=>a-b)) {const option=el('option',String(y));option.value=y;ys.append(option);}
        ys.value = year;
        ys.setAttribute('aria-label', 'Année');
        ys.addEventListener('change', async () => { if (!await settle()) {
            ys.value = year;
            return;
        } year = Number(ys.value); draft = null; missionId = data.missions.find(m => m.year === year)?.id || ''; render(); });
        actions.append(ys, button('Actualiser', () => dirty || failed ? recover() : load(true)));
        h.append(actions);
        root.append(h);
        const tabs = el('div', undefined, 'memory-view-tabs career-tabs');
        for (const [value, label] of [['mission', 'Mission'], ['interviews', 'Entretiens'], ['bilan', 'Bilan']]) {
            const b = button(label, async () => { if (!await settle())
                return; tab = value; draft = null; suggestion = null; render(); if (tab === 'bilan')
                await buildBilan(); }, 'memory-view-tab' + (tab === value ? ' active' : ''));
            b.setAttribute('aria-pressed', String(tab === value));
            tabs.append(b);
        }
        root.append(tabs);
        const err = el('div', '', 'career-error error');
        err.hidden = true;
        err.setAttribute('role', 'alert');
        root.append(err);
        const saved = el('div', 'Enregistré', 'career-save-status muted');
        saved.id = 'career-save-status';
        saved.setAttribute('role', 'status');
        root.append(saved);
    }
    function missionPicker(parent) { const n = el('select'); n.setAttribute('aria-label', 'Mission'); for (const m of data.missions.filter(m => m.year === year)) {
        const o = el('option', m.label);
        o.value = m.id;
        n.append(o);
    } n.value = missionId; n.addEventListener('change', async () => { if (!await settle()) {
        n.value = missionId;
        return;
    } missionId = n.value; draft = null; render(); if (tab === 'bilan')
        await buildBilan(); }); parent.append(n); }
    function render() { if (!mounted)
        return; root.replaceChildren(); header(); if (tab === 'mission')
        renderMission(); if (tab === 'interviews')
        renderInterviews(); if (tab === 'bilan')
        renderBilan(); updateStatus(); baseline(); }
    function renderMission() {
        const bar = el('div', undefined, 'career-actions');
        missionPicker(bar);
        bar.append(button('+ Mission', async () => { if (!await settle())
            return; selectDraft({ id: `mission-${year}-${uid()}`, label: `Mission ${year}`, year, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, role: '', perimeter: '', description: '', manager: '', functionalManager: '', additionalRole: '', goals: [], history: [], unplanned: [] }, 'mission'); touch(); }));
        if (data.existingMissions?.length)
            bar.append(button('Reprendre une mission existante', () => { dialog('Mission existante', form => { const n = el('select'); for (const m of data.existingMissions) {
                const o = el('option', m.label);
                o.value = m.id;
                n.append(o);
            } form.append(n); return () => ({ id: n.value }); }, async (v) => { const template = data.existingMissions.find(m => m.id === v.id)?.template; if (!template)
                throw new Error('Mission introuvable.'); selectDraft({ ...template, year, history: [], unplanned: [] }, 'mission'); touch(); }); }));
        root.append(bar);
        const m = draft && kind === 'mission' ? draft : data.missions.find(m => m.id === missionId);
        if (!m) {
            root.append(el('p', 'Crée ta mission pour préparer les entretiens et conserver les réalisations de l’année.', 'career-empty'));
            return;
        }
        if (!draft) {
            draft = JSON.parse(JSON.stringify(m));
            kind = 'mission';
        }
        const tools = el('div', undefined, 'career-actions');
        tools.append(button('M’aider à rédiger la mission', () => requestAi('mission')), button('Nouvelle version / périmètre', () => versionDialog()), button('Ouvrir le Markdown', () => draft.file && openFile(draft.file)));
        root.append(tools);
        const form = el('div', undefined, 'career-form');
        field(form, 'Nom de la mission', draft.label, v => draft.label = v);
        field(form, 'Rôle', draft.role, v => draft.role = v);
        field(form, 'Périmètre', draft.perimeter, v => draft.perimeter = v, 'textarea');
        field(form, 'Description de la mission', draft.description, v => draft.description = v, 'textarea');
        const dates = el('div', undefined, 'career-grid');
        field(dates, 'Début', draft.periodStart, v => draft.periodStart = v, 'date');
        field(dates, 'Fin', draft.periodEnd, v => draft.periodEnd = v, 'date');
        field(dates, 'Manager', draft.manager, v => draft.manager = v);
        field(dates, 'Manager fonctionnel', draft.functionalManager, v => draft.functionalManager = v);
        form.append(dates);
        root.append(form);
        const gh = el('div', undefined, 'career-header');
        gh.append(el('h2', 'Objectifs'), button('+ Objectif', () => { draft.goals.push({ id: uid(), title: '', why: '', actions: '', priority: 'important', status: 'active', results: [] }); touch(); render(); }));
        root.append(gh);
        for (const goal of draft.goals) {
            const card = el('details', undefined, 'career-card');
            card.open = true;
            card.append(el('summary', goal.title || 'Nouvel objectif'));
            const grid = el('div', undefined, 'career-grid');
            field(grid, 'Objectif', goal.title, v => { goal.title = v; card.querySelector('summary').textContent = v || 'Nouvel objectif'; });
            field(grid, 'Priorité', goal.priority, v => goal.priority = v, 'text', choices(['must_win', 'important', 'complementary']));
            field(grid, 'Avancement', goal.status, v => goal.status = v, 'text', choices(['draft', 'active', 'at_risk', 'off_track', 'achieved', 'closed']));
            card.append(grid);
            field(card, 'Pourquoi / résultat attendu', goal.why, v => goal.why = v, 'textarea');
            field(card, 'Comment : actions et livrables', goal.actions, v => goal.actions = v, 'textarea');
            for (const r of goal.results) {
                const kr = el('div', undefined, 'career-result');
                field(kr, 'Résultat clé', r.title, v => r.title = v);
                const fields = el('div', undefined, 'career-grid');
                field(fields, 'Unité', r.unit, v => r.unit = v);
                field(fields, 'Valeur de départ', r.baseline, v => r.baseline = v, 'number');
                field(fields, 'Cible', r.target, v => r.target = v, 'number');
                field(fields, 'Échéance', r.dueDate, v => r.dueDate = v, 'date');
                field(fields, 'Sens', r.direction, v => r.direction = v, 'text', [['increase', 'Augmenter'], ['decrease', 'Réduire'], ['target', 'Atteindre la cible']]);
                field(fields, 'Avancement', r.status, v => r.status = v, 'text', choices(['not_started', 'on_track', 'at_risk', 'off_track', 'achieved']));
                kr.append(fields);
                const live = data.missions.find(m => m.id === missionId)?.goals.flatMap(g => g.results).find(x => x.id === r.id);
                kr.append(el('p', `Dernière mesure : ${live?.currentValue ?? 'non renseignée'} ${r.unit || ''} · ${live?.measuredAt?.slice(0, 10) || 'aucune mesure'}`, 'muted'), button('Ajouter une mesure', () => measureDialog(r)), button('Retirer ce résultat', () => { goal.results = goal.results.filter(x => x.id !== r.id); touch(); render(); }));
                card.append(kr);
            }
            card.append(button('+ Résultat clé / KPI', () => { goal.results.push({ id: uid(), title: '', unit: '', direction: 'increase', status: 'not_started' }); touch(); render(); }), button('Retirer cet objectif', () => { draft.goals = draft.goals.filter(x => x.id !== goal.id); touch(); render(); }));
            root.append(card);
        }
        field(root, 'Rôle additionnel', draft.additionalRole, v => draft.additionalRole = v, 'textarea');
        const extra = el('section', undefined, 'career-card');
        extra.append(el('h2', 'Contributions hors mission'), el('p', 'Ces réalisations seront reprises dans les EI et le bilan, même sans objectif associé.', 'muted'), button('+ Réalisation hors mission', () => collect({})));
        for (const c of draft.unplanned || []) {
            const card = contributionCard(c);
            card.append(button('Modifier', () => collect({ ...c, missionId })));
            extra.append(card);
        }
        root.append(extra);
        if (draft.history?.length) {
            const history = el('details', undefined, 'career-card');
            history.append(el('summary', `Versions précédentes (${draft.history.length})`));
            for (const v of draft.history) {
                history.append(el('h3', `Version ${v.version} · ${v.periodStart} → ${v.periodEnd}`), el('p', v.perimeter), el('p', v.changeReason));
                for (const g of v.goals)
                    history.append(el('p', g.title));
            }
            root.append(history);
        }
    }
    function renderInterviews() {
        const bar = el('div', undefined, 'career-actions');
        missionPicker(bar);
        bar.append(button('+ Entretien', () => createInterviewDialog()));
        root.append(bar);
        if (!draft || kind !== 'interview') {
            const rows = data.interviews.filter(e => e.missionId === missionId);
            if (!rows.length)
                root.append(el('p', 'Prépare ton premier entretien. Les décisions suivantes et les indicateurs seront repris au fil des échanges.', 'career-empty'));
            const table = el('table', undefined, 'career-table');
            const head = el('tr');
            for (const t of ['Entretien', 'Période', 'Avancement', 'Hors mission', ''])
                head.append(el('th', t));
            table.append(head);
            for (const e of rows) {
                const row = el('tr');
                row.append(el('td', e.title), el('td', `${e.periodStart} → ${e.periodEnd}`), el('td', status[e.status]), el('td', String(e.contributions.filter(c => c.origin === 'outside').length)));
                const cell = el('td');
                cell.append(button('Ouvrir', () => selectDraft(e, 'interview')));
                row.append(cell);
                table.append(row);
            }
            root.append(table);
            return;
        }
        const e = draft, readonly = e.status === 'realized';
        const actions = el('div', undefined, 'career-actions');
        actions.append(button('← Entretiens', async () => { if (!await settle())
            return; draft = null; interviewId = ''; render(); }), button('Ouvrir le Markdown', () => openFile(e.file)));
        if (readonly)
            actions.append(button('Ajouter une correction', async () => { const v = await api('interview-reopen', { missionId: e.missionId, interviewId: e.id, revision: e.revision }); data.interviews = data.interviews.map(x => x.id === v.id ? v : x); selectDraft(v, 'interview'); }));
        else
            actions.append(button('Préparer avec l’IA', () => requestAi('interview')), button('Actualiser les indicateurs', async () => { if (!await settle())
                return; const v = await api('interview-refresh', { missionId: e.missionId, interviewId: e.id, revision: e.revision }); selectDraft(v, 'interview'); }), button('Marquer comme réalisé', async () => { if (!await settle())
                return; e.status = 'realized'; touch(); await save(); if (!dirty)
                render(); }));
        root.append(actions);
        field(root, 'Titre', e.title, v => e.title = v);
        const dates = el('div', undefined, 'career-grid');
        field(dates, 'Date de l’entretien', e.date, v => e.date = v, 'date');
        field(dates, 'Depuis', e.periodStart, v => e.periodStart = v, 'date');
        field(dates, 'Jusqu’au', e.periodEnd, v => e.periodEnd = v, 'date');
        field(dates, 'État', e.status, v => e.status = v, 'text', choices(readonly ? ['realized'] : ['draft', 'ready']));
        root.append(dates);
        e.objectiveReviews ||= e.missionSnapshot.goals.map(g => ({ objectiveId: g.id, achievements: '', obstacles: '', comment: '' }));
        const goals = el('details', undefined, 'career-card');
        goals.open = true;
        goals.append(el('summary', `Mission et indicateurs · version ${e.missionSnapshot.version}`), el('p', e.missionSnapshot.perimeter));
        for (const g of e.missionSnapshot.goals) {
            goals.append(el('h3', g.title));
            for (const r of g.results)
                goals.append(el('p', `${r.title} : ${r.currentValue ?? 'non mesuré'} / ${r.target ?? 'cible à définir'} ${r.unit || ''} · ${r.measuredAt?.slice(0, 10) || 'aucune mesure'}`));
            const review = e.objectiveReviews.find(r => r.objectiveId === g.id);
            if (review) {
                field(goals, 'Réalisations pour cet objectif', review.achievements, v => review.achievements = v, 'textarea');
                field(goals, 'Difficultés / ce qui reste à faire', review.obstacles, v => review.obstacles = v, 'textarea');
                field(goals, 'Commentaire sur l’avancement', review.comment, v => review.comment = v, 'textarea');
            }
        }
        root.append(goals);
        for (const [key, label] of Object.entries(labels)) {
            field(root, label, e.sections[key], v => e.sections[key] = v, 'textarea');
            if (!readonly)
                root.append(button('M’aider sur cette rubrique', () => requestAi('section:' + key)));
        }
        if (e.previousDecisions.length) {
            root.append(el('h2', 'Engagements du précédent EI'));
            for (const d of e.previousDecisions)
                decisionFields(d, readonly);
        }
        const dh = el('div', undefined, 'career-header');
        dh.append(el('h2', 'Décisions pour la période à venir'));
        if (!readonly)
            dh.append(button('+ Décision', () => { e.decisions.push({ id: uid(), title: '', state: 'open', comment: '', deadline: '', objectiveId: '', taskId: '' }); touch(); render(); }));
        root.append(dh);
        for (const d of e.decisions)
            decisionFields(d, readonly, true);
        const ch = el('div', undefined, 'career-header');
        ch.append(el('h2', 'Réalisations hors mission et autres contributions'));
        if (!readonly)
            ch.append(button('+ Réalisation', () => { e.contributions.push({ id: uid(), title: '', description: '', impact: '', date: day(), origin: 'outside', links: [], objectiveId: '' }); touch(); render(); }));
        root.append(ch);
        for (const c of e.contributions) {
            const box = el('div', undefined, 'career-card');
            field(box, 'Ce que j’ai réalisé', c.title, v => c.title = v);
            field(box, 'Ce qui a été fait', c.description, v => c.description = v, 'textarea');
            field(box, 'Impact / valeur apportée', c.impact, v => c.impact = v, 'textarea');
            const grid = el('div', undefined, 'career-grid');
            field(grid, 'Date', c.date, v => c.date = v, 'date');
            field(grid, 'Contribution', c.origin, v => c.origin = v, 'text', choices(['outside', 'planned']));
            field(grid, 'Objectif associé (facultatif)', c.objectiveId, v => c.objectiveId = v, 'text', [['', 'Aucun objectif'], ...e.missionSnapshot.goals.map(g => [g.id, g.title])]);
            box.append(grid);
            field(box, 'Liens / preuves (une URL par ligne)', c.links.join('\n'), v => c.links = v.split('\n').map(x => x.trim()).filter(Boolean), 'textarea');
            if (!readonly)
                box.append(button('Retirer de cet entretien', () => { e.contributions = e.contributions.filter(x => x.id !== c.id); touch(); render(); }));
            root.append(box);
        }
    }
    function decisionFields(d, readonly, current = false) { const card = el('div', undefined, 'career-card'); field(card, 'Décision', d.title, v => d.title = v); const grid = el('div', undefined, 'career-grid'); field(grid, 'Avancement', d.state, v => d.state = v, 'text', choices(['open', 'in_progress', 'done', 'postponed', 'abandoned'])); field(grid, 'Échéance', d.deadline, v => d.deadline = v, 'date'); field(grid, 'Objectif lié', d.objectiveId, v => d.objectiveId = v, 'text', [['', 'Aucun'], ...draft.missionSnapshot.goals.map(g => [g.id, g.title])]); card.append(grid); field(card, 'Commentaires et apprentissages', d.comment, v => d.comment = v, 'textarea'); if (d.taskId)
        card.append(button('Ouvrir la tâche', () => openTask(d.taskId)));
    else if (current && !readonly)
        card.append(button('Créer une tâche', async () => { if (!await settle())
            return; const v = await api('decision-task', { missionId: draft.missionId, interviewId: draft.id, revision: draft.revision, decisionId: d.id }); data.interviews = data.interviews.map(e => e.id === v.id ? v : e); selectDraft(v, 'interview'); })); root.append(card); }
    function contributionCard(c) { const card = el('article', undefined, 'career-result'); card.append(el('h3', c.title), el('p', c.description), el('p', `Impact : ${c.impact || 'à préciser'}`), el('small', `${c.date} · ${status[c.origin]}`)); for (const link of c.links || [])
        card.append(button('Lien / preuve', () => openUrl?.(link))); if (c.ref?.startsWith('task:'))
        card.append(button('Tâche source', () => openTask(c.ref.slice(5)))); if (c.ref?.startsWith('capture:'))
        card.append(button('Note source', () => openNote?.(c.ref.slice(8)))); return card; }
    async function buildBilan() { try {
        bilan = await api('bilan', { year, missionId: missionId || undefined, includeDrafts: root.querySelector('#career-include-drafts')?.checked || false });
        renderBilanBody();
    }
    catch (error) {
        showError(error);
    } }
    function renderBilan() { const tools = el('div', undefined, 'career-actions'); missionPicker(tools); const label = el('label'); const check = el('input'); check.type = 'checkbox'; check.id = 'career-include-drafts'; check.addEventListener('change', buildBilan); label.append(check, document.createTextNode(' Inclure les EI en préparation')); tools.append(label, button('Préparer la synthèse avec l’IA', () => requestAi('bilan')), button('Copier le bilan', async () => { await win.navigator.clipboard.writeText(root.querySelector('#career-bilan-text')?.value || bilan?.markdown || ''); })); root.append(tools); const body = el('div'); body.id = 'career-bilan-body'; root.append(body); if (bilan)
        renderBilanBody();
    else
        void buildBilan(); }
    function renderBilanBody() { const body = root.querySelector('#career-bilan-body'); if (!body || !bilan)
        return; body.replaceChildren(); const stats = el('div', undefined, 'career-grid'); stats.append(el('div', `${bilan.interviews.length} entretiens inclus`, 'career-result'), el('div', `${bilan.outside.length} contributions hors mission`, 'career-result')); body.append(stats); for (const m of bilan.missions) {
        const box = el('div', undefined, 'career-card');
        box.append(el('h2', m.label));
        for (const version of [...m.history, m]) {
            box.append(el('h3', `Périmètre v${version.version} · ${version.periodStart} → ${version.periodEnd}`), el('p', version.perimeter));
            for (const g of version.goals)
                box.append(el('p', `${g.title} · ${status[g.status]}`));
        }
        body.append(box);
    } body.append(el('h2', 'Contributions hors mission')); for (const c of bilan.outside)
        body.append(contributionCard(c)); const planned = bilan.contributions?.filter(c => c.origin === 'planned') || []; if (planned.length) {
        body.append(el('h2', 'Réalisations liées aux objectifs'));
        for (const c of planned)
            body.append(contributionCard(c));
    } const text = el('textarea'); text.id = 'career-bilan-text'; text.value = bilan.draft?.text || bilan.markdown; text.defaultValue = text.value; draft = { ...(bilan.draft || {}), missionId, year, text: text.value }; kind = 'bilan'; text.addEventListener('input', () => { draft.text = text.value; touch(); }); text.rows = 14; text.setAttribute('aria-label', 'Bilan à copier'); body.append(text); }
    function dialog(title, build, commit) { const d = el('dialog', undefined, 'career-dialog'); const form = el('form'); form.append(el('h2', title)); const message = el('p', '', 'error'); form.append(message); const values = build(form); const footer = el('div', undefined, 'career-actions'); footer.append(button('Annuler', () => { d.close(); d.remove(); })); const submit = el('button', 'Enregistrer', 'action primary'); submit.type = 'submit'; footer.append(submit); form.append(footer); form.addEventListener('submit', async (event) => { event.preventDefault(); submit.disabled = true; try {
        await commit(values());
        d.close();
        d.remove();
    }
    catch (error) {
        message.textContent = error.message;
    }
    finally {
        submit.disabled = false;
    } }); d.append(form); root.append(d); d.showModal(); return d; }
    const plainField = (form, label, value, type = 'text') => { const box = el('label', undefined, 'career-field'); box.append(el('span', label)); const n = el(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea')
        n.type = type; n.value = value || ''; n.defaultValue = n.value; box.append(n); form.append(box); return n; };
    async function createInterviewDialog() { if (!missionId) {
        showError(new Error('Crée ou sélectionne une mission.'));
        return;
    } if (!await settle())
        return; const newId = uid(); dialog('Nouvel entretien', form => { const d = plainField(form, 'Date', day(), 'date'), from = plainField(form, 'Début de période', data.interviews.find(e => e.missionId === missionId)?.date || data.missions.find(m => m.id === missionId)?.periodStart || day(), 'date'); return () => ({ id: newId, date: d.value, periodStart: from.value, periodEnd: d.value }); }, async (v) => { const e = await api('interview-create', { missionId, ...v }); data.interviews.unshift(e); selectDraft(e, 'interview'); }); }
    async function measureDialog(r) { if (!await settle())
        return; dialog('Nouvelle mesure · ' + r.title, form => { const value = plainField(form, 'Valeur', '', 'number'), d = plainField(form, 'Date de mesure', day(), 'date'), url = plainField(form, 'URL de la source', '', 'url'), note = plainField(form, 'Commentaire', '', 'textarea'); return () => ({ value: Number(value.value), date: d.value, sourceUrl: url.value, note: note.value }); }, async (v) => { const m = await api('measure', { missionId, resultId: r.id, revision: draft.revision, ...v }); data.missions = data.missions.map(x => x.id === m.id ? m : x); selectDraft(m, 'mission'); }); }
    async function versionDialog() { if (!await settle())
        return; dialog('Changement de périmètre', form => { const start = plainField(form, 'Début du nouveau périmètre', day(), 'date'), perimeter = plainField(form, 'Nouveau périmètre', draft.perimeter, 'textarea'), reason = plainField(form, 'Raison du changement', '', 'textarea'); return () => ({ periodStart: start.value, perimeter: perimeter.value, reason: reason.value }); }, async (v) => { const m = await api('mission-version', { missionId, revision: draft.revision, ...v }); data.missions = data.missions.map(x => x.id === m.id ? m : x); selectDraft(m, 'mission'); }); }
    async function collect(evidence) { onActivate(); mount(); if (!data.missions.length)
        await load(); if (!data.missions.length) {
        showError(new Error('Crée d’abord ta mission ; tu pourras ensuite y rattacher cette réalisation.'));
        return;
    } if (!await settle())
        return; dialog('Valoriser une contribution hors mission', form => { const picker = el('select'); for (const m of data.missions) {
        const o = el('option', m.label);
        o.value = m.id;
        picker.append(o);
    } picker.value = evidence.missionId || missionId || data.missions.at(-1).id; form.append(picker); const title = plainField(form, 'Réalisation', evidence.title || ''), description = plainField(form, 'Ce qui a été fait', evidence.description || '', 'textarea'), impact = plainField(form, 'Impact / valeur apportée', evidence.impact || '', 'textarea'), d = plainField(form, 'Date', evidence.date || day(), 'date'), links = plainField(form, 'Liens / preuves (une URL par ligne)', (evidence.links || (evidence.url ? [evidence.url] : [])).join('\n'), 'textarea'); return () => ({ missionId: picker.value, contribution: { id: evidence.id || uid(), title: title.value, description: description.value, impact: impact.value, date: d.value, origin: 'outside', ref: evidence.ref || '', links: links.value.split('\n').map(s => s.trim()).filter(Boolean) } }); }, async (v) => { const m = data.missions.find(m => m.id === v.missionId); const saved = await api('contribution-save', { ...v, revision: m.revision }); data.missions = data.missions.map(x => x.id === saved.id ? saved : x); missionId = saved.id; tab = 'mission'; selectDraft(saved, 'mission'); }); }
    async function requestAi(purpose) { if (!await settle())
        return; if (!missionId) {
        showError(new Error('Enregistre d’abord la mission.'));
        return;
    } const n = root.querySelector('#career-save-status'); n.textContent = 'Préparation de propositions…'; const target = { missionId, interviewId, editVersion }; try {
        const proposal = await ai(purpose);
        if (target.missionId !== missionId || target.interviewId !== interviewId || target.editVersion !== editVersion)
            throw new Error('La fiche a changé pendant la préparation. Relance la proposition sur son état actuel.');
        suggestion = proposal;
        showSuggestion(purpose);
    }
    catch (error) {
        showError(error);
    }
    finally {
        updateStatus();
    } }
    function showSuggestion(purpose) {
        root.querySelector('.career-suggestion')?.remove();
        const box = el('section', undefined, 'career-card career-suggestion');
        box.append(el('h2', 'Proposition de l’IA · à relire'));
        const text = el('textarea');
        text.rows = 12;
        text.value = suggestion.text;
        text.defaultValue = text.value;
        box.append(text);
        if (suggestion.sections) {
            for (const [key, value] of Object.entries(suggestion.sections)) {
                if (!value)
                    continue;
                const section = el('div', undefined, 'career-result');
                section.append(el('h3', labels[key]));
                const proposal = el('textarea');
                proposal.value = value;
                proposal.defaultValue = value;
                proposal.rows = 4;
                section.append(proposal, button('Utiliser cette rubrique', () => { draft.sections[key] += (draft.sections[key] ? '\n\n' : '') + proposal.value; touch(); section.remove(); }));
                box.append(section);
            }
        }
        for (const s of suggestion.sources || []) {
            const row = el('div', undefined, 'career-actions');
            row.append(el('span', `${s.title} · ${s.date?.slice(0, 10) || ''}`, 'muted'));
            if (s.file)
                row.append(button('Source', () => openFile(s.file)));
            else if (s.ref.startsWith('task:'))
                row.append(button('Tâche', () => openTask(s.ref.slice(5))));
            box.append(row);
        }
        box.append(button('Écarter', () => box.remove()), button('Utiliser cette proposition', () => {
            if (purpose === 'bilan') {
                const t = root.querySelector('#career-bilan-text');
                t.value = text.value;
                draft.text = text.value;
                touch();
                box.remove();
                return;
            }
            if (purpose === 'mission') {
                draft.description += (draft.description ? '\n\n' : '') + (suggestion?.mission?.description || text.value);
                for (const g of suggestion?.mission?.goals || [])
                    if (typeof g.title === 'string' && g.title.trim() && !draft.goals.some(existing => existing.title.toLocaleLowerCase() === g.title.toLocaleLowerCase()))
                        draft.goals.push({ id: uid(), title: g.title, why: typeof g.why === 'string' ? g.why : '', actions: typeof g.actions === 'string' ? g.actions : '', priority: 'important', status: 'active', results: (Array.isArray(g.results) ? g.results : []).filter(r => typeof r.title === 'string' && r.title.trim()).map(r => ({ id: uid(), title: r.title, unit: typeof r.unit === 'string' ? r.unit : '', target: typeof r.target === 'number' ? r.target : undefined, direction: 'increase', status: 'not_started' })) });
            }
            else if (purpose.startsWith('section:')) {
                const key = purpose.slice(8);
                draft.sections[key] += (draft.sections[key] ? '\n\n' : '') + text.value;
            }
            else if (suggestion?.sections) {
                for (const [key, value] of Object.entries(suggestion.sections))
                    if (value)
                        draft.sections[key] += (draft.sections[key] ? '\n\n' : '') + value;
            }
            else
                draft.sections.performance += (draft.sections.performance ? '\n\n' : '') + text.value;
            touch();
            render();
        }));
        root.append(box);
        box.scrollIntoView?.({ block: 'nearest' });
    }
    root.addEventListener("focusout", () => win.setTimeout(() => { if(stale && !editing() && !dirty && !saving) void load(); }, 0));
    function mount() { if (mounted) {
        if (stale && !dirty && !saving)
            void load();
        return;
    } mounted = true; render(); void load(); }
    function receive(value) {
        if (['careerResult', 'careerAiResult'].includes(value?.type)) {
            const p = pending.get(value.requestId);
            if (!p)
                return true;
            pending.delete(value.requestId);
            win.clearTimeout(p.t);
            value.error ? p.reject(new Error(value.error)) : p.resolve(value.payload);
            return true;
        }
        if (value?.type === 'cockpitInvalidated' && !value.except?.includes('career')) {
            stale = true;
            if (root.closest('[data-panel]')?.classList.contains('active') && !dirty && !saving)
                void load();
        }
        return false;
    }
    function canLeave() { if (dirty || saving) {
        showError(new Error('L’enregistrement est en cours ou reste à vérifier. Ton brouillon est conservé.'));
        void save();
        return false;
    } return true; }
    return { mount, receive, collect, canLeave, dirty: () => dirty || saving };
}
module.exports = { createCareerPage };
