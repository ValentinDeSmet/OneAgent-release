const fs = require("node:fs");
const path = require("node:path");

const GUIDE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_AGENT_CONTEXT_CHAR_LIMIT = 64000;
const DOCUMENTATION_QUERY_STOP_WORDS = new Set([
  "a", "about", "and", "are", "avec", "comment", "dans", "de", "des", "do",
  "does", "est", "et", "faire", "for", "how", "i", "in", "is", "je", "la",
  "le", "les", "me", "my", "of", "on", "oneagent", "ou", "pour", "que",
  "qui", "sur", "the", "to", "un", "une", "use", "utiliser", "what", "with"
]);

function loadDocumentationBundle(extensionPath, options = {}) {
  const docsRoot = path.resolve(extensionPath, options.docsDirectory || "docs");
  const catalogPath = path.join(docsRoot, "catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const entries = Array.isArray(catalog) ? catalog : catalog?.guides;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("OneAgent documentation catalog must contain at least one guide.");
  }

  const seenIds = new Set();
  const guides = entries.map((entry, index) => {
    const id = requiredText(entry?.id, `Guide ${index + 1} id`);
    if (!GUIDE_ID_PATTERN.test(id)) {
      throw new Error(`Invalid OneAgent documentation guide id: ${id}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate OneAgent documentation guide id: ${id}`);
    }
    seenIds.add(id);

    const relativeFile = requiredText(entry?.file, `Guide ${id} file`);
    const filePath = path.resolve(docsRoot, relativeFile);
    if (!isPathInside(filePath, docsRoot) || path.extname(filePath).toLowerCase() !== ".md") {
      throw new Error(`Guide ${id} must point to a Markdown file inside the documentation directory.`);
    }

    return {
      id,
      title: requiredText(entry?.title, `Guide ${id} title`),
      summary: optionalText(entry?.summary),
      category: optionalText(entry?.category) || "Guides",
      order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index,
      keywords: Array.isArray(entry?.keywords)
        ? entry.keywords.map(optionalText).filter(Boolean)
        : [],
      sourceFile: relativeFile.split(path.sep).join("/"),
      markdown: fs.readFileSync(filePath, "utf8")
    };
  }).sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));

  const requestedDefault = optionalText(catalog?.defaultGuideId);
  const defaultGuideId = requestedDefault && seenIds.has(requestedDefault)
    ? requestedDefault
    : guides[0].id;

  return {
    defaultGuideId,
    guides,
    releaseNotesMarkdown: loadLatestReleaseNotes(extensionPath)
  };
}

function createDocumentationFallback(error) {
  const detail = error instanceof Error ? error.message : String(error || "Unknown documentation error");
  return {
    defaultGuideId: "documentation-unavailable",
    guides: [{
      id: "documentation-unavailable",
      title: "Help is temporarily unavailable",
      summary: "OneAgent is still running, but its bundled guides could not be opened.",
      category: "Help",
      order: 0,
      keywords: ["help", "documentation", "troubleshooting"],
      markdown: "# Help is temporarily unavailable\n\nOneAgent itself can continue to run. Reinstall the latest OneAgent update to restore the built-in guides.\n\nTechnical detail: " + detail
    }],
    releaseNotesMarkdown: ""
  };
}

function selectDocumentationGuide(bundle, query) {
  const guides = Array.isArray(bundle?.guides) ? bundle.guides : [];
  if (!guides.length) return undefined;
  const terms = documentationQueryTerms(query);
  if (!terms.length) {
    return guides.find((guide) => guide.id === bundle?.defaultGuideId) || guides[0];
  }

  let bestGuide;
  let bestScore = 0;
  for (const guide of guides) {
    const title = documentationTokenSet(guide.title);
    const id = documentationTokenSet(guide.id);
    const category = documentationTokenSet(guide.category);
    const summary = documentationTokenSet(guide.summary);
    const keywords = documentationTokenSet((guide.keywords || []).join(" "));
    const markdown = documentationTokenSet(guide.markdown);
    let score = 0;
    for (const term of terms) {
      if (title.has(term)) score += 14;
      if (id.has(term)) score += 11;
      if (keywords.has(term)) score += 9;
      if (category.has(term)) score += 5;
      if (summary.has(term)) score += 4;
      if (markdown.has(term)) score += 1;
    }
    if (score > bestScore) {
      bestGuide = guide;
      bestScore = score;
    }
  }
  return bestGuide || guides.find((guide) => guide.id === bundle?.defaultGuideId) || guides[0];
}

function buildDocumentationAgentContext(bundle, query, options = {}) {
  const guides = Array.isArray(bundle?.guides) ? bundle.guides : [];
  const requestedLimit = Number(options.maxChars);
  const maxChars = Number.isFinite(requestedLimit)
    ? Math.max(8000, Math.min(200000, Math.round(requestedLimit)))
    : DEFAULT_AGENT_CONTEXT_CHAR_LIMIT;
  const selected = selectDocumentationGuide(bundle, query);
  const orderedGuides = selected
    ? [selected, ...guides.filter((guide) => guide.id !== selected.id)]
    : guides;
  const sections = [
    "# OneAgent bundled documentation",
    "Use these local guides as the source of truth for product behavior and user instructions."
  ];
  let length = sections.join("\n\n").length;
  let truncated = false;

  for (const guide of orderedGuides) {
    const section = [
      `## Guide: ${guide.title || guide.id}`,
      `Guide id: ${guide.id || "unknown"}`,
      guide.category ? `Category: ${guide.category}` : "",
      guide.summary ? `Summary: ${guide.summary}` : "",
      String(guide.markdown || "").trim()
    ].filter(Boolean).join("\n\n");
    const remaining = maxChars - length - 2;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (section.length <= remaining) {
      sections.push(section);
      length += section.length + 2;
      continue;
    }
    if (remaining >= 1000) {
      sections.push(`${section.slice(0, Math.max(0, remaining - 38)).trimEnd()}\n\n[Guide truncated for chat context]`);
    }
    truncated = true;
    break;
  }

  const releaseNotes = String(bundle?.releaseNotesMarkdown || "").trim();
  if (releaseNotes && !truncated) {
    const releaseSection = `## Latest release notes\n\n${releaseNotes}`;
    if (length + releaseSection.length + 2 <= maxChars) {
      sections.push(releaseSection);
    } else {
      truncated = true;
    }
  }
  let markdown = sections.join("\n\n");
  if (truncated) {
    const notice = "Some less relevant guide content was omitted to fit the chat model context.";
    const separator = "\n\n";
    const contentLimit = Math.max(0, maxChars - separator.length - notice.length);
    markdown = `${markdown.slice(0, contentLimit).trimEnd()}${separator}${notice}`;
  }
  return {
    markdown: markdown.slice(0, maxChars),
    selectedGuideId: selected?.id,
    guideCount: guides.length,
    truncated
  };
}

function renderDocumentationIndexMarkdown(bundle) {
  const guides = Array.isArray(bundle?.guides) ? bundle.guides : [];
  if (!guides.length) {
    return "### OneAgent Help\n\nThe bundled guides are temporarily unavailable.";
  }
  const lines = [
    "### OneAgent Help",
    "",
    "Ask a question after `/oneagent-help`, for example:",
    "",
    "- `/oneagent-help How do I ingest a file from chat?`",
    "- `/oneagent-help What is the difference between a Graph View and the Active Context?`",
    "- `/oneagent-help How does local Markdown search work?`",
    "",
    "Available local guides:"
  ];
  let previousCategory;
  for (const guide of guides) {
    if (guide.category !== previousCategory) {
      lines.push("", `**${guide.category || "Guides"}**`);
      previousCategory = guide.category;
    }
    lines.push(`- **${guide.title}**${guide.summary ? ` — ${guide.summary}` : ""}`);
  }
  return lines.join("\n");
}

function loadLatestReleaseNotes(extensionPath) {
  const changelogPath = path.join(extensionPath, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return "";
  const changelog = fs.readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n");
  const heading = /^##\s+([^\n]+)\s*$/m.exec(changelog);
  if (!heading) return "";
  const bodyStart = heading.index + heading[0].length;
  const remainder = changelog.slice(bodyStart);
  const nextHeading = /^##\s+/m.exec(remainder);
  const body = (nextHeading ? remainder.slice(0, nextHeading.index) : remainder).trim();
  return `## Version ${heading[1].trim()}\n${body}`.trim();
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function requiredText(value, label) {
  const text = optionalText(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optionalText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function documentationQueryTerms(value) {
  return [...new Set(
    normalizeDocumentationText(value)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 2 && !DOCUMENTATION_QUERY_STOP_WORDS.has(term))
  )];
}

function normalizeDocumentationText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function documentationTokenSet(value) {
  return new Set(normalizeDocumentationText(value).split(/[^a-z0-9]+/).filter(Boolean));
}

module.exports = {
  DEFAULT_AGENT_CONTEXT_CHAR_LIMIT,
  GUIDE_ID_PATTERN,
  buildDocumentationAgentContext,
  createDocumentationFallback,
  isPathInside,
  loadDocumentationBundle,
  loadLatestReleaseNotes,
  renderDocumentationIndexMarkdown,
  selectDocumentationGuide
};
