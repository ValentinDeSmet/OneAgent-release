// Structured memory search, shared by the memory table and the graph.
//
// A query is free words plus combinable criteria, all of which must match:
//   tag:bcp            the entity carries a tag containing "bcp"
//   type:personne      the entry is of that kind (id or French label)
//   équipe:1FF         in the perimeter of team 1FF (any kind key works:
//   projet:"Nom"       projet, produit, domaine, personne… or dans: for any kind)
//   source:"Orga BCP"  extracted from, or linked to, a matching document
//   moi:               what concerns the user: their own perimeter, what they
//                      own or contribute to, their mission, tasks and notes
// A comma means "one of" (team:1ff,2ff), a leading "-" excludes, quotes keep
// spaces. Free words also search tags, aliases and the parent chain.
//
// A perimeter is the entity, everything below it in the hierarchy (contains,
// part_of, owns, scoped_to, parent…) at any depth, then one ring of the other
// relations around that core (people, decisions, risks, tasks…).
//
// Self-contained: the cockpit embeds it in the webview with toString().
function createMemoryQuery() {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase().trim();
  const FIELDS = { tag: 'tag', tags: 'tag', etiquette: 'tag', type: 'type', kind: 'type', source: 'source', doc: 'source', document: 'source', dans: 'in', in: 'in', scope: 'in', perimetre: 'in', moi: 'me', me: 'me' };
  const KINDS = {
    equipe: 'team', team: 'team', projet: 'project', project: 'project', produit: 'product', product: 'product',
    domaine: 'domain', domain: 'domain', 'sous-domaine': 'subdomain', sousdomaine: 'subdomain', subdomain: 'subdomain',
    personne: 'person', person: 'person', depot: 'repository', repo: 'repository', repository: 'repository',
    initiative: 'initiative', fonctionnalite: 'feature', feature: 'feature', demande: 'feature_request', feature_request: 'feature_request',
    okr: 'okr', kpi: 'kpi', mission: 'mission', discovery: 'discovery', pratique: 'practice', practice: 'practice', insight: 'insight'
  };
  // The key written back for a kind, French first.
  const KIND_KEYS = { team: 'équipe', project: 'projet', product: 'produit', domain: 'domaine', subdomain: 'sous-domaine', person: 'personne', repository: 'dépôt', feature: 'fonctionnalité', feature_request: 'demande', practice: 'pratique' };
  // Hierarchy predicates: true when the edge source is the parent.
  const HIERARCHY = { contains: true, owns: true, has_okr: true, has_repository: true, part_of: false, scoped_to: false, owned_by: false };
  const SOURCE_CATEGORIES = new Set(['capture', 'source', 'document']);

  function splitValues(text, raw) {
    const values = []; let current = '', quoted = false;
    for (const char of text) {
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ',' && !quoted) { values.push(current); current = ''; continue; }
      current += char;
    }
    values.push(current);
    return raw ? values.map(value => value.trim()).filter(value => normalize(value)) : values.map(normalize).filter(Boolean);
  }

  function tokenize(text) {
    const source = String(text || ''), tokens = [];
    let index = 0;
    while (index < source.length) {
      while (index < source.length && /\s/.test(source[index])) index++;
      if (index >= source.length) break;
      const start = index; let quoted = false;
      while (index < source.length && (quoted || !/\s/.test(source[index]))) { if (source[index] === '"') quoted = !quoted; index++; }
      tokens.push({ text: source.slice(start, index), start, end: index });
    }
    return tokens;
  }

  /** Field key for a criterion key, or undefined when the token is a plain word. */
  function fieldFor(key, kinds) {
    const name = normalize(key);
    if (FIELDS[name]) return { field: FIELDS[name] };
    if (KINDS[name]) return { field: 'in', kind: KINDS[name] };
    if (kinds && kinds.has(name)) return { field: 'in', kind: name };
    return undefined;
  }

  const parsed = new Map();
  function parse(text, kinds) {
    const cacheKey = String(text || '') + '\u0000' + (kinds ? [...kinds].join(',') : '');
    if (parsed.has(cacheKey)) return parsed.get(cacheKey);
    const words = [], criteria = [];
    for (const token of tokenize(text)) {
      const negate = token.text.length > 1 && token.text[0] === '-';
      const body = negate ? token.text.slice(1) : token.text;
      const match = /^([^\s:"]+):(.*)$/s.exec(body);
      const field = match && fieldFor(match[1], kinds);
      if (field) {
        const values = field.field === 'me' ? ['moi'] : splitValues(match[2]);
        if (values.length) criteria.push({ ...field, key: match[1], values, display: field.field === 'me' ? [] : splitValues(match[2], true), negate });
        continue;
      }
      const value = normalize(body.replace(/"/g, ''));
      if (value) words.push({ value, display: body.replace(/"/g, ''), negate });
    }
    const result = { words, criteria, empty: !words.length && !criteria.length };
    if (parsed.size > 200) parsed.clear();
    parsed.set(cacheKey, result);
    return result;
  }

  const endpoint = value => value && typeof value === 'object' ? value.id : value;
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(value); };

  let cached;
  /** Entities, hierarchy, relations and sources from the cockpit state; rebuilt when the state changes. */
  function index(state, entityRef) {
    const graph = state.graph || {}, entities = state.entities || [], entries = state.memoryIndex?.entries || [], tasks = state.tasks || [];
    if (cached && cached.graph === graph && cached.entities === entities && cached.entries === entries && cached.tasks === tasks) return cached;
    const records = new Map();
    const record = (ref, kind) => {
      if (!records.has(ref)) records.set(ref, { ref, kind: kind || ref.split(':')[0], label: '', aliases: [], tags: [], parentIds: [], people: [] });
      return records.get(ref);
    };
    const merge = (target, values) => { for (const value of values || []) if (typeof value === 'string' && value && !target.includes(value)) target.push(value); };
    for (const entity of entities) {
      if (!entity || !entity.kind || !entity.id) continue;
      const item = record(entity.kind + ':' + entity.id, entity.kind);
      item.label = item.label || entity.label || entity.id;
      merge(item.aliases, entity.aliases); merge(item.tags, entity.tags); merge(item.people, [...(entity.ownerIds || []), ...(entity.contributorIds || [])]);
      if (entity.parentId) merge(item.parentIds, [entity.parentId]);
    }
    const nodeRefs = new Map(), selfRefs = new Set();
    for (const node of graph.nodes || []) {
      const ref = entityRef(node);
      nodeRefs.set(node.id, ref || 'node:' + node.id);
      if (!ref) continue;
      if (node.meta?.self) selfRefs.add(ref);
      const item = record(ref, node.meta?.kind);
      item.label = item.label || node.label || ref;
      merge(item.tags, node.meta?.tags);
      if (node.meta?.parentId) merge(item.parentIds, [node.meta.parentId]);
    }
    const byId = new Map();
    for (const item of records.values()) add(byId, item.ref.split(':').slice(1).join(':'), item.ref);
    const children = new Map(), parents = new Map(), links = new Map();
    const link = (parent, child) => { if (parent !== child) { add(children, parent, child); add(parents, child, parent); } };
    for (const item of records.values()) {
      for (const parentId of item.parentIds) {
        const candidates = [...(byId.get(parentId) || [])];
        const parent = candidates.find(ref => ['domain', 'subdomain', 'team'].includes(ref.split(':')[0])) || candidates[0];
        if (parent) link(parent, item.ref);
      }
    }
    const captureLinks = new Map();
    for (const edge of graph.edges || []) {
      const source = nodeRefs.get(endpoint(edge.source)), target = nodeRefs.get(endpoint(edge.target));
      if (!source || !target || source === target) continue;
      const down = HIERARCHY[edge.predicate || edge.label];
      if (down === true) link(source, target);
      else if (down === false) link(target, source);
      else { add(links, source, target); add(links, target, source); }
      for (const id of Array.isArray(edge.meta?.capturedFrom) ? edge.meta.capturedFrom : []) { add(captureLinks, 'capture:' + id, source); add(captureLinks, 'capture:' + id, target); }
    }
    // Documents and captures, with what they mention or produced.
    const sources = [];
    for (const entry of entries) {
      if (!SOURCE_CATEGORIES.has(entry.category)) continue;
      const refs = new Set([...(entry.refs || []), ...(captureLinks.get(entry.id) || [])]);
      sources.push({ id: entry.id, title: entry.title || '', text: normalize([entry.title, entry.file, entry.url, entry.description].filter(Boolean).join(' ')), refs });
    }
    for (const node of graph.nodes || []) {
      if (!['capture', 'source'].includes(node.type)) continue;
      const ref = nodeRefs.get(node.id), id = node.type === 'capture' ? 'capture:' + (node.meta?.captureId || node.id.replace(/^capture:/, '')) : node.id;
      if (sources.some(item => item.id === id)) continue;
      sources.push({ id, title: node.label || '', text: normalize(node.label), refs: new Set([...(links.get(ref) || []), ...(children.get(ref) || []), ...(parents.get(ref) || []), ...(captureLinks.get(id) || [])]) });
    }
    cached = { graph, entities, entries, tasks, selfRefs, records, children, parents, links, sources, perimeters: new Map(), ancestors: new Map(), kinds: new Set([...records.values()].map(item => normalize(item.kind))) };
    return cached;
  }

  function ancestorText(idx, ref) {
    if (idx.ancestors.has(ref)) return idx.ancestors.get(ref);
    const labels = [], seen = new Set([ref]);
    let frontier = [ref];
    for (let level = 0; level < 20 && frontier.length; level++) {
      const next = [];
      for (const id of frontier) for (const parent of idx.parents.get(id) || []) {
        if (seen.has(parent)) continue;
        seen.add(parent); next.push(parent);
        const item = idx.records.get(parent);
        if (item) labels.push(item.label, ...item.aliases);
      }
      frontier = next;
    }
    const text = normalize(labels.join(' '));
    idx.ancestors.set(ref, text);
    return text;
  }

  /** Core (hierarchy below the root, any depth) plus one ring of other relations. */
  function perimeter(idx, root) {
    if (idx.perimeters.has(root)) return idx.perimeters.get(root);
    const core = new Set([root]);
    let frontier = [root];
    while (frontier.length) {
      const next = [];
      for (const id of frontier) for (const child of idx.children.get(id) || []) if (!core.has(child)) { core.add(child); next.push(child); }
      frontier = next;
    }
    const all = new Set(core);
    for (const id of core) for (const neighbour of idx.links.get(id) || []) all.add(neighbour);
    const result = { core, all };
    idx.perimeters.set(root, result);
    return result;
  }

  /** Entities a criterion value names: exact label, id or alias first, otherwise partial. */
  function roots(idx, kind, value) {
    const candidates = [...idx.records.values()].filter(item => !kind || normalize(item.kind) === kind);
    const names = item => [item.label, item.ref.split(':').slice(1).join(':'), ...item.aliases].map(normalize);
    const exact = candidates.filter(item => names(item).includes(value));
    return (exact.length ? exact : candidates.filter(item => names(item).some(name => name.includes(value)))).map(item => item.ref);
  }

  function perimeterSet(idx, kind, value) {
    const key = 'in\u0000' + (kind || '') + '\u0000' + value;
    if (idx.perimeters.has(key)) return idx.perimeters.get(key);
    const set = new Set();
    for (const root of roots(idx, kind, value)) for (const ref of perimeter(idx, root).all) set.add(ref);
    idx.perimeters.set(key, set);
    return set;
  }

  /** What concerns the user: their perimeter, what they own or contribute to, missions, own tasks and notes. */
  function meSet(idx) {
    if (idx.me) return idx.me;
    const refs = new Set(), entries = new Set();
    const selfIds = new Set([...idx.selfRefs].map(ref => ref.split(':').slice(1).join(':')));
    for (const self of idx.selfRefs) for (const ref of perimeter(idx, self).all) refs.add(ref);
    for (const item of idx.records.values()) {
      if (item.kind === 'mission') for (const ref of perimeter(idx, item.ref).all) refs.add(ref);
      if (item.people.some(id => selfIds.has(id) || idx.selfRefs.has(id))) refs.add(item.ref);
    }
    for (const task of idx.tasks) if (task.assignee === 'me') entries.add('task:' + task.id);
    for (const entry of idx.entries) if (entry.category === 'note') entries.add(entry.id);
    idx.me = { refs, entries };
    return idx.me;
  }

  function sourceSet(idx, value) {
    const key = 'source\u0000' + value;
    if (idx.perimeters.has(key)) return idx.perimeters.get(key);
    const set = new Set();
    for (const source of idx.sources) if (source.text.includes(value)) { set.add(source.id); for (const ref of source.refs) set.add(ref); }
    idx.perimeters.set(key, set);
    return set;
  }

  /** The entities an entry stands for: itself for an entity, what it mentions otherwise. */
  function entryRefs(entry) {
    if (entry.category === 'entity' || (entry.category === 'graph' && entry.detailRef)) return entry.detailRef ? [entry.detailRef] : [];
    return [...new Set([...(entry.refs || []), ...(entry.detailRef ? [entry.detailRef] : [])])];
  }

  function kindMatches(kind, value, label) {
    const wanted = KINDS[value] || value;
    return normalize(kind) === wanted || normalize(kind).startsWith(value) || normalize(label(kind)).startsWith(value);
  }

  function criterionMatches(criterion, entry, refs, idx, label) {
    return criterion.values.some(value => {
      if (criterion.field === 'type') return (entry.kinds || [entry.kind]).some(kind => kind && kindMatches(kind, value, label));
      if (criterion.field === 'tag') return refs.some(ref => (idx.records.get(ref)?.tags || []).some(tag => normalize(tag).includes(value)));
      if (criterion.field === 'in') { const set = perimeterSet(idx, criterion.kind, value); return refs.some(ref => set.has(ref)); }
      if (criterion.field === 'me') { const me = meSet(idx); return me.entries.has(entry.id) || (entry.representations || []).some(item => me.entries.has(item.id)) || refs.some(ref => me.refs.has(ref)); }
      if (criterion.field === 'source') { const set = sourceSet(idx, value); return set.has(entry.id) || (entry.representations || []).some(item => set.has(item.id)) || refs.some(ref => set.has(ref)); }
      return false;
    });
  }

  /** Whether an entry satisfies every word and criterion. haystack is its already normalized text. */
  function matches(query, entry, haystack, idx, label) {
    if (query.empty) return true;
    const refs = entryRefs(entry);
    let text = haystack;
    if (query.words.length) {
      const own = entry.category === 'entity' || entry.category === 'graph' ? refs : [];
      const extra = own.flatMap(ref => { const item = idx.records.get(ref); return item ? [...item.tags, ...item.aliases, ancestorText(idx, ref)] : []; });
      text = haystack + ' ' + normalize(extra.join(' '));
    }
    for (const word of query.words) if (text.includes(word.value) === word.negate) return false;
    for (const criterion of query.criteria) if (criterionMatches(criterion, entry, refs, idx, label) === criterion.negate) return false;
    return true;
  }

  const quote = value => /[\s,"]/.test(value) ? '"' + value.replace(/"/g, '') + '"' : value;
  /** The search text that shows an entity's perimeter. */
  function perimeterQuery(kind, label) {
    const key = KIND_KEYS[kind] || (Object.values(KINDS).includes(kind) ? kind : 'dans');
    return key + ':' + quote(String(label || '').trim());
  }

  /** Readable criteria, for the chips above the results. */
  function describe(query, label) {
    const fieldNames = { tag: 'Tag', type: 'Type', source: 'Source', in: 'Périmètre', me: 'Ce qui me concerne' };
    return [
      ...query.criteria.map(criterion => ({ negate: criterion.negate, text: criterion.field === 'me' ? fieldNames.me : (criterion.field === 'in' && criterion.kind ? label(criterion.kind) : fieldNames[criterion.field]) + ' : ' + (criterion.display || criterion.values).join(' ou ') })),
      ...query.words.map(word => ({ negate: word.negate, text: '« ' + (word.display || word.value) + ' »' }))
    ];
  }

  const KEY_HINTS = [['tag:', 'un tag'], ['type:', 'un type d’entité'], ['équipe:', 'le périmètre d’une équipe'], ['projet:', 'le périmètre d’un projet'], ['produit:', 'le périmètre d’un produit'], ['domaine:', 'le périmètre d’un domaine'], ['personne:', 'ce qui touche une personne'], ['source:', 'ce qui vient d’un document'], ['moi:', 'ce qui me concerne'], ['dans:', 'le périmètre de n’importe quelle entité']];

  /** Completions for the token being typed (the last one), replacing it when picked. */
  function suggest(text, idx, label) {
    const source = String(text || '');
    if (!source || /\s$/.test(source)) return [];
    const token = tokenize(source).at(-1);
    if (!token) return [];
    const negate = token.text.length > 1 && token.text[0] === '-';
    const body = negate ? token.text.slice(1) : token.text;
    const prefix = source.slice(0, token.start) + (negate ? '-' : '');
    const match = /^([^\s:"]+):(.*)$/s.exec(body);
    const field = match && fieldFor(match[1], idx.kinds);
    const result = [];
    if (!field) {
      const partial = normalize(body);
      if (!partial || partial.length < 2) return [];
      for (const [key, hint] of KEY_HINTS) if (normalize(key).startsWith(partial) && normalize(key) !== partial + ':') result.push({ label: key, hint, text: prefix + key });
      return result.slice(0, 4);
    }
    if (field.field === 'me') return [];
    const partial = splitValues(match[2]).at(-1) || '';
    const head = match[2].includes(',') ? match[2].slice(0, match[2].lastIndexOf(',') + 1) : '';
    const counts = new Map();
    const offer = (value, hint) => { const key = normalize(value); if (!key || (partial && !key.includes(partial)) || counts.has(key)) return; counts.set(key, { label: value, hint }); };
    if (field.field === 'tag') {
      const tags = new Map();
      for (const item of idx.records.values()) for (const tag of item.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
      [...tags].sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => offer(tag, count + (count > 1 ? ' entités' : ' entité')));
    } else if (field.field === 'type') {
      [...new Set([...idx.records.values()].map(item => item.kind))].sort().forEach(kind => offer(label(kind), kind));
    } else if (field.field === 'source') {
      idx.sources.forEach(item => offer(item.title, item.refs.size + ' entités liées'));
    } else {
      [...idx.records.values()].filter(item => !field.kind || normalize(item.kind) === field.kind)
        .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
        .forEach(item => offer(item.label, field.kind ? '' : label(item.kind)));
    }
    for (const item of [...counts.values()].slice(0, 8)) result.push({ label: match[1] + ':' + item.label, hint: item.hint, text: prefix + match[1] + ':' + head + quote(item.label) + ' ' });
    return result;
  }

  return { normalize, parse, index, matches, perimeter, perimeterQuery, describe, suggest, tokenize };
}
module.exports = { createMemoryQuery };
