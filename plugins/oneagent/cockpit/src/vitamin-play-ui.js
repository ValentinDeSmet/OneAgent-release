// Vitamin Play web styles (Apache-2.0) for the OneAgent webviews.
//
// The webviews build their markup as text, without React. Vitamin Play ships
// its component styles as plain CSS classes (@vtmn-play/css), so the screens
// use the exact markup the official Vp* components render (see docs/vitamin-play.md):
//   - vitaminPlayHead() loads the bundled stylesheet (media/vitamin-play, system font);
//   - VITAMIN_PLAY_TOKENS maps the cockpit's colour roles onto semantic tokens,
//     light by default and dark under .vp--dark-mode (wonder-light / wonder-dark);
//   - vitaminPlayEnhancer() turns every button, field, select, checkbox, tab,
//     sticker, link, heading and dialog into its component markup, including
//     the ones rendered later, without touching handlers, ids or data attributes.
const { vpIcon } = require("./vitamin-icons.js");

const escapeAttribute = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function vitaminPlayHead(assets = {}) {
  return assets.vitaminPlayCss ? `<link rel="stylesheet" href="${escapeAttribute(assets.vitaminPlayCss)}">` : "";
}

/** Colour roles of the cockpit, all carried by Vitamin Play semantic tokens. */
const VITAMIN_PLAY_TOKENS = `
      :root {
        color-scheme: light;
        --bg: var(--vp-semantic-color-background-main);
        --panel: var(--vp-semantic-color-container-neutral);
        --surface: var(--vp-semantic-color-background-alternative);
        --surface-2: var(--vp-semantic-color-container-quiet);
        --hover: var(--vp-semantic-color-hover-container-alpha-neutral);
        --overlay: var(--vp-semantic-color-container-neutral);
        --grid-line: transparent;
        --rail-bg: var(--vp-semantic-color-background-alternative);
        --topbar-bg: var(--vp-semantic-color-background-main);
        --side-bg: var(--vp-semantic-color-background-alternative);
        --graph-bg: var(--vp-semantic-color-background-alternative);
        --border: var(--vp-semantic-color-border-quiet);
        --border-strong: var(--vp-semantic-color-border-neutral);
        --text: var(--vp-semantic-color-content-neutral);
        --fg: var(--vp-semantic-color-content-neutral);
        --muted: var(--vp-semantic-color-content-quiet);
        --dim: var(--vp-semantic-color-content-quiet);
        --text-soft: var(--vp-semantic-color-content-quiet);
        --blue: var(--vp-semantic-color-content-brand);
        --green: var(--vp-semantic-color-status-positive);
        --yellow: var(--vp-semantic-color-status-warning);
        --warning: var(--vp-semantic-color-status-warning);
        --red: var(--vp-semantic-color-status-negative);
        --violet: var(--vp-semantic-color-extended-purple);
        --cyan: var(--vp-semantic-color-extended-turquoise);
        --orange: var(--vp-semantic-color-extended-orange);
        --active-bg: var(--vp-semantic-color-container-brand);
        --active-fg: var(--vp-semantic-color-content-on-brand-neutral);
        --node-stroke: var(--vp-semantic-color-border-neutral);
        --node-stroke-strong: var(--vp-semantic-color-content-neutral);
        --incontext: var(--vp-semantic-color-content-brand);
        --edge: var(--vp-semantic-color-border-neutral);
        --edge-default: var(--vp-semantic-color-border-neutral);
        --edge-graphify: var(--vp-semantic-color-extended-turquoise);
        --edge-indirect: var(--vp-semantic-color-extended-orange);
        --track: var(--vp-semantic-color-alpha-neutral-s);
        --accent-soft-bg: var(--vp-semantic-color-alpha-brand-s);
        --accent-soft-border: var(--vp-semantic-color-border-brand);
        --select-checked-bg: var(--vp-semantic-color-container-brand);
        --positive-soft-bg: var(--vp-semantic-color-status-positive-quiet);
        --warning-soft-bg: var(--vp-semantic-color-status-warning-quiet);
        --negative-soft-bg: var(--vp-semantic-color-status-negative-quiet);
        --info-soft-bg: var(--vp-semantic-color-status-info-quiet);
      }
      :root.vp--dark-mode { color-scheme: dark; }
      body {
        font-family: var(--vp-typography-body-s-font-family);
        font-size: var(--vp-typography-body-s-font-size);
        line-height: var(--vp-typography-body-s-line-height);
        letter-spacing: var(--vp-typography-body-s-letter-spacing);
        -webkit-font-smoothing: antialiased;
      }
      .vp-icon { flex: none; }
      .vp-select-container, .vp-input-container { min-width: 0; }
      .vp-tabs { min-width: 0; }
      .vp-tabs > .vp-divider { display: none; }
      .vp-select-trigger { display: flex; width: 100%; align-items: center; justify-content: space-between; text-align: start; cursor: pointer; }
      /* .vp-modal sets display:flex with opacity 0: a closed dialog would stay
         laid out, invisible, over the screen and swallow clicks (graph nodes).
         !important: this block may sit in a cascade layer below Vitamin Play. */
      dialog.vp-modal:not([open]) { display: none !important; }
`;

/** Node colours of the memory graph, per entity kind: data hues of the design system. */
const GRAPH_NODE_TOKENS = {
  domain: "--vp-semantic-color-content-brand",
  subdomain: "--vp-semantic-color-extended-cobalt",
  team: "--vp-semantic-color-extended-green",
  product: "--vp-semantic-color-content-neutral",
  repository: "--vp-semantic-color-extended-orange",
  project: "--vp-semantic-color-extended-turquoise",
  discovery: "--vp-semantic-color-extended-turquoise",
  initiative: "--vp-semantic-color-extended-cobalt",
  feature: "--vp-semantic-color-extended-pink",
  feature_request: "--vp-semantic-color-extended-red",
  practice: "--vp-semantic-color-extended-purple",
  mission: "--vp-semantic-color-extended-purple",
  okr: "--vp-semantic-color-extended-green",
  kpi: "--vp-semantic-color-content-brand",
  insight: "--vp-semantic-color-extended-yellow",
  person: "--vp-semantic-color-extended-orange",
  oneagent: "--vp-semantic-color-extended-turquoise",
  capture: "--vp-semantic-color-extended-grey",
  concept: "--vp-semantic-color-extended-yellow",
  decision: "--vp-semantic-color-status-positive",
  question: "--vp-semantic-color-status-info",
  risk: "--vp-semantic-color-status-negative",
  task: "--vp-semantic-color-extended-orange",
  source: "--vp-semantic-color-content-quiet",
  wiki_page: "--vp-semantic-color-extended-grey",
  group: "--vp-semantic-color-border-neutral"
};

/** Text glyphs used as icons → Vitamin Play icon names. */
const GLYPH_ICONS = {
  "＋": "add", "+": "add", "✓": "check", "✔": "check", "✎": "edit", "✏": "edit", "⧉": "file-copy", "⇄": "exchange", "✕": "close", "×": "close", "✖": "close",
  "−": "subtract", "-": "subtract", "↗": "external-link", "↻": "refresh", "⟳": "refresh", "◐": "moon", "⚙": "settings", "…": "more", "⋯": "more", "⋮": "more-2",
  "▾": "chevron-down", "▼": "chevron-down", "▸": "chevron-right", "▶": "chevron-right", "▴": "chevron-up", "▲": "chevron-up", "◂": "chevron-left", "‹": "chevron-left",
  "›": "chevron-right", "←": "arrow-left", "→": "arrow-right", "↕": "arrow-up-down", "⇅": "arrow-up-down", "⌕": "search", "★": "star", "☆": "star", "↧": "download",
  "⤓": "download", "⤒": "upload", "⤢": "maximize", "⤡": "minimize", "⌫": "delete-bin", "🗑": "delete-bin", "⚑": "notification", "☰": "menu", "≡": "menu",
  "⊕": "add", "⊖": "subtract", "?": "question", "ⓘ": "information", "ℹ": "information", "!": "warning-error", "⚠": "warning-error", "◎": "focus", "◇": "database",
  "⌘": "bezier-curve", "⇱": "maximize", "⇲": "minimize", "⎘": "file-copy", "⏸": "pause", "▷": "play", "■": "stop", "◫": "function-tiles", "☷": "function-rows", "⠿": "drag", "⋮⋮": "drag", "⣿": "drag"
};

/** Accessible names of icon-only buttons → Vitamin Play icon names. */
const LABEL_ICONS = [
  [/modifier|edit|renommer|rename/i, "edit"], [/supprimer|delete|remove|retirer/i, "delete-bin"], [/fermer|close|dismiss/i, "close"],
  [/actions|more|plus d.options|menu/i, "more"], [/déplacer|move|drag|réordonner/i, "drag"], [/ouvrir|open|external/i, "external-link"],
  [/copier|copy|dupliquer|duplicate/i, "file-copy"], [/filtr/i, "filter"], [/recherch|search/i, "search"], [/ajouter|add|nouveau|new/i, "add"],
  [/actualiser|refresh|reload/i, "refresh"], [/aide|help/i, "question"], [/réglages|settings/i, "settings"]
];

/** Icons of the navigation rail, by cockpit view. */
const NAV_ICONS = {
  today: "calendar-date", map: "bezier-curve", priorities: "star", career: "award", tasks: "task", notes: "edit",
  inbox: "mail", sources: "database", help: "question", settings: "settings", workspace: "home"
};

function iconMarkup(names, size) {
  return Object.fromEntries([...new Set(names)].map((name) => [name, vpIcon(name, size)]));
}

/**
 * Client-side script. It runs in the webview, so it is serialised with
 * Function#toString and receives its data as JSON.
 */
function vitaminPlayEnhancerClient(config) {
  const { glyphs, icons, navIcons, chevron, nodeTokens } = config;
  const labelIcons = config.labelIcons.map(([source, flags, name]) => [new RegExp(source, flags), name]);
  const VP = /(^|\s)vp-[a-z]/;
  const TABLISTS = '[role="tablist"], .scope-tabs, .memory-view-tabs, .view-tabs';
  const skipButton = /(^|\s)(graph-menu-item|menu-option|note-card|help-guide|task-link-option|tax-swatch|visibility-cause|md-internal|md-external|chip-x|filter-toggle-caret|filter-section-state|ep-reldel|graph-search-reveal|today-alignment-chip|graph-visibility-chip|graph-context-close)(\s|$)/;
  const linkButton = /(^|\s)(ep-linkish)(\s|$)/;
  const sectionToggle = /(^|\s)(filter-section-toggle|task-link-section-toggle)(\s|$)/;
  const stickerHost = /(^|\s)(badge|chip|pill|tag|status-pill|kind-pill)(\s|$)/;
  const textTypes = new Set(["", "text", "search", "number", "date", "datetime-local", "time", "url", "email", "month", "week", "tel", "password"]);
  const add = (el, ...names) => el.classList.add(...names.filter(Boolean));
  const has = (el, re) => re.test(el.className && typeof el.className === "string" ? el.className : "");

  function iconFor(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || trimmed.length > 2) return undefined;
    return glyphs[trimmed];
  }

  function stickerVariant(el) {
    const text = (el.className + " " + (el.textContent || "")).toLowerCase();
    if (/critical|high|fail|error|danger|blocked|overdue|risk|reject|negative|stale/.test(text)) return "negative";
    if (/medium|pending|warn|waiting|soon|clarify|draft|at_risk|partial/.test(text)) return "warning";
    if (/done|curated|success|accepted|achieved|positive|healthy|\bok\b/.test(text)) return "positive";
    if (/agent|curating|in_progress|in progress|info|active|ready|open/.test(text)) return "info";
    return "neutral";
  }

  function syncTab(button) {
    const selected = button.classList.contains("active") || button.getAttribute("aria-selected") === "true";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) button.setAttribute("data-selected", ""); else button.removeAttribute("data-selected");
  }

  function syncChip(button) {
    const checked = button.classList.contains("active") || button.getAttribute("aria-pressed") === "true";
    if (checked) button.setAttribute("data-checked", ""); else button.removeAttribute("data-checked");
  }

  /** VpModal shows on data-open, which the React component sets with the native open state. */
  function syncDialog(dialog) {
    if (dialog.open) dialog.setAttribute("data-open", ""); else dialog.removeAttribute("data-open");
  }

  function setIcon(button, name) {
    if (!icons[name] || button.querySelector(":scope > svg.vp-icon")) return;
    const label = button.getAttribute("aria-label") || button.getAttribute("title") || "";
    if (label) button.setAttribute("aria-label", label);
    button.innerHTML = icons[name];
  }

  function enhanceButton(button) {
    if (button.dataset.vp || has(button, VP) || button.closest(".vp-search, .vp-chip")) return;
    button.dataset.vp = "1";
    if (has(button, skipButton)) return;
    if (button.closest("th")) return;
    // A clickable card or list row (several blocks of content) is not a button pattern.
    if (button.querySelectorAll(":scope > :is(div, p, strong, b, h2, h3, h4, ul, ol, small)").length >= 1 && button.children.length >= 2) return;
    if (has(button, linkButton)) { add(button, "vp-link", "vp-link--small"); return; }
    if (has(button, sectionToggle)) { add(button, "vp-accordion__item-header"); return; }
    const view = button.dataset.view;
    if (view && navIcons[view] && button.closest(".nav")) {
      add(button, "vp-icon-button", "vp-icon-button--ghost", "vp-icon-button--icon");
      setIcon(button, navIcons[view]);
      return;
    }
    const tablist = button.closest(TABLISTS);
    if (tablist || has(button, /(^|\s)(tab|ep-tab|memory-view-tab)(\s|$)/)) {
      add(button, "vp-tabs__trigger");
      syncTab(button);
      return;
    }
    if (has(button, /(^|\s)([a-z-]*chip)(\s|$)/)) {
      add(button, "vp-chip");
      syncChip(button);
      return;
    }
    if (has(button, /(^|\s)(subject|row-title|item-title|title-link|memory-title|entity-title|note-title)(\s|$)/)) { add(button, "vp-link", "vp-link--small"); return; }
    // A custom dropdown trigger reads as a Select field (VpSelect), not as a button.
    if (has(button, /(^|\s)(menu-button|select-button|picker-button)(\s|$)/)) { add(button, "vp-select", "vp-select--small", "vp-select-trigger"); return; }
    // The close action of a dialog header is VpModalCloseButton: an icon button.
    if (button.closest(".vp-modal__header, dialog > header") && /fermer|close/i.test((button.textContent || "") + " " + (button.getAttribute("aria-label") || ""))) {
      if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", (button.textContent || "").replace(/[×✕]/g, "").trim() || "Fermer");
      add(button, "vp-icon-button", "vp-icon-button--small", "vp-icon-button--ghost", "vp-icon-button--icon");
      button.innerHTML = "";
      setIcon(button, "close");
      return;
    }
    const text = (button.textContent || "").trim();
    const label = button.getAttribute("aria-label") || button.getAttribute("title") || "";
    const svgOnly = !text && button.querySelector("svg") && !button.querySelector("*:not(svg):not(svg *)");
    const icon = iconFor(text) || (button.id === "themeToggle" ? "moon" : undefined) || (svgOnly ? (labelIcons.find(([re]) => re.test(label)) || [])[1] : undefined);
    if (icon && (svgOnly || !button.querySelector("*:not(svg):not(svg *)"))) {
      add(button, "vp-icon-button", "vp-icon-button--small", "vp-icon-button--ghost", "vp-icon-button--icon");
      button.innerHTML = "";
      setIcon(button, icon);
      return;
    }
    if (svgOnly) { add(button, "vp-icon-button", "vp-icon-button--small", "vp-icon-button--ghost", "vp-icon-button--icon"); return; }
    if (/^[▸▾▶▼›]/.test(text)) { add(button, "vp-button", "vp-button--small", "vp-button--tertiary"); return; }
    const negative = button.classList.contains("danger") || button.classList.contains("destructive");
    const primary = button.classList.contains("primary") || button.getAttribute("type") === "submit" && !negative;
    add(button, "vp-button", "vp-button--small", negative ? "vp-button--negative" : primary ? "" : "vp-button--secondary");
  }

  function enhanceTablist(list) {
    if (list.dataset.vp) return;
    list.dataset.vp = "1";
    add(list, "vp-tabs__list");
    list.setAttribute("role", "tablist");
    if (!list.parentElement.classList.contains("vp-tabs")) {
      const root = document.createElement("div");
      root.className = "vp-tabs";
      list.replaceWith(root);
      root.append(list);
    }
  }

  // Screens sometimes move a field into another slot: its previous wrapper is
  // dropped and the field is wrapped again where it now lives.
  const wrappers = new WeakMap();
  function rewrap(field, containerClass) {
    if (field.parentElement && field.parentElement.classList.contains(containerClass)) return false;
    const previous = wrappers.get(field);
    if (previous && !previous.contains(field)) previous.remove();
    return true;
  }

  function enhanceSelect(select) {
    if (!rewrap(select, "vp-select-container")) return;
    select.dataset.vp = "1";
    add(select, "vp-select", "vp-select--small");
    const root = document.createElement("div");
    wrappers.set(select, root);
    root.className = "vp-select-container vp-select-container--small";
    if (select.style.display === "none") root.style.display = "none";
    select.replaceWith(root);
    root.append(select);
    root.insertAdjacentHTML("beforeend", chevron);
  }

  function enhanceInput(input) {
    const type = (input.getAttribute("type") || "").toLowerCase();
    if (type === "checkbox") {
      if (input.dataset.vp) return;
      input.dataset.vp = "1";
      return enhanceCheckbox(input);
    }
    if (!textTypes.has(type) || input.closest(".vp-search") || !rewrap(input, "vp-input-container")) return;
    input.dataset.vp = "1";
    add(input, "vp-input", "vp-input--small");
    const root = document.createElement("div");
    wrappers.set(input, root);
    root.className = "vp-input-container";
    root.setAttribute("data-part", "root");
    if (input.style.display === "none") root.style.display = "none";
    input.replaceWith(root);
    root.append(input);
  }

  function enhanceCheckbox(input) {
    if (input.closest(".vp-chip")) return;
    add(input, "vp-checkbox__input");
    let label = input.parentElement && input.parentElement.tagName === "LABEL" ? input.parentElement : undefined;
    if (!label) {
      label = document.createElement("label");
      input.replaceWith(label);
      label.append(input);
    }
    add(label, "vp-checkbox");
    const control = document.createElement("span");
    control.className = "vp-checkbox__control";
    control.setAttribute("aria-hidden", "true");
    input.before(control);
    const rest = [...label.childNodes].filter((node) => node !== input && node !== control && !(node.nodeType === 3 && !node.textContent.trim()));
    if (rest.length) {
      const text = document.createElement("span");
      text.className = "vp-checkbox__label";
      rest.forEach((node) => text.append(node));
      label.append(text);
    }
  }

  function enhanceSticker(el) {
    if (el.dataset.vp || has(el, VP) || el.tagName === "BUTTON" || el.closest("button")) return;
    el.dataset.vp = "1";
    add(el, "vp-sticker", "vp-sticker--small", "vp-sticker--" + stickerVariant(el));
  }

  function enhanceDialog(dialog) {
    add(dialog, "vp-modal");
    syncDialog(dialog);
    dialog.querySelectorAll(":scope > header").forEach((el) => add(el, "vp-modal__header"));
    dialog.querySelectorAll(":scope > footer").forEach((el) => add(el, "vp-modal__footer"));
    dialog.querySelectorAll(":scope > .inbox-review-body, :scope > div").forEach((el) => add(el, "vp-modal__body"));
  }

  const headingClass = { H1: "vp-title-s", H2: "vp-subtitle-l", H3: "vp-subtitle-m", H4: "vp-subtitle-m" };

  function enhance(root) {
    if (!root || root.nodeType !== 1) return;
    const all = (selector) => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    all(TABLISTS).forEach(enhanceTablist);
    all("dialog").forEach(enhanceDialog);
    all("button").forEach(enhanceButton);
    all("select").forEach(enhanceSelect);
    all("input").forEach(enhanceInput);
    all("textarea").forEach((area) => { if (!has(area, VP)) add(area, "vp-textarea"); });
    all("span, em, small, b").forEach((el) => { if (has(el, stickerHost)) enhanceSticker(el); });
    all("h1, h2, h3, h4").forEach((heading) => { if (!has(heading, VP)) add(heading, headingClass[heading.tagName]); });
    all("a[href]").forEach((link) => { if (!has(link, VP) && !link.closest(".vp-tabs__list")) add(link, "vp-link", "vp-link--small"); });

  }

  let pending = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    const roots = [...pending];
    pending = new Set();
    roots.forEach((node) => { if (node.isConnected) enhance(node); });
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const el = record.target;
        if (el.tagName === "DIALOG") syncDialog(el);
        else if (el.classList.contains("vp-tabs__trigger")) syncTab(el);
        else if (el.classList.contains("vp-chip") && el.tagName === "BUTTON") syncChip(el);
        continue;
      }
      record.addedNodes.forEach((node) => { if (node.nodeType === 1) pending.add(node); });
    }
    if (!scheduled && pending.size) { scheduled = true; requestAnimationFrame(flush); }
  });

  function setDarkMode(dark) {
    document.documentElement.classList.toggle("vp--dark-mode", Boolean(dark));
  }

  /** Resolved node colours for the graph canvas, which cannot read CSS variables. */
  function graphNodeColors() {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(Object.entries(nodeTokens).map(([kind, token]) => [kind, hex(style.getPropertyValue(token))]));
  }

  /** Token values come as #RRGGBBAA; the graph and saved kind colours use #rrggbb. */
  function hex(value) {
    const text = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{8}$/.test(text) && text.endsWith("ff") ? text.slice(0, 7) : text || "#949494";
  }

  const watch = (root) => observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "open"] });

  /** A shadow root (embedded screen) gets the stylesheet and the same enhancement. */
  function adopt(shadow) {
    const sheet = document.querySelector('link[rel="stylesheet"][href*="vitamin-play.css"]');
    if (sheet && !shadow.querySelector('link[href*="vitamin-play.css"]')) shadow.append(sheet.cloneNode());
    [...shadow.children].forEach(enhance);
    watch(shadow);
  }

  // A standalone canvas has no theme toggle: it follows the system appearance.
  if (config.followSystemTheme && window.matchMedia) {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    setDarkMode(dark.matches);
    dark.addEventListener("change", (event) => setDarkMode(event.matches));
  }

  window.vitaminPlay = { enhance, adopt, setDarkMode, graphNodeColors, tokenColor: (token) => hex(getComputedStyle(document.documentElement).getPropertyValue(token)) };
  enhance(document.body);
  watch(document.body);
}

/** Source of the client script, to place at the start of the page's inline script. */
function vitaminPlayEnhancer(options = {}) {
  const config = {
    followSystemTheme: Boolean(options.followSystemTheme),
    glyphs: GLYPH_ICONS,
    icons: iconMarkup([...Object.values(GLYPH_ICONS), ...Object.values(NAV_ICONS), ...LABEL_ICONS.map(([, name]) => name)], 20),
    labelIcons: LABEL_ICONS.map(([re, name]) => [re.source, re.flags, name]),
    navIcons: NAV_ICONS,
    chevron: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24" stroke-width="1.5" aria-hidden="true" class="vp-select-indicator" data-part="indicator"><path d="M6 9L12 15L18 9" stroke="currentColor"></path></svg>',
    nodeTokens: GRAPH_NODE_TOKENS
  };
  const data = JSON.stringify(config).replace(/</g, "\\u003c");
  return `(${vitaminPlayEnhancerClient.toString()})(${data});`;
}

module.exports = { vitaminPlayHead, vitaminPlayEnhancer, VITAMIN_PLAY_TOKENS, GRAPH_NODE_TOKENS, GLYPH_ICONS, NAV_ICONS, LABEL_ICONS };
