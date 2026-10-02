const { prioritiesBootstrap } = require("./priorities-view.js");

function renderCockpitHtml(payload, assets = {}) {
  const data = JSON.stringify(payload).replace(/</g, "\\u003c");
  const nonce = assets.nonce || "";
  const graphViewerScript = assets.graphViewerScript || "";
  const csp = assets.cspSource
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${assets.cspSource} data:; style-src ${assets.cspSource} 'unsafe-inline'; script-src ${assets.cspSource} 'nonce-${escapeHtmlAttribute(nonce)}'; ${assets.connectSource ? `connect-src ${escapeHtmlAttribute(assets.connectSource)};` : ''}">`
    : "";
  const graphViewerTag = graphViewerScript
    ? `<script nonce="${escapeHtmlAttribute(nonce)}" src="${escapeHtmlAttribute(graphViewerScript)}"></script>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${csp}
    <title>OneAgent Cockpit</title>
    <style>
      /* Theming: every color is a token. :root is the default (dark) theme;
         each extra theme is ONE token block below (see vp-light). To add a
         theme: add a body[data-theme=NAME] token block here + a THEMES[NAME]
         entry (mode + nodes) in the script (it is auto-added to the toggle).
         No base CSS rule needs editing. */
      :root {
        color-scheme: dark;
        --bg: #101010;
        --panel: rgba(32, 32, 34, 0.82);
        --surface: rgba(255,255,255,0.035);
        --surface-2: rgba(255,255,255,0.055);
        --hover: rgba(255,255,255,0.07);
        --overlay: #202024;
        --grid-line: rgba(255,255,255,0.025);
        --rail-bg: rgba(12,12,13,0.9);
        --topbar-bg: rgba(18,18,19,0.78);
        --side-bg: rgba(19,19,20,0.86);
        --graph-bg: radial-gradient(circle at 50% 50%, rgba(50,50,54,0.92), #242427 100%);
        --border: rgba(255, 255, 255, 0.12);
        --border-strong: rgba(255, 255, 255, 0.22);
        --text: #f4f1ea;
        --muted: #a8a5a0;
        --dim: #706d69;
        --text-soft: #d6d1c8;
        --blue: #79a7ff;
        --green: #58d68d;
        --yellow: #e2c86f;
        --red: #ed6a73;
        --violet: #b998ff;
        --cyan: #65d7de;
        --orange: #f0b36a;
        --active-bg: #f1eee5;
        --active-fg: #171717;
        --node-stroke: rgba(255,255,255,0.75);
        --node-stroke-strong: rgba(255,255,255,0.95);
        --incontext: #6ea8fe;
        --edge: rgba(244,241,234,0.24);
        --edge-graphify: rgba(101,215,222,0.54);
        --edge-indirect: rgba(226,200,111,0.42);
        --score-bg: rgba(88,214,141,0.1);
        --track: rgba(255,255,255,0.08);
        --accent-soft-bg: rgba(121,167,255,0.14);
        --accent-soft-border: rgba(121,167,255,0.45);
        --select-checked-bg: #2d4f82;
      }
      body[data-theme="vp-light"] {
        color-scheme: light;
        --bg: #ffffff;
        --panel: #ffffff;
        --surface: #f5f4f5;
        --surface-2: #f5f4f5;
        --hover: rgba(0,0,0,0.05);
        --overlay: #ffffff;
        --grid-line: rgba(0,0,0,0.045);
        --rail-bg: #f5f4f5;
        --topbar-bg: #ffffff;
        --side-bg: #f5f4f5;
        --graph-bg: radial-gradient(circle at 50% 50%, #ffffff, #f0eff0 100%);
        --border: #e1e0df;
        --border-strong: #949494;
        --text: #101010;
        --muted: #616161;
        --dim: #949494;
        --text-soft: #616161;
        --blue: #3643ba;
        --active-bg: #3643ba;
        --active-fg: #ffffff;
        --node-stroke: rgba(0,0,0,0.45);
        --node-stroke-strong: #101010;
        --incontext: #3643ba;
        --edge: rgba(16,16,16,0.22);
        --edge-graphify: rgba(14,124,134,0.5);
        --edge-indirect: rgba(180,83,9,0.42);
        --score-bg: rgba(1,127,92,0.12);
        --track: rgba(0,0,0,0.08);
        --accent-soft-bg: rgba(54,67,186,0.1);
        --accent-soft-border: rgba(54,67,186,0.35);
        --select-checked-bg: #3643ba;
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body {
        background:
          linear-gradient(var(--grid-line) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px),
          var(--bg);
        background-size: 44px 44px;
        color: var(--text);
        font-family: var(--vscode-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
        overflow: hidden;
      }
      button, input, select { font: inherit; color: inherit; }
      button { cursor: pointer; }
      .app { display: grid; grid-template-columns: 58px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); height: 100vh; }
      .rail {
        display: grid;
        grid-template-rows: 58px 1fr auto;
        border-right: 1px solid var(--border);
        background: var(--rail-bg);
      }
      .logo { display: grid; place-items: center; border-bottom: 1px solid var(--border); }
      .logo-mark { width: 25px; height: 25px; position: relative; }
      .logo-mark span { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: var(--text); }
      .logo-mark span:nth-child(1) { left: 0; top: 8px; }
      .logo-mark span:nth-child(2) { left: 8px; top: 0; }
      .logo-mark span:nth-child(3) { left: 16px; top: 8px; }
      .logo-mark span:nth-child(4) { left: 8px; top: 16px; }
      .nav, .rail-foot { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0; }
      .nav button, .rail-foot button {
        width: 38px;
        height: 38px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--muted);
      }
      .nav button:hover, .nav button.active, .rail-foot button:hover {
        border-color: var(--border);
        background: var(--hover);
        color: var(--text);
      }
      .shell { display: grid; grid-template-rows: 58px minmax(0, 1fr); min-width: 0; min-height: 0; }
      .topbar {
        display: grid;
        grid-template-columns: minmax(150px, 0.7fr) minmax(0, auto) minmax(180px, 0.55fr);
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border);
        background: var(--topbar-bg);
        position: relative;
        z-index: 20;
      }
      .brand { display: flex; min-width: 0; align-items: baseline; gap: 10px; }
      .brand strong { font-size: 14px; }
      .brand span { min-width: 0; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .toolbar { display: flex; min-width: 0; align-items: center; gap: 6px; }
      .map-toolbar { overflow: visible; }
      .topbar:not(.map-active) .map-toolbar { display: none; }
      .topbar:not(.map-active) .graph-search { display: none; }
      .topbar:not(.map-active) .hidden-mode { display: none; }
      .topbar.help-active { grid-template-columns: minmax(0, 1fr); }
      .topbar.help-active .toolbar { display: none; }
      .graph-search { position: relative; flex: 1 1 auto; min-width: 120px; max-width: 260px; }
      .graph-search .control { width: 100%; min-width: 0; }
      .graph-search-results {
        position: absolute;
        top: 38px;
        left: 0;
        z-index: 130;
        display: grid;
        gap: 2px;
        width: 380px;
        max-height: 340px;
        overflow-y: auto;
        padding: 5px;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: var(--overlay);
        box-shadow: 0 18px 44px rgba(0,0,0,0.42);
      }
      .graph-search-results[hidden] { display: none; }
      .graph-search-empty { padding: 9px 8px; color: var(--muted); font-size: 12px; }
      .graph-search-row {
        display: flex;
        align-items: center;
        gap: 7px;
        min-height: 30px;
        padding: 3px 7px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--fg);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .graph-search-row:hover { border-color: var(--border); background: var(--surface-2); }
      .graph-search-row .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; }
      .graph-search-row .graph-search-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .graph-search-row small { flex: none; color: var(--dim); font-size: 10px; }
      .graph-search-row.hidden-node .graph-search-label { color: var(--muted); }
      .graph-search-reason {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--warning, #d9a54a);
        font-size: 10px;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .graph-search-reveal {
        flex: none;
        height: 22px;
        padding: 0 9px;
        border: 1px solid var(--accent-soft-border);
        border-radius: 6px;
        background: var(--accent-soft);
        color: var(--fg);
        font-size: 11px;
        cursor: pointer;
      }
      .hidden-mode { display: flex; flex: none; align-items: center; gap: 3px; padding: 3px 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .hidden-mode span { padding: 0 3px; color: var(--dim); font-size: 10px; text-transform: uppercase; }
      .hidden-mode button { height: 24px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; }
      .hidden-mode button.active { background: var(--active-bg); color: var(--active-fg); }
      .graph-visibility-chip {
        position: absolute;
        bottom: 26px;
        right: 178px;
        z-index: 3;
        padding: 6px 12px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--topbar-bg);
        color: var(--muted);
        font-size: 11px;
        cursor: pointer;
        box-shadow: 0 12px 30px rgba(0,0,0,0.22);
      }
      .graph-visibility-chip strong { color: var(--fg); }
      .graph-visibility-chip .warn { color: var(--warning, #d9a54a); }
      .graph-visibility-breakdown {
        position: absolute;
        bottom: 62px;
        right: 178px;
        z-index: 4;
        display: grid;
        gap: 2px;
        min-width: 220px;
        padding: 6px;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: var(--overlay);
        box-shadow: 0 18px 44px rgba(0,0,0,0.42);
      }
      .graph-visibility-breakdown[hidden] { display: none; }
      .visibility-cause {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        min-height: 26px;
        padding: 3px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--muted);
        font-size: 11px;
        text-align: left;
        cursor: pointer;
      }
      .visibility-cause:hover { border-color: var(--border); background: var(--surface-2); }
      .visibility-cause strong { color: var(--fg); }
      .visibility-cause.warn strong { color: var(--warning, #d9a54a); }
      .visibility-cause.none { cursor: default; }
      .node.ghost { opacity: 0.2; }
      .node.ghost:hover { opacity: 0.55; }
      .edge.ghost { opacity: 0.16; stroke-dasharray: 4 4; }
      .scope-tabs { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .tab { height: 30px; min-width: 56px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); }
      .tab.active { background: var(--active-bg); color: var(--active-fg); }
      .control, .score, .action {
        height: 34px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface-2);
      }
      .control { padding: 0 9px; min-width: 104px; }
      .graph-context-menu {
        position: fixed;
        z-index: 120;
        display: grid;
        gap: 3px;
        width: 198px;
        padding: 5px;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: var(--overlay);
        box-shadow: 0 18px 44px rgba(0,0,0,0.42);
      }
      .graph-context-menu[hidden] { display: none; }
      .graph-menu-title {
        padding: 6px 7px 4px;
        color: var(--dim);
        font-size: 10px;
        font-weight: 800;
        overflow: hidden;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .graph-menu-reason {
        padding: 2px 7px 6px;
        color: var(--warning, #d9a54a);
        font-size: 11px;
      }
      .graph-menu-item {
        min-height: 30px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--text);
        padding: 7px 8px;
        text-align: left;
      }
      .graph-menu-item:hover { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
      .graph-menu-item[disabled] { color: var(--dim); pointer-events: none; }
      .graph-menu-item.danger { color: var(--red); }
      .graph-menu-item.danger:hover { border-color: rgba(237,106,115,0.4); background: rgba(237,106,115,0.1); }
      .action.danger { color: var(--red); border-color: rgba(237,106,115,0.4); }
      .action.danger:hover { background: rgba(237,106,115,0.12); }
      .badge.curation-curated { border-color: rgba(88,214,141,0.4); color: var(--green); }
      .badge.curation-pending { border-color: rgba(226,200,111,0.45); color: var(--yellow); }
      .badge.curation-curating { border-color: var(--accent-soft-border); color: var(--blue); }
      .badge.curation-failed { border-color: rgba(237,106,115,0.5); color: var(--red); }
      .badge.ingestion-failed { border-color: rgba(237,106,115,0.5); color: var(--red); }
      .focus-section .filter-section-body { gap: 6px; }
      .focus-field { display: flex; align-items: center; gap: 6px; }
      .focus-field > span { min-width: 44px; color: var(--dim); font-size: 11px; text-transform: uppercase; }
      .focus-field .control, .focus-field .focus-filter { flex: 1; min-width: 0; }
      .focus-field .focus-filter button { min-width: 0; flex: 1; }
      .relation-quick { display: flex; align-items: center; gap: 4px; }
      .relation-quick > span { color: var(--dim); font-size: 11px; text-transform: uppercase; padding-right: 2px; }
      .relation-quick button { flex: 1; height: 24px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
      .relation-quick button:hover { border-color: var(--accent-soft-border); color: var(--text); }
      .relation-quick button.active { border-color: var(--active-bg); background: var(--active-bg); color: var(--active-fg); }
      .focus-filter { display: inline-flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
      .focus-filter span { padding: 0 4px; color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
      .focus-filter button { min-width: 76px; height: 24px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
      .focus-filter button:hover { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); color: var(--text); }
      .focus-filter button.active { border-color: var(--active-bg); background: var(--active-bg); color: var(--active-fg); }
      #graphGroupMode { min-width: 112px; width: 124px; }
      #graphLayoutMode { min-width: 118px; width: 132px; }
      .inbox-explainer { margin: 2px 0 0; padding: 6px 8px; border: 1px solid var(--accent-soft-border); border-radius: 7px; background: var(--accent-soft-bg); color: var(--muted); font-size: 12px; line-height: 1.45; }
      .view-preset { display: inline-flex; align-items: center; gap: 4px; }
      #graphViewPreset { min-width: 118px; max-width: 168px; }
      #graphViewPreset.dirty { border-color: var(--accent-soft-border); }
      .view-preset .view-action { min-width: 26px; width: 26px; padding: 4px 0; text-align: center; }
      .action { padding: 0 10px; }
      .operation { display: none; max-width: 260px; min-height: 28px; align-items: center; padding: 0 9px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .operation.active { display: inline-flex; }
      .operation.running { border-color: rgba(121,167,255,0.38); color: var(--blue); }
      .operation.success { border-color: rgba(88,214,141,0.38); color: var(--green); }
      .operation.warning { border-color: rgba(226,200,111,0.45); color: var(--yellow); }
      .operation.error { border-color: rgba(237,106,115,0.45); color: var(--red); }
      .score {
        display: grid;
        place-items: center;
        min-width: 46px;
        border-color: rgba(88,214,141,0.38);
        background: var(--score-bg);
        color: var(--green);
        font-weight: 800;
      }
      .content {
        --side-width: 352px;
        display: grid;
        grid-template-columns: minmax(420px, 1fr) 10px minmax(300px, var(--side-width));
        grid-template-rows: minmax(0, 1fr);
        min-height: 0;
      }
      .content.side-hidden { grid-template-columns: minmax(0, 1fr); }
      .content.side-hidden .side-resizer,
      .content.side-hidden .side { display: none; }
      .stage { position: relative; overflow: hidden; min-width: 0; min-height: 0; }
      .side-resizer {
        position: relative;
        z-index: 15;
        min-width: 10px;
        border-left: 1px solid var(--border);
        border-right: 1px solid transparent;
        background: linear-gradient(90deg, transparent, var(--surface), transparent);
        cursor: col-resize;
        touch-action: none;
      }
      .side-resizer::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 3px;
        height: 42px;
        border-left: 1px solid var(--dim);
        border-right: 1px solid var(--dim);
        opacity: 0.42;
        transform: translate(-50%, -50%);
      }
      .side-resizer:hover,
      .side-resizer.dragging {
        background: var(--accent-soft-bg);
        border-left-color: var(--accent-soft-border);
        border-right-color: var(--accent-soft-border);
      }
      .side-resizer:hover::after,
      .side-resizer.dragging::after { opacity: 0.82; }
      .panel { display: none; height: 100%; }
      .panel.active { display: block; }
      .graph-stage { position: relative; width: 100%; height: 100%; min-height: 100%; }
      #graphCanvas { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }
      #graph { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
      .enhanced-graph #graph { display: none; }
      .graph-stage:not(.enhanced-graph) #graphCanvas { display: none; }
      .oneagent-graph-viewer { width: 100%; height: 100%; min-height: 100%; background: var(--graph-bg); }
      .edge { stroke: var(--edge); stroke-width: 1.4; marker-end: url(#arrow); }
      .edge.graphify { stroke: var(--edge-graphify); stroke-width: 2; }
      .edge.indirect { stroke: var(--edge-indirect); stroke-dasharray: 4 6; }
      .fold-badge circle { fill: var(--overlay); stroke: var(--border-strong); stroke-width: 1.2; }
      .fold-badge text { font-size: 9px; font-weight: 700; fill: var(--text); }
      .edge.low { stroke-dasharray: 5 6; }
      .node { cursor: pointer; }
      .node.pulse { animation: nodePulse 0.9s ease-in-out 4; }
      @keyframes nodePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
      .live-toast { position: fixed; right: 18px; bottom: 16px; z-index: 80; padding: 8px 14px; border-radius: 999px; background: var(--panel); color: var(--text); border: 1px solid var(--accent-soft-border); font-size: 12px; opacity: 0; transform: translateY(8px); transition: opacity 0.25s ease, transform 0.25s ease; pointer-events: none; }
      .live-toast.visible { opacity: 1; transform: translateY(0); }
      .node circle, .node rect, .node polygon { stroke: var(--node-stroke); stroke-width: 1.2; }
      .node.selected circle, .node.selected rect, .node.selected polygon { stroke-width: 2.5; filter: drop-shadow(0 0 18px rgba(255,255,255,0.18)); }
      .node.focus-primary circle, .node.focus-primary rect, .node.focus-primary polygon { stroke: var(--node-stroke-strong); stroke-width: 3; filter: drop-shadow(0 0 16px rgba(121,167,255,0.28)); }
      .node.focus-supporting circle, .node.focus-supporting rect, .node.focus-supporting polygon { stroke: rgba(226,200,111,0.86); stroke-width: 2.2; }
      .node.in-context circle, .node.in-context rect, .node.in-context polygon { stroke: var(--incontext); stroke-width: 2.6; }
      .node.dimmed { opacity: 0.18; }
      .node text { fill: var(--text); font-size: 12px; pointer-events: none; }
      .node .kind { fill: var(--muted); font-size: 10px; text-transform: uppercase; }
      .legend { display: none; }
      .graph-tools { position: absolute; right: 18px; bottom: 18px; z-index: 3; display: grid; grid-template-columns: repeat(3, 34px); gap: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--topbar-bg); box-shadow: 0 18px 42px rgba(0,0,0,0.24); }
      .graph-tools button { min-width: 34px; height: 30px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-2); }
      .graph-tools button.active { border-color: var(--border-strong); color: var(--text); background: rgba(255,255,255,0.1); }
      .graph-filter-panel { position: absolute; left: 18px; top: 18px; bottom: 18px; z-index: 3; width: min(380px, calc(100% - 36px)); min-height: 0; display: flex; flex-direction: column; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--overlay); box-shadow: 0 18px 42px rgba(0,0,0,0.24); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
      .graph-filter-panel.collapsed { bottom: auto; width: min(260px, calc(100% - 36px)); max-height: none; overflow: hidden; }
      .graph-filter-panel.collapsed .filter-head { cursor: pointer; }
      .graph-context-panel {
        position: absolute;
        top: 18px;
        right: 18px;
        z-index: 12;
        display: flex;
        flex-direction: column;
        width: min(390px, calc(100% - 36px));
        max-height: calc(100% - 110px);
        overflow: hidden;
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        background: var(--overlay);
        box-shadow: 0 22px 54px rgba(0,0,0,0.38);
      }
      .graph-context-panel[hidden] { display: none; }
      .graph-context-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 11px; border-bottom: 1px solid var(--border); background: var(--surface); }
      .graph-context-panel-title { display: grid; min-width: 0; gap: 2px; }
      .graph-context-panel-title strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
      .graph-context-panel-title small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      .graph-context-panel-head-actions { display: flex; flex: none; align-items: center; gap: 6px; }
      .context-status { min-height: 22px; padding: 2px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 10px; }
      .context-status.active { border-color: rgba(88,214,141,0.4); color: var(--green); }
      .context-status.draft { border-color: rgba(226,200,111,0.45); color: var(--yellow); }
      .graph-context-close { width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); }
      .graph-context-close:hover { background: var(--hover); color: var(--text); }
      .graph-context-panel-body { min-height: 0; overflow-y: auto; padding: 11px; overscroll-behavior: contain; }
      .context-panel-section { display: grid; gap: 9px; }
      .context-panel-section + .context-panel-section { margin-top: 13px; padding-top: 13px; border-top: 1px solid var(--border); }
      .context-panel-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .context-panel-section-head strong { font-size: 12px; }
      .context-panel-section-head small { color: var(--muted); font-size: 10px; }
      .context-panel-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 6px; }
      .context-panel-metric { min-width: 0; padding: 7px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
      .context-panel-metric span { display: block; overflow: hidden; color: var(--dim); font-size: 9px; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
      .context-panel-metric strong { display: block; margin-top: 3px; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .context-panel-tabs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; }
      .context-panel-tabs button { height: 28px; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--muted); font-size: 11px; }
      .context-panel-tabs button.active { border-color: var(--active-bg); background: var(--active-bg); color: var(--active-fg); }
      .context-panel-row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
      .context-panel-field { display: grid; min-width: 0; gap: 4px; color: var(--muted); font-size: 10px; }
      .context-panel-field input, .context-panel-field select, .context-pack-objective { width: 100%; min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-2); color: var(--text); }
      .context-pack-objective { height: 58px; padding: 7px 8px; resize: vertical; line-height: 1.35; }
      .context-panel-actions { display: flex; justify-content: flex-end; gap: 7px; }
      .context-panel-actions button { min-height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-2); color: var(--text); font-size: 11px; }
      .context-panel-actions button.primary { border-color: var(--active-bg); background: var(--active-bg); color: var(--active-fg); }
      .context-panel-actions button[disabled] { opacity: 0.45; cursor: default; }
      .context-role-list { display: grid; gap: 5px; max-height: 152px; overflow-y: auto; }
      .context-role-row { display: grid; grid-template-columns: minmax(0,1fr) 88px 22px; gap: 5px; align-items: center; min-height: 30px; padding: 5px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
      .context-role-row.proposed { border-color: rgba(226,200,111,0.45); background: rgba(226,200,111,0.06); }
      .context-role-main { display: grid; min-width: 0; gap: 2px; }
      .context-role-main span { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .context-role-main small { overflow: hidden; color: var(--muted); font-size: 9px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
      .context-role-row select { min-width: 0; height: 23px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-2); font-size: 9px; }
      .context-role-row button { width: 22px; height: 22px; border: 0; background: transparent; color: var(--muted); }
      .context-advanced { border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
      .context-advanced summary { padding: 8px; color: var(--muted); font-size: 11px; cursor: pointer; }
      .context-advanced-body { display: grid; gap: 7px; padding: 0 8px 8px; }
      .context-pack-summary { padding: 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 11px; line-height: 1.45; }
      .context-pack-summary strong { color: var(--text); }
      .context-pack-summary.warning { border-color: rgba(226,200,111,0.45); color: var(--yellow); }
      .context-pack-history { display: grid; gap: 5px; }
      .context-pack-history button { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px; align-items: center; min-height: 32px; padding: 5px 7px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--muted); text-align: left; }
      .context-pack-history button:hover, .context-pack-history button.active { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); color: var(--text); }
      .context-pack-history button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .context-pack-history button small { font-size: 9px; }
      .context-pack-entry { margin-top: 5px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
      .context-pack-entry summary { padding: 7px; font-size: 10px; cursor: pointer; }
      .context-pack-entry-body { padding: 0 7px 7px; color: var(--muted); font-size: 10px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
      @media (max-width: 900px) {
        .graph-context-panel { right: 10px; top: 10px; width: min(350px, calc(100% - 20px)); max-height: calc(100% - 90px); }
      }
      .filter-head, .filter-actions, .filter-row { display: flex; align-items: center; gap: 8px; }
      .filter-head { justify-content: space-between; }
      .filter-head-actions { display: flex; align-items: center; gap: 6px; }
      .filter-head strong { font-size: 12px; text-transform: uppercase; color: var(--muted); }
      .filter-head span { color: var(--dim); font-size: 11px; }
      .filter-toggle-caret { min-width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--muted); }
      .filter-toggle-caret:hover { border-color: var(--border-strong); color: var(--text); }
      .filter-sections { display: grid; flex: 0 0 auto; gap: 8px; min-height: 0; padding-right: 3px; }
      .filter-section { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); overflow: hidden; }
      .filter-section.off { opacity: 0.58; }
      .filter-section.empty { opacity: 0.45; }
      .filter-section-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; min-height: 34px; padding: 6px; cursor: pointer; }
      .filter-section-head:hover { background: var(--surface); }
      .filter-section-toggle { min-width: 0; height: 28px; display: flex; align-items: center; gap: 7px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; }
      .filter-section-toggle:hover { background: var(--surface-2); }
      .filter-section-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; text-transform: capitalize; }
      .filter-section-count { padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 10px; line-height: 16px; }
      .filter-section-caret { color: var(--dim); font-size: 11px; }
      .filter-section-body { display: grid; gap: 8px; min-height: 0; padding: 0 8px 8px; }
      .filter-section-state { height: 26px; padding: 0 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 11px; }
      .filter-section-state:hover { border-color: var(--border-strong); color: var(--text); }
      .filter-actions { flex-wrap: wrap; }
      .filter-action { min-height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 12px; }
      .filter-action:hover { border-color: var(--border-strong); color: var(--text); }
      .filter-select, .filter-search { width: 100%; min-height: 32px; border: 1px solid var(--border); border-radius: 7px; background: var(--overlay); color: var(--text); color-scheme: dark; padding: 0 9px; }
      .filter-select option { background: var(--overlay); color: var(--text); }
      .filter-select option:checked { background: var(--select-checked-bg); color: #ffffff; }
      .filter-values { display: grid; gap: 4px; min-height: 0; max-height: 250px; overflow: auto; padding-right: 3px; }
      .relation-type-box { display: grid; gap: 7px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .relation-type-head { display: grid; gap: 3px; }
      .relation-type-head strong { color: var(--text); font-size: 12px; }
      .relation-type-head small { color: var(--dim); font-size: 10px; line-height: 1.35; }
      .relation-type-box .filter-values { max-height: 220px; }
      .filter-value { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 28px; padding: 4px 6px; border: 1px solid transparent; border-radius: 7px; color: var(--muted); font-size: 12px; }
      .filter-value:hover { border-color: var(--border); background: var(--surface); color: var(--text); }
      .filter-value.select-all { border-top: 1px solid var(--border); border-radius: 0; margin-top: 2px; padding-top: 8px; color: var(--text); }
      .filter-value input { width: 14px; height: 14px; accent-color: var(--blue); }
      .filter-value span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .filter-value small { color: var(--dim); font-size: 10px; }
      .relation-category-box { display: grid; gap: 7px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .relation-category-head { display: grid; gap: 3px; }
      .relation-category-head strong { color: var(--text); font-size: 12px; }
      .relation-category-head small { color: var(--dim); font-size: 10px; line-height: 1.35; }
      .relation-category-list { display: grid; gap: 5px; }
      .relation-category-option { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start; gap: 7px; padding: 6px; border: 1px solid var(--border); border-radius: 7px; background: var(--overlay); color: var(--muted); font-size: 12px; }
      .relation-category-option:hover { border-color: var(--border-strong); color: var(--text); }
      .relation-category-option.active { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); color: var(--text); }
      .relation-category-option input { width: 14px; height: 14px; margin-top: 2px; accent-color: var(--blue); }
      .relation-category-option span { display: grid; min-width: 0; gap: 2px; }
      .relation-category-option strong { display: inline-flex; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .relation-category-option small { color: var(--dim); font-size: 10px; }
      .relation-category-option em { min-width: 0; overflow: hidden; color: var(--text-soft); font-size: 10px; font-style: normal; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
      .relation-category-empty { padding: 8px; color: var(--dim); font-size: 12px; }
      .chip { display: inline-flex; align-items: center; gap: 7px; min-height: 26px; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); font-size: 12px; background: var(--surface); }
      button.chip { cursor: pointer; }
      .legend-chip.disabled { opacity: 0.42; text-decoration: line-through; }
      .legend-chip:hover { border-color: var(--border-strong); color: var(--text); }
      .dot { width: 8px; height: 8px; border-radius: 50%; }
      .list-panel { padding: 18px; overflow: auto; }
      .title-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
      .title-row h1 { margin: 0; font-size: 24px; letter-spacing: 0; }
      .title-row p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
      .task-view-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .task-view-controls .control { min-width: 136px; color-scheme: dark; background: var(--overlay); }
      .task-entity-filter { position: relative; }
      .task-entity-filter-toggle { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; }
      .task-entity-filter-toggle::after { content: "▾"; color: var(--muted); font-size: 10px; }
      .task-entity-filter.open .task-entity-filter-toggle::after { content: "▴"; }
      .task-entity-filter-panel {
        display: none;
        position: absolute;
        z-index: 25;
        right: 0;
        top: calc(100% + 6px);
        width: min(320px, 78vw);
        max-height: 360px;
        overflow: auto;
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--overlay);
        box-shadow: 0 18px 42px rgba(0,0,0,0.32);
      }
      .task-entity-filter.open .task-entity-filter-panel { display: grid; gap: 6px; }
      .task-entity-filter-actions { display: flex; justify-content: space-between; gap: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
      .task-entity-filter-actions button { min-height: 26px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--muted); font-size: 11px; }
      .task-entity-filter-actions button:hover { color: var(--text); border-color: var(--border-strong); }
      .task-entity-filter-option { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 30px; padding: 4px 5px; border-radius: 6px; color: var(--text); font-size: 12px; }
      .task-entity-filter-option:hover { background: var(--hover); }
      .task-entity-filter-option span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .task-entity-filter-option small { color: var(--dim); font-size: 10px; }
      .task-entity-filter-empty { margin: 4px; color: var(--muted); font-size: 12px; }
      .columns { display: grid; grid-template-columns: repeat(5, minmax(180px, 1fr)); gap: 12px; min-width: 960px; }
      .task-groups { display: grid; gap: 16px; min-width: 960px; }
      .task-group { display: grid; gap: 8px; }
      .task-group > h2 { display: flex; align-items: center; justify-content: space-between; margin: 0; color: var(--text); font-size: 13px; letter-spacing: 0; }
      .task-group > h2 span { color: var(--muted); font-size: 12px; font-weight: 650; }
      .lane, .card { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .lane h2 { display: flex; justify-content: space-between; margin: 0; padding: 12px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 12px; text-transform: uppercase; }
      .task, .proposal { margin: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
      .task { display: grid; gap: 9px; width: calc(100% - 20px); text-align: left; cursor: grab; touch-action: none; }
      .task:hover, .task.selected { border-color: var(--border-strong); background: var(--hover); }
      .task { user-select: none; }
      .task.dragging { opacity: .52; border-color: rgba(121,167,255,0.55); cursor: grabbing; }
      .lane.drag-over { border-color: rgba(121,167,255,0.55); background: rgba(121,167,255,0.08); }
      .task strong, .proposal strong { display: block; margin-bottom: 6px; font-size: 13px; }
      .task span, .proposal span { color: var(--muted); font-size: 12px; line-height: 1.45; }
      .task-meta { display: flex; flex-wrap: wrap; gap: 6px; }
      .badge { display: inline-flex; align-items: center; min-height: 22px; padding: 0 7px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); font-size: 11px; background: var(--surface); }
      .badge.priority-critical, .badge.priority-high { border-color: rgba(237,106,115,0.45); color: var(--red); }
      .badge.priority-medium { border-color: rgba(226,200,111,0.45); color: var(--yellow); }
      .badge.assignee-agent { border-color: rgba(185,152,255,0.45); color: var(--violet); }
      .inbox-kind { border-color: var(--accent-soft-border); color: var(--blue); background: var(--accent-soft-bg); }
      .inbox-kind.create { border-color: rgba(88,214,141,0.38); color: var(--green); }
      .inbox-kind.update { border-color: rgba(226,200,111,0.45); color: var(--yellow); }
      .inbox-kind.link { border-color: rgba(185,152,255,0.45); color: var(--violet); }
      .inbox-kind.attention { border-color: rgba(237,106,115,0.55); color: var(--red, #ed6a73); background: rgba(237,106,115,0.12); }
      .inbox-problems { display: grid; gap: 4px; padding: 7px 9px; border: 1px solid rgba(237,106,115,0.4); border-radius: 7px; background: rgba(237,106,115,0.08); }
      .inbox-problems strong { color: var(--red, #ed6a73); font-size: 12px; }
      .inbox-problems span { color: var(--muted); font-size: 12px; line-height: 1.4; }
      .inbox-problems .repair { color: var(--dim); }
      .diag-action { justify-self: start; margin-top: 4px; padding: 3px 10px; font-size: 12px; }
      .proposal { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; }
      .proposal.selected { border-color: var(--border-strong); background: var(--hover); }
      .proposal-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .proposal-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .inbox-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 18px 10px 7px; color: var(--muted); }
      .inbox-section-head strong { color: var(--text); font-size: 12px; text-transform: uppercase; }
      .inbox-section-head span { color: var(--dim); font-size: 11px; }
      .inbox-history-empty { margin: 0 10px 10px; padding: 9px 10px; border: 1px dashed var(--border); border-radius: 7px; color: var(--dim); font-size: 11px; }
      .curation-package-card { cursor: pointer; }
      .curation-package-card.history { background: var(--surface); }
      .curation-package-card .package-progress { color: var(--text-soft); }
      .observation-list { display: grid; gap: 10px; }
      .observation-review { display: grid; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .observation-review.proposed { border-color: rgba(226,200,111,0.45); }
      .observation-review.accepted { border-color: rgba(88,214,141,0.35); }
      .observation-review.rejected, .observation-review.superseded { opacity: 0.72; }
      .observation-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: start; }
      .observation-head input[type="checkbox"] { width: 15px; height: 15px; margin-top: 4px; accent-color: var(--blue); }
      .observation-head strong { display: block; overflow-wrap: anywhere; font-size: 12px; }
      .observation-head small { display: block; margin-top: 3px; color: var(--dim); font-size: 10px; line-height: 1.35; }
      .observation-fields { display: grid; gap: 8px; }
      .observation-quote { margin: 0; padding: 9px 10px; border-left: 3px solid var(--accent-soft-border); border-radius: 0 7px 7px 0; background: var(--overlay); color: var(--text-soft); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
      .observation-citation { color: var(--dim); font-size: 10px; overflow-wrap: anywhere; }
      .observation-relation { display: grid; gap: 5px; padding: 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--overlay); }
      .observation-relation span { color: var(--muted); font-size: 11px; line-height: 1.4; }
      .observation-relation .relation-unavailable { color: var(--yellow); }
      .observation-metadata { display: grid; gap: 8px; padding: 9px; border: 1px solid var(--accent-soft-border); border-radius: 7px; background: var(--accent-soft-bg); }
      .observation-metadata > strong { color: var(--text); font-size: 12px; }
      .metadata-readonly-note { color: var(--muted); font-size: 11px; line-height: 1.45; }
      .metadata-proposal-list { display: grid; gap: 7px; }
      .metadata-proposal { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
      .metadata-proposal strong { margin: 0; color: var(--text); font-size: 11px; }
      .metadata-proposal span { color: var(--muted); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
      .metadata-json { margin: 5px 0 0; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--overlay); color: var(--text-soft); font-family: var(--vscode-editor-font-family); font-size: 10px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
      .curation-batch, .wiki-decision { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .curation-batch > strong, .wiki-decision > strong { font-size: 12px; }
      .wiki-evidence-list { display: grid; gap: 5px; max-height: 150px; overflow-y: auto; }
      .wiki-evidence-list label { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 7px; color: var(--muted); font-size: 11px; line-height: 1.35; text-transform: none; }
      .wiki-evidence-list input { width: 14px; height: 14px; min-height: 0; margin-top: 1px; accent-color: var(--blue); }
      .list-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
      .source-card, .settings-card { padding: 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .source-card strong, .settings-card strong { display: block; margin-bottom: 6px; font-size: 13px; }
      .source-card span, .settings-card span { display: block; color: var(--muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
      .source-card .failure-detail { margin-top: 7px; padding: 7px 9px; border: 1px solid rgba(237,106,115,0.32); border-radius: 6px; background: rgba(237,106,115,0.07); color: var(--red); }
      .notes-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px; }
      .note-card { display: grid; gap: 8px; min-width: 0; padding: 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); text-align: left; }
      .note-card:hover, .note-card.selected { border-color: var(--border-strong); background: var(--hover); }
      .note-card strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
      .note-card p { display: -webkit-box; min-height: 34px; margin: 0; overflow: hidden; color: var(--text-soft); font-size: 12px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .note-card-meta { display: flex; flex-wrap: wrap; gap: 6px; }
      .note-toolbar { display: grid; grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(120px, auto)); gap: 8px; margin-bottom: 14px; }
      .note-toolbar .control { width: 100%; background: var(--overlay); }
      .note-empty { padding: 18px; border: 1px dashed var(--border); border-radius: 8px; color: var(--muted); font-size: 12px; text-align: center; }
      .note-body { min-height: 220px !important; }
      .side { display: grid; grid-auto-rows: max-content; align-content: start; gap: 12px; min-width: 0; min-height: 0; padding: 14px; background: var(--side-bg); overflow-y: auto; }
      .side.tasks-mode, .side.notes-mode, .side.inbox-mode, .side.settings-mode { grid-template-rows: minmax(0, 1fr); overflow: hidden; }
      .side:not(.map-mode) .side-graph { display: none; }
      .side:not(.tasks-mode) .side-task { display: none; }
      .side:not(.notes-mode) .side-notes { display: none; }
      .side:not(.inbox-mode) .side-inbox { display: none; }
      .side:not(.settings-mode) .side-settings { display: none; }
      .side.tasks-mode .side-task, .side.notes-mode .side-notes, .side.inbox-mode .side-inbox, .side.settings-mode .side-settings { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
      .side-card { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); overflow: hidden; }
      .side-head { display: flex; justify-content: space-between; align-items: center; min-height: 40px; padding: 0 11px; border-bottom: 1px solid var(--border); }
      .side-head h2 { margin: 0; color: var(--muted); font-size: 12px; text-transform: uppercase; }
      .side-body { padding: 12px; }
      .side-task .side-body, .side-notes .side-body, .side-inbox .side-body, .side-settings .side-body { min-height: 0; overflow: auto; padding: 16px; }
      .detail-title { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
      .detail-title b { font-size: 16px; }
      .detail-title span, .summary { color: var(--muted); font-size: 12px; }
      .summary { margin: 0 0 12px; line-height: 1.45; color: var(--text-soft); }
      .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .metric { min-height: 64px; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .metric span { display: block; color: var(--dim); font-size: 10px; text-transform: uppercase; }
      .metric strong { display: block; margin-top: 7px; font-size: 18px; }
      .readiness { display: grid; grid-template-columns: 88px 1fr; gap: 12px; align-items: center; }
      .ring text { fill: var(--text); font-size: 18px; font-weight: 800; text-anchor: middle; }
      .signals { display: grid; gap: 7px; }
      .signal { display: grid; grid-template-columns: 86px 1fr; gap: 8px; align-items: center; color: var(--muted); font-size: 12px; }
      .bar { height: 7px; border-radius: 999px; background: var(--track); overflow: hidden; }
      .bar span { display: block; height: 100%; border-radius: inherit; }
      .feed { min-height: 0; overflow: auto; }
      .feed-item { padding: 11px; border-bottom: 1px solid var(--border); }
      .feed-item strong { display: block; margin-bottom: 5px; font-size: 12px; }
      .feed-item span { color: var(--muted); font-size: 12px; }
      .settings-section, .today-readiness { margin-top: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); overflow: hidden; }
      .today-readiness .side-body { display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 18px; align-items: center; }
      .readiness-score { display: grid; place-items: center; min-height: 96px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .readiness-score strong { color: var(--green); font-size: 30px; }
      .readiness-score span { color: var(--muted); font-size: 11px; text-transform: uppercase; }
      .today-outcomes { display: grid; gap: 14px; margin-top: 14px; }
      .today-outcome-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .today-outcome-head h2 { margin: 0; font-size: 15px; }
      .today-outcome-head p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
      .today-outcome-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
      .today-outcome-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
      .today-outcome-metrics .metric { min-height: 58px; }
      .today-mission-list, .today-standalone-list { display: grid; gap: 12px; }
      .today-mission { border: 1px solid var(--border); border-radius: 9px; background: var(--panel); overflow: hidden; }
      .today-mission-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 13px 14px; border-bottom: 1px solid var(--border); }
      .today-mission-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .today-mission-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
      .today-mission-title span, .today-mission-copy { color: var(--muted); font-size: 11px; }
      .today-mission-copy { margin: 5px 0 0; line-height: 1.45; }
      .today-progress-ring { display: grid; place-items: center; min-width: 58px; min-height: 42px; padding: 5px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .today-progress-ring strong { font-size: 16px; }
      .today-progress-ring span { color: var(--dim); font-size: 9px; text-transform: uppercase; }
      .today-okr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 10px; padding: 10px; }
      .today-okr { display: grid; gap: 10px; align-content: start; min-width: 0; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .today-okr.at-risk { border-color: rgba(226,200,111,0.48); }
      .today-okr-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .today-okr-title { min-width: 0; }
      .today-okr-title strong { display: block; margin-bottom: 4px; font-size: 13px; line-height: 1.35; }
      .today-okr-title span { display: block; color: var(--muted); font-size: 11px; line-height: 1.4; }
      .today-status { display: inline-flex; align-items: center; padding: 2px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 10px; white-space: nowrap; }
      .today-status.risk, .today-trend.worsening { color: var(--yellow); border-color: rgba(226,200,111,0.4); background: rgba(226,200,111,0.08); }
      .today-status.good, .today-trend.improving { color: var(--green); border-color: rgba(88,214,141,0.35); background: rgba(88,214,141,0.08); }
      .today-progress { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
      .today-progress .bar { height: 6px; }
      .today-progress .bar span { background: var(--accent); }
      .today-progress b { color: var(--text-soft); font-size: 11px; }
      .today-kr-list { display: grid; gap: 7px; }
      .today-kr { display: grid; gap: 5px; padding: 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--overlay); }
      .today-kr-head, .today-kr-values { display: flex; justify-content: space-between; gap: 9px; align-items: baseline; }
      .today-kr-head strong { font-size: 11px; line-height: 1.35; }
      .today-kr-head span, .today-kr-values { color: var(--dim); font-size: 10px; }
      .today-kr .bar { height: 4px; }
      .today-kr .bar span { background: var(--green); }
      .today-alignment { display: grid; gap: 7px; }
      .today-alignment-row { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 8px; align-items: start; }
      .today-alignment-row > span { color: var(--dim); font-size: 10px; text-transform: uppercase; }
      .today-alignment-items { display: flex; flex-wrap: wrap; gap: 5px; }
      .today-alignment-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--panel); color: var(--text-soft); font-size: 10px; }
      button.today-alignment-chip:hover { border-color: var(--border-strong); color: var(--text); }
      .today-card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }
      .today-kpi-section, .today-alert-section { padding: 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--panel); }
      .today-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(245px, 1fr)); gap: 9px; margin-top: 10px; }
      .today-kpi { display: grid; grid-template-columns: minmax(0, 1fr) 138px; gap: 10px; padding: 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .today-kpi-main { min-width: 0; }
      .today-kpi-main strong { display: block; margin-bottom: 5px; font-size: 12px; }
      .today-kpi-value { display: flex; gap: 7px; align-items: baseline; }
      .today-kpi-value b { font-size: 20px; }
      .today-kpi-value span, .today-kpi-meta { color: var(--muted); font-size: 10px; }
      .today-kpi-meta { margin-top: 5px; line-height: 1.4; }
      .today-kpi-viz { display: grid; justify-items: end; align-content: space-between; gap: 5px; min-width: 0; }
      .today-sparkline { width: 132px; height: 42px; overflow: visible; }
      .today-sparkline path { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
      .today-sparkline circle { fill: var(--accent); }
      .today-trend { display: inline-flex; align-items: center; padding: 2px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 10px; }
      .today-alerts { display: grid; gap: 7px; margin-top: 10px; }
      .today-alert { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 8px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
      .today-alert i { width: 7px; height: 7px; border-radius: 50%; background: var(--yellow); }
      .today-alert.critical i { background: var(--red); }
      .today-alert.info i { background: var(--accent); }
      .today-alert strong { display: block; margin-bottom: 2px; font-size: 11px; }
      .today-alert span { color: var(--muted); font-size: 10px; line-height: 1.4; }
      .today-empty-outcomes { padding: 16px; border: 1px dashed var(--border); border-radius: 8px; color: var(--muted); font-size: 12px; text-align: center; }
      .diagnostic-list { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
      .task-detail { display: grid; gap: 12px; align-content: start; grid-auto-rows: max-content; }
      .field { display: grid; gap: 5px; }
      .field label { color: var(--dim); font-size: 10px; text-transform: uppercase; }
      .action-group { display: grid; gap: 6px; margin-top: 12px; }
      .action-group > label { color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
      .field input, .field textarea, .field select {
        width: 100%;
        min-height: 34px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface-2);
        padding: 8px 10px;
      }
      .field textarea { min-height: 96px; resize: vertical; line-height: 1.45; }
      /* Entity selection panel (graph): read-first layout, edit on demand. */
      #detailLegacy.hidden { display: none; }
      .ep { margin: -12px; font-size: 12.5px; }
      .ep-head { padding: 12px 12px 11px; border-bottom: 1px solid var(--border); }
      .ep-kindrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .ep-kind { display: inline-flex; align-items: center; gap: 6px; color: var(--dim); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
      .ep-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--dim); }
      .ep-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--muted); font-size: 13px; }
      .ep-iconbtn:hover { border-color: var(--border-strong); color: var(--text); }
      .ep-name { margin: 0 0 7px; font-size: 15.5px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
      .ep-pills { display: flex; flex-wrap: wrap; gap: 6px; }
      .ep-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 11px; }
      .ep-pill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .ep-pill.ok { color: var(--green); border-color: rgba(88,214,141,0.35); background: rgba(88,214,141,0.1); font-weight: 600; }
      .ep-pill.warn { color: var(--yellow); border-color: rgba(226,200,111,0.4); background: rgba(226,200,111,0.1); }
      .ep-pill.dim { color: var(--dim); }
      .ep-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
      .ep-actions button { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 11.5px; font-weight: 600; }
      .ep-actions button:hover { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
      .ep-actions button span { font-size: 13px; line-height: 1; color: var(--muted); }
      .ep-desc { padding: 10px 12px; border-bottom: 1px solid var(--border); }
      .ep-desc p { margin: 0; color: var(--text-soft); line-height: 1.5; overflow-wrap: anywhere; }
      .ep-desc p.clamped { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .ep-linkish { margin-top: 3px; padding: 0; border: 0; background: none; color: var(--blue); font-size: 11.5px; font-weight: 600; }
      .ep-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(44px, 1fr)); border-bottom: 1px solid var(--border); }
      .ep-stat { padding: 8px 2px 7px; text-align: center; }
      .ep-stat b { display: block; font-size: 14.5px; line-height: 1.15; font-variant-numeric: tabular-nums; }
      .ep-stat span { display: block; color: var(--dim); font-size: 8.5px; letter-spacing: .04em; text-transform: uppercase; }
      .ep-stat.zero b, .ep-stat.zero span { opacity: 0.32; }
      .ep-stat.hot b { color: var(--blue); }
      .ep-tabs { display: flex; gap: 2px; padding: 6px 12px 0; border-bottom: 1px solid var(--border); }
      .ep-tab { display: flex; align-items: center; gap: 6px; margin-bottom: -1px; padding: 6px 9px 8px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font-size: 12px; font-weight: 600; }
      .ep-tab:hover { color: var(--text); }
      .ep-tab.active { color: var(--text); border-bottom-color: var(--active-bg); }
      .ep-count { padding: 1px 6px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .ep-tab.active .ep-count { background: var(--accent-soft-bg); color: var(--blue); }
      .ep-sec { padding: 10px 12px; border-bottom: 1px solid var(--border); }
      .ep-sec:last-child { border-bottom: 0; }
      .ep-sec-title { margin: 0 0 8px; color: var(--dim); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .ep-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      .ep-sec-head .ep-sec-title { margin: 0; }
      .ep-minibtn { padding: 3px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--blue); font-size: 11px; font-weight: 700; }
      .ep-minibtn:hover { border-color: var(--accent-soft-border); }
      .ep-capture { padding: 8px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); margin-bottom: 6px; }
      .ep-capture:last-child { margin-bottom: 0; }
      .ep-capture b { display: block; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
      .ep-capture span { color: var(--dim); font-size: 10.5px; }
      .ep-capture blockquote { margin: 6px 0 0; padding-left: 7px; border-left: 2px solid var(--accent-soft-border); color: var(--text-soft); font-size: 10.5px; line-height: 1.4; }
      .ep-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .ep-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 2.5px 9px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text-soft); font-size: 11.5px; }
      .ep-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ep-relgroup { margin-bottom: 10px; }
      .ep-relgroup:last-of-type { margin-bottom: 0; }
      .ep-relgroup-h { display: flex; align-items: baseline; gap: 6px; margin: 0 0 4px; color: var(--dim); font-size: 10.5px; }
      .ep-relgroup-h b { color: var(--text); font-weight: 700; }
      .ep-relrow { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
      .ep-relrow:hover { background: var(--surface-2); }
      .ep-reldir { flex: none; width: 14px; color: var(--dim); font-size: 12px; text-align: center; }
      .ep-rellabel { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 12px; }
      .ep-rellabel span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ep-reldel { flex: none; padding: 2px 5px; border: 0; border-radius: 4px; background: none; color: var(--red); font-size: 11px; opacity: 0; }
      .ep-relrow:hover .ep-reldel, .ep-reldel:focus-visible { opacity: 1; }
      .ep-composer { margin-top: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); display: grid; gap: 8px; }
      .ep-foot { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--surface); color: var(--dim); font-size: 10.5px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
      .ep-editbar { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border); background: var(--overlay); }
      .ep-edit-fields { display: grid; gap: 10px; padding: 12px; }
      .ep-doc-wrap { position: relative; overflow: hidden; }
      .ep-doc-wrap.clamped { max-height: 300px; }
      .ep-doc-wrap.clamped::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 52px; background: linear-gradient(transparent, var(--panel)); pointer-events: none; }
      .ep-doc { font-size: 12.5px; line-height: 1.6; color: var(--text-soft); overflow-wrap: anywhere; }
      .ep-doc h1, .ep-doc h2, .ep-doc h3, .ep-doc h4 { color: var(--text); line-height: 1.3; }
      .ep-doc h1 { margin: 0 0 8px; font-size: 14px; }
      .ep-doc h2 { margin: 14px 0 5px; font-size: 12.5px; }
      .ep-doc h3, .ep-doc h4 { margin: 12px 0 4px; font-size: 12px; }
      .ep-doc p { margin: 0 0 8px; }
      .ep-doc ul, .ep-doc ol { margin: 0 0 8px; padding-left: 18px; }
      .ep-doc li { margin-bottom: 3px; }
      .ep-doc code { padding: 1px 4px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 11px; }
      .ep-doc pre { margin: 0 0 8px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); overflow-x: auto; }
      .ep-doc pre code { padding: 0; border: 0; background: none; white-space: pre; }
      .ep-doc blockquote { margin: 0 0 8px; padding: 2px 0 2px 10px; border-left: 2px solid var(--border-strong); color: var(--muted); }
      .md-external, .md-internal {
        display: inline;
        padding: 0;
        border: 0;
        background: none;
        color: var(--blue);
        font: inherit;
        text-align: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .md-external:hover, .md-internal:hover { color: var(--cyan); }
      .help-panel { padding: 0; overflow: hidden; }
      .help-shell {
        display: grid;
        grid-template-columns: minmax(240px, 310px) minmax(0, 1fr);
        width: 100%;
        height: 100%;
        min-height: 0;
      }
      .help-sidebar {
        display: flex;
        min-height: 0;
        flex-direction: column;
        border-right: 1px solid var(--border);
        background: var(--panel);
      }
      .help-sidebar-head { display: grid; gap: 10px; padding: 18px 16px 14px; border-bottom: 1px solid var(--border); }
      .help-sidebar-title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .help-sidebar-title h1 { margin: 0; font-size: 18px; }
      .help-sidebar-title span { color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
      .help-sidebar-head p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
      .help-search { position: relative; }
      .help-search::before {
        content: "⌕";
        position: absolute;
        top: 50%;
        left: 10px;
        color: var(--dim);
        font-size: 16px;
        transform: translateY(-52%);
        pointer-events: none;
      }
      .help-search input {
        width: 100%;
        height: 36px;
        padding: 0 34px 0 32px;
        border: 1px solid var(--border);
        border-radius: 8px;
        outline: 0;
        background: var(--surface-2);
        color: var(--text);
      }
      .help-search input:focus { border-color: var(--accent-soft-border); box-shadow: 0 0 0 2px var(--accent-soft-bg); }
      .help-search button {
        position: absolute;
        top: 50%;
        right: 6px;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--muted);
        transform: translateY(-50%);
      }
      .help-search button:hover { background: var(--hover); color: var(--text); }
      .help-guide-list { min-height: 0; overflow-y: auto; padding: 10px; }
      .help-category + .help-category { margin-top: 12px; }
      .help-category-label {
        margin: 0 6px 5px;
        color: var(--dim);
        font-size: 9px;
        font-weight: 750;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .help-guide {
        display: grid;
        width: 100%;
        gap: 3px;
        margin-bottom: 3px;
        padding: 9px 10px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--text);
        text-align: left;
      }
      .help-guide:hover { border-color: var(--border); background: var(--hover); }
      .help-guide.active { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
      .help-guide strong { font-size: 12.5px; line-height: 1.3; }
      .help-guide span {
        display: -webkit-box;
        overflow: hidden;
        color: var(--muted);
        font-size: 10.5px;
        line-height: 1.4;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .help-search-summary { margin: 0 6px 8px; color: var(--muted); font-size: 11px; }
      .help-no-results { display: grid; gap: 8px; padding: 24px 12px; color: var(--muted); font-size: 12px; line-height: 1.5; text-align: center; }
      .help-no-results button { justify-self: center; min-height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-2); }
      .help-article-wrap { min-width: 0; min-height: 0; overflow-y: auto; scroll-behavior: smooth; }
      .help-article { width: min(860px, 100%); margin: 0 auto; padding: 32px clamp(22px, 5vw, 64px) 72px; }
      .help-breadcrumb { margin: 0 0 10px; color: var(--dim); font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
      .help-article-title { margin: 0; font-size: clamp(24px, 3vw, 34px); line-height: 1.15; letter-spacing: -.025em; }
      .help-article-summary { max-width: 720px; margin: 10px 0 24px; color: var(--muted); font-size: 14px; line-height: 1.55; }
      .help-banner {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        margin: 0 0 24px;
        padding: 12px 14px;
        border: 1px solid var(--accent-soft-border);
        border-radius: 9px;
        background: var(--accent-soft-bg);
      }
      .help-banner strong { display: block; margin-bottom: 3px; font-size: 12px; }
      .help-banner span { color: var(--muted); font-size: 11px; line-height: 1.4; }
      .help-banner button { min-height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-2); color: var(--text); }
      .help-doc { color: var(--text-soft); font-size: 14px; line-height: 1.72; overflow-wrap: anywhere; }
      .help-doc h1 { display: none; }
      .help-doc h2 { margin: 30px 0 10px; color: var(--text); font-size: 20px; line-height: 1.3; }
      .help-doc h3 { margin: 24px 0 8px; color: var(--text); font-size: 16px; line-height: 1.35; }
      .help-doc h4 { margin: 20px 0 7px; color: var(--text); font-size: 14px; line-height: 1.35; }
      .help-doc p { margin: 0 0 14px; }
      .help-doc ul, .help-doc ol { margin: 0 0 16px; padding-left: 24px; }
      .help-doc li { margin: 6px 0; padding-left: 2px; }
      .help-doc blockquote { margin: 18px 0; padding: 10px 14px; border-left: 3px solid var(--blue); background: var(--surface); color: var(--text-soft); }
      .help-doc code { padding: 2px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 12px; }
      .help-doc pre { margin: 16px 0; padding: 13px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); overflow-x: auto; }
      .help-doc pre code { padding: 0; border: 0; background: none; white-space: pre; }
      .help-doc .md-table-wrap { max-width: 100%; margin: 18px 0; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
      .help-doc table { width: 100%; border-collapse: collapse; min-width: 560px; background: var(--surface); }
      .help-doc th, .help-doc td { padding: 10px 12px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
      .help-doc th:last-child, .help-doc td:last-child { border-right: 0; }
      .help-doc tr:last-child td { border-bottom: 0; }
      .help-doc th { color: var(--text); font-size: 12px; background: var(--surface-2); }
      .help-release-notes { margin-bottom: 26px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
      .help-release-notes h2 { margin-top: 0; font-size: 16px; }
      .help-release-notes p:last-child, .help-release-notes ul:last-child { margin-bottom: 0; }
      .nav button[data-view="help"] { position: relative; }
      .nav button[data-view="help"].has-update::after {
        content: "";
        position: absolute;
        top: 5px;
        right: 5px;
        width: 7px;
        height: 7px;
        border: 2px solid var(--rail-bg);
        border-radius: 50%;
        background: var(--blue);
      }
      .ep-doc-page { margin-bottom: 12px; }
      .ep-doc-page:last-child { margin-bottom: 0; }
      .ep-doc-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 6px; color: var(--dim); font-size: 10.5px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
      .ep-discovery-lifecycle { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .ep-discovery-field { padding: 8px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
      .ep-discovery-field span { display: block; margin-bottom: 3px; color: var(--dim); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }
      .ep-discovery-field b { display: block; overflow-wrap: anywhere; font-size: 11.5px; }
      .ep-discovery-criteria { margin: 8px 0 0; padding-left: 18px; color: var(--text-soft); line-height: 1.45; }
      .ep-discovery-criteria li { margin-bottom: 3px; }
      /* Settings › Taxonomy manager */
      .tax-tabs { display: flex; gap: 4px; margin-bottom: 10px; padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); width: fit-content; }
      .tax-tabs button { min-width: 120px; height: 28px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; }
      .tax-tabs button.active { background: var(--active-bg); color: var(--active-fg); }
      .tax-banner { margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 12px; line-height: 1.5; }
      .tax-banner b { color: var(--text); }
      .tax-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 0 6px; }
      .tax-sec-head label { color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
      .tax-row { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 7px; }
      .tax-row:hover { background: var(--surface); }
      .tax-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--dim); }
      .tax-main { flex: 1; min-width: 0; }
      .tax-title { display: flex; align-items: baseline; gap: 7px; }
      .tax-title b { font-size: 12.5px; }
      .tax-title code { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 10.5px; color: var(--dim); }
      .tax-desc { margin: 1px 0 0; color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tax-usage { flex: none; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .tax-badge { flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); background: var(--surface); }
      .tax-badge.custom { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); color: var(--blue); }
      .tax-actions { flex: none; display: flex; gap: 4px; align-items: center; }
      .tax-actions .action { height: 26px; font-size: 11.5px; }
      .tax-lock { flex: none; color: var(--dim); font-size: 11px; cursor: help; }
      .tax-box { margin: 4px 8px 8px 27px; padding: 9px 11px; border: 1px solid rgba(226,200,111,0.45); border-radius: 7px; background: rgba(226,200,111,0.08); font-size: 12px; display: grid; gap: 8px; }
      .tax-box p { margin: 0; line-height: 1.5; }
      .tax-box-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .tax-box-row select { min-height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text); padding: 3px 7px; font: inherit; font-size: 12px; }
      .tax-box-row label { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text); }
      .tax-form { margin: 8px 0; padding: 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); display: grid; gap: 9px; }
      .tax-form .hint { color: var(--muted); font-size: 11px; }
      .tax-form .hint b { color: var(--yellow); }
      .tax-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
      .tax-swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
      .tax-swatch.sel { border-color: var(--text); box-shadow: 0 0 0 2px var(--panel); }
      .tax-relgroup { margin: 2px 0; color: var(--muted); font-size: 11.5px; line-height: 1.6; }
      .tax-relgroup b { color: var(--dim); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
      .tax-toggle { display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--muted); font-size: 11.5px; padding: 6px 8px; cursor: pointer; border-radius: 6px; }
      .tax-toggle:hover { background: var(--surface); color: var(--text); }
      .entity-edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .entity-relation-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
      .entity-relation-row strong { display: block; overflow-wrap: anywhere; font-size: 12px; }
      .entity-relation-row span { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
      .link-preview { padding: 8px; border: 1px solid var(--accent-soft-border); border-radius: 8px; background: var(--accent-soft-bg); color: var(--text); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
      details.field summary { color: var(--dim); font-size: 10px; text-transform: uppercase; cursor: pointer; }
      details.field textarea { margin-top: 6px; }
      .diff-view { display: grid; gap: 0; max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 1.45; }
      .diff-line { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; min-height: 20px; padding: 2px 8px; white-space: pre-wrap; overflow-wrap: anywhere; border-bottom: 1px solid rgba(255,255,255,0.03); }
      .diff-line.add { background: rgba(88,214,141,0.11); color: var(--text); }
      .diff-line.remove { background: rgba(237,106,115,0.12); color: var(--text); }
      .diff-line.context { color: var(--muted); }
      .diff-prefix { color: var(--dim); user-select: none; }
      .menu-control { display: grid; gap: 6px; }
      .menu-button, .menu-option {
        width: 100%;
        min-height: 34px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface-2);
        padding: 8px 10px;
        text-align: left;
      }
      .menu-button { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 650; }
      .menu-button:hover, .menu-control.open .menu-button { border-color: var(--border-strong); background: var(--track); }
      .menu-chevron { color: var(--muted); font-size: 12px; }
      .menu-options {
        display: none;
        gap: 3px;
        padding: 4px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--overlay);
      }
      .menu-control.open .menu-options { display: grid; }
      .menu-option { min-height: 30px; color: var(--muted); }
      .menu-option:hover, .menu-option.selected { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); color: var(--text); }
      .task-link-picker { display: grid; gap: 6px; }
      .task-link-picker-panel { display: none; gap: 8px; grid-auto-rows: max-content; align-content: start; max-height: 420px; overflow: auto; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--overlay); }
      .task-link-picker.open .task-link-picker-panel { display: grid; }
      .task-link-picker-summary { color: var(--muted); font-size: 11px; }
      .task-link-section { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); overflow: hidden; }
      .task-link-section-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; min-height: 34px; padding: 6px; cursor: pointer; }
      .task-link-section-head:hover { background: var(--surface-2); }
      .task-link-section-toggle { min-width: 0; display: flex; align-items: center; gap: 7px; border: 0; background: transparent; color: var(--text); text-align: left; }
      .task-link-section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; text-transform: capitalize; }
      .task-link-section-toggle small { color: var(--muted); font-size: 10px; }
      .task-link-section-body { display: grid; gap: 6px; padding: 0 8px 8px; }
      .task-link-options { display: grid; gap: 4px; max-height: 220px; overflow: auto; padding-right: 3px; }
      .task-link-option { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 32px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-2); color: var(--muted); text-align: left; }
      .task-link-option:hover, .task-link-option.selected { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); color: var(--text); }
      .task-link-option span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .task-link-option small { color: var(--dim); font-size: 10px; }
      .detail-actions { display: flex; justify-content: flex-end; gap: 8px; }
      .link-entity { display: grid; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
      .link-entity-label { color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
      .link-entity-row { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: 8px; }
      .link-select { width: 100%; min-height: 34px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); padding: 6px 8px; font: inherit; }
      .link-select:focus { outline: none; border-color: var(--border-strong); }
      .empty { display: grid; place-items: center; height: 100%; color: var(--muted); }
      @media (max-width: 1180px) {
        body { overflow: auto; }
        .app { grid-template-columns: 58px minmax(0, 1fr); height: auto; min-height: 100vh; }
        .rail {
          position: sticky;
          top: 0;
          z-index: 10;
          height: 100vh;
        }
        .shell {
          grid-template-rows: auto minmax(0, 1fr);
          min-height: 100vh;
        }
        .topbar {
          grid-template-columns: minmax(0, 1fr) auto;
          height: auto;
          min-height: 56px;
          padding: 9px 12px;
        }
        .brand {
          min-width: 0;
        }
        .brand strong,
        .brand span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .map-toolbar {
          grid-column: 1 / -1;
          overflow-x: auto;
        }
        .toolbar:last-child {
          justify-content: flex-end;
        }
        .scope-tabs {
          max-width: 100%;
          overflow-x: auto;
        }
        .content { grid-template-columns: 1fr; grid-template-rows: none; }
        .side-resizer { display: none; }
        .stage {
          overflow: visible;
        }
        .panel.active {
          height: auto;
          min-height: 0;
        }
        .panel[data-panel="map"].active {
          min-height: 520px;
        }
        #graph {
          min-height: 520px;
        }
        .list-panel {
          padding: 14px;
        }
        .help-panel { padding: 0; }
        .title-row {
          align-items: flex-start;
        }
        .columns {
          min-width: 0;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        .lane {
          min-height: 0;
        }
        .task {
          width: auto;
        }
        .proposal {
          grid-template-columns: 1fr;
          align-items: stretch;
        }
        .proposal-actions {
          justify-content: flex-start;
        }
        .side,
        .side.tasks-mode,
        .side.notes-mode,
        .side.inbox-mode,
        .side.settings-mode {
          grid-template-rows: auto;
          overflow: visible;
          border-left: 0;
          border-top: 1px solid var(--border);
        }
        .side.tasks-mode .side-task,
        .side.notes-mode .side-notes,
        .side.inbox-mode .side-inbox,
        .side.settings-mode .side-settings {
          grid-template-rows: auto;
        }
        .side-task .side-body,
        .side-notes .side-body,
        .side-inbox .side-body,
        .side-settings .side-body {
          overflow: visible;
        }
        .note-toolbar {
          grid-template-columns: 1fr;
        }
        .help-shell { grid-template-columns: minmax(210px, 270px) minmax(0, 1fr); }
      }
      @media (max-width: 680px) {
        .nav button::after {
          display: none;
        }
        .topbar {
          grid-template-columns: 1fr;
        }
        .toolbar,
        .toolbar:last-child {
          justify-content: flex-start;
        }
        .control {
          width: 100%;
          min-width: 0;
        }
        .title-row {
          flex-direction: column;
        }
        .readiness,
        .metrics,
        .today-readiness .side-body,
        .today-outcome-metrics {
          grid-template-columns: 1fr;
        }
        .today-outcome-head,
        .today-mission-head {
          grid-template-columns: 1fr;
          align-items: stretch;
        }
        .today-outcome-head { flex-direction: column; }
        .today-outcome-actions { justify-content: flex-start; }
        .today-okr-grid { grid-template-columns: 1fr; padding: 8px; }
        .today-kpi { grid-template-columns: 1fr; }
        .today-kpi-viz { justify-items: start; }
        .today-alert { grid-template-columns: auto minmax(0, 1fr); }
        .today-alert .action { grid-column: 2; justify-self: start; }
        .help-panel { overflow: auto; }
        .help-shell { display: block; height: auto; }
        .help-sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
        .help-guide-list { max-height: 300px; }
        .help-article-wrap { overflow: visible; }
        .help-article { padding: 24px 18px 54px; }
        .help-banner { grid-template-columns: 1fr; }
        .signal {
          grid-template-columns: 72px 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="app">
      <aside class="rail">
        <div class="logo"><div class="logo-mark"><span></span><span></span><span></span><span></span></div></div>
        <nav class="nav">
          <button data-view="today" title="Today">★</button>
          <button class="active" data-view="map" title="Memory graph">⌘</button>
          <button data-view="priorities" title="Priorités" aria-label="Priorités">!</button>
          <button data-view="tasks" title="Tasks">✓</button>
          <button data-view="notes" title="Notes">✎</button>
          <button data-view="inbox" title="Inbox">↧</button>
          <button data-view="sources" title="Sources">◇</button>
          <button data-view="help" title="Help and guides" aria-label="Help and guides">?</button>
          <button data-view="settings" title="Settings">⚙</button>
        </nav>
        <div class="rail-foot"><button id="refresh" title="Refresh">↻</button><button id="themeToggle" title="Toggle light / dark theme" aria-label="Toggle light or dark theme">◐</button></div>
      </aside>
      <section class="shell">
        <header class="topbar map-active">
          <div class="brand"><strong>OneAgent</strong><span id="scope"></span></div>
          <div class="toolbar map-toolbar">
            <div class="view-preset" id="graphViewControls">
              <select class="control" id="graphViewPreset" title="Saved graph views — presets of every graph filter for a task or topic"><option value="">View: none</option></select>
              <button class="control view-action" id="graphViewSaveAs" title="Save the current view as a new preset">＋</button>
              <button class="control view-action" id="graphViewUpdate" title="Update this view with the current filters" style="display:none">✓</button>
              <button class="control view-action" id="graphViewRename" title="Rename this view" style="display:none">✎</button>
              <button class="control view-action" id="graphViewDuplicate" title="Duplicate this view" style="display:none">⧉</button>
              <button class="control view-action" id="graphViewCompare" title="Compare this view" style="display:none">⇄</button>
              <button class="control view-action" id="graphViewDelete" title="Delete this view" style="display:none">✕</button>
            </div>
            <div class="scope-tabs" role="tablist" aria-label="Graph perspective">
              <button class="tab" data-graph-mode="map" title="Full graph for the active scope">Overview</button>
              <button class="tab active" data-graph-mode="focus" title="Memory around the focused entity">Focus</button>
              <button class="tab" data-graph-mode="deps" title="Focused product and related products">Dependencies</button>
            </div>
            <div class="scope-tabs" role="tablist" aria-label="Graph interaction mode">
              <button class="tab active" data-graph-select="navigate" title="Click selects and inspects a node">Navigate</button>
              <button class="tab" data-graph-select="context" title="Click toggles a node into the agent context">Context</button>
            </div>
            <div class="scope-tabs" role="tablist" aria-label="Nodes outside the context" id="graphIsolateTabs" style="display:none">
              <button class="tab active" data-graph-isolate="show" title="Show every node normally">Show</button>
              <button class="tab" data-graph-isolate="dim" title="Dim nodes outside the context (still clickable to add)">Dim</button>
              <button class="tab" data-graph-isolate="hide" title="Hide nodes outside the context">Hide</button>
            </div>
            <div class="scope-tabs" role="tablist" aria-label="Links of the workspace owner (me)" id="selfLinksTabs" style="display:none">
              <button class="tab active" data-self-links="show" title="Show my links normally">★ Show</button>
              <button class="tab" data-self-links="fade" title="Fade my links to declutter the graph">★ Fade</button>
              <button class="tab" data-self-links="hide" title="Hide my links entirely (my node stays visible)">★ Hide</button>
            </div>
            <select class="control" id="graphLayoutMode" title="Graph layout algorithm"><option value="force">Layout: force</option><option value="hierarchy">Layout: hierarchy</option><option value="circle">Layout: circle</option><option value="grid">Layout: grid</option></select>
            <select class="control" id="graphGroupMode" title="Group visible nodes without changing the memory graph"><option value="none">Group: none</option><option value="auto">Group: auto</option><option value="by_type">Group: type</option></select>
          </div>
          <div class="toolbar"><div class="graph-search"><input class="control" id="filter" placeholder="Find or filter nodes" autocomplete="off"><div class="graph-search-results" id="graphSearchResults" hidden></div></div><div class="hidden-mode" id="graphHiddenModeToggle" title="What to do with nodes hidden by filters: remove them or keep them as faded ghosts"><span>Hidden</span><button type="button" data-hidden-mode="hide" class="active">Hide</button><button type="button" data-hidden-mode="fade">Fade</button></div><div class="operation" id="operationStatus"></div><button class="control" id="curationQueueBadge" style="display:none" title="Captures awaiting agent curation — click to curate them all now"></button><div class="score" id="score">0</div></div>
        </header>
        <div class="content">
          <section class="stage">
            <section class="panel active graph-stage" data-panel="map">
              <div id="graphCanvas" aria-label="OneAgent Graph 2D and 3D"></div>
              <svg id="graph" role="img" aria-label="OneAgent Graph">
                <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(244,241,234,0.34)"></path></marker></defs>
                <g id="graphLayer"></g>
              </svg>
              <div class="legend" id="legend"></div>
              <div class="graph-filter-panel" id="graphFilterPanel"></div>
              <aside class="graph-context-panel" id="graphContextPanel" aria-label="Context View and Context Pack" hidden></aside>
              <div class="graph-tools"><button id="zoomOut" title="Zoom out">−</button><button id="zoomIn" title="Zoom in">+</button><button id="zoomReset" title="Reset view">Fit</button><button id="openFullCockpit" title="Open cockpit in an editor tab">↗</button><button id="openSidebarCockpit" title="Focus the docked cockpit view">▣</button><button id="refreshGraphify" title="Refresh Graphify">G↻</button></div>
              <div class="graph-context-menu" id="graphContextMenu" hidden></div>
              <button type="button" class="graph-visibility-chip" id="graphVisibilityChip" title="How many nodes the current filters show, fade and hide — click for the breakdown"></button>
              <div class="graph-visibility-breakdown" id="graphVisibilityBreakdown" hidden></div>
            </section>
            <section class="panel list-panel" data-panel="priorities"><div id="priorities"></div></section>
            <section class="panel list-panel" data-panel="tasks"><div id="tasks"></div></section>
            <section class="panel list-panel" data-panel="notes"><div id="notes"></div></section>
            <section class="panel list-panel" data-panel="inbox"><div id="inbox"></div></section>
            <section class="panel list-panel" data-panel="sources"><div id="sources"></div></section>
            <section class="panel list-panel help-panel" data-panel="help"><div id="help"></div></section>
            <section class="panel list-panel" data-panel="settings"><div id="settings"></div></section>
            <section class="panel list-panel" data-panel="workspace"><div id="workspace"></div></section>
            <section class="panel list-panel" data-panel="today"><div id="today"></div></section>
          </section>
          <div class="side-resizer" id="sideResizer" role="separator" aria-orientation="vertical" title="Resize detail panel"></div>
          <aside class="side">
            <section class="side-card side-graph">
              <div class="side-head"><h2>Selection</h2><span class="chip"><i class="dot" id="detailDot"></i><span id="detailType">none</span></span></div>
              <div class="side-body">
                <div id="detailLegacy">
                  <div class="detail-title"><b id="detailTitle">No selection</b><span id="detailStatus"></span></div>
                  <p class="summary" id="detailSummary">Select an entity or relation to inspect and edit it.</p>
                  <div class="metrics"><div class="metric"><span>Provider</span><strong id="detailProvider">-</strong></div><div class="metric"><span>Confidence</span><strong id="detailConfidence">-</strong></div></div>
                </div>
                <div id="detailExtra"></div>
              </div>
            </section>
            <section class="side-card side-task">
              <div class="side-head"><h2>Task Detail</h2><span class="chip" id="taskDetailStatus">none</span></div>
              <div class="side-body" id="taskDetail"></div>
            </section>
            <section class="side-card side-notes">
              <div class="side-head"><h2>Note</h2><span class="chip" id="noteDetailStatus">none</span></div>
              <div class="side-body" id="noteDetail"></div>
            </section>
            <section class="side-card side-inbox">
              <div class="side-head"><h2>Inbox Detail</h2><span class="chip" id="inboxDetailStatus">none</span></div>
              <div class="side-body" id="inboxDetail"></div>
            </section>
            <section class="side-card side-settings">
              <div class="side-head"><h2>Runtime Actions</h2><span class="chip">local</span></div>
              <div class="side-body" id="settingsDetail"></div>
            </section>
          </aside>
        </div>
      </section>
      <div class="live-toast" id="liveToast" role="status" aria-live="polite"></div>
    </main>
    ${assets.hostBridgeScript ? `<script nonce="${escapeHtmlAttribute(nonce)}" src="${escapeHtmlAttribute(assets.hostBridgeScript)}"></script>` : ""}
    ${graphViewerTag}
    <script nonce="${escapeHtmlAttribute(nonce)}">
      const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
      let state = ${data};
      const defaultContextTokenBudget = Math.max(1000, Number(state.contextTokenBudget) || 64000);
      function contextTokenBudgetOrDefault(value) {
        const parsed = Number(value);
        return !Number.isFinite(parsed) || parsed === 12000 || parsed === 64000
          ? defaultContextTokenBudget
          : Math.max(1, parsed);
      }
      let graphPerspective = "focus";
      let graphSelectionMode = "navigate";
      let graphIsolateMode = "show";
      let selfLinksMode = "show";
      let cockpitTheme = (state && typeof state.cockpitTheme === "string" && state.cockpitTheme) ? state.cockpitTheme : "dark";
      let selectedNodeId = undefined;
      let selectedRelationId = undefined;
      let entityPanelUi = { ref: undefined, tab: undefined, editing: false, composerOpen: false, descExpanded: false, expandedDocs: {} };
      let taxonomyUi = { tab: "entities", kindFormOpen: false, editKindId: undefined, mergeKindId: undefined, relFormOpen: false, formalizeType: undefined, mergeRelType: undefined };
      let selectedTaskId = undefined;
      let selectedNoteId = undefined;
      let activeCockpitView = "today";
      let selectedDocumentationId = state.documentation?.defaultGuideId;
      let documentationSearch = "";
      let documentationWelcomeAcknowledged = false;
      let documentationReleaseNotesAcknowledged = false;
      let documentationWorkspaceAcknowledged = false;
      let pendingNoteDetailId = undefined;
      let noteDraftEntityRef = undefined;
      let noteSearch = "";
      const pendingSavedManualNotes = new Map();
      let noteTypeFilter = "all";
      let noteStatusFilter = "active";
      let noteEntityFilter = "all";
      const noteDetailCache = {};
      const manualNoteDetailFailures = {};
      const pendingManualNoteDetailIds = new Set();
      let selectedInboxId = undefined;
      let selectedCurationPackageId = undefined;
      let selectedObservationReviewIds = new Set();
      let pendingInboxDetailId = undefined;
      const inboxDetailCache = {};
      const curationPackageDetailCache = {};
      let draggingTaskId = undefined;
      let taskPointerDrag = undefined;
      let sideResizeDrag = undefined;
      let graphResizeFrame = undefined;
      let suppressTaskClick = false;
      let taskGroupMode = "status";
      let taskEntityFilterRefs = new Set();
      let taskEntityFilterOpen = false;
      let taskLinkPickerState = {};
      let focusedNodeId = undefined;
      let graphTransform = { x: 0, y: 0, k: 1 };
      let graphDrag = undefined;
      let operationStatus = undefined;
      let recentGraphChanges = undefined;
      let liveToastTimer = undefined;
      let entityContextCache = {};
      let workspaceRef = undefined;
      let graphDepth = 0;
      let graphViewer = undefined;
      const graphPositions = new Map();
      // Group folding: any node with part_of/contains children can collapse into a
      // single badge node. Explicit user choices win over the automatic threshold.
      const userCollapsedGroups = new Set();
      const userExpandedGroups = new Set();
      const pendingFoldSeeds = new Map();
      let groupFoldState = { childrenIndex: new Map(), collapsed: new Set(), hiddenReps: new Map() };
      const GROUP_FOLD_AUTO_THRESHOLD = 8;
      /* Node-color palette per theme. mode ("dark" | "light") tells the graph
         canvas which base palette to use. Add a theme = add an entry here (it
         is auto-added to the ◐ toggle) + a matching CSS token block above. */
      const THEMES = {
        dark: {
          mode: "dark",
          nodes: {
            domain: "#7aa2ff",
            subdomain: "#65d7de",
            team: "#58d68d",
            product: "#f4f1ea",
            repository: "#f0b36a",
            project: "#65d7de",
            discovery: "#53d6c7",
            initiative: "#79a7ff",
            feature: "#ed6a73",
            feature_request: "#ff8fab",
            practice: "#b998ff",
            mission: "#f0b36a",
            okr: "#58d68d",
            kpi: "#79a7ff",
            insight: "#c3e88d",
            person: "#e2c86f",
            oneagent: "#65d7de",
            capture: "#9aa0a6",
            concept: "#65d7de",
            decision: "#58d68d",
            question: "#e2c86f",
            risk: "#ed6a73",
            task: "#b998ff",
            source: "#79a7ff",
            wiki_page: "#d7d0c2",
            group: "#94a3b8"
          }
        },
        "vp-light": {
          mode: "light",
          // Decathlon "Data palette" (Vitamin Play). White-theme only. Pale tints
          // (pale yellow/orange/pink/lavender, cyan, mint, light grey) are avoided as
          // node fills — paintNode fills the whole node and the light stroke is faint,
          // so fills need enough contrast on white. Entity kinds are all distinct;
          // secondary content-types reuse a hue where it stays coherent.
          nodes: {
            domain: "#3643ba",      // DKT Blue
            subdomain: "#8babfe",   // DKT Data Light Blue
            team: "#10a86b",        // DKT Green 02
            product: "#101010",     // DKT Content Primary
            repository: "#ff9a3d",  // DKT Data Orange
            project: "#1ceadd",     // DKT Bright Turquoise
            discovery: "#007f78",   // dark teal — research and synthesis
            initiative: "#0b1788",  // DKT Data Dark Blue
            feature: "#ff62d3",     // DKT Data Pink
            feature_request: "#d6006d", // deep pink — darker cousin of feature, reads on white
            practice: "#b66cff",    // DKT Data Purple
            mission: "#3e2573",     // DKT Data Dark Purple
            okr: "#10a86b",         // DKT Green 02
            kpi: "#3643ba",         // DKT Blue
            insight: "#946500",     // dark amber — learning/lightbulb hue, reads on white
            person: "#78381d",      // DKT Data Burnt Umber
            oneagent: "#156767",    // DKT Data Dark Teal
            capture: "#949494",     // DKT Inactive
            concept: "#c9e137",     // DKT Data Lime Green
            decision: "#5f701d",    // DKT Data Moss Green
            question: "#b66cff",    // DKT Data Purple (shares practice)
            risk: "#72265d",        // DKT Data Dark Magenta
            task: "#ff9a3d",        // DKT Data Orange (shares repository)
            source: "#434343",      // DKT Content Secondary
            wiki_page: "#156767",   // DKT Data Dark Teal (shares oneagent)
            group: "#64748b"
          }
        }
      };
      let colors = THEMES.dark.nodes;
      const BASE_RAW_TYPE_ORDER = ["domain", "subdomain", "team", "product", "repository", "project", "discovery", "initiative", "feature", "feature_request", "practice", "mission", "okr", "kpi", "person", "oneagent", "capture", "insight", "concept", "decision", "question", "risk", "task", "source"];
      const BASE_TYPE_ORDER = ["domain", "subdomain", "team", "product", "repository", "project", "discovery", "initiative", "feature", "feature_request", "practice", "mission", "okr", "kpi", "person", "oneagent", "insight", "concept", "decision", "question", "risk", "task", "source"];
      const BASE_ENTITY_NODE_KINDS = ["domain", "subdomain", "team", "product", "repository", "project", "discovery", "initiative", "feature", "feature_request", "practice", "mission", "okr", "kpi", "insight", "person", "oneagent"];
      let rawTypeOrder = BASE_RAW_TYPE_ORDER.slice();
      let typeOrder = BASE_TYPE_ORDER.slice();
      let ENTITY_NODE_KINDS = BASE_ENTITY_NODE_KINDS.slice();
      let GRAPH_GROUPABLE_TYPES = new Set(typeOrder);
      const RELATION_FILTER_TYPE = "__relation_types";
      const FOCUS_LEVEL_ORDER = ["primary", "supporting", "informational"];

      // Workspace taxonomy (state.taxonomy): custom entity kinds become first-class
      // node types — colored, filterable and selectable like the built-in ones.
      function taxonomyModel() {
        const model = state && state.taxonomy && typeof state.taxonomy === "object" ? state.taxonomy : {};
        return {
          entityKinds: Array.isArray(model.entityKinds) ? model.entityKinds : [],
          relationTypes: Array.isArray(model.relationTypes) ? model.relationTypes : [],
          detectedCustomRelations: Array.isArray(model.detectedCustomRelations) ? model.detectedCustomRelations : [],
          entityKindAliases: model.entityKindAliases && typeof model.entityKindAliases === "object" ? model.entityKindAliases : {},
          relationTypeAliases: model.relationTypeAliases && typeof model.relationTypeAliases === "object" ? model.relationTypeAliases : {}
        };
      }

      function customEntityKinds() {
        return taxonomyModel().entityKinds.filter((kind) => !kind.builtin);
      }

      function syncTaxonomyTypes() {
        const customIds = customEntityKinds().map((kind) => kind.id);
        const insertAt = BASE_TYPE_ORDER.indexOf("insight") + 1;
        typeOrder = [...BASE_TYPE_ORDER.slice(0, insertAt), ...customIds, ...BASE_TYPE_ORDER.slice(insertAt)];
        rawTypeOrder = [...BASE_RAW_TYPE_ORDER, ...customIds];
        ENTITY_NODE_KINDS = [...BASE_ENTITY_NODE_KINDS, ...customIds];
        GRAPH_GROUPABLE_TYPES = new Set(typeOrder);
      }

      function lightenHex(hex, amount) {
        const value = String(hex || "").replace("#", "");
        if (!/^[0-9a-fA-F]{6}$/.test(value)) return hex;
        const channel = (offset) => Math.round(parseInt(value.slice(offset, offset + 2), 16) * (1 - amount) + 255 * amount);
        return "#" + [channel(0), channel(2), channel(4)].map((part) => part.toString(16).padStart(2, "0")).join("");
      }
      const RELATION_CATEGORY_ORDER = ["structural", "ownership", "dependency", "evidence", "operational", "informational", "other"];
      const IMPORTANT_RELATION_CATEGORIES = new Set(["structural", "dependency", "ownership"]);
      const RELATION_CATEGORY_LABELS = {
        structural: "Structural",
        dependency: "Dependency",
        ownership: "Ownership",
        evidence: "Evidence",
        operational: "Operational",
        informational: "Informational",
        other: "Other"
      };
      const RELATION_CATEGORY_BY_TYPE = {
        contains: "structural",
        part_of: "structural",
        owns: "ownership",
        owned_by: "ownership",
        owner: "ownership",
        contributor_to: "ownership",
        stakeholder_of: "ownership",
        expert_on: "ownership",
        contact_for: "ownership",
        manager: "ownership",
        reviewer: "ownership",
        decision_maker_for: "ownership",
        has_repository: "structural",
        scoped_to: "structural",
        depends_on: "dependency",
        blocks: "dependency",
        supports: "dependency",
        implements: "dependency",
        validates: "evidence",
        captures: "evidence",
        evidenced_by: "evidence",
        requested_by: "operational",
        reported_by: "operational",
        drives: "operational",
        impacts: "operational",
        contributes_to: "operational",
        has_okr: "structural",
        measured_by: "operational",
        tracks_progress_for: "operational",
        supersedes: "operational",
        applies_practice: "operational",
        development_area: "operational",
        related_to: "informational",
        informs: "informational",
        informs_mission: "informational",
        discussed_in: "informational",
        subject: "informational",
        concept_mention: "informational",
        grouped_links: "other"
      };
      syncTaxonomyTypes();
      const activeGraphTypes = new Set(typeOrder);
      // Value filters store EXCLUSIONS: a node is visible unless its id was
      // explicitly unchecked. New entities therefore default to visible even
      // under an old saved view (the historic inclusion lists silently hid
      // everything created after the filter was set).
      const graphExcludedValues = {};
      const graphFilterSearches = {};
      let graphRelationValueMode = "all";
      let graphSelectedRelationTypes = new Set();
      let graphRelationQuickMode = "all";
      let graphSelectedRelationCategories = new Set(RELATION_CATEGORY_ORDER);
      const graphExpandedFilterTypes = new Set(["product", "team", "source"]);
      let selectedGraphFilterType = "product";
      let graphFilterPanelOpen = true;
      let graphFocusThreshold = "informational";
      let graphGroupMode = "none";
      let graphLayoutMode = "force";
      const graphExpandedTypeGroups = new Set();
      const graphCollapsedTypeGroups = new Set();
      let graphTypeGroupState = { groups: new Map(), memberToGroup: new Map() };
      // Pinned nodes are always visible: Reveal uses this when the hiding
      // cause is not a filter the user can simply uncheck (depth, node cap,
      // perspective, focus level, context scope).
      let graphPinnedNodeIds = new Set();
      // "hide" removes filtered nodes entirely; "fade" keeps the ones adjacent
      // to a visible node in the layout as low-opacity ghosts.
      let graphHiddenMode = "hide";
      let lastGraphVisibility = { hidden: new Map(), renderedIds: new Set(), shown: 0, faded: 0, capLimit: 0 };
      let graphFilterSaveTimer = undefined;
      let graphViews = [];
      let activeGraphViewId = undefined;
      let contextScopeDraft = undefined;
      let contextScopeCounts = { entities: 0, captures: 0, sources: 0 };
      let contextScopePreviewDetails = undefined;
      let contextScopeActivated = false;
      let contextScopeDraftDirty = false;
      let contextScopePreviewTimer = undefined;
      let contextPanelDismissed = false;
      let contextPackObjective = "";
      let contextPackBusy = false;
      let contextPackHistory = [];
      let selectedContextPack = undefined;
      let contextPackOutdated = false;
      let contextActivationBusy = false;
      let contextPackErrorMessage = "";
      const cockpitContextPackSessionId = "cockpit-" + Date.now().toString(36);
      graphViews = Array.isArray(state.graphViews) ? state.graphViews : [];
      hydrateGraphFilters(state.graphFilters);
      initContextScopeFromState();
      applyCockpitTheme();
      renderContextScopePanel();

      function graphViewTypeForType(type) {
        return type === "capture" ? "source" : type;
      }

      function graphViewType(node) {
        return graphViewTypeForType(node?.type);
      }

      window.addEventListener("message", (event) => {
        if (event.data?.type === "state") {
          const previousNodeId = selectedNodeId;
          const previousGraph = state?.graph;
          const nextState = event.data.payload;
          mergePendingSavedManualNotes(nextState);
          if (!nextState.documentation && state?.documentation) {
            nextState.documentation = {
              ...state.documentation,
              launchState: nextState.documentationState || state.documentation.launchState
            };
          }
          invalidateChangedManualNoteDetails(state, nextState);
          rememberCurationPackages(state);
          state = nextState;
          rememberCurationPackages(state);
          if (Array.isArray(state.graphViews)) graphViews = state.graphViews;
          syncTaxonomyTypes();
          hydrateGraphFilters(state.graphFilters, { preserveLocal: true });
          cockpitTheme = (typeof state.cockpitTheme === "string" && state.cockpitTheme) ? state.cockpitTheme : "dark";
          applyCockpitTheme();
          if (!contextScopeDraftDirty) initContextScopeFromState();
          selectedNodeId = undefined;
          if (!findTask(selectedTaskId)) selectedTaskId = undefined;
          if (selectedNoteId !== "__new__" && !findManualNote(selectedNoteId)) selectedNoteId = undefined;
          if (!findInboxItem(selectedInboxId)) selectedInboxId = undefined;
          if (!findCurationPackage(selectedCurationPackageId)) selectedCurationPackageId = undefined;
          const graphDelta = computeGraphDelta(previousGraph, state.graph);
          if (graphDelta) {
            recentGraphChanges = { ids: graphDelta.ids, at: Date.now() };
            showLiveUpdateToast(graphDelta);
          }
          render();
          renderContextScopePanel();
          if (previousNodeId) {
            const stillThere = (state.graph?.nodes || []).find((node) => node.id === previousNodeId);
            if (stillThere) selectNode(stillThere, { restore: true });
          }
        }
        if (event.data?.type === "operation") {
          operationStatus = event.data.payload;
          if (event.data.payload?.status === "error") {
            if ((contextPackBusy || contextActivationBusy) && !contextPackErrorMessage) {
              contextPackErrorMessage = String(event.data.payload.message || "Unable to update the Context control plane.");
            }
            contextPackBusy = false;
            contextActivationBusy = false;
            renderGraphContextPanel();
          }
          renderOperation();
        }
        if (event.data?.type === "inboxDetail" && event.data.id) {
          inboxDetailCache[event.data.id] = event.data.payload;
          if (pendingInboxDetailId === event.data.id) pendingInboxDetailId = undefined;
          if (selectedInboxId === event.data.id) renderInboxDetail();
        }
        if (event.data?.type === "manualNoteDetail" && event.data.id) {
          const id = event.data.id;
          const detail = event.data.payload;
          pendingManualNoteDetailIds.delete(id);
          if (pendingNoteDetailId === id) pendingNoteDetailId = undefined;
          if (!detail || detail.detailError) {
            delete noteDetailCache[id];
            manualNoteDetailFailures[id] = String(detail?.detailError || "The note content could not be loaded.");
          } else {
            noteDetailCache[id] = detail;
            delete manualNoteDetailFailures[id];
          }
          renderNotes();
          if (selectedNoteId === id) renderNoteDetail();
        }
        if (event.data?.type === "manualNoteDetails" && Array.isArray(event.data.payload)) {
          const receivedIds = new Set();
          for (const detail of event.data.payload) {
            if (!detail?.id) continue;
            const id = detail.id;
            receivedIds.add(id);
            pendingManualNoteDetailIds.delete(id);
            if (detail.detailError) {
              delete noteDetailCache[id];
              manualNoteDetailFailures[id] = String(detail.detailError);
            } else {
              noteDetailCache[id] = detail;
              delete manualNoteDetailFailures[id];
            }
          }
          for (const id of event.data.requestedIds || []) {
            pendingManualNoteDetailIds.delete(id);
            if (!receivedIds.has(id)) {
              delete noteDetailCache[id];
              manualNoteDetailFailures[id] = "The note content could not be loaded.";
            }
          }
          renderNotes();
          renderNoteDetail();
        }
        if (event.data?.type === "manualNoteSaved" && event.data.id) {
          if (event.data.payload) {
            noteDetailCache[event.data.id] = event.data.payload;
            rememberSavedManualNote(event.data.payload);
          }
          const noteEditor = document.querySelector("#noteDetail");
          if (noteEditor) noteEditor.dataset.manualNoteEditorDirty = "false";
          delete manualNoteDetailFailures[event.data.id];
          pendingManualNoteDetailIds.delete(event.data.id);
          pendingNoteDetailId = undefined;
          selectedNoteId = event.data.id;
          noteDraftEntityRef = undefined;
          renderNotes();
          renderNoteDetail();
        }
        if (event.data?.type === "manualNoteSaveFailed") {
          const saveButton = document.querySelector("#saveManualNote");
          if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = selectedNoteId === "__new__" ? "Save note" : "Save changes";
          }
        }
        if (event.data?.type === "openNewManualNote") {
          openNewManualNote(event.data.primary);
        }
        if (event.data?.type === "openDocumentation") {
          openDocumentationGuide(event.data.id);
        }
        if (event.data?.type === "documentationState" && state.documentation) {
          state.documentation = {
            ...state.documentation,
            launchState: event.data.payload
          };
          renderDocumentation();
        }
        if (event.data?.type === "entityContext" && event.data.ref) {
          entityContextCache[event.data.ref] = event.data.payload;
          const selected = (state.graph?.nodes || []).find((node) => node.id === selectedNodeId);
          if (selected && entityRefForNode(selected) === event.data.ref) {
            renderEntityContext(event.data.ref);
          }
          if (workspaceRef === event.data.ref) {
            renderWorkspace();
          }
        }
        if (event.data?.type === "focusEntity" && event.data.ref) {
          focusGraphOnEntity(event.data.ref);
        }
        if (event.data?.type === "graphViews") {
          graphViews = Array.isArray(event.data.views) ? event.data.views : [];
          if (event.data.activeId) {
            activeGraphViewId = String(event.data.activeId);
            scheduleGraphFiltersSave();
          } else if (activeGraphViewId && !graphViews.some((view) => view.id === activeGraphViewId)) {
            activeGraphViewId = undefined;
            scheduleGraphFiltersSave();
          }
          renderGraphViewControls();
          renderGraphContextPanel();
        }
        if (event.data?.type === "contextScope") {
          const payload = event.data.payload;
          contextScopeCounts = payload && payload.counts ? payload.counts : { entities: 0, captures: 0, sources: 0 };
          contextScopePreviewDetails = payload || undefined;
          contextScopeActivated = Boolean(payload && payload.scope && (payload.scope.selectedEntities || []).length > 0);
          contextScopeDraftDirty = false;
          contextActivationBusy = false;
          if (payload?.scope) contextScopeDraft = normalizeContextScopeDraft(payload.scope);
          renderContextScopePanel();
        }
        if (event.data?.type === "contextBoundaryCancelled") {
          contextActivationBusy = false;
          contextPackBusy = false;
          contextPackErrorMessage = "";
          renderContextScopePanel();
        }
        if (event.data?.type === "contextScopePreview") {
          if (event.data.payload) {
            const previewCounts = event.data.payload.counts || event.data.payload.resolved?.counts;
            if (previewCounts) contextScopeCounts = previewCounts;
            contextScopePreviewDetails = event.data.payload;
            renderContextScopePanel();
          }
        }
        if (event.data?.type === "contextViewActivated") {
          contextActivationBusy = false;
          contextScopeActivated = true;
          contextPackErrorMessage = "";
          const activatedView = event.data.payload?.view;
          contextPackOutdated = Boolean(selectedContextPack && (
            !activatedView
            || selectedContextPack.viewId !== activatedView.id
            || Number(selectedContextPack.viewVersion || 0) !== Number(activatedView.version || 0)
          ));
          renderContextScopePanel();
          requestContextPackHistory();
        }
        if (event.data?.type === "contextPacks") {
          const responseViewId = typeof event.data.viewId === "string" && event.data.viewId ? event.data.viewId : undefined;
          if (responseViewId !== activeGraphViewId) return;
          contextPackHistory = Array.isArray(event.data.payload) ? event.data.payload : [];
          if (!selectedContextPack && contextPackHistory.length > 0) selectedContextPack = contextPackHistory[0];
          contextPackErrorMessage = "";
          if (selectedContextPack?.viewId && contextScopeDraft?.viewId) {
            contextPackOutdated = selectedContextPack.viewId !== contextScopeDraft.viewId
              || Number(selectedContextPack.viewVersion || 0) !== Number(contextScopeDraft.viewVersion || 0);
          }
          renderGraphContextPanel();
        }
        if (event.data?.type === "contextPackCompiled") {
          contextPackBusy = false;
          contextPackErrorMessage = "";
          selectedContextPack = event.data.payload;
          contextPackOutdated = false;
          const summary = contextPackSummaryFromDetail(event.data.payload);
          contextPackHistory = [summary, ...contextPackHistory.filter((pack) => pack.id !== summary.id)].slice(0, 8);
          renderGraphContextPanel();
        }
        if (event.data?.type === "contextPackDetail") {
          contextPackBusy = false;
          contextPackErrorMessage = "";
          selectedContextPack = event.data.payload;
          renderGraphContextPanel();
        }
        if (event.data?.type === "contextPackError") {
          contextPackBusy = false;
          contextPackErrorMessage = String(event.data.error || event.data.message || "Unable to prepare the Context Pack.");
          renderGraphContextPanel();
        }
      });

      document.querySelectorAll("[data-view]").forEach((button) => {
        button.addEventListener("click", () => {
          setActiveView(button.dataset.view);
        });
      });
      document.querySelectorAll("[data-graph-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          setGraphPerspective(button.dataset.graphMode);
          renderGraph();
        });
      });
      document.querySelectorAll("[data-graph-select]").forEach((button) => {
        button.addEventListener("click", () => setGraphSelectionMode(button.dataset.graphSelect));
      });
      function setGraphSelectionMode(mode) {
        graphSelectionMode = mode === "context" ? "context" : "navigate";
        if (graphSelectionMode === "context") {
          contextPanelDismissed = false;
          const currentView = activeGraphView();
          const boundViewId = contextScopeDraft?.viewId;
          const viewBindingChanged = Boolean(currentView?.id || boundViewId) && currentView?.id !== boundViewId;
          const activeContextNeedsSync = contextScopeActivated && (currentView ? graphViewVisualIsDirty() : true);
          if (!contextScopeDraft?.nodeSelections?.length || viewBindingChanged || activeContextNeedsSync) seedContextScopeFromView();
          requestContextPackHistory();
        }
        document.querySelectorAll("[data-graph-select]").forEach((button) => button.classList.toggle("active", button.dataset.graphSelect === graphSelectionMode));
        renderGraphContextPanel();
        renderGraph();
      }
      document.querySelectorAll("[data-graph-isolate]").forEach((button) => {
        button.addEventListener("click", () => setGraphIsolateMode(button.dataset.graphIsolate));
      });
      function setGraphIsolateMode(mode) {
        if (!contextScopeHasSelection()) {
          mode = "show";
        }
        graphIsolateMode = mode === "dim" || mode === "hide" ? mode : "show";
        document.querySelectorAll("[data-graph-isolate]").forEach((button) => button.classList.toggle("active", button.dataset.graphIsolate === graphIsolateMode));
        updateGraphIsolateControls();
        renderGraph();
      }
      document.querySelectorAll("[data-self-links]").forEach((button) => {
        button.addEventListener("click", () => setSelfLinksMode(button.dataset.selfLinks));
      });
      function setSelfLinksMode(mode) {
        selfLinksMode = mode === "fade" || mode === "hide" ? mode : "show";
        document.querySelectorAll("[data-self-links]").forEach((button) => button.classList.toggle("active", button.dataset.selfLinks === selfLinksMode));
        renderGraph();
      }
      function applyCockpitTheme() {
        document.body.dataset.theme = cockpitTheme === "dark" ? "" : cockpitTheme;
        const theme = THEMES[cockpitTheme] || THEMES.dark;
        const extended = Object.assign({}, theme.nodes);
        for (const kind of customEntityKinds()) {
          const color = kind.color || "#8a8f9b";
          extended[kind.id] = theme.mode === "dark" ? lightenHex(color, 0.38) : color;
        }
        colors = extended;
      }
      document.querySelector("#themeToggle")?.addEventListener("click", () => {
        const order = Object.keys(THEMES);
        cockpitTheme = order[(order.indexOf(cockpitTheme) + 1) % order.length];
        applyCockpitTheme();
        renderGraph();
        vscode?.postMessage({ type: "setCockpitTheme", theme: cockpitTheme });
      });
      function contextScopeHasSelection() {
        return Boolean(contextScopeDraft && contextScopeDraft.selectedEntities.length > 0);
      }
      function updateGraphIsolateControls() {
        const hasContext = contextScopeHasSelection();
        if (!hasContext && graphIsolateMode !== "show") {
          graphIsolateMode = "show";
        }
        const group = document.querySelector("#graphIsolateTabs");
        if (group) {
          group.style.display = hasContext ? "" : "none";
        }
        document.querySelectorAll("[data-graph-isolate]").forEach((button) => {
          button.classList.toggle("active", button.dataset.graphIsolate === graphIsolateMode);
        });
      }
      document.querySelector("#graphGroupMode")?.addEventListener("change", (event) => {
        graphGroupMode = ["none", "auto", "by_type"].includes(event.target.value) ? event.target.value : "none";
        renderGraph();
        scheduleGraphFiltersSave();
      });
      document.querySelector("#graphLayoutMode")?.addEventListener("change", (event) => {
        graphLayoutMode = ["force", "hierarchy", "circle", "grid"].includes(event.target.value) ? event.target.value : "force";
        renderGraph();
        scheduleGraphFiltersSave();
      });
      document.querySelector("#graphViewPreset")?.addEventListener("change", (event) => {
        activeGraphViewId = event.target.value || undefined;
        const view = activeGraphView();
        if (view) {
          applyGraphView(view);
        } else {
          renderGraphViewControls();
        }
        scheduleGraphFiltersSave();
      });
      document.querySelector("#graphViewSaveAs")?.addEventListener("click", () => {
        vscode?.postMessage({ type: "saveGraphView", payload: serializeGraphView() });
      });
      document.querySelector("#graphViewUpdate")?.addEventListener("click", () => {
        if (!activeGraphViewId) return;
        vscode?.postMessage({ type: "saveGraphView", id: activeGraphViewId, payload: serializeGraphView() });
      });
      document.querySelector("#graphViewRename")?.addEventListener("click", () => {
        if (activeGraphViewId) vscode?.postMessage({ type: "renameGraphView", id: activeGraphViewId });
      });
      document.querySelector("#graphViewDuplicate")?.addEventListener("click", () => {
        if (activeGraphViewId) vscode?.postMessage({ type: "duplicateGraphView", id: activeGraphViewId });
      });
      document.querySelector("#graphViewCompare")?.addEventListener("click", () => {
        if (activeGraphViewId) vscode?.postMessage({ type: "compareGraphView", id: activeGraphViewId });
      });
      document.querySelector("#graphViewDelete")?.addEventListener("click", () => {
        if (activeGraphViewId) vscode?.postMessage({ type: "deleteGraphView", id: activeGraphViewId });
      });
      document.querySelector("#filter").addEventListener("input", () => {
        renderGraph();
        renderGraphSearchResults();
      });
      document.querySelector("#filter").addEventListener("focus", renderGraphSearchResults);
      document.querySelectorAll("[data-hidden-mode]").forEach((button) => {
        button.addEventListener("click", () => setGraphHiddenMode(button.dataset.hiddenMode));
      });
      document.querySelector("#graphVisibilityChip")?.addEventListener("click", () => {
        const breakdown = document.querySelector("#graphVisibilityBreakdown");
        if (!breakdown) return;
        breakdown.hidden = !breakdown.hidden;
        if (!breakdown.hidden) renderGraphVisibilityBreakdown();
      });
      document.querySelector("#toggleGraphFilters")?.addEventListener("click", () => {
        toggleGraphFilterPanel();
      });
      document.querySelector("#graphFilterPanel")?.addEventListener("wheel", (event) => {
        event.stopPropagation();
        const scroller = graphFilterWheelTarget(event.target, event.deltaY);
        if (!scroller) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
        scroller.scrollTop += event.deltaY * unit;
      }, { capture: true, passive: false });
      document.querySelector("#openFullCockpit").addEventListener("click", () => vscode?.postMessage({ type: "openFullCockpit" }));
      document.querySelector("#openSidebarCockpit").addEventListener("click", () => vscode?.postMessage({ type: "openSidebarCockpit" }));
      document.querySelector("#zoomIn").addEventListener("click", () => zoomGraph(1.18));
      document.querySelector("#zoomOut").addEventListener("click", () => zoomGraph(0.84));
      document.querySelector("#zoomReset").addEventListener("click", () => {
        if (graphViewer) {
          graphViewer.reset();
          return;
        }
        graphTransform = { x: 0, y: 0, k: 1 };
        applyGraphTransform();
      });
      bindGraphNavigation();
      document.querySelector("#refresh").addEventListener("click", () => vscode?.postMessage({ type: "refresh" }));
      document.querySelector("#refreshGraphify").addEventListener("click", () => vscode?.postMessage({ type: "refreshGraphify" }));
      document.addEventListener("click", (event) => {
        const helpLink = event.target.closest("[data-help-guide]");
        if (helpLink) {
          event.preventDefault();
          openDocumentationGuide(helpLink.dataset.helpGuide);
        }
        const externalLink = event.target.closest("[data-open-external]");
        if (externalLink) {
          event.preventDefault();
          vscode?.postMessage({ type: "openExternal", url: externalLink.dataset.openExternal });
        }
        if (!event.target.closest("[data-menu-control]")) closeMenus();
        if (!event.target.closest("[data-task-link-picker]")) closeTaskLinkPickers();
        if (!event.target.closest("#graphContextMenu")) closeGraphContextMenu();
        if (!event.target.closest(".graph-search")) {
          const searchResults = document.querySelector("#graphSearchResults");
          if (searchResults) searchResults.hidden = true;
        }
        if (!event.target.closest("#graphVisibilityChip") && !event.target.closest("#graphVisibilityBreakdown")) {
          const breakdown = document.querySelector("#graphVisibilityBreakdown");
          if (breakdown) breakdown.hidden = true;
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeGraphContextMenu();
          const searchResults = document.querySelector("#graphSearchResults");
          if (searchResults) searchResults.hidden = true;
        }
      });
      document.addEventListener("mousemove", (event) => {
        updateTaskPointerDrag(event);
      });
      document.addEventListener("mouseup", (event) => {
        finishTaskPointerDrag(event);
      });
      initSideResize();

      ${prioritiesBootstrap()}

      function setActiveView(view) {
        activeCockpitView = view;
        if (view === "priorities") mountPriorities();
        document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
        document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
        document.querySelector(".topbar").classList.toggle("map-active", view === "map");
        document.querySelector(".topbar").classList.toggle("help-active", view === "help");
        const scopeLabel = document.querySelector("#scope");
        if (scopeLabel) {
          scopeLabel.textContent = view === "help"
            ? "Help & guides"
            : state.graph?.includedProductIds?.length
              ? state.graph.includedProductIds.join(" · ")
              : "No product configured";
        }
        const side = document.querySelector(".side");
        side.classList.toggle("map-mode", view === "map");
        side.classList.toggle("tasks-mode", view === "tasks");
        side.classList.toggle("notes-mode", view === "notes");
        side.classList.toggle("inbox-mode", view === "inbox");
        side.classList.toggle("settings-mode", view === "settings");
        document.querySelector(".content").classList.toggle("side-hidden", !["map", "tasks", "notes", "inbox", "settings"].includes(view));
        if (view === "notes") {
          renderNotes();
          renderNoteDetail();
        }
        if (view === "help") {
          renderDocumentation();
          acknowledgeDocumentation();
        }
      }

      function initSideResize() {
        const content = document.querySelector(".content");
        const handle = document.querySelector("#sideResizer");
        if (!content || !handle) return;
        const saved = Number(localStorage.getItem("oneagent.sideWidth") || "");
        if (Number.isFinite(saved) && saved > 0) {
          setSideWidth(saved);
        }
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== undefined && event.button !== 0) return;
          event.preventDefault();
          const rect = content.getBoundingClientRect();
          sideResizeDrag = {
            pointerId: event.pointerId,
            contentRight: rect.right
          };
          handle.classList.add("dragging");
          handle.setPointerCapture?.(event.pointerId);
        });
        handle.addEventListener("pointermove", (event) => {
          if (!sideResizeDrag || sideResizeDrag.pointerId !== event.pointerId) return;
          setSideWidth(sideResizeDrag.contentRight - event.clientX);
        });
        const finish = (event) => {
          if (!sideResizeDrag || sideResizeDrag.pointerId !== event.pointerId) return;
          handle.releasePointerCapture?.(event.pointerId);
          handle.classList.remove("dragging");
          sideResizeDrag = undefined;
          const width = currentSideWidth();
          if (width) localStorage.setItem("oneagent.sideWidth", String(width));
        };
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", finish);
        window.addEventListener("resize", () => {
          const width = currentSideWidth();
          if (width) setSideWidth(width);
        });
      }

      function currentSideWidth() {
        const content = document.querySelector(".content");
        if (!content) return undefined;
        const raw = getComputedStyle(content).getPropertyValue("--side-width");
        const value = Number(String(raw).replace("px", "").trim());
        return Number.isFinite(value) ? value : undefined;
      }

      function setSideWidth(width) {
        const content = document.querySelector(".content");
        if (!content) return;
        const rect = content.getBoundingClientRect();
        const min = Math.min(300, Math.max(240, rect.width - 440));
        const max = Math.max(min, rect.width - 440);
        const next = Math.round(Math.max(min, Math.min(max, width)));
        content.style.setProperty("--side-width", next + "px");
        scheduleGraphResize();
      }

      function scheduleGraphResize() {
        if (graphResizeFrame !== undefined) return;
        graphResizeFrame = requestAnimationFrame(() => {
          graphResizeFrame = undefined;
          if (document.querySelector('[data-panel="map"]')?.classList.contains("active")) {
            renderGraph();
          }
        });
      }

      function setGraphPerspective(mode) {
        graphPerspective = mode === "product" ? "focus" : mode || "map";
        document.querySelectorAll("[data-graph-mode]").forEach((item) => item.classList.toggle("active", item.dataset.graphMode === graphPerspective));
      }

      function render() {
        rememberCurationPackages(state);
        const graph = state.graph;
        document.querySelector("#scope").textContent = activeCockpitView === "help"
          ? "Help & guides"
          : graph.includedProductIds.length
            ? graph.includedProductIds.join(" · ")
            : "No product configured";
        renderFocusSelector();
        renderReadiness();
        renderCurationQueue();
        renderLegend();
        renderGraphFilterPanel();
        renderGraphFocusFilter();
        renderGraphGroupControls();
        renderGraphRelationQuickControls();
        updateGraphIsolateControls();
        renderGraph();
        renderTasks();
        renderNotes();
        renderInbox();
        renderSources();
        renderDocumentation();
        renderSettings();
        renderContextScopePanel();
        renderWorkspace();
        renderToday();
        renderTaskDetail();
        renderNoteDetail();
        renderInboxDetail();
        renderSettingsDetail();
        renderDiagnostics();
        renderOperation();
      }

      function computeGraphDelta(previousGraph, nextGraph) {
        if (!Array.isArray(previousGraph?.nodes) || !Array.isArray(nextGraph?.nodes)) return undefined;
        const previousById = new Map(previousGraph.nodes.map((node) => [node.id, JSON.stringify(node)]));
        const ids = new Set();
        let added = 0;
        let changed = 0;
        for (const node of nextGraph.nodes) {
          const before = previousById.get(node.id);
          if (before === undefined) {
            added += 1;
            ids.add(node.id);
          } else if (before !== JSON.stringify(node)) {
            changed += 1;
            ids.add(node.id);
          }
          previousById.delete(node.id);
        }
        const removed = previousById.size;
        if (added === 0 && changed === 0 && removed === 0) return undefined;
        return { ids, added, changed, removed };
      }

      function isRecentlyChanged(node) {
        return Boolean(recentGraphChanges && recentGraphChanges.ids.has(node.id) && Date.now() - recentGraphChanges.at < 8000);
      }

      function showLiveUpdateToast(delta) {
        const toast = document.querySelector("#liveToast");
        if (!toast) return;
        const parts = [];
        if (delta.added) parts.push(delta.added + " added");
        if (delta.changed) parts.push(delta.changed + " updated");
        if (delta.removed) parts.push(delta.removed + " removed");
        toast.textContent = "Graph · " + parts.join(" · ");
        toast.classList.add("visible");
        clearTimeout(liveToastTimer);
        liveToastTimer = setTimeout(() => toast.classList.remove("visible"), 4000);
      }

      function renderOperation() {
        const target = document.querySelector("#operationStatus");
        if (!target) return;
        if (!operationStatus) {
          target.className = "operation";
          target.textContent = "";
          return;
        }
        target.className = "operation active " + escapeAttr(operationStatus.status || "");
        target.textContent = operationStatus.message || "";
        target.title = operationStatus.message || "";
      }

      function buildGroupChildrenIndex(graph) {
        const children = new Map();
        for (const edge of graph.edges || []) {
          let parent;
          let child;
          if (edge.predicate === "part_of") { parent = edge.target; child = edge.source; }
          else if (edge.predicate === "contains") { parent = edge.source; child = edge.target; }
          else continue;
          if (!parent || !child || parent === child) continue;
          if (!children.has(parent)) children.set(parent, new Set());
          children.get(parent).add(child);
        }
        return children;
      }

      function isGroupCollapsed(nodeId, childCount) {
        if (userExpandedGroups.has(nodeId)) return false;
        if (userCollapsedGroups.has(nodeId)) return true;
        return childCount >= GROUP_FOLD_AUTO_THRESHOLD;
      }

      // Fold collapsed groups: hide their part_of/contains descendants and reroute
      // the hidden nodes' edges onto the group node, aggregated with a count.
      function applyGroupFolding(graph) {
        if (!graph || !Array.isArray(graph.nodes)) return graph;
        const childrenIndex = buildGroupChildrenIndex(graph);
        groupFoldState = { childrenIndex, collapsed: new Set(), hiddenReps: new Map() };
        if (childrenIndex.size === 0) return graph;

        const parentIndex = new Map();
        for (const [parent, kids] of childrenIndex) {
          for (const kid of kids) {
            if (!parentIndex.has(kid)) parentIndex.set(kid, []);
            parentIndex.get(kid).push(parent);
          }
        }
        const collapsed = groupFoldState.collapsed;
        for (const [parent, kids] of childrenIndex) {
          if (isGroupCollapsed(parent, kids.size)) collapsed.add(parent);
        }
        if (collapsed.size === 0) return graph;

        // A child stays visible while at least one of its parent groups is both
        // expanded and itself visible; roots are always visible.
        const visibleMemo = new Map();
        const nodeVisible = (id, stack) => {
          if (visibleMemo.has(id)) return visibleMemo.get(id);
          const parents = parentIndex.get(id);
          if (!parents || parents.length === 0) return true;
          if (stack.has(id)) return true;
          stack.add(id);
          const visible = parents.some((parent) => !collapsed.has(parent) && nodeVisible(parent, stack));
          stack.delete(id);
          visibleMemo.set(id, visible);
          return visible;
        };
        // Hidden nodes roll up to their nearest visible collapsed ancestor.
        const representative = (id, stack) => {
          if (stack.has(id)) return undefined;
          stack.add(id);
          const parents = parentIndex.get(id) || [];
          for (const parent of parents) {
            if (collapsed.has(parent) && nodeVisible(parent, new Set())) return parent;
          }
          for (const parent of parents) {
            const found = representative(parent, stack);
            if (found) return found;
          }
          return undefined;
        };

        const hiddenReps = new Map();
        for (const node of graph.nodes) {
          if (nodeVisible(node.id, new Set())) continue;
          const rep = representative(node.id, new Set());
          if (rep) hiddenReps.set(node.id, rep);
        }
        groupFoldState.hiddenReps = hiddenReps;
        if (hiddenReps.size === 0) return graph;

        const foldedCounts = new Map();
        for (const rep of hiddenReps.values()) {
          foldedCounts.set(rep, (foldedCounts.get(rep) || 0) + 1);
        }

        const nodes = [];
        for (const node of graph.nodes) {
          if (hiddenReps.has(node.id)) continue;
          const count = foldedCounts.get(node.id);
          nodes.push(count ? { ...node, foldedCount: count } : node);
        }

        const edges = [];
        const aggregated = new Map();
        for (const edge of graph.edges || []) {
          const source = hiddenReps.get(edge.source) || edge.source;
          const target = hiddenReps.get(edge.target) || edge.target;
          if (source === edge.source && target === edge.target) {
            edges.push(edge);
            continue;
          }
          if (source === target) continue;
          const key = source < target ? source + "::" + target : target + "::" + source;
          const existing = aggregated.get(key);
          if (existing) {
            existing.meta.foldedRelationCount += 1;
            existing.label = existing.meta.foldedRelationCount + " relations";
            continue;
          }
          aggregated.set(key, {
            ...edge,
            id: "folded:" + key,
            source,
            target,
            label: edge.label || edge.predicate,
            meta: { ...(edge.meta || {}), foldedRelationCount: 1 }
          });
        }
        for (const entry of aggregated.values()) edges.push(entry);
        return { ...graph, nodes, edges };
      }

      function graphGroupChildCount(nodeId) {
        const kids = groupFoldState.childrenIndex.get(nodeId);
        return kids ? kids.size : 0;
      }

      function isCollapsedGroupNode(nodeId) {
        return groupFoldState.collapsed.has(nodeId);
      }

      function collapseGraphGroup(nodeId) {
        userCollapsedGroups.add(nodeId);
        userExpandedGroups.delete(nodeId);
        renderGraph();
      }

      function expandGraphGroup(nodeId) {
        userExpandedGroups.add(nodeId);
        userCollapsedGroups.delete(nodeId);
        const kids = groupFoldState.childrenIndex.get(nodeId);
        if (kids) {
          // Seed children around the group so the expand reads as a local unfold
          // instead of a full relayout (legacy SVG uses graphPositions, the
          // force-graph viewer consumes pendingFoldSeeds via foldSeedId).
          for (const kid of kids) pendingFoldSeeds.set(kid, nodeId);
          seedFoldPositions(nodeId, kids);
        }
        renderGraph();
      }

      function seedFoldPositions(groupId, kids) {
        const center = graphPositions.get(groupId);
        if (!center) return;
        let index = 0;
        for (const kid of kids) {
          if (!graphPositions.has(kid)) {
            const angle = (Math.PI * 2 * index) / kids.size;
            graphPositions.set(kid, { x: center.x + Math.cos(angle) * 56, y: center.y + Math.sin(angle) * 56 });
          }
          index += 1;
        }
      }

      function toggleGraphGroupFold(node) {
        if (!node) return false;
        if (isVirtualTypeGroup(node)) {
          setTypeGroupExpanded(node.meta?.groupType, true);
          return true;
        }
        if (isCollapsedGroupNode(node.id)) {
          expandGraphGroup(node.id);
          return true;
        }
        if (graphGroupChildCount(node.id) > 0) {
          collapseGraphGroup(node.id);
          return true;
        }
        return false;
      }

      function matchesGraphTextFilter(node, filter) {
        return !filter || node.label.toLowerCase().includes(filter) || graphViewType(node).includes(filter) || node.type.includes(filter) || (node.provider || "").includes(filter);
      }

      // Runs the whole node filter pipeline while recording WHY each node was
      // dropped, so the search dropdown, the fade mode and the visibility chip
      // can explain (and undo) every hiding cause instead of silently losing
      // nodes. Pinned nodes bypass everything; context-scope nodes keep their
      // historic bypass of type/value/perspective only.
      function computeGraphVisibility(graph, filter) {
        const hidden = new Map();
        const mark = (node, cause, label) => {
          if (!hidden.has(node.id)) hidden.set(node.id, { cause, label });
        };
        let nodes = [];
        for (const node of graph.nodes || []) {
          const pinned = graphPinnedNodeIds.has(node.id);
          if (!pinned && !isNodeInContextScope(node)) {
            const viewType = graphViewType(node);
            if (!activeGraphTypes.has(viewType)) { mark(node, "type", typeLabel(viewType) + " hidden"); continue; }
            if (!matchesGraphValueFilter(node)) { mark(node, "value", "unchecked in " + typeLabel(viewType)); continue; }
            if (!matchesGraphPerspective(node, graph)) { mark(node, "perspective", "outside " + graphPerspective + " perspective"); continue; }
          }
          if (!pinned && !matchesGraphFocusFilter(node)) { mark(node, "focus", "below focus level"); continue; }
          if (!pinned && !matchesGraphTextFilter(node, filter)) { mark(node, "text", "text filter"); continue; }
          nodes.push(node);
        }
        const depthFocus = selectedNodeId || focusedNodeId;
        if (graphDepth > 0 && depthFocus) {
          const within = nodesWithinDepth(graph, depthFocus, graphDepth);
          nodes = nodes.filter((node) => {
            if (within.has(node.id) || graphPinnedNodeIds.has(node.id)) return true;
            mark(node, "depth", "beyond depth " + graphDepth);
            return false;
          });
        }
        if (graphIsolateMode === "hide" && contextScopeHasSelection()) {
          nodes = nodes.filter((node) => {
            if (isNodeInContextScope(node) || graphPinnedNodeIds.has(node.id)) return true;
            mark(node, "scope", "outside context scope");
            return false;
          });
        }
        nodes = prioritizeGraphNodes(nodes, filter);
        const limit = graphNodeLimit(filter);
        if (nodes.length > limit) {
          const kept = [];
          let budget = limit;
          for (const node of nodes) {
            if (graphPinnedNodeIds.has(node.id) || node.id === selectedNodeId || node.id === focusedNodeId) {
              kept.push(node);
              continue;
            }
            if (budget > 0) {
              kept.push(node);
              budget -= 1;
            } else {
              mark(node, "cap", "over the " + limit + " node display limit");
            }
          }
          nodes = kept;
        }
        return { nodes, hidden, capLimit: limit };
      }

      // In fade mode, filtered-out nodes that touch a visible node stay in the
      // layout as ghosts (capped, most-connected first) so missing context is
      // noticeable and recoverable via right-click.
      function collectGhostNodes(graph, hidden, nodeIds) {
        const GHOST_LIMIT = 80;
        const candidates = new Map();
        for (const edge of graph.edges || []) {
          let ghostId;
          let anchorId;
          if (hidden.has(edge.source) && nodeIds.has(edge.target)) { ghostId = edge.source; anchorId = edge.target; }
          else if (hidden.has(edge.target) && nodeIds.has(edge.source)) { ghostId = edge.target; anchorId = edge.source; }
          else continue;
          if (!candidates.has(ghostId)) candidates.set(ghostId, { edges: [], links: 0 });
          const entry = candidates.get(ghostId);
          entry.links += 1;
          if (entry.edges.length < 6) entry.edges.push({ ...edge, ghost: true });
          void anchorId;
        }
        const nodesById = new Map((graph.nodes || []).map((node) => [node.id, node]));
        const picked = Array.from(candidates.entries())
          .sort((left, right) => right[1].links - left[1].links)
          .slice(0, GHOST_LIMIT);
        const ghostNodes = [];
        const ghostEdges = [];
        for (const [ghostId, entry] of picked) {
          const node = nodesById.get(ghostId);
          if (!node) continue;
          ghostNodes.push({ ...node, ghost: true });
          for (const edge of entry.edges) ghostEdges.push(edge);
        }
        return { ghostNodes, ghostEdges };
      }

      // Explains why a node is absent from the current render: a filter cause
      // recorded by computeGraphVisibility, a collapsed part_of/contains group,
      // or a virtual type group.
      function hiddenReasonForNode(nodeId) {
        if (lastGraphVisibility.renderedIds.has(nodeId)) return undefined;
        const filtered = lastGraphVisibility.hidden.get(nodeId);
        if (filtered) return filtered;
        const groupId = graphTypeGroupState.memberToGroup.get(nodeId);
        if (groupId) {
          const group = graphTypeGroupState.groups.get(groupId);
          return { cause: "type-group", label: "inside " + (group ? group.label : "a type") + " group", groupId };
        }
        const rep = groupFoldState.hiddenReps.get(nodeId);
        if (rep) {
          const parent = (state.graph.nodes || []).find((node) => node.id === rep);
          return { cause: "fold", label: "inside collapsed " + compactLabel(parent?.label || "group", 18), rep };
        }
        return { cause: "unknown", label: "not in the current render" };
      }

      // Undoes whatever hides the node: uncheckable filters are fixed in
      // place, structural causes (depth, cap, perspective, focus, scope) pin
      // the node instead, groups are expanded. Ends with the camera on it.
      function revealGraphNode(nodeId) {
        const node = (state.graph.nodes || []).find((entry) => entry.id === nodeId);
        if (!node) return;
        for (let pass = 0; pass < 4; pass += 1) {
          const reason = hiddenReasonForNode(nodeId);
          if (!reason) break;
          if (reason.cause === "type") {
            activeGraphTypes.add(graphViewType(node));
          } else if (reason.cause === "value") {
            const viewType = graphViewType(node);
            graphExcludedValues[viewType]?.delete(nodeId);
            if (graphExcludedValues[viewType] && !graphExcludedValues[viewType].size) delete graphExcludedValues[viewType];
          } else if (reason.cause === "text") {
            const filterInput = document.querySelector("#filter");
            if (filterInput) filterInput.value = "";
          } else if (reason.cause === "type-group") {
            const group = graphTypeGroupState.groups.get(reason.groupId);
            setTypeGroupExpanded(group?.meta?.groupType, true);
          } else if (reason.cause === "fold") {
            userExpandedGroups.add(reason.rep);
            userCollapsedGroups.delete(reason.rep);
          } else {
            graphPinnedNodeIds.add(nodeId);
          }
          renderGraph();
        }
        recentGraphChanges = { ids: new Set([nodeId]), at: Date.now() };
        renderGraphFilterSurfaces();
        const rendered = (state.graph.nodes || []).find((entry) => entry.id === nodeId);
        if (rendered) {
          selectNode(rendered);
          window.setTimeout(() => graphViewer?.focusSelected?.(), 120);
        }
      }

      function unpinGraphNode(nodeId) {
        graphPinnedNodeIds.delete(nodeId);
        renderGraphFilterSurfaces();
      }

      function renderGraphSearchResults() {
        const container = document.querySelector("#graphSearchResults");
        const input = document.querySelector("#filter");
        if (!container || !input) return;
        const query = input.value.trim().toLowerCase();
        const onGraphView = document.querySelector(".topbar")?.classList.contains("map-active");
        if (!query || !onGraphView) {
          container.hidden = true;
          container.innerHTML = "";
          return;
        }
        const matches = (state.graph.nodes || [])
          .filter((node) => (node.label || "").toLowerCase().includes(query) || graphViewType(node).includes(query))
          .sort((left, right) => {
            const leftHidden = hiddenReasonForNode(left.id) ? 1 : 0;
            const rightHidden = hiddenReasonForNode(right.id) ? 1 : 0;
            if (leftHidden !== rightHidden) return leftHidden - rightHidden;
            return (left.label || "").localeCompare(right.label || "");
          })
          .slice(0, 12);
        if (!matches.length) {
          container.innerHTML = '<div class="graph-search-empty">No node matches</div>';
          container.hidden = false;
          return;
        }
        container.innerHTML = matches.map((node) => {
          const reason = hiddenReasonForNode(node.id);
          const dot = '<i class="dot" style="background:' + (colors[graphViewType(node)] || "var(--muted)") + (reason ? ";opacity:0.35" : "") + '"></i>';
          const meta = '<small>' + escapeHtml(typeLabel(graphViewType(node))) + '</small>';
          const status = reason
            ? '<span class="graph-search-reason" title="' + escapeAttr(reason.label) + '">' + escapeHtml(reason.label) + '</span><button type="button" class="graph-search-reveal" data-search-reveal="' + escapeAttr(node.id) + '">Reveal</button>'
            : "";
          return '<div class="graph-search-row' + (reason ? " hidden-node" : "") + '" role="button" tabindex="0" data-search-node="' + escapeAttr(node.id) + '">' + dot + '<span class="graph-search-label">' + escapeHtml(compactLabel(node.label || node.id, 34)) + '</span>' + meta + status + '</div>';
        }).join("");
        container.hidden = false;
        // Picking a result ends the search: the query must not linger as a text
        // filter that hides the rest of the graph.
        const clearSearch = () => {
          container.hidden = true;
          input.value = "";
          renderGraph();
        };
        container.querySelectorAll("[data-search-reveal]").forEach((button) => {
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            clearSearch();
            revealGraphNode(button.dataset.searchReveal);
          });
        });
        container.querySelectorAll("[data-search-node]").forEach((row) => {
          row.addEventListener("click", () => {
            const id = row.dataset.searchNode;
            const reason = hiddenReasonForNode(id);
            clearSearch();
            if (reason) {
              revealGraphNode(id);
              return;
            }
            const node = (state.graph.nodes || []).find((entry) => entry.id === id);
            if (node) {
              recentGraphChanges = { ids: new Set([id]), at: Date.now() };
              selectNode(node);
              window.setTimeout(() => graphViewer?.focusSelected?.(), 120);
            }
          });
        });
      }

      function setGraphHiddenMode(mode) {
        graphHiddenMode = mode === "fade" ? "fade" : "hide";
        document.querySelectorAll("[data-hidden-mode]").forEach((button) => {
          button.classList.toggle("active", button.dataset.hiddenMode === graphHiddenMode);
        });
        renderGraph();
        scheduleGraphFiltersSave();
      }

      function renderGraphVisibilityChip() {
        const chip = document.querySelector("#graphVisibilityChip");
        if (!chip) return;
        const hiddenCount = Math.max(0, lastGraphVisibility.hidden.size - lastGraphVisibility.faded);
        const parts = ['<strong>' + lastGraphVisibility.shown + '</strong> shown'];
        if (lastGraphVisibility.faded) parts.push(lastGraphVisibility.faded + " faded");
        parts.push((hiddenCount ? '<span class="warn">' + hiddenCount + " hidden</span>" : "0 hidden"));
        const dataTruncated = (state.graph?.diagnostics || []).some((diagnostic) => diagnostic.provider === "work-memory" && diagnostic.status === "degraded" && String(diagnostic.message || "").startsWith("Graph data truncated"));
        if (dataTruncated) parts.push('<span class="warn">data truncated</span>');
        chip.innerHTML = parts.join(" · ");
        chip.classList.toggle("has-hidden", hiddenCount > 0 || dataTruncated);
        const breakdown = document.querySelector("#graphVisibilityBreakdown");
        if (breakdown && !breakdown.hidden) renderGraphVisibilityBreakdown();
      }

      function renderGraphVisibilityBreakdown() {
        const breakdown = document.querySelector("#graphVisibilityBreakdown");
        if (!breakdown) return;
        const CAUSE_LABELS = {
          type: "Types unchecked",
          value: "Value selections",
          perspective: "Perspective",
          focus: "Focus level",
          text: "Text filter",
          depth: "Focus depth",
          scope: "Context scope",
          cap: "Node display limit"
        };
        const counts = new Map();
        for (const reason of lastGraphVisibility.hidden.values()) {
          counts.set(reason.cause, (counts.get(reason.cause) || 0) + 1);
        }
        const rows = Array.from(counts.entries())
          .sort((left, right) => right[1] - left[1])
          .map(([cause, count]) =>
            '<button type="button" class="visibility-cause' + (cause === "cap" ? " warn" : "") + '" data-visibility-cause="' + escapeAttr(cause) + '"><span>' + escapeHtml(CAUSE_LABELS[cause] || cause) + '</span><strong>' + count + '</strong></button>'
          ).join("");
        breakdown.innerHTML = rows || '<div class="visibility-cause none">Nothing is hidden</div>';
        breakdown.querySelectorAll("[data-visibility-cause]").forEach((button) => {
          button.addEventListener("click", () => {
            breakdown.hidden = true;
            graphFilterPanelOpen = true;
            renderGraphFilterToggle();
            renderGraphFilterPanel();
          });
        });
      }

      function renderGraph() {
        const graph = applyGroupFolding(state.graph);
        const svg = document.querySelector("#graph");
        const width = svg.clientWidth || 900;
        const height = svg.clientHeight || 640;
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        const filter = document.querySelector("#filter").value.trim().toLowerCase();
        if (graphPerspective !== "map") ensureFocusedNode(graph);
        const visibility = computeGraphVisibility(graph, filter);
        let nodes = visibility.nodes;
        let nodeIds = new Set(nodes.map((node) => node.id));
        let edges = prioritizeGraphEdges(buildVisibleGraphEdges(graph, nodeIds)).slice(0, graphEdgeLimit(filter));
        const groupedGraph = applyTypeGrouping(nodes, edges, filter);
        nodes = groupedGraph.nodes;
        edges = groupedGraph.edges;
        nodeIds = new Set(nodes.map((node) => node.id));
        let ghostCount = 0;
        if (graphHiddenMode === "fade") {
          const ghosts = collectGhostNodes(graph, visibility.hidden, nodeIds);
          ghostCount = ghosts.ghostNodes.length;
          nodes = nodes.concat(ghosts.ghostNodes);
          edges = edges.concat(ghosts.ghostEdges);
          for (const ghost of ghosts.ghostNodes) nodeIds.add(ghost.id);
        }
        lastGraphVisibility = {
          hidden: visibility.hidden,
          renderedIds: nodeIds,
          shown: nodeIds.size - ghostCount,
          faded: ghostCount,
          capLimit: visibility.capLimit
        };
        if (selectedNodeId && !nodeIds.has(selectedNodeId)) resetNodeDetail();
        if (selectedRelationId && !edges.some((edge) => String(edge.id || graphRelationMenuTitle(edge)) === selectedRelationId)) resetNodeDetail();
        renderGraphViewControls();
        renderGraphVisibilityChip();

        const degrees = new Map();
        for (const edge of edges) {
          degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
          degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
        }
        // The legacy SVG renderer has no hierarchy layout; fall back to force.
        const positions = layoutNodes(nodes, edges, width, height, graphLayoutMode === "hierarchy" ? "force" : graphLayoutMode);
        svg.querySelectorAll(".empty").forEach((item) => item.remove());
        const layer = ensureGraphLayer(svg);
        layer.innerHTML = "";
        applyGraphTransform();
        if (nodes.length === 0) {
          clearEnhancedGraphViewer();
          const text = createSvg("text", { class: "empty", x: width / 2, y: height / 2, "text-anchor": "middle" });
          text.textContent = graph.diagnostics?.[0]?.message || "No graph data";
          svg.appendChild(text);
          return;
        }

        if (renderEnhancedGraph(nodes, edges, degrees)) {
          return;
        }

        for (const edge of edges) {
          const left = positions.get(edge.source);
          const right = positions.get(edge.target);
          if (!left || !right) continue;
          const line = createSvg("line", {
            class: "edge " + (edge.ghost ? "ghost " : "") + (edge.provider === "graphify" ? "graphify " : "") + (edge.provider === "compressed" ? "indirect " : "") + ((edge.confidence || 1) < 0.7 ? "low" : ""),
            x1: left.x,
            y1: left.y,
            x2: right.x,
            y2: right.y
          });
          line.addEventListener("click", () => selectRelation(edge));
          line.addEventListener("contextmenu", (event) => showGraphRelationContextMenu(edge, event));
          layer.appendChild(line);
        }

        for (const node of nodes) {
          const position = positions.get(node.id);
          const focusClass = isPrimaryFocus(node) ? " focus-primary" : isSupportingFocus(node) ? " focus-supporting" : "";
          const group = createSvg("g", { class: "node" + focusClass + (node.ghost ? " ghost" : "") + (node.id === selectedNodeId ? " selected" : "") + (isNodeInContextScope(node) ? " in-context" : "") + (isRecentlyChanged(node) ? " pulse" : "") + (graphIsolateMode === "dim" && contextScopeHasSelection() && !isNodeInContextScope(node) ? " dimmed" : ""), transform: "translate(" + position.x + " " + position.y + ")" });
          group.addEventListener("click", () => selectNode(node));
          group.addEventListener("contextmenu", (event) => showGraphContextMenu(node, event));
          group.addEventListener("dblclick", () => {
            if (toggleGraphGroupFold(node)) return;
            if (node.path) vscode?.postMessage({ type: "openFile", path: node.path });
          });
          drawNodeShape(group, node, degrees.get(node.id) || 0);
          if (node.foldedCount) {
            const badge = createSvg("g", { class: "fold-badge", transform: "translate(16 -16)" });
            badge.appendChild(createSvg("circle", { r: 10 }));
            const count = createSvg("text", { "text-anchor": "middle", y: 3 });
            count.textContent = node.foldedCount > 99 ? "99+" : String(node.foldedCount);
            badge.appendChild(count);
            group.appendChild(badge);
          }
          if (shouldRenderNodeLabel(node, nodes.length, filter)) {
            const label = createSvg("text", { x: 28, y: -2 });
            label.textContent = compactLabel(node.label, nodes.length > 32 ? 18 : 28);
            const kind = createSvg("text", { class: "kind", x: 28, y: 15 });
            kind.textContent = graphViewType(node) + (node.provider === "graphify" ? " · graphify" : "");
            group.appendChild(label);
            group.appendChild(kind);
          }
          layer.appendChild(group);
        }
        pendingFoldSeeds.clear();
      }

      function clearEnhancedGraphViewer() {
        document.querySelector('[data-panel="map"]')?.classList.remove("enhanced-graph");
        if (graphViewer) {
          graphViewer.destroy?.();
          graphViewer = undefined;
        }
        const host = document.querySelector("#graphCanvas");
        if (host) {
          host.innerHTML = "";
          delete host.dataset.edgeCount;
          delete host.dataset.compressedEdgeCount;
          delete host.dataset.compressedEdges;
        }
      }

      function buildVisibleGraphEdges(graph, visibleNodeIds) {
        const direct = [];
        for (const edge of graph.edges || []) {
          if (!matchesGraphRelationFilter(edge)) continue;
          if (visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) {
            direct.push(edge);
          }
        }
        return direct;
      }

      function typeGroupKey(type) {
        return "type:" + type;
      }

      function typeGroupNodeId(type) {
        return "virtual-group:type:" + type;
      }

      function isVirtualTypeGroup(node) {
        return Boolean(node?.meta?.virtualGroup && node.meta.groupKind === "type");
      }

      function typeLabel(type) {
        const labels = {
          domain: "Domains",
          subdomain: "Subdomains",
          team: "Teams",
          product: "Products",
          project: "Projects",
          discovery: "Discoveries",
          initiative: "Initiatives",
          feature: "Features",
          feature_request: "Feature requests",
          practice: "Practices",
          mission: "Missions",
          okr: "OKRs",
          kpi: "KPIs",
          oneagent: "OneAgents",
          person: "People",
          insight: "Insights",
          capture: "Captures",
          source: "Sources & captures",
          task: "Tasks",
          question: "Questions",
          risk: "Risks",
          decision: "Decisions",
          concept: "Concepts",
          wiki_page: "Wiki pages",
          repository: "Repositories"
        };
        if (labels[type]) return labels[type];
        const custom = customEntityKinds().find((kind) => kind.id === type);
        if (custom) return custom.label || custom.id;
        return String(type || "Nodes").replace(/_/g, " ");
      }

      function shouldGroupType(type, count, filter) {
        if (!GRAPH_GROUPABLE_TYPES.has(type)) return false;
        const key = typeGroupKey(type);
        if (graphExpandedTypeGroups.has(key)) return false;
        if (graphCollapsedTypeGroups.has(key)) return count >= 2;
        if (graphGroupMode === "by_type") return count >= 2;
        if (graphGroupMode === "auto") return count >= GROUP_FOLD_AUTO_THRESHOLD;
        return false;
      }

      function nodeCanBeTypeGrouped(node) {
        if (!node || isVirtualTypeGroup(node)) return false;
        if (!GRAPH_GROUPABLE_TYPES.has(graphViewType(node))) return false;
        return true;
      }

      function applyTypeGrouping(nodes, edges, filter) {
        graphTypeGroupState = { groups: new Map(), memberToGroup: new Map() };
        const buckets = new Map();
        for (const node of nodes) {
          if (!nodeCanBeTypeGrouped(node)) continue;
          const type = graphViewType(node);
          if (!buckets.has(type)) buckets.set(type, []);
          buckets.get(type).push(node);
        }

        const groups = new Map();
        const representative = new Map();
        for (const [type, members] of buckets) {
          if (!shouldGroupType(type, members.length, filter)) continue;
          const groupId = typeGroupNodeId(type);
          const memberRefs = members.map((member) => entityRefForNode(member)).filter(Boolean);
          const groupNode = {
            id: groupId,
            label: typeLabel(type),
            type: "group",
            status: "active",
            provider: "visual-group",
            foldedCount: members.length,
            meta: {
              virtualGroup: true,
              groupKind: "type",
              groupType: type,
              memberCount: members.length,
              memberRefs,
              members: members.map((member) => ({
                id: member.id,
                label: member.label || member.name || member.id,
                type: member.type,
                ref: entityRefForNode(member)
              })),
              description: "Visual group for " + members.length + " " + typeLabel(type).toLowerCase() + "."
            }
          };
          groups.set(groupId, groupNode);
          graphTypeGroupState.groups.set(groupId, groupNode);
          for (const member of members) {
            representative.set(member.id, groupId);
            graphTypeGroupState.memberToGroup.set(member.id, groupId);
          }
        }
        if (groups.size === 0) return { nodes, edges };

        const groupedNodeIds = new Set(representative.keys());
        const nextNodes = nodes.filter((node) => !groupedNodeIds.has(node.id)).concat(Array.from(groups.values()));
        const aggregated = new Map();
        for (const edge of edges) {
          const source = representative.get(edge.source) || edge.source;
          const target = representative.get(edge.target) || edge.target;
          if (source === target) continue;
          const key = source + "::" + target;
          const existing = aggregated.get(key);
          if (existing) {
            existing.meta.groupedRelationCount += 1;
            const relationType = graphRelationType(edge);
            existing.meta.relationTypes[relationType] = (existing.meta.relationTypes[relationType] || 0) + 1;
            existing.label = existing.meta.groupedRelationCount + " links";
            continue;
          }
          const relationType = graphRelationType(edge);
          aggregated.set(key, {
            id: "type-group-edge:" + key,
            source,
            target,
            label: representative.has(edge.source) || representative.has(edge.target) ? "1 link" : edge.label,
            predicate: "grouped_links",
            status: "active",
            confidence: edge.confidence,
            provider: representative.has(edge.source) || representative.has(edge.target) ? "compressed" : edge.provider,
            meta: {
              ...(edge.meta || {}),
              virtualGroupEdge: representative.has(edge.source) || representative.has(edge.target),
              groupedRelationCount: 1,
              relationTypes: { [relationType]: 1 }
            }
          });
        }
        return { nodes: nextNodes, edges: Array.from(aggregated.values()) };
      }

      function renderEnhancedGraph(nodes, edges, degrees) {
        const host = document.querySelector("#graphCanvas");
        const panel = document.querySelector('[data-panel="map"]');
        if (!host || !window.OneAgentGraphViewer?.create) {
          panel?.classList.remove("enhanced-graph");
          return false;
        }
        if (!graphViewer) {
          graphViewer = window.OneAgentGraphViewer.create(host, {
            onNodeClick: (node) => selectNode(node),
            onLinkClick: (edge) => selectRelation(edge),
            onNodeContextMenu: (node, event) => showGraphContextMenu(node, event),
            onLinkContextMenu: (edge, event) => showGraphRelationContextMenu(edge, event),
            onBackgroundClick: () => {
              resetNodeDetail();
              renderGraph();
            },
            onNodeDoubleClick: (node) => {
              if (toggleGraphGroupFold(node)) return;
              if (node.path) vscode?.postMessage({ type: "openFile", path: node.path });
            }
          });
        }
        panel?.classList.add("enhanced-graph");
        window.__oneAgentGraphDebug = { nodes, edges };
        host.dataset.edgeCount = String(edges.length);
        host.dataset.compressedEdgeCount = String(edges.filter((edge) => edge.provider === "compressed").length);
        host.dataset.compressedEdges = edges
          .filter((edge) => edge.provider === "compressed")
          .map((edge) => edge.source + ">" + edge.target + ":" + edge.label)
          .join("|");
        const selfLinksTabs = document.querySelector("#selfLinksTabs");
        if (selfLinksTabs) {
          selfLinksTabs.style.display = nodes.some((node) => node?.meta?.self) ? "" : "none";
        }
        graphViewer.render({
          nodes: nodes.map((node) => ({ ...node, degree: degrees.get(node.id) || 0, inContext: isNodeInContextScope(node), recentChange: isRecentlyChanged(node) ? recentGraphChanges.at : 0, dimmed: graphIsolateMode === "dim" && contextScopeHasSelection() && !isNodeInContextScope(node), foldSeedId: pendingFoldSeeds.get(node.id) })),
          edges,
          layoutMode: graphLayoutMode,
          selfLinks: selfLinksMode,
          showLabels: true,
          showArrows: true
        }, {
          mode: "2d",
          selectedNodeId,
          colors,
          theme: (THEMES[cockpitTheme] || THEMES.dark).mode
        });
        pendingFoldSeeds.clear();
        return true;
      }

      function nodesWithinDepth(graph, startId, depth) {
        const adjacency = new Map();
        for (const edge of graph.edges || []) {
          if (!matchesGraphRelationFilter(edge)) continue;
          if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
          if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
          adjacency.get(edge.source).push(edge.target);
          adjacency.get(edge.target).push(edge.source);
        }
        const seen = new Set([startId]);
        let frontier = [startId];
        for (let level = 0; level < depth; level += 1) {
          const next = [];
          for (const id of frontier) {
            for (const neighbour of adjacency.get(id) || []) {
              if (!seen.has(neighbour)) {
                seen.add(neighbour);
                next.push(neighbour);
              }
            }
          }
          frontier = next;
        }
        return seen;
      }

      function prioritizeGraphNodes(nodes, filter) {
        const recentSourceIds = new Set((state.sources || []).slice(0, 8).map((source) => "source:" + source.id));
        const typeRank = { domain: 0, subdomain: 1, team: 2, product: 3, wiki_page: 4, concept: 5, decision: 6, question: 7, risk: 8, task: 9, source: 10, repository: 11 };
        return [...nodes].sort((left, right) => {
          if (left.id === selectedNodeId) return -1;
          if (right.id === selectedNodeId) return 1;
          const leftRecent = recentSourceIds.has(left.id) ? -2 : 0;
          const rightRecent = recentSourceIds.has(right.id) ? -2 : 0;
          const leftGraphify = left.provider === "graphify" && !filter ? 4 : 0;
          const rightGraphify = right.provider === "graphify" && !filter ? 4 : 0;
          return (leftRecent + (typeRank[left.type] ?? 9) + leftGraphify) - (rightRecent + (typeRank[right.type] ?? 9) + rightGraphify);
        });
      }

      function prioritizeGraphEdges(edges) {
        return [...edges].sort((left, right) => {
          const leftSelected = left.source === selectedNodeId || left.target === selectedNodeId ? -2 : 0;
          const rightSelected = right.source === selectedNodeId || right.target === selectedNodeId ? -2 : 0;
          const leftGraphify = left.provider === "graphify" ? 2 : 0;
          const rightGraphify = right.provider === "graphify" ? 2 : 0;
          return (leftSelected + leftGraphify) - (rightSelected + rightGraphify);
        });
      }

      function graphNodeLimit(filter) {
        const configured = Math.max(20, Number(state.graphLimits?.visibleMaxNodes) || 500);
        if (filter || graphPerspective === "map") return configured;
        if (graphPerspective === "bmad") return Math.min(configured, 180);
        if (graphPerspective === "focus" || graphPerspective === "product") return Math.min(configured, 240);
        return Math.min(configured, 220);
      }

      function graphEdgeLimit(filter) {
        const configured = Math.max(20, Number(state.graphLimits?.visibleMaxEdges) || 1200);
        if (filter || graphPerspective === "map") return configured;
        if (graphPerspective === "bmad") return Math.min(configured, 300);
        return Math.min(configured, 500);
      }

      function shouldRenderNodeLabel(node, visibleCount, filter) {
        if (node.ghost) return false;
        if (isVirtualTypeGroup(node)) return true;
        if (filter || node.id === selectedNodeId) return true;
        if (visibleCount <= 28) return true;
        return node.type === "product" || node.type === "repository" || (state.sources || []).slice(0, 3).some((source) => node.id === "source:" + source.id);
      }

      function ensureGraphLayer(svg) {
        let layer = svg.querySelector("#graphLayer");
        if (!layer) {
          layer = createSvg("g", { id: "graphLayer" });
          svg.appendChild(layer);
        }
        return layer;
      }

      function applyGraphTransform() {
        const layer = document.querySelector("#graphLayer");
        if (layer) {
          layer.setAttribute("transform", "translate(" + graphTransform.x + " " + graphTransform.y + ") scale(" + graphTransform.k + ")");
        }
      }

      function zoomGraph(factor, center) {
        if (graphViewer) {
          graphViewer.zoom(factor);
          return;
        }
        const svg = document.querySelector("#graph");
        const rect = svg.getBoundingClientRect();
        const point = center || { x: rect.width / 2, y: rect.height / 2 };
        const nextK = Math.max(0.35, Math.min(3.5, graphTransform.k * factor));
        const scale = nextK / graphTransform.k;
        graphTransform = {
          k: nextK,
          x: point.x - (point.x - graphTransform.x) * scale,
          y: point.y - (point.y - graphTransform.y) * scale
        };
        applyGraphTransform();
      }

      function bindGraphNavigation() {
        const svg = document.querySelector("#graph");
        svg.addEventListener("wheel", (event) => {
          if (!event.metaKey && !event.ctrlKey && !event.altKey) return;
          event.preventDefault();
          const rect = svg.getBoundingClientRect();
          zoomGraph(event.deltaY < 0 ? 1.12 : 0.89, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        }, { passive: false });
        svg.addEventListener("pointerdown", (event) => {
          if (event.target.closest && event.target.closest(".node")) return;
          graphDrag = { x: event.clientX, y: event.clientY, tx: graphTransform.x, ty: graphTransform.y };
          svg.setPointerCapture(event.pointerId);
        });
        svg.addEventListener("pointermove", (event) => {
          if (!graphDrag) return;
          graphTransform.x = graphDrag.tx + event.clientX - graphDrag.x;
          graphTransform.y = graphDrag.ty + event.clientY - graphDrag.y;
          applyGraphTransform();
        });
        svg.addEventListener("pointerup", () => {
          graphDrag = undefined;
        });
        svg.addEventListener("pointercancel", () => {
          graphDrag = undefined;
        });
      }

      function matchesGraphPerspective(node, graph) {
        const type = graphViewType(node);
        if (graphPerspective === "map") return true;
        if (graphPerspective === "focus" || graphPerspective === "product") {
          return isInFocusedEntityArea(node, graph, 2);
        }
        if (graphPerspective === "bmad") {
          return ["question", "risk", "task", "decision", "source"].includes(type) && isInFocusedEntityArea(node, graph, 3);
        }
        if (graphPerspective === "deps") {
          return isInFocusedEntityArea(node, graph, 3) && ["domain", "subdomain", "team", "product", "repository", "source", "decision", "question", "risk", "task"].includes(type);
        }
        return true;
      }

      function renderFocusSelector() {
        if (graphPerspective !== "map") ensureFocusedNode(state.graph);
      }

      function setGraphFocusNode(node) {
        if (!node) return;
        const filterInput = document.querySelector("#filter");
        if (filterInput) filterInput.value = "";
        selectedNodeId = node.id;
        focusedNodeId = node.id;
        setGraphPerspective("focus");
        graphDepth = 2;
        closeGraphContextMenu();
        renderGraphFilterPanel();
        renderGraph();
        window.setTimeout(() => graphViewer?.focusSelected?.(), 80);
      }

      function clearGraphFocus() {
        focusedNodeId = undefined;
        closeGraphContextMenu();
        setGraphPerspective("map");
        graphDepth = 0;
        renderFocusSelector();
        renderGraphFilterPanel();
        renderGraph();
      }

      function showGraphContextMenu(node, event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!node) return;
        selectedNodeId = node.id;
        const menu = document.querySelector("#graphContextMenu");
        if (node.ghost) {
          const reason = lastGraphVisibility.hidden.get(node.id);
          menu.innerHTML =
            '<div class="graph-menu-title">' + escapeHtml(compactLabel(node.label || node.name || node.id, 26)) + '</div>' +
            '<div class="graph-menu-reason">Hidden: ' + escapeHtml(reason ? reason.label : "filtered out") + '</div>' +
            '<button type="button" class="graph-menu-item" data-graph-menu="reveal">Add to view</button>' +
            '<button type="button" class="graph-menu-item" data-graph-menu="reveal-focus">Focus here</button>' +
            '<button type="button" class="graph-menu-item" data-graph-menu="show-type">Show all ' + escapeHtml(typeLabel(graphViewType(node))) + '</button>';
          menu.querySelector('[data-graph-menu="reveal"]')?.addEventListener("click", () => {
            closeGraphContextMenu();
            revealGraphNode(node.id);
          });
          menu.querySelector('[data-graph-menu="reveal-focus"]')?.addEventListener("click", () => {
            closeGraphContextMenu();
            revealGraphNode(node.id);
            setGraphFocusNode(node);
          });
          menu.querySelector('[data-graph-menu="show-type"]')?.addEventListener("click", () => {
            closeGraphContextMenu();
            applyGraphFilterAction("all-values", graphViewType(node));
          });
          menu.hidden = false;
          const ghostX = Math.max(8, Math.min((event?.clientX || 120), window.innerWidth - 214));
          const ghostY = Math.max(8, Math.min((event?.clientY || 120), window.innerHeight - 156));
          menu.style.left = ghostX + "px";
          menu.style.top = ghostY + "px";
          return;
        }
        const isFocused = focusedNodeId === node.id && graphPerspective === "focus";
        const contextRef = entityRefForNode(node);
        const inContext = contextRef ? isNodeInContextScope(node) : false;
        const virtualTypeGroup = isVirtualTypeGroup(node);
        const viewType = graphViewType(node);
        const localTypeGrouped = graphCollapsedTypeGroups.has(typeGroupKey(viewType)) || (graphGroupMode !== "none" && GRAPH_GROUPABLE_TYPES.has(viewType) && !graphExpandedTypeGroups.has(typeGroupKey(viewType)));
        menu.innerHTML =
          '<div class="graph-menu-title">' + escapeHtml(compactLabel(node.label || node.name || node.id, 26)) + '</div>' +
          (virtualTypeGroup ? "" : '<button type="button" class="graph-menu-item" data-graph-menu="focus"' + (isFocused ? " disabled" : "") + '>' + (isFocused ? "Current focus" : "Set as focus") + '</button>') +
          (!virtualTypeGroup && focusedNodeId ? '<button type="button" class="graph-menu-item" data-graph-menu="clear">Clear focus</button>' : "") +
          (contextRef ? '<button type="button" class="graph-menu-item" data-graph-menu="context">' + (inContext ? "Remove from context" : "Include in context") + '</button>' : "") +
          (contextRef ? '<button type="button" class="graph-menu-item" data-graph-menu="context-pin">Pin in context</button>' : "") +
          (contextRef ? '<button type="button" class="graph-menu-item" data-graph-menu="context-exclude">Exclude from context</button>' : "") +
          (virtualTypeGroup ? '<button type="button" class="graph-menu-item" data-graph-menu="expand-type-group">Expand ' + escapeHtml(typeLabel(node.meta?.groupType)) + '</button>' : "") +
          (virtualTypeGroup && Array.isArray(node.meta?.memberRefs) && node.meta.memberRefs.length ? '<button type="button" class="graph-menu-item" data-graph-menu="context-group">Add group to context</button>' : "") +
          (!virtualTypeGroup && GRAPH_GROUPABLE_TYPES.has(viewType)
            ? '<button type="button" class="graph-menu-item" data-graph-menu="' + (localTypeGrouped ? "expand-similar" : "group-similar") + '">' + (localTypeGrouped ? "Keep " + escapeHtml(typeLabel(viewType)) + " expanded" : "Group visible " + escapeHtml(typeLabel(viewType))) + '</button>'
            : "") +
          (isCollapsedGroupNode(node.id)
            ? '<button type="button" class="graph-menu-item" data-graph-menu="expand-group">Expand group (' + (node.foldedCount || graphGroupChildCount(node.id)) + ')</button>'
            : graphGroupChildCount(node.id) > 0
              ? '<button type="button" class="graph-menu-item" data-graph-menu="collapse-group">Collapse group (' + graphGroupChildCount(node.id) + ')</button>'
              : "") +
          (graphPinnedNodeIds.has(node.id) ? '<button type="button" class="graph-menu-item" data-graph-menu="unpin">Unpin from view</button>' : "") +
          (!virtualTypeGroup ? '<button type="button" class="graph-menu-item" data-graph-menu="hide">Hide node</button>' : "") +
          (!virtualTypeGroup ? '<button type="button" class="graph-menu-item" data-graph-menu="show-type">Show all ' + escapeHtml(typeLabel(viewType)) + '</button>' : "") +
          (contextRef ? '<button type="button" class="graph-menu-item danger" data-graph-menu="delete-entity">Delete entity</button>' : "") +
          (!virtualTypeGroup && node.path ? '<button type="button" class="graph-menu-item" data-graph-menu="open">Open source</button>' : "");
        menu.querySelector('[data-graph-menu="focus"]')?.addEventListener("click", () => setGraphFocusNode(node));
        menu.querySelector('[data-graph-menu="clear"]')?.addEventListener("click", clearGraphFocus);
        menu.querySelector('[data-graph-menu="context"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          if (contextRef) contextScopeToggleRef(contextRef);
          renderGraph();
        });
        menu.querySelector('[data-graph-menu="context-pin"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          if (contextRef) contextScopeSetRole(contextRef, "pinned");
        });
        menu.querySelector('[data-graph-menu="context-exclude"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          if (contextRef) contextScopeSetRole(contextRef, "excluded");
        });
        menu.querySelector('[data-graph-menu="context-group"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          addRefsToContextScope(node.meta?.memberRefs || []);
          renderGraph();
        });
        menu.querySelector('[data-graph-menu="group-similar"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          setTypeGroupExpanded(viewType, false);
        });
        menu.querySelector('[data-graph-menu="expand-similar"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          setTypeGroupExpanded(viewType, true);
        });
        menu.querySelector('[data-graph-menu="expand-type-group"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          setTypeGroupExpanded(node.meta?.groupType, true);
        });
        menu.querySelector('[data-graph-menu="collapse-group"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          collapseGraphGroup(node.id);
        });
        menu.querySelector('[data-graph-menu="expand-group"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          expandGraphGroup(node.id);
        });
        menu.querySelector('[data-graph-menu="unpin"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          unpinGraphNode(node.id);
        });
        menu.querySelector('[data-graph-menu="hide"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          graphPinnedNodeIds.delete(node.id);
          toggleGraphValue(viewType, node.id, false);
        });
        menu.querySelector('[data-graph-menu="show-type"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          applyGraphFilterAction("all-values", viewType);
        });
        menu.querySelector('[data-graph-menu="delete-entity"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          if (contextRef) {
            vscode?.postMessage({ type: "deleteGraphEntity", ref: contextRef, label: node.label || node.name || node.id });
          }
        });
        menu.querySelector('[data-graph-menu="open"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          vscode?.postMessage({ type: "openFile", path: node.path });
        });
        menu.hidden = false;
        const x = Math.max(8, Math.min((event?.clientX || 120), window.innerWidth - 214));
        const y = Math.max(8, Math.min((event?.clientY || 120), window.innerHeight - 156));
        menu.style.left = x + "px";
        menu.style.top = y + "px";
        selectNode(node);
      }

      function showGraphRelationContextMenu(edge, event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!edge) return;
        const menu = document.querySelector("#graphContextMenu");
        const relationType = graphRelationType(edge);
        const deletePayload = graphRelationDeletePayload(edge);
        const title = graphRelationMenuTitle(edge);
        menu.innerHTML =
          '<div class="graph-menu-title">' + escapeHtml(compactLabel(title, 34)) + '</div>' +
          '<button type="button" class="graph-menu-item" data-graph-menu="hide-relation-type">Hide relation type</button>' +
          '<button type="button" class="graph-menu-item" data-graph-menu="show-relation-type">Show only this relation type</button>' +
          '<button type="button" class="graph-menu-item" data-graph-menu="show-all-relation-types">Show all relation types</button>' +
          (deletePayload
            ? '<button type="button" class="graph-menu-item danger" data-graph-menu="delete-relation">Delete relation</button>'
            : '<button type="button" class="graph-menu-item" disabled>Derived relation</button>');
        menu.querySelector('[data-graph-menu="hide-relation-type"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          toggleGraphRelationType(relationType, false);
        });
        menu.querySelector('[data-graph-menu="show-relation-type"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          graphRelationQuickMode = "custom";
          graphRelationValueMode = "selected";
          graphSelectedRelationTypes = new Set([relationType]);
          graphSelectedRelationCategories = new Set([relationCategoryForType(relationType)]);
          graphExpandedFilterTypes.add(RELATION_FILTER_TYPE);
          renderGraphFilterSurfaces();
        });
        menu.querySelector('[data-graph-menu="show-all-relation-types"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          graphRelationQuickMode = "all";
          graphRelationValueMode = "all";
          graphSelectedRelationTypes = new Set();
          graphSelectedRelationCategories = new Set(RELATION_CATEGORY_ORDER);
          renderGraphFilterSurfaces();
        });
        menu.querySelector('[data-graph-menu="delete-relation"]')?.addEventListener("click", () => {
          closeGraphContextMenu();
          vscode?.postMessage({ type: "deleteGraphRelation", label: title, ...deletePayload });
        });
        menu.hidden = false;
        const x = Math.max(8, Math.min((event?.clientX || 120), window.innerWidth - 234));
        const y = Math.max(8, Math.min((event?.clientY || 120), window.innerHeight - 156));
        menu.style.left = x + "px";
        menu.style.top = y + "px";
      }

      function closeGraphContextMenu() {
        const menu = document.querySelector("#graphContextMenu");
        if (!menu) return;
        menu.hidden = true;
        menu.innerHTML = "";
      }

      function ensureFocusedNode(graph) {
        const nodes = focusSelectableNodes(graph);
        if (!nodes.length) {
          focusedNodeId = undefined;
          return undefined;
        }
        if (focusedNodeId && nodes.some((node) => node.id === focusedNodeId)) return focusedNodeId;
        const included = graph.includedProductIds || [];
        const preferred = nodes.find((node) => isPrimaryFocus(node))
          || nodes.find((node) => isSupportingFocus(node))
          || nodes.find((node) => included.some((id) => node.id === id || node.id === "product:" + id || node.label === id))
          || nodes.find((node) => node.type === "product");
        focusedNodeId = (preferred || nodes[0]).id;
        return focusedNodeId;
      }

      function focusSelectableNodes(graph) {
        const byId = new Map();
        for (const node of graph?.nodes || []) {
          byId.set(node.id, { id: node.id, label: focusOptionLabel(node), type: node.type, meta: node.meta || {} });
        }
        for (const entity of state.entities || []) {
          if (ENTITY_NODE_KINDS.includes(entity.kind)) {
            const id = entity.kind === "product" ? "product:" + entity.id : entity.kind === "repository" ? "repository:" + entity.id : entity.kind === "domain" || entity.kind === "subdomain" || entity.kind === "team" ? "entity:" + entity.id : "entity:" + entity.kind + ":" + entity.id;
            if (!byId.has(id)) {
              byId.set(id, { id, label: focusOptionLabel({ label: entity.label || entity.id, type: entity.kind, meta: { focusLevel: entity.focusLevel } }), type: entity.kind, meta: { focusLevel: entity.focusLevel } });
            }
          }
        }
        return [...byId.values()].sort((left, right) => focusSortScore(left) - focusSortScore(right) || left.label.localeCompare(right.label));
      }

      function focusOptionLabel(node) {
        const level = node.meta?.focusLevel;
        const prefix = level === "primary" ? "★ " : level === "supporting" ? "• " : "";
        return prefix + (node.label || node.id);
      }

      function focusSortScore(node) {
        if (isPrimaryFocus(node)) return 0;
        if (isSupportingFocus(node)) return 1;
        if (node.type === "product") return 2;
        return 3;
      }

      function focusLevelForNode(node) {
        return node?.meta?.focusLevel || "informational";
      }

      function focusRank(level) {
        const index = FOCUS_LEVEL_ORDER.indexOf(String(level || "informational"));
        return index >= 0 ? index : FOCUS_LEVEL_ORDER.length - 1;
      }

      function matchesGraphFocusFilter(node) {
        return focusRank(focusLevelForNode(node)) <= focusRank(graphFocusThreshold);
      }

      function applyGraphFocusFilter(nodes) {
        if (graphFocusThreshold === "informational") return nodes;
        const filtered = nodes.filter((node) => isNodeInContextScope(node) || matchesGraphFocusFilter(node));
        return filtered.length > 0 ? filtered : nodes;
      }

      function setGraphFocusThreshold(level) {
        graphFocusThreshold = FOCUS_LEVEL_ORDER.includes(level) ? level : "informational";
        renderGraphFocusFilter();
        renderGraph();
        scheduleGraphFiltersSave();
      }

      function renderGraphFocusFilter() {
        document.querySelectorAll("[data-graph-focus]").forEach((button) => {
          button.classList.toggle("active", button.dataset.graphFocus === graphFocusThreshold);
        });
      }

      function renderGraphGroupControls() {
        const input = document.querySelector("#graphGroupMode");
        if (input) {
          input.value = graphGroupMode;
        }
        const layoutInput = document.querySelector("#graphLayoutMode");
        if (layoutInput) {
          layoutInput.value = graphLayoutMode;
        }
      }

      function setGraphRelationQuickMode(mode) {
        graphRelationQuickMode = ["important", "all", "custom"].includes(mode) ? mode : "all";
        if (graphRelationQuickMode === "custom") {
          ensureGraphRelationCategories();
          graphFilterPanelOpen = true;
          selectedGraphFilterType = RELATION_FILTER_TYPE;
          graphExpandedFilterTypes.add(RELATION_FILTER_TYPE);
        }
        renderGraphRelationQuickControls();
        renderGraphFilterPanel();
        renderGraph();
        scheduleGraphFiltersSave();
      }

      function renderGraphRelationQuickControls() {
        document.querySelectorAll("[data-relation-quick]").forEach((button) => {
          button.classList.toggle("active", button.dataset.relationQuick === graphRelationQuickMode);
        });
      }

      function setTypeGroupExpanded(type, expanded) {
        type = graphViewTypeForType(type);
        const key = typeGroupKey(type);
        if (expanded) {
          graphExpandedTypeGroups.add(key);
          graphCollapsedTypeGroups.delete(key);
        } else {
          graphCollapsedTypeGroups.add(key);
          graphExpandedTypeGroups.delete(key);
        }
        renderGraph();
        scheduleGraphFiltersSave();
      }

      function isPrimaryFocus(node) {
        return focusLevelForNode(node) === "primary";
      }

      function isSupportingFocus(node) {
        return focusLevelForNode(node) === "supporting";
      }

      function isInFocusedEntityArea(node, graph, maxDepth) {
        const focus = focusedNodeId || ensureFocusedNode(graph);
        if (!focus) return true;
        if (node.id === focus) return true;
        const visited = new Set([focus]);
        let frontier = [focus];
        for (let depth = 0; depth < maxDepth; depth += 1) {
          const next = [];
          for (const id of frontier) {
            for (const edge of graph.edges || []) {
              if (!matchesGraphRelationFilter(edge)) continue;
              const other = edge.source === id ? edge.target : edge.target === id ? edge.source : undefined;
              if (!other || visited.has(other)) continue;
              visited.add(other);
              next.push(other);
            }
          }
          frontier = next;
        }
        return visited.has(node.id);
      }

      function layoutNodes(nodes, edges, width, height, mode) {
        const positions = new Map();
        if (mode === "circle") {
          const radius = Math.min(width, height) * 0.34;
          nodes.forEach((node, index) => {
            const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1);
            positions.set(node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius });
          });
          return positions;
        }
        if (mode === "grid") {
          const cols = Math.ceil(Math.sqrt(nodes.length));
          nodes.forEach((node, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            positions.set(node.id, { x: 90 + col * ((width - 180) / Math.max(cols - 1, 1)), y: 90 + row * 108 });
          });
          return positions;
        }

        // Force-directed layout (Obsidian-like): repulsion between all nodes + spring attraction
        // along edges + gentle centering. Positions persist across renders so the graph stays stable.
        const n = nodes.length;
        if (n === 0) return positions;
        const cx = width / 2;
        const cy = height / 2;
        const nodeState = nodes.map((node) => {
          const cached = graphPositions.get(node.id);
          if (cached) {
            return { id: node.id, x: cached.x, y: cached.y };
          }
          const seed = hashString(node.id);
          const angle = (seed % 360) * Math.PI / 180;
          const radius = 60 + (seed % Math.max(1, Math.round(Math.min(width, height) * 0.32)));
          return { id: node.id, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
        });
        const indexOfId = new Map(nodeState.map((node, i) => [node.id, i]));
        const links = (edges || [])
          .map((edge) => [indexOfId.get(edge.source), indexOfId.get(edge.target)])
          .filter(([a, b]) => a !== undefined && b !== undefined && a !== b);

        const area = width * height;
        const repulsion = Math.min(11000, Math.max(2500, (area / n) * 0.85));
        const springLength = Math.max(70, Math.min(150, Math.sqrt(area / n) * 0.85));
        const iterations = Math.min(320, Math.max(120, Math.round(12000 / n)));
        let alpha = 1;

        for (let step = 0; step < iterations && alpha > 0.02; step += 1) {
          const fx = new Float64Array(n);
          const fy = new Float64Array(n);
          for (let i = 0; i < n; i += 1) {
            for (let j = i + 1; j < n; j += 1) {
              let dx = nodeState[i].x - nodeState[j].x;
              let dy = nodeState[i].y - nodeState[j].y;
              let d2 = dx * dx + dy * dy;
              if (d2 < 0.01) { dx = (i - j) || 0.5; dy = 0.5; d2 = dx * dx + dy * dy; }
              const d = Math.sqrt(d2);
              const force = repulsion / d2;
              const ux = (dx / d) * force;
              const uy = (dy / d) * force;
              fx[i] += ux; fy[i] += uy;
              fx[j] -= ux; fy[j] -= uy;
            }
          }
          for (const [a, b] of links) {
            let dx = nodeState[b].x - nodeState[a].x;
            let dy = nodeState[b].y - nodeState[a].y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const force = (d - springLength) * 0.06;
            const ux = (dx / d) * force;
            const uy = (dy / d) * force;
            fx[a] += ux; fy[a] += uy;
            fx[b] -= ux; fy[b] -= uy;
          }
          for (let i = 0; i < n; i += 1) {
            fx[i] += (cx - nodeState[i].x) * 0.015;
            fy[i] += (cy - nodeState[i].y) * 0.015;
            const dispX = Math.max(-32, Math.min(32, fx[i] * alpha * 0.5));
            const dispY = Math.max(-32, Math.min(32, fy[i] * alpha * 0.5));
            nodeState[i].x = Math.max(36, Math.min(width - 36, nodeState[i].x + dispX));
            nodeState[i].y = Math.max(36, Math.min(height - 36, nodeState[i].y + dispY));
          }
          alpha *= 0.985;
        }

        for (const node of nodeState) {
          positions.set(node.id, { x: node.x, y: node.y });
          graphPositions.set(node.id, { x: node.x, y: node.y });
        }
        return positions;
      }

      function hashString(value) {
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
          hash = (hash * 31 + value.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
      }

      function drawNodeShape(group, node, degree) {
        const viewType = graphViewType(node);
        const fill = colors[viewType] || "#d7d0c2";
        // Obsidian-like: hubs (more connections) render larger.
        const scale = 1 + Math.min(0.9, (degree || 0) * 0.12);
        if (viewType === "domain" || viewType === "subdomain" || viewType === "team" || viewType === "product" || viewType === "repository" || viewType === "wiki_page") {
          const half = Math.round(18 * scale);
          group.appendChild(createSvg("rect", { x: -half, y: -half, width: half * 2, height: half * 2, rx: viewType === "product" ? Math.round(10 * scale) : 6, fill }));
        } else if (viewType === "question") {
          const r = Math.round(21 * scale);
          group.appendChild(createSvg("polygon", { points: "0," + (-r) + " " + r + ",0 0," + r + " " + (-r) + ",0", fill }));
        } else if (viewType === "risk") {
          const r = Math.round(22 * scale);
          const h = Math.round(r / 2);
          group.appendChild(createSvg("polygon", { points: (-r + 2) + "," + (-h) + " 0," + (-r) + " " + (r - 2) + "," + (-h) + " " + (r - 2) + "," + h + " 0," + r + " " + (-r + 2) + "," + h, fill }));
        } else {
          group.appendChild(createSvg("circle", { r: Math.round((viewType === "task" ? 18 : 20) * scale), fill }));
        }
      }

      function selectNode(node, options) {
        const opts = options || {};
        if (!opts.restore && graphSelectionMode === "context") {
          if (isVirtualTypeGroup(node)) {
            addRefsToContextScope(node.meta?.memberRefs || []);
          } else {
            const contextRef = entityRefForNode(node);
            if (contextRef) {
              contextScopeToggleRef(contextRef);
            }
          }
        }
        selectedRelationId = undefined;
        selectedNodeId = node.id;
        document.querySelector("#detailType").textContent = graphViewType(node);
        document.querySelector("#detailDot").style.background = colors[graphViewType(node)] || "#d7d0c2";
        const ref = isVirtualTypeGroup(node) ? undefined : entityRefForNode(node);
        if (ref) {
          if (entityPanelUi.ref !== ref) {
            entityPanelUi = { ref, tab: undefined, editing: false, composerOpen: false, descExpanded: false, expandedDocs: {} };
          }
          setDetailLegacyVisible(false);
          if (entityContextCache[ref]) {
            renderEntityContext(ref);
          } else {
            document.querySelector("#detailExtra").innerHTML = entityPanelLoadingHtml(node);
            vscode?.postMessage({ type: "loadEntityContext", ref });
          }
        } else {
          setDetailLegacyVisible(true);
          document.querySelector("#detailTitle").textContent = node.label;
          document.querySelector("#detailStatus").textContent = node.status || "";
          document.querySelector("#detailSummary").textContent = node.meta?.description || node.meta?.body || node.path || node.id;
          document.querySelector("#detailProvider").textContent = node.provider || "-";
          document.querySelector("#detailConfidence").textContent = node.confidence == null ? "-" : Number(node.confidence).toFixed(2);
          document.querySelector("#detailExtra").innerHTML = renderNodeExtra(node);
          document.querySelectorAll("[data-detail-open]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "openFile", path: button.dataset.detailOpen })));
          bindGraphGroupDetailActions();
        }
        renderFocusSelector();
        renderGraph();
      }

      function selectRelation(edge) {
        if (!edge) return;
        selectedNodeId = undefined;
        selectedRelationId = String(edge.id || graphRelationMenuTitle(edge));
        setDetailLegacyVisible(true);
        const relationType = graphRelationType(edge);
        document.querySelector("#detailTitle").textContent = relationType;
        document.querySelector("#detailType").textContent = "relation";
        document.querySelector("#detailStatus").textContent = edge.status || "";
        document.querySelector("#detailSummary").textContent = graphRelationMenuTitle(edge);
        document.querySelector("#detailProvider").textContent = edge.provider || "-";
        document.querySelector("#detailConfidence").textContent = edge.confidence == null ? "-" : Number(edge.confidence).toFixed(2);
        document.querySelector("#detailDot").style.background = "var(--edge-default)";
        document.querySelector("#detailExtra").innerHTML = renderRelationExtra(edge);
        bindRelationDetailActions(edge);
        renderFocusSelector();
        renderGraph();
      }

      // ENTITY_NODE_KINDS is declared with the type orders above and extended with
      // workspace-defined custom kinds by syncTaxonomyTypes().

      // Mirrors the controlled vocabulary in packages/shared/src/taxonomy.ts (RELATION_TYPES).
      const RELATION_TYPE_GROUPS = [
        ["Structure", ["related_to", "part_of", "contains", "depends_on", "scoped_to", "owns", "owned_by", "has_okr"]],
        ["Work", ["drives", "supports", "blocks", "impacts", "contributes_to", "informs", "implements", "validates", "supersedes"]],
        ["People", ["owner", "reviewer", "manager", "stakeholder_of", "contributor_to", "expert_on", "decision_maker_for", "contact_for", "requested_by", "reported_by", "subject"]],
        ["Practice & mission", ["applies_practice", "development_area", "measured_by", "informs_mission", "tracks_progress_for", "discussed_in"]]
      ];

      function relationTypeOptionsHtml(selectedType) {
        return RELATION_TYPE_GROUPS.map((group) =>
          '<optgroup label="' + escapeAttr(group[0]) + '">' +
          group[1].map((type) => '<option value="' + escapeAttr(type) + '"' + (type === (selectedType || "related_to") ? " selected" : "") + '>' + escapeHtml(type.replace(/_/g, " ")) + '</option>').join("") +
          '</optgroup>'
        ).join("");
      }

      function entityKindOptionsHtml(selectedKind) {
        const aliases = taxonomyModel().entityKindAliases;
        return ENTITY_NODE_KINDS
          .filter((kind) => !aliases[kind] || kind === selectedKind)
          .map((kind) => {
            const custom = customEntityKinds().find((entry) => entry.id === kind);
            const label = custom ? (custom.label || kind) : kind.replace(/_/g, " ");
            return '<option value="' + escapeAttr(kind) + '"' + (kind === selectedKind ? " selected" : "") + '>' + escapeHtml(label) + '</option>';
          }).join("");
      }

      function entityStatusOptionsHtml(selectedStatus) {
        return ["active", "inactive", "candidate", "archived"].map((status) =>
          '<option value="' + escapeAttr(status) + '"' + (status === selectedStatus ? " selected" : "") + '>' + escapeHtml(status) + '</option>'
        ).join("");
      }

      function entityFocusOptionsHtml(selectedFocus) {
        return ["primary", "supporting", "informational"].map((focus) =>
          '<option value="' + escapeAttr(focus) + '"' + (focus === selectedFocus ? " selected" : "") + '>' + escapeHtml(focus) + '</option>'
        ).join("");
      }

      function entityKindLocked(kind) {
        return kind === "oneagent" || kind === "repository" || kind === "discovery";
      }

      function entityLinkTargetOptionsHtml(excludeRef) {
        const byKind = {};
        for (const entity of (state.entities || [])) {
          const ref = entity.kind + ":" + entity.id;
          if (ref === excludeRef) continue;
          (byKind[entity.kind] = byKind[entity.kind] || []).push(entity);
        }
        return Object.keys(byKind).sort().map((kind) =>
          '<optgroup label="' + escapeAttr(kind) + '">' +
          byKind[kind]
            .sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)))
            .map((entity) => '<option value="' + escapeAttr(entity.kind + ":" + entity.id) + '">' + escapeHtml(entity.label || entity.id) + '</option>').join("") +
          '</optgroup>'
        ).join("");
      }

      function relationEntityOptionsHtml(selectedRef) {
        const options = new Map();
        for (const entity of (state.entities || [])) {
          const ref = entity.kind + ":" + entity.id;
          options.set(ref, entity.label || entity.id);
        }
        for (const node of (state.graph?.nodes || [])) {
          const ref = entityRefForNode(node);
          if (ref && !options.has(ref)) options.set(ref, node.label || ref);
        }
        if (selectedRef && !options.has(selectedRef)) options.set(selectedRef, selectedRef);
        return [...options.entries()]
          .sort((left, right) => String(left[1]).localeCompare(String(right[1])))
          .map(([ref, label]) => '<option value="' + escapeAttr(ref) + '"' + (ref === selectedRef ? " selected" : "") + '>' + escapeHtml(label + " · " + ref) + '</option>')
          .join("");
      }

      function entityDisplayLabel(ref) {
        const [kind, ...idParts] = String(ref || "").split(":");
        const id = idParts.join(":");
        const entity = (state.entities || []).find((candidate) => candidate.kind === kind && candidate.id === id);
        return entity ? (entity.label || entity.id) + " (" + kind + ":" + id + ")" : ref;
      }

      function entityRefForNode(node) {
        if (node.meta && node.meta.kind && node.meta.entityId) {
          return node.meta.kind + ":" + node.meta.entityId;
        }
        if (!ENTITY_NODE_KINDS.includes(node.type)) {
          return undefined;
        }
        if (node.id.indexOf("entity:") === 0) {
          const rest = node.id.slice(7);
          const parts = rest.split(":");
          if (parts.length >= 2 && ENTITY_NODE_KINDS.includes(parts[0])) {
            return parts[0] + ":" + parts.slice(1).join(":");
          }
          return node.type + ":" + rest;
        }
        if (node.id.indexOf("product:") === 0) return "product:" + node.id.slice(8);
        if (node.id.indexOf("repository:") === 0) return "repository:" + node.id.slice(11);
        return undefined;
      }

      function graphEndpointId(endpoint) {
        return typeof endpoint === "object" && endpoint ? endpoint.id : String(endpoint || "");
      }

      function graphNodeForEndpoint(endpoint) {
        if (typeof endpoint === "object" && endpoint) return endpoint;
        const id = graphEndpointId(endpoint);
        if (graphTypeGroupState.groups.has(id)) return graphTypeGroupState.groups.get(id);
        return (state.graph?.nodes || []).find((node) => node.id === id);
      }

      function graphRelationType(edge) {
        return String(edge?.predicate || edge?.label || "related");
      }

      function relationCategoryForType(type) {
        return RELATION_CATEGORY_BY_TYPE[String(type || "")] || (String(type || "").startsWith("custom:") ? "other" : "other");
      }

      function relationCategoryLabel(type) {
        const category = relationCategoryForType(type);
        return RELATION_CATEGORY_LABELS[category] || "Other";
      }

      function relationCategoryName(category) {
        return RELATION_CATEGORY_LABELS[category] || "Other";
      }

      function relationCategorySelectionForMode(mode) {
        if (mode === "custom") return graphSelectedRelationCategories.size ? new Set(graphSelectedRelationCategories) : new Set(RELATION_CATEGORY_ORDER);
        if (mode === "important") return new Set(IMPORTANT_RELATION_CATEGORIES);
        return new Set(RELATION_CATEGORY_ORDER);
      }

      function ensureGraphRelationCategories() {
        if (graphSelectedRelationCategories.size > 0) return;
        graphSelectedRelationCategories = relationCategorySelectionForMode(graphRelationQuickMode);
      }

      function graphRelationQuickDescription() {
        if (graphRelationQuickMode === "all") return "All relation categories are visible.";
        if (graphRelationQuickMode === "important") {
          return "Important relations: " + RELATION_CATEGORY_ORDER
            .filter((category) => IMPORTANT_RELATION_CATEGORIES.has(category))
            .map((category) => relationCategoryName(category))
            .join(", ");
        }
        const selected = RELATION_CATEGORY_ORDER
          .filter((category) => graphSelectedRelationCategories.has(category))
          .map((category) => relationCategoryName(category));
        return selected.length ? "Custom relation categories: " + selected.join(", ") : "No relation categories selected.";
      }

      function edgeRelationTypes(edge) {
        const grouped = edge?.meta?.relationTypes;
        if (grouped && typeof grouped === "object") {
          return Object.keys(grouped);
        }
        return [graphRelationType(edge)];
      }

      function edgeHasImportantRelation(edge) {
        return edgeRelationTypes(edge).some((type) => IMPORTANT_RELATION_CATEGORIES.has(relationCategoryForType(type)));
      }

      function graphRelationMenuTitle(edge) {
        const sourceId = graphEndpointId(edge?.source);
        const targetId = graphEndpointId(edge?.target);
        const nodes = state.graph?.nodes || [];
        const source = nodes.find((node) => node.id === sourceId) || (typeof edge?.source === "object" ? edge.source : undefined);
        const target = nodes.find((node) => node.id === targetId) || (typeof edge?.target === "object" ? edge.target : undefined);
        const sourceLabel = source?.label || source?.name || sourceId;
        const targetLabel = target?.label || target?.name || targetId;
        return sourceLabel + " --" + graphRelationType(edge) + "--> " + targetLabel;
      }

      function graphRelationDeletePayload(edge) {
        const relationId = typeof edge?.meta?.relationId === "string" ? edge.meta.relationId : (typeof edge?.id === "string" && edge.id.indexOf("erel_") === 0 ? edge.id : "");
        if (relationId) return { relationId };
        const linkId = typeof edge?.meta?.linkId === "string" ? edge.meta.linkId : "";
        if (linkId) return { linkId };
        return undefined;
      }

      function relationOriginLabel(edge) {
        const meta = edge?.meta || {};
        if (meta.relationId) return "Explicit entity relation";
        if (meta.linkId) return "Organization link";
        if (meta.origin === "capture_primary_entity") return "Capture primary classification";
        if (meta.origin === "capture_related_entity") return "Capture related entity";
        if (meta.origin === "concept_mention") return "Concept mention in source";
        if (meta.origin === "source_product") return "Source attached to product";
        if (edge?.provider === "graphify") return "Graphify repository analysis";
        if (edge?.provider === "compressed") return "Collapsed hidden path";
        return edge?.provider || "Graph model";
      }

      function relationSourceRecord(edge) {
        const sourceId = edge?.sourceId || edge?.meta?.sourceId;
        return sourceId ? (state.sources || []).find((source) => source.id === sourceId) : undefined;
      }

      function relationCaptureRecord(edge) {
        const captureId = edge?.meta?.captureId;
        return captureId ? (state.captures || []).find((capture) => capture.id === captureId) : undefined;
      }

      function relationCapturedFromRecords(edge) {
        const ids = Array.isArray(edge?.meta?.capturedFrom) ? edge.meta.capturedFrom.map(String) : [];
        return ids.map((id) => (state.captures || []).find((capture) => capture.id === id) || { id }).filter(Boolean);
      }

      function isNodeInContextScope(node) {
        if (!contextScopeDraft) return false;
        const ref = entityRefForNode(node);
        if (!ref) return false;
        const selection = contextScopeSelection(ref);
        return Boolean(selection && ["pinned", "included", "exploratory"].includes(selection.role));
      }

      function ecMetric(label, value) {
        return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value || 0)) + '</strong></div>';
      }

      function setDetailLegacyVisible(visible) {
        document.querySelector("#detailLegacy")?.classList.toggle("hidden", !visible);
      }

      function entityShortInfo(ref) {
        const [kind, ...idParts] = String(ref || "").split(":");
        const id = idParts.join(":");
        const entity = (state.entities || []).find((candidate) => candidate.kind === kind && candidate.id === id);
        if (entity) return { kind, label: entity.label || entity.id };
        const node = (state.graph?.nodes || []).find((candidate) => entityRefForNode(candidate) === ref);
        return { kind, label: node ? (node.label || id) : id };
      }

      function entityKindColor(kind) {
        return colors[kind] || colors.group || "#94a3b8";
      }

      // Minimal Markdown renderer for the selection panel's Content tab. Input is
      // escaped first, so the output only contains tags produced here. The code-fence
      // marker is built from char codes because this whole script lives inside a
      // template literal (a literal backtick would end it).
      const MD_FENCE = String.fromCharCode(96, 96, 96);
      function mdToHtml(markdown, options = {}) {
        const lines = String(markdown || "").replace(/\\r\\n/g, "\\n").split("\\n");
        const html = [];
        let list = null;
        let inCode = false;
        let codeLines = [];
        let paragraph = [];
        const closeList = () => { if (list) { html.push("</" + list + ">"); list = null; } };
        const flushParagraph = () => { if (paragraph.length) { html.push("<p>" + inlineMd(paragraph.join(" "), options) + "</p>"); paragraph = []; } };
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          if (inCode) {
            if (line.indexOf(MD_FENCE) === 0) {
              html.push("<pre><code>" + escapeHtml(codeLines.join("\\n")) + "</code></pre>");
              inCode = false;
              codeLines = [];
            } else {
              codeLines.push(line);
            }
            continue;
          }
          if (line.indexOf(MD_FENCE) === 0) { flushParagraph(); closeList(); inCode = true; continue; }
          const nextLine = lines[lineIndex + 1] || "";
          if (line.includes("|") && markdownTableSeparator(nextLine)) {
            flushParagraph();
            closeList();
            const headings = markdownTableCells(line);
            const rows = [];
            lineIndex += 2;
            while (lineIndex < lines.length && lines[lineIndex].includes("|") && lines[lineIndex].trim()) {
              rows.push(markdownTableCells(lines[lineIndex]));
              lineIndex += 1;
            }
            lineIndex -= 1;
            html.push('<div class="md-table-wrap"><table><thead><tr>' +
              headings.map((cell) => "<th>" + inlineMd(cell, options) + "</th>").join("") +
              "</tr></thead><tbody>" +
              rows.map((row) => "<tr>" + headings.map((_heading, index) => "<td>" + inlineMd(row[index] || "", options) + "</td>").join("") + "</tr>").join("") +
              "</tbody></table></div>");
            continue;
          }
          const heading = line.match(/^(#{1,4})\\s+(.*)$/);
          if (heading) {
            flushParagraph(); closeList();
            const level = heading[1].length;
            html.push("<h" + level + ">" + inlineMd(heading[2], options) + "</h" + level + ">");
            continue;
          }
          const bullet = line.match(/^\\s*[-*+]\\s+(.*)$/);
          if (bullet) {
            flushParagraph();
            if (list !== "ul") { closeList(); html.push("<ul>"); list = "ul"; }
            html.push("<li>" + inlineMd(bullet[1], options) + "</li>");
            continue;
          }
          const ordered = line.match(/^\\s*\\d+[.)]\\s+(.*)$/);
          if (ordered) {
            flushParagraph();
            if (list !== "ol") { closeList(); html.push("<ol>"); list = "ol"; }
            html.push("<li>" + inlineMd(ordered[1], options) + "</li>");
            continue;
          }
          const quote = line.match(/^>\\s?(.*)$/);
          if (quote) { flushParagraph(); closeList(); html.push("<blockquote>" + inlineMd(quote[1], options) + "</blockquote>"); continue; }
          if (!line.trim()) { flushParagraph(); closeList(); continue; }
          paragraph.push(line.trim());
        }
        if (inCode) html.push("<pre><code>" + escapeHtml(codeLines.join("\\n")) + "</code></pre>");
        flushParagraph();
        closeList();
        return html.join("");
      }

      function markdownTableSeparator(line) {
        return /^\\s*\\|?\\s*:?-{3,}:?\\s*(?:\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(String(line || ""));
      }

      function markdownTableCells(line) {
        return String(line || "")
          .trim()
          .replace(/^\\|/, "")
          .replace(/\\|$/, "")
          .split("|")
          .map((cell) => cell.trim());
      }

      const MD_TICK = String.fromCharCode(96);
      const MD_CODE_RE = new RegExp(MD_TICK + "([^" + MD_TICK + "]+)" + MD_TICK, "g");
      function inlineMd(text, options = {}) {
        let value = escapeHtml(text);
        value = value.replace(MD_CODE_RE, "<code>$1</code>");
        value = value.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
        value = value.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
        value = value.replace(/\\[\\[([^\\]]+)\\]\\]/g, "<strong>$1</strong>");
        if (options.documentationLinks === true) {
          value = value.replace(/\\[([^\\]]+)\\]\\(([a-zA-Z0-9._\\/-]+\\.md)(?:#[^)]*)?\\)/g, function (_match, label, target) {
            const guideId = documentationGuideIdForSourceFile(target);
            return guideId
              ? '<button type="button" class="md-internal" data-help-guide="' + escapeAttr(guideId) + '">' + label + '</button>'
              : label;
          });
        }
        if (options.externalLinks === true) {
          value = value.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, function (_match, label, url) {
            return '<button type="button" class="md-external" data-open-external="' + url + '">' + label + ' ↗</button>';
          });
        }
        value = value.replace(/\\[([^\\]]*)\\]\\(([^)]*)\\)/g, "$1");
        return value;
      }

      function documentationGuides() {
        return Array.isArray(state.documentation?.guides) ? state.documentation.guides : [];
      }

      function documentationGuide(id) {
        return documentationGuides().find((guide) => guide.id === id);
      }

      function documentationGuideIdForSourceFile(sourceFile) {
        const normalized = String(sourceFile || "").replace(/^\\.\\//, "");
        return documentationGuides().find((guide) => guide.sourceFile === normalized)?.id;
      }

      function normalizeDocumentationText(value) {
        return String(value || "")
          .normalize("NFD")
          .replace(/[\\u0300-\\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      }

      function documentationPlainText(markdown) {
        return String(markdown || "")
          .split(MD_FENCE).join(" ")
          .replace(/^#{1,6}\\s+/gm, "")
          .replace(/^\\s*[-*+>]\\s*/gm, "")
          .replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, "$1")
          .replace(/[\\[\\]_*#()]/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
      }

      function documentationHeadings(markdown) {
        return String(markdown || "")
          .split("\\n")
          .map((line) => line.match(/^#{1,4}\\s+(.+)$/)?.[1] || "")
          .filter(Boolean)
          .join(" ");
      }

      function documentationExcerpt(guide, normalizedQuery) {
        const text = documentationPlainText(guide.markdown);
        if (!text) return guide.summary || "";
        const normalized = normalizeDocumentationText(text);
        const firstTerm = normalizedQuery.split(/\\s+/).find(Boolean);
        const matchAt = firstTerm ? normalized.indexOf(firstTerm) : -1;
        if (matchAt < 0) return guide.summary || text.slice(0, 150);
        const start = Math.max(0, matchAt - 55);
        const end = Math.min(text.length, matchAt + 125);
        return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
      }

      function searchDocumentation(query) {
        const normalizedQuery = normalizeDocumentationText(query);
        if (!normalizedQuery) {
          return documentationGuides().map((guide) => ({ guide, score: 0, excerpt: guide.summary || "" }));
        }
        const terms = normalizedQuery.split(/\\s+/).filter(Boolean);
        return documentationGuides().map((guide) => {
          const title = normalizeDocumentationText(guide.title);
          const summary = normalizeDocumentationText(guide.summary);
          const headings = normalizeDocumentationText(documentationHeadings(guide.markdown));
          const keywords = normalizeDocumentationText((guide.keywords || []).join(" "));
          const body = normalizeDocumentationText(documentationPlainText(guide.markdown));
          const combined = [title, summary, headings, keywords, body].join(" ");
          if (!terms.every((term) => combined.includes(term))) return undefined;
          let score = 0;
          for (const term of terms) {
            if (title === term) score += 180;
            else if (title.startsWith(term)) score += 120;
            else if (title.includes(term)) score += 90;
            if (keywords.includes(term)) score += 55;
            if (headings.includes(term)) score += 35;
            if (summary.includes(term)) score += 22;
            if (body.includes(term)) score += 5;
          }
          return { guide, score, excerpt: documentationExcerpt(guide, normalizedQuery) };
        }).filter(Boolean).sort((left, right) =>
          right.score - left.score ||
          left.guide.order - right.guide.order ||
          left.guide.title.localeCompare(right.guide.title)
        );
      }

      function documentationBannerHtml(guide) {
        const launch = state.documentation?.launchState || {};
        if (state.documentationOnly) {
          return '<div class="help-banner"><div><strong>OneAgent data is temporarily unavailable</strong><span>The bundled guides remain available. Use Troubleshooting for runtime, indexing, or configuration checks, then refresh OneAgent.</span></div><button type="button" data-help-guide="troubleshooting">Open troubleshooting</button></div>';
        }
        if (launch.showWelcome && !documentationWelcomeAcknowledged) {
          return '<div class="help-banner"><div><strong>Welcome to OneAgent</strong><span>This guide is built into OneAgent and stays available from the ? button. Start here, then use search whenever a term or screen is unclear.</span></div></div>';
        }
        if (launch.isFirstWorkspaceUse && !documentationWorkspaceAcknowledged) {
          return '<div class="help-banner"><div><strong>First time in this workspace</strong><span>OneAgent keeps onboarding separate for every workspace, so this short starting point appears where it is useful.</span></div></div>';
        }
        if (launch.hasUnreadReleaseNotes && !documentationReleaseNotesAcknowledged && guide?.id !== "whats-new" && documentationGuide("whats-new")) {
          return '<div class="help-banner"><div><strong>OneAgent ' + escapeHtml(launch.currentVersion || "") + ' is ready</strong><span>The local release notes have not been opened yet.</span></div><button type="button" data-help-guide="whats-new">What\\'s new</button></div>';
        }
        return "";
      }

      function documentationGuideButton(result) {
        const guide = result.guide;
        const detail = documentationSearch.trim() ? result.excerpt : guide.summary;
        return '<button type="button" class="help-guide' + (guide.id === selectedDocumentationId ? " active" : "") + '" data-help-guide="' + escapeAttr(guide.id) + '" aria-current="' + (guide.id === selectedDocumentationId ? "page" : "false") + '">' +
          '<strong>' + escapeHtml(guide.title) + '</strong>' +
          (detail ? '<span>' + escapeHtml(detail) + '</span>' : "") +
          '</button>';
      }

      function renderDocumentation() {
        const root = document.querySelector("#help");
        if (!root) return;
        const previousScrollTop = root.querySelector(".help-article-wrap")?.scrollTop || 0;
        const searchWasFocused = document.activeElement?.id === "helpSearch";
        const previousSearchCursor = searchWasFocused ? document.activeElement.selectionStart : undefined;
        const guides = documentationGuides();
        if (!guides.length) {
          root.innerHTML = '<div class="empty">The bundled OneAgent guides could not be loaded.</div>';
          return;
        }
        if (!documentationGuide(selectedDocumentationId)) {
          selectedDocumentationId = state.documentation?.defaultGuideId || guides[0].id;
        }
        const selected = documentationGuide(selectedDocumentationId) || guides[0];
        const results = searchDocumentation(documentationSearch);
        let listHtml = "";
        if (documentationSearch.trim()) {
          listHtml = '<p class="help-search-summary">' + results.length + ' guide' + (results.length === 1 ? "" : "s") + ' found</p>' +
            (results.length
              ? '<div class="help-category">' + results.map(documentationGuideButton).join("") + '</div>'
              : '<div class="help-no-results"><span>No guide matches every word in this search.</span><button type="button" data-help-clear>Clear search</button></div>');
        } else {
          const categories = [];
          for (const result of results) {
            let category = categories.find((entry) => entry.name === result.guide.category);
            if (!category) {
              category = { name: result.guide.category, results: [] };
              categories.push(category);
            }
            category.results.push(result);
          }
          listHtml = categories.map((category) =>
            '<div class="help-category"><p class="help-category-label">' + escapeHtml(category.name) + '</p>' +
            category.results.map(documentationGuideButton).join("") + '</div>'
          ).join("");
        }
        const releaseNotes = selected.id === "whats-new" && state.documentation?.releaseNotesMarkdown
          ? '<div class="help-release-notes help-doc">' + mdToHtml(state.documentation.releaseNotesMarkdown, { externalLinks: true, documentationLinks: true }) + '</div>'
          : "";
        root.innerHTML = '<div class="help-shell">' +
          '<aside class="help-sidebar"><div class="help-sidebar-head">' +
          '<div class="help-sidebar-title"><h1>Help</h1><span>Local guides</span></div>' +
          '<p>Learn OneAgent at your pace. Search covers guide titles, sections and full content.</p>' +
          '<div class="help-search"><input id="helpSearch" type="search" value="' + escapeAttr(documentationSearch) + '" placeholder="Search the guides" aria-label="Search OneAgent help">' +
          (documentationSearch ? '<button type="button" data-help-clear aria-label="Clear documentation search">×</button>' : "") + '</div></div>' +
          '<nav class="help-guide-list" aria-label="OneAgent guides">' + listHtml + '</nav></aside>' +
          '<div class="help-article-wrap"><article class="help-article">' +
          '<p class="help-breadcrumb">' + escapeHtml(selected.category || "Guide") + '</p>' +
          '<h1 class="help-article-title">' + escapeHtml(selected.title) + '</h1>' +
          (selected.summary ? '<p class="help-article-summary">' + escapeHtml(selected.summary) + '</p>' : "") +
          documentationBannerHtml(selected) + releaseNotes +
          '<div class="help-doc">' + mdToHtml(selected.markdown, { externalLinks: true, documentationLinks: true }) + '</div>' +
          '</article></div></div>';
        const articleWrap = root.querySelector(".help-article-wrap");
        if (articleWrap) articleWrap.scrollTop = previousScrollTop;
        if (searchWasFocused) {
          requestAnimationFrame(() => {
            const nextSearch = root.querySelector("#helpSearch");
            nextSearch?.focus();
            if (Number.isFinite(previousSearchCursor)) {
              nextSearch?.setSelectionRange(previousSearchCursor, previousSearchCursor);
            }
          });
        }
        const search = root.querySelector("#helpSearch");
        search?.addEventListener("input", () => {
          documentationSearch = search.value;
          const cursor = search.selectionStart;
          renderDocumentation();
          requestAnimationFrame(() => {
            const nextSearch = document.querySelector("#helpSearch");
            nextSearch?.focus();
            if (Number.isFinite(cursor)) nextSearch?.setSelectionRange(cursor, cursor);
          });
        });
        root.querySelectorAll("[data-help-clear]").forEach((button) => button.addEventListener("click", () => {
          documentationSearch = "";
          renderDocumentation();
          requestAnimationFrame(() => document.querySelector("#helpSearch")?.focus());
        }));
        const helpButton = document.querySelector('[data-view="help"]');
        helpButton?.classList.toggle("has-update", Boolean(state.documentation?.launchState?.hasUnreadReleaseNotes && !documentationReleaseNotesAcknowledged));
      }

      function acknowledgeDocumentation() {
        const launch = state.documentation?.launchState || {};
        const acknowledgeWelcome = !documentationWelcomeAcknowledged &&
          launch.showWelcome &&
          selectedDocumentationId === (state.documentation?.defaultGuideId || "start");
        const acknowledgeReleaseNotes = !documentationReleaseNotesAcknowledged &&
          launch.hasUnreadReleaseNotes &&
          selectedDocumentationId === "whats-new";
        const acknowledgeWorkspace = !documentationWorkspaceAcknowledged && launch.isFirstWorkspaceUse;
        if (!acknowledgeWelcome && !acknowledgeReleaseNotes && !acknowledgeWorkspace) return;
        if (acknowledgeWelcome) documentationWelcomeAcknowledged = true;
        if (acknowledgeReleaseNotes) documentationReleaseNotesAcknowledged = true;
        if (acknowledgeWorkspace) documentationWorkspaceAcknowledged = true;
        document.querySelector('[data-view="help"]')?.classList.toggle(
          "has-update",
          Boolean(launch.hasUnreadReleaseNotes && !documentationReleaseNotesAcknowledged)
        );
        vscode?.postMessage({
          type: "documentationShown",
          welcome: acknowledgeWelcome,
          releaseNotes: acknowledgeReleaseNotes,
          workspace: acknowledgeWorkspace
        });
      }

      function openDocumentationGuide(id) {
        const requested = documentationGuide(id);
        selectedDocumentationId = requested?.id || state.documentation?.defaultGuideId || documentationGuides()[0]?.id;
        setActiveView("help");
        const article = document.querySelector(".help-article-wrap");
        if (article) article.scrollTop = 0;
      }

      function entityPanelLoadingHtml(node) {
        const kind = node.meta?.kind || node.type;
        return '<div class="ep"><div class="ep-head">' +
          '<div class="ep-kindrow"><span class="ep-kind"><i class="ep-dot" style="background:' + escapeAttr(colors[graphViewType(node)] || "#94a3b8") + '"></i>' + escapeHtml(String(kind).replace(/_/g, " ")) + '</span></div>' +
          '<h3 class="ep-name">' + escapeHtml(node.label || node.id) + '</h3></div>' +
          '<div class="ep-sec"><p class="summary" style="margin:0">Loading entity context…</p></div></div>';
      }

      function entityPanelReadHtml(ref, ctx, wikiPages) {
        const ui = entityPanelUi;
        const entity = ctx.entity;
        const primaryWikiPage = wikiPages.find((page) => page.absolutePath);
        const s = ctx.summary || {};
        const status = entity.status || "unknown";
        const statusClass = status === "active" ? "ok" : status === "candidate" ? "warn" : "dim";
        const description = String(entity.description || "");
        const relations = Array.isArray(ctx.relations) ? ctx.relations : [];

        let html = '<div class="ep">';
        html += '<div class="ep-head">' +
          '<div class="ep-kindrow"><span class="ep-kind"><i class="ep-dot" style="background:' + escapeAttr(entityKindColor(entity.kind)) + '"></i>' + escapeHtml(String(entity.kind).replace(/_/g, " ")) + '</span>' +
          '<button class="ep-iconbtn" data-ec="edit" data-ref="' + escapeAttr(ref) + '" title="Edit name, status, focus, owners and description">✎</button></div>' +
          '<h3 class="ep-name">' + escapeHtml(entity.label || entity.id) + '</h3>' +
          '<div class="ep-pills"><span class="ep-pill ' + statusClass + '"><i></i>' + escapeHtml(status) + '</span>' +
          '<span class="ep-pill dim">focus · ' + escapeHtml(entity.focusLevel || "informational") + '</span></div>' +
          '</div>';
        html += '<div class="ep-actions">' +
          '<button data-ec="workspace" data-ref="' + escapeAttr(ref) + '" title="Open the full entity workspace"><span>▦</span>Workspace</button>' +
          (primaryWikiPage ? '<button data-ec="openWikiPage" data-path="' + escapeAttr(primaryWikiPage.absolutePath) + '" title="Open ' + escapeAttr(primaryWikiPage.relativePath) + ' in the editor"><span>↗</span>Open Markdown</button>' : "") +
          '<button data-ec="note" data-ref="' + escapeAttr(ref) + '" title="Write a note linked to this entity"><span>✎</span>Add note</button>' +
          '<button data-ec="capture" data-ref="' + escapeAttr(ref) + '" title="Capture a note attached to this entity"><span>✚</span>Capture</button>' +
          '<button data-ec="focus" data-ref="' + escapeAttr(ref) + '" title="Focus the graph on this entity"><span>◎</span>Focus graph</button>' +
          '</div>';
        if (description) {
          const long = description.length > 180;
          html += '<div class="ep-desc"><p class="' + (long && !ui.descExpanded ? "clamped" : "") + '">' + escapeHtml(description) + '</p>' +
            (long ? '<button class="ep-linkish" data-ec="toggleDesc" data-ref="' + escapeAttr(ref) + '">' + (ui.descExpanded ? "Show less" : "Show more") + '</button>' : "") +
            '</div>';
        }
        const stats = [["Obs.", s.observations], ["Capt.", s.captures], ["Linked", s.relatedEntities], ["Obj.", s.objectives], ["Decis.", s.decisions], ["Quest.", s.openQuestions], ["Risks", s.risks]];
        html += '<div class="ep-stats">' + stats.map((stat) =>
          '<div class="ep-stat' + (stat[1] ? "" : " zero") + '"><b>' + escapeHtml(String(stat[1] || 0)) + '</b><span>' + escapeHtml(stat[0]) + '</span></div>'
        ).join("") + '</div>';
        const tabs = [];
        if (entity.kind === "discovery") tabs.push(["discovery", "Discovery", undefined]);
        if (wikiPages.length > 0) tabs.push(["content", "Content", wikiPages.length > 1 ? wikiPages.length : undefined]);
        tabs.push(["overview", "Overview", undefined]);
        tabs.push(["relations", "Relations", relations.length || undefined]);
        html += '<div class="ep-tabs">' + tabs.map((tab) =>
          '<button class="ep-tab' + (ui.tab === tab[0] ? " active" : "") + '" data-ep-tab="' + escapeAttr(tab[0]) + '" data-ref="' + escapeAttr(ref) + '">' + escapeHtml(tab[1]) +
          (tab[2] == null ? "" : '<span class="ep-count">' + escapeHtml(String(tab[2])) + '</span>') + '</button>'
        ).join("") + '</div>';
        if (ui.tab === "discovery") html += discoveryPanelHtml(ref, ctx, wikiPages);
        else if (ui.tab === "content") html += entityPanelContentHtml(ref, wikiPages);
        else if (ui.tab === "relations") html += entityPanelRelationsHtml(ref, relations);
        else html += entityPanelOverviewHtml(ref, ctx);
        const node = (state.graph?.nodes || []).find((candidate) => entityRefForNode(candidate) === ref);
        const confidence = node && node.confidence != null ? Number(node.confidence).toFixed(2) : "—";
        html += '<div class="ep-foot"><span>' + escapeHtml(node?.provider || "work-memory") + '</span><span>confidence ' + escapeHtml(confidence) + '</span><span>' + escapeHtml(ref) + '</span></div>';
        html += '</div>';
        return html;
      }

      function entityPanelOverviewHtml(ref, ctx) {
        let html = "";
        const owners = Array.isArray(ctx.entity.ownerIds) ? ctx.entity.ownerIds : [];
        const contributors = Array.isArray(ctx.entity.contributorIds) ? ctx.entity.contributorIds : [];
        const observations = Array.isArray(ctx.observations) ? ctx.observations : [];
        const captures = Array.isArray(ctx.captures) ? ctx.captures : [];
        const related = Array.isArray(ctx.relatedEntities) ? ctx.relatedEntities : [];
        if (observations.length) {
          html += '<div class="ep-sec"><p class="ep-sec-title">Sourced observations</p>' + observations.slice(0, 4).map((observation) =>
            '<div class="ep-capture"><b>' + escapeHtml(observation.title) + '</b><span>' + escapeHtml(observation.validationStatus + " · " + observation.evidenceStatus + " · " + (observation.sourceTitle || observation.sourceId) + (observation.sourceRevision ? " @" + observation.sourceRevision : "")) + '</span><blockquote>“' + escapeHtml(observation.excerpt) + '”</blockquote></div>'
          ).join("") + (observations.length > 4 ? '<p class="summary" style="margin:4px 0 0">+ ' + (observations.length - 4) + ' more observation(s) in the entity workspace.</p>' : '') + '</div>';
        }
        if (captures.length) {
          html += '<div class="ep-sec"><p class="ep-sec-title">Latest captures</p>' + captures.slice(0, 3).map((capture) =>
            '<div class="ep-capture"><b>' + escapeHtml(capture.title) + '</b><span>' + escapeHtml(capture.contentType + " · " + capture.ingestionStatus + (capture.createdAt ? " · " + String(capture.createdAt).slice(0, 10) : "")) + '</span></div>'
          ).join("") + '</div>';
        }
        if (related.length) {
          const chips = related.slice(0, 8).map((entry) =>
            '<span class="ep-chip" title="' + escapeAttr(entry.relation + " · " + entry.direction) + '"><i class="ep-dot" style="background:' + escapeAttr(entityKindColor(entry.kind)) + '"></i><span>' + escapeHtml(entry.label || entry.id) + '</span></span>'
          ).join("");
          const more = related.length > 8 ? '<span class="ep-chip"><span>+ ' + (related.length - 8) + ' more</span></span>' : "";
          html += '<div class="ep-sec"><p class="ep-sec-title">Related entities</p><div class="ep-chips">' + chips + more + '</div></div>';
        }
        if (owners.length || contributors.length) {
          html += '<div class="ep-sec"><p class="ep-sec-title">Ownership</p><p class="summary" style="margin:0">' +
            (owners.length ? "Owners: " + escapeHtml(owners.join(", ")) : "") +
            (owners.length && contributors.length ? "<br>" : "") +
            (contributors.length ? "Contributors: " + escapeHtml(contributors.join(", ")) : "") + '</p></div>';
        }
        if (!html) {
          html = '<div class="ep-sec"><p class="summary" style="margin:0">No sourced observations, captures or related entities yet. Use Capture to attach knowledge to this entity.</p></div>';
        }
        return html;
      }

      function discoveryPanelHtml(ref, ctx, wikiPages) {
        const discovery = ctx.discovery || {};
        const lifecycle = discovery.lifecycle || { phase: "framing" };
        const observations = Array.isArray(ctx.observations) ? ctx.observations : [];
        const decisions = Array.isArray(ctx.decisions) ? ctx.decisions : [];
        const questions = Array.isArray(ctx.questions) ? ctx.questions : [];
        const risks = Array.isArray(ctx.risks) ? ctx.risks : [];
        const sources = Array.isArray(ctx.sources) ? ctx.sources : [];
        const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];
        let html = '<div class="ep-sec"><p class="ep-sec-title">Research lifecycle</p><div class="ep-discovery-lifecycle">' +
          discoveryFieldHtml("Phase", lifecycle.phase || "framing") +
          discoveryFieldHtml("Outcome", lifecycle.outcome || "Pending") +
          discoveryFieldHtml("Started", lifecycle.startedAt ? String(lifecycle.startedAt).slice(0, 10) : "—") +
          discoveryFieldHtml("Target / concluded", lifecycle.concludedAt ? String(lifecycle.concludedAt).slice(0, 10) : lifecycle.targetEndAt ? String(lifecycle.targetEndAt).slice(0, 10) : "—") +
          '</div>';
        if (Array.isArray(lifecycle.conclusionCriteria) && lifecycle.conclusionCriteria.length) {
          html += '<p class="ep-sec-title" style="margin-top:10px">Conclusion criteria</p><ul class="ep-discovery-criteria">' + lifecycle.conclusionCriteria.map((criterion) => '<li>' + escapeHtml(criterion) + '</li>').join("") + '</ul>';
        }
        html += '</div>';

        if (wikiPages.length) {
          html += '<div class="ep-sec"><p class="ep-sec-title">Curated discovery synthesis</p>' + wikiPages.map((page) => {
            const key = page.relativePath;
            const expanded = Boolean(entityPanelUi.expandedDocs[key]);
            const long = String(page.content || "").length > 700;
            return '<div class="ep-doc-page"><div class="ep-doc-meta"><span>' + escapeHtml(key) + '</span>' +
              (page.absolutePath ? '<button class="ep-linkish" data-ec="openWikiPage" data-path="' + escapeAttr(page.absolutePath) + '">Open ↗</button>' : "") + '</div>' +
              '<div class="ep-doc-wrap' + (long && !expanded ? " clamped" : "") + '"><div class="ep-doc">' + mdToHtml(page.content) + '</div></div>' +
              (long ? '<button class="ep-linkish" data-ec="toggleDoc" data-doc="' + escapeAttr(key) + '" data-ref="' + escapeAttr(ref) + '">' + (expanded ? "Collapse" : "Show all") + '</button>' : "") + '</div>';
          }).join("") + '</div>';
        }

        html += discoveryEntitiesSectionHtml("Products", discovery.products);
        html += discoveryEntitiesSectionHtml("Projects", discovery.projects);
        html += discoveryEntitiesSectionHtml("Insights", discovery.insights);
        html += discoveryEntitiesSectionHtml("Feature requests", discovery.featureRequests);
        html += discoveryEntitiesSectionHtml("Participants & contributors", discovery.people);
        if ((ctx.entity.ownerIds || []).length || (ctx.entity.contributorIds || []).length) {
          html += '<div class="ep-sec"><p class="ep-sec-title">Ownership</p><p class="summary" style="margin:0">' +
            ((ctx.entity.ownerIds || []).length ? "Owners: " + escapeHtml(ctx.entity.ownerIds.join(", ")) : "") +
            ((ctx.entity.ownerIds || []).length && (ctx.entity.contributorIds || []).length ? "<br>" : "") +
            ((ctx.entity.contributorIds || []).length ? "Contributors: " + escapeHtml(ctx.entity.contributorIds.join(", ")) : "") + '</p></div>';
        }
        html += discoveryCapturesSectionHtml("User interviews", discovery.interviews);
        html += discoveryCapturesSectionHtml("Other research sources", discovery.evidence);
        html += discoverySourcesSectionHtml("Indexed sources", sources);
        html += discoveryObservationsSectionHtml("Sourced observations", observations);
        html += discoveryCapturesSectionHtml("Decisions", decisions);
        html += discoveryCapturesSectionHtml("Open questions", questions);
        html += discoveryCapturesSectionHtml("Risks", risks);
        html += discoveryTasksSectionHtml("Next steps & tasks", tasks);
        if (!wikiPages.length && !observations.length && !(discovery.interviews || []).length && !(discovery.evidence || []).length) {
          html += '<div class="ep-sec"><p class="summary" style="margin:0">This discovery has no curated synthesis or research evidence yet. Capture an interview, research note or document to start building it.</p></div>';
        }
        return html;
      }

      function discoveryFieldHtml(label, value) {
        return '<div class="ep-discovery-field"><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(String(value || "—").replace(/_/g, " ")) + '</b></div>';
      }

      function discoveryEntitiesSectionHtml(title, entries) {
        if (!Array.isArray(entries) || !entries.length) return "";
        return '<div class="ep-sec"><p class="ep-sec-title">' + escapeHtml(title) + '</p><div class="ep-chips">' + entries.map((entry) =>
          '<span class="ep-chip" title="' + escapeAttr((entry.relation || "related") + " · " + (entry.direction || "unknown")) + '"><i class="ep-dot" style="background:' + escapeAttr(entityKindColor(entry.kind)) + '"></i><span>' + escapeHtml(entry.label || entry.id) + '</span></span>'
        ).join("") + '</div></div>';
      }

      function discoveryCapturesSectionHtml(title, captures) {
        if (!Array.isArray(captures) || !captures.length) return "";
        return '<div class="ep-sec"><p class="ep-sec-title">' + escapeHtml(title) + '</p>' + captures.map((capture) =>
          '<div class="ep-capture"><div class="ep-sec-head" style="margin:0"><b>' + escapeHtml(capture.title) + '</b>' +
          (capture.path ? '<button class="ep-linkish" data-ec="openCapture" data-path="' + escapeAttr(capture.path) + '">Open ↗</button>' : "") + '</div>' +
          '<span>' + escapeHtml(capture.contentType + " · " + capture.ingestionStatus + (capture.createdAt ? " · " + String(capture.createdAt).slice(0, 10) : "")) + '</span>' +
          (capture.curationSummary ? '<blockquote>' + escapeHtml(capture.curationSummary) + '</blockquote>' : "") + '</div>'
        ).join("") + '</div>';
      }

      function discoveryObservationsSectionHtml(title, observations) {
        if (!Array.isArray(observations) || !observations.length) return "";
        return '<div class="ep-sec"><p class="ep-sec-title">' + escapeHtml(title) + '</p>' + observations.map((observation) =>
          '<div class="ep-capture"><b>' + escapeHtml(observation.title) + '</b><span>' + escapeHtml(observation.kind + " · " + observation.validationStatus + " · " + observation.evidenceStatus) + '</span>' +
          (observation.body ? '<p class="summary" style="margin:6px 0 0">' + escapeHtml(observation.body) + '</p>' : "") +
          (observation.excerpt ? '<blockquote>“' + escapeHtml(observation.excerpt) + '”</blockquote>' : "") + '</div>'
        ).join("") + '</div>';
      }

      function discoverySourcesSectionHtml(title, sources) {
        if (!Array.isArray(sources) || !sources.length) return "";
        return '<div class="ep-sec"><p class="ep-sec-title">' + escapeHtml(title) + '</p>' + sources.map((source) =>
          '<div class="ep-capture"><div class="ep-sec-head" style="margin:0"><b>' + escapeHtml(source.title || source.id) + '</b>' +
          (source.rawPath ? '<button class="ep-linkish" data-ec="openCapture" data-path="' + escapeAttr(source.rawPath) + '">Open ↗</button>' : "") + '</div>' +
          '<span>' + escapeHtml((source.sourceType || "source") + " · " + (source.status || "unknown") + (source.chunkCount != null ? " · " + source.chunkCount + " chunks" : "")) + '</span></div>'
        ).join("") + '</div>';
      }

      function discoveryTasksSectionHtml(title, tasks) {
        if (!Array.isArray(tasks) || !tasks.length) return "";
        return '<div class="ep-sec"><p class="ep-sec-title">' + escapeHtml(title) + '</p>' + tasks.map((task) =>
          '<div class="ep-capture"><b>' + escapeHtml(task.title) + '</b><span>' + escapeHtml((task.status || "unknown") + (task.priority ? " · " + task.priority : "") + (task.deadline ? " · due " + String(task.deadline).slice(0, 10) : "")) + '</span>' +
          (task.body ? '<p class="summary" style="margin:6px 0 0">' + escapeHtml(task.body) + '</p>' : "") + '</div>'
        ).join("") + '</div>';
      }

      function entityPanelContentHtml(ref, wikiPages) {
        const ui = entityPanelUi;
        return '<div class="ep-sec">' + wikiPages.map((page) => {
          const key = page.relativePath;
          const expanded = Boolean(ui.expandedDocs[key]);
          const long = String(page.content || "").length > 700;
          return '<div class="ep-doc-page">' +
            '<div class="ep-doc-meta"><span>' + escapeHtml(key + (page.updatedAt ? " · " + String(page.updatedAt).slice(0, 10) : "")) + '</span>' +
            (page.absolutePath ? '<button class="ep-linkish" data-ec="openWikiPage" data-path="' + escapeAttr(page.absolutePath) + '" title="Open the Markdown file in the editor">Open ↗</button>' : "") +
            '</div>' +
            '<div class="ep-doc-wrap' + (long && !expanded ? " clamped" : "") + '"><div class="ep-doc">' + mdToHtml(page.content) + '</div></div>' +
            (long ? '<button class="ep-linkish" data-ec="toggleDoc" data-doc="' + escapeAttr(key) + '" data-ref="' + escapeAttr(ref) + '">' + (expanded ? "Collapse" : "Show all") + '</button>' : "") +
            (page.truncated ? '<p class="summary" style="margin:4px 0 0">Content truncated — open the file for the full page.</p>' : "") +
            '</div>';
        }).join("") + '</div>';
      }

      function entityPanelRelationsHtml(ref, relations) {
        const ui = entityPanelUi;
        const groups = new Map();
        for (const relation of relations) {
          const list = groups.get(relation.relationType) || [];
          list.push(relation);
          groups.set(relation.relationType, list);
        }
        const ordered = [...groups.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
        let html = '<div class="ep-sec"><div class="ep-sec-head"><p class="ep-sec-title">Explicit relations</p>' +
          '<button class="ep-minibtn" data-ec="toggleComposer" data-ref="' + escapeAttr(ref) + '">' + (ui.composerOpen ? "Close" : "+ New") + '</button></div>';
        if (!ordered.length) {
          html += '<p class="summary" style="margin:0 0 4px">No explicit relations yet.</p>';
        }
        html += ordered.map(([type, list]) => {
          const rows = list.map((relation) => {
            const source = relation.sourceKind + ":" + relation.sourceId;
            const target = relation.targetKind + ":" + relation.targetId;
            const outgoing = source === ref;
            const other = entityShortInfo(outgoing ? target : source);
            const fullLabel = entityDisplayLabel(source) + " --" + relation.relationType + "--> " + entityDisplayLabel(target);
            return '<div class="ep-relrow" title="' + escapeAttr(fullLabel + (relation.description ? " · " + relation.description : "")) + '">' +
              '<span class="ep-reldir">' + (outgoing ? "→" : "←") + '</span>' +
              '<span class="ep-rellabel"><i class="ep-dot" style="background:' + escapeAttr(entityKindColor(other.kind)) + '"></i><span>' + escapeHtml(other.label) + '</span></span>' +
              '<button class="ep-reldel" data-ec="deleteRelation" data-ref="' + escapeAttr(ref) + '" data-relation-id="' + escapeAttr(relation.id) + '" data-label="' + escapeAttr(fullLabel) + '" title="Delete relation">✕</button>' +
              '</div>';
          }).join("");
          const outCount = list.filter((relation) => relation.sourceKind + ":" + relation.sourceId === ref).length;
          const inCount = list.length - outCount;
          const directionNote = [outCount ? outCount + " outgoing" : "", inCount ? inCount + " incoming" : ""].filter(Boolean).join(", ");
          return '<div class="ep-relgroup"><p class="ep-relgroup-h"><b>' + escapeHtml(type) + '</b><span>· ' + escapeHtml(directionNote || String(list.length)) + '</span></p>' + rows + '</div>';
        }).join("");
        if (ui.composerOpen) {
          html += '<div class="ep-composer">' +
            '<select id="ecLinkTarget" class="link-select"><option value="">Select an entity…</option>' + entityLinkTargetOptionsHtml(ref) + '</select>' +
            '<div class="link-entity-row">' +
              '<select id="ecLinkDir" class="link-select" title="Relation direction"><option value="out">This node is source</option><option value="in">This node is target</option></select>' +
              '<select id="ecLinkType" class="link-select" title="Relation type">' + relationTypeOptionsHtml() + '</select>' +
            '</div>' +
            '<div class="field"><label>Why / note</label><textarea id="ecLinkDescription" maxlength="1000" placeholder="Optional reason or context for this relation."></textarea></div>' +
            '<div id="ecLinkPreview" class="link-preview">Select a target to preview the relation direction.</div>' +
            '<div class="detail-actions"><button class="action" data-ec="createRelation" data-ref="' + escapeAttr(ref) + '">Create relation</button></div>' +
            '</div>';
        }
        html += '</div>';
        return html;
      }

      function entityPanelEditHtml(ref, ctx) {
        const entity = ctx.entity;
        const lifecycle = ctx.discovery?.lifecycle || { phase: "framing" };
        const discoveryFields = entity.kind === "discovery" ?
          '<div class="entity-edit-grid"><div class="field"><label>Discovery phase</label><select id="ecDiscoveryPhase">' + ["framing", "planning", "collecting", "synthesizing", "concluded"].map((phase) => '<option value="' + phase + '"' + (phase === lifecycle.phase ? " selected" : "") + '>' + phase + '</option>').join("") + '</select></div>' +
          '<div class="field"><label>Outcome</label><select id="ecDiscoveryOutcome"' + (lifecycle.phase === "concluded" ? "" : " disabled") + '><option value="">Pending</option>' + ["validated", "invalidated", "inconclusive", "pivoted", "cancelled"].map((outcome) => '<option value="' + outcome + '"' + (outcome === lifecycle.outcome ? " selected" : "") + '>' + outcome + '</option>').join("") + '</select></div>' +
          '<div class="field"><label>Started</label><input id="ecDiscoveryStarted" type="date" value="' + escapeAttr(lifecycle.startedAt ? String(lifecycle.startedAt).slice(0, 10) : "") + '"></div>' +
          '<div class="field"><label>Target end</label><input id="ecDiscoveryTarget" type="date" value="' + escapeAttr(lifecycle.targetEndAt ? String(lifecycle.targetEndAt).slice(0, 10) : "") + '"></div>' +
          '<div class="field"><label>Concluded</label><input id="ecDiscoveryConcluded" type="date" value="' + escapeAttr(lifecycle.concludedAt ? String(lifecycle.concludedAt).slice(0, 10) : "") + '"></div></div>' +
          '<div class="field"><label>Conclusion criteria</label><textarea id="ecDiscoveryCriteria" placeholder="One criterion per line">' + escapeHtml((lifecycle.conclusionCriteria || []).join("\\n")) + '</textarea></div>' : "";
        return '<div class="ep">' +
          '<div class="ep-head"><div class="ep-kindrow"><span class="ep-kind"><i class="ep-dot" style="background:' + escapeAttr(entityKindColor(entity.kind)) + '"></i>' + escapeHtml(String(entity.kind).replace(/_/g, " ")) + ' · editing</span></div>' +
          '<h3 class="ep-name">' + escapeHtml(entity.label || entity.id) + '</h3></div>' +
          '<div class="ep-edit-fields">' +
            '<div class="field"><label>Name</label><input id="ecLabel" maxlength="180" value="' + escapeAttr(entity.label || entity.id || "") + '"></div>' +
            '<div class="entity-edit-grid">' +
              '<div class="field"><label>Type</label><select id="ecKind"' + (entityKindLocked(entity.kind) ? " disabled" : "") + '>' + entityKindOptionsHtml(entity.kind) + '</select></div>' +
              '<div class="field"><label>Status</label><select id="ecStatus">' + entityStatusOptionsHtml(entity.status || "active") + '</select></div>' +
              '<div class="field"><label>Focus level</label><select id="ecFocus">' + entityFocusOptionsHtml(entity.focusLevel || "informational") + '</select></div>' +
              '<div class="field"><label>Owners</label><input id="ecOwners" value="' + escapeAttr((entity.ownerIds || []).join(", ")) + '" placeholder="person:me, team:core"></div>' +
            '</div>' +
            '<div class="field"><label>Contributors</label><input id="ecContributors" value="' + escapeAttr((entity.contributorIds || []).join(", ")) + '" placeholder="person:name, team:name"></div>' +
            '<div class="field"><label>Description</label><textarea id="ecDescription" maxlength="2000" placeholder="Short description used by the agent, search and graph.">' + escapeHtml(entity.description || "") + '</textarea></div>' +
            discoveryFields +
            (entityKindLocked(entity.kind) ? '<p class="summary" style="margin:0">This core node type cannot be changed after creation.</p>' : "") +
          '</div>' +
          '<div class="ep-editbar"><button class="action" data-ec="cancelEdit" data-ref="' + escapeAttr(ref) + '">Cancel</button><button class="action" data-ec="saveEntity" data-ref="' + escapeAttr(ref) + '">Save</button></div>' +
          '</div>';
      }

      function renderEntityContext(ref) {
        const ctx = entityContextCache[ref];
        if (!ctx) return;
        if (entityPanelUi.ref !== ref) {
          entityPanelUi = { ref, tab: undefined, editing: false, composerOpen: false, descExpanded: false, expandedDocs: {} };
        }
        const ui = entityPanelUi;
        const wikiPages = Array.isArray(ctx.wikiPages) ? ctx.wikiPages : [];
        if (!ui.tab || (ui.tab === "content" && wikiPages.length === 0)) {
          ui.tab = ctx.entity.kind === "discovery" ? "discovery" : wikiPages.length > 0 ? "content" : "overview";
        }
        const extra = document.querySelector("#detailExtra");
        extra.innerHTML = ui.editing ? entityPanelEditHtml(ref, ctx) : entityPanelReadHtml(ref, ctx, wikiPages);
        bindEntityContextActions(extra);
        if (!ui.editing && ui.tab === "relations" && ui.composerOpen) {
          updateEntityLinkPreview(ref);
        }
      }

      function bindEntityContextActions(root) {
        root.querySelector("#ecDiscoveryPhase")?.addEventListener("change", (event) => {
          const outcome = root.querySelector("#ecDiscoveryOutcome");
          if (!outcome) return;
          outcome.disabled = event.target.value !== "concluded";
          if (outcome.disabled) outcome.value = "";
        });
        ["#ecLinkTarget", "#ecLinkType", "#ecLinkDir"].forEach((selector) => {
          root.querySelector(selector)?.addEventListener("change", () => updateEntityLinkPreview(root.querySelector("[data-ec='createRelation']")?.dataset.ref));
        });
        root.querySelectorAll("[data-ep-tab]").forEach((button) => button.addEventListener("click", () => {
          entityPanelUi.tab = button.dataset.epTab;
          renderEntityContext(button.dataset.ref);
        }));
        root.querySelectorAll("[data-ec]").forEach((button) => button.addEventListener("click", () => {
          const ref = button.dataset.ref;
          if (button.dataset.ec === "saveEntity") {
            const label = document.querySelector("#ecLabel")?.value || "";
            const kind = document.querySelector("#ecKind")?.value || "";
            const status = document.querySelector("#ecStatus")?.value || "";
            const focusLevel = document.querySelector("#ecFocus")?.value || "";
            const ownerIds = parseCsvList(document.querySelector("#ecOwners")?.value || "");
            const contributorIds = parseCsvList(document.querySelector("#ecContributors")?.value || "");
            const description = document.querySelector("#ecDescription")?.value || "";
            const discoveryPhase = document.querySelector("#ecDiscoveryPhase")?.value;
            const discoveryOutcome = discoveryPhase === "concluded" ? document.querySelector("#ecDiscoveryOutcome")?.value : "";
            const discoveryStartedAt = document.querySelector("#ecDiscoveryStarted")?.value;
            const discoveryTargetEndAt = document.querySelector("#ecDiscoveryTarget")?.value;
            const discoveryConcludedAt = document.querySelector("#ecDiscoveryConcluded")?.value;
            const discoveryConclusionCriteria = String(document.querySelector("#ecDiscoveryCriteria")?.value || "").split(/\\n/).map((value) => value.trim()).filter(Boolean);
            vscode?.postMessage({ type: "updateGraphEntity", ref, label, kind, status, focusLevel, ownerIds, contributorIds, description, discoveryPhase, discoveryOutcome, discoveryStartedAt, discoveryTargetEndAt, discoveryConcludedAt, discoveryConclusionCriteria });
            entityPanelUi.editing = false;
          } else if (button.dataset.ec === "edit") {
            entityPanelUi.editing = true;
            renderEntityContext(ref);
          } else if (button.dataset.ec === "cancelEdit") {
            entityPanelUi.editing = false;
            renderEntityContext(ref);
          } else if (button.dataset.ec === "toggleDesc") {
            entityPanelUi.descExpanded = !entityPanelUi.descExpanded;
            renderEntityContext(ref);
          } else if (button.dataset.ec === "toggleComposer") {
            entityPanelUi.composerOpen = !entityPanelUi.composerOpen;
            renderEntityContext(ref);
          } else if (button.dataset.ec === "toggleDoc") {
            entityPanelUi.expandedDocs[button.dataset.doc] = !entityPanelUi.expandedDocs[button.dataset.doc];
            renderEntityContext(ref);
          } else if (button.dataset.ec === "openWikiPage") {
            vscode?.postMessage({ type: "openFile", path: button.dataset.path });
          } else if (button.dataset.ec === "openCapture") {
            vscode?.postMessage({ type: "openFile", path: button.dataset.path });
          } else if (button.dataset.ec === "workspace") {
            openEntityWorkspace(ref);
          } else if (button.dataset.ec === "note") {
            openNewManualNote(ref);
          } else if (button.dataset.ec === "capture") {
            setActiveView("settings");
            renderCaptureForm(ref);
          } else if (button.dataset.ec === "focus") {
            focusGraphOnEntity(ref);
          } else if (button.dataset.ec === "focusLevel") {
            vscode?.postMessage({ type: "updateEntityFocus", ref, focusLevel: button.dataset.focusLevel });
          } else if (button.dataset.ec === "createRelation") {
            const targetSelect = document.querySelector("#ecLinkTarget");
            const typeSelect = document.querySelector("#ecLinkType");
            const dirSelect = document.querySelector("#ecLinkDir");
            const descriptionField = document.querySelector("#ecLinkDescription");
            const picked = targetSelect ? targetSelect.value : "";
            const relationType = typeSelect ? typeSelect.value : "";
            if (!picked || !relationType) return;
            const inbound = dirSelect && dirSelect.value === "in";
            vscode?.postMessage({
              type: "createRelation",
              source: inbound ? picked : ref,
              target: inbound ? ref : picked,
              relationType,
              description: descriptionField ? descriptionField.value : ""
            });
            entityPanelUi.composerOpen = false;
          } else if (button.dataset.ec === "deleteRelation") {
            vscode?.postMessage({ type: "deleteGraphRelation", relationId: button.dataset.relationId, label: button.dataset.label, ref });
          }
        }));
      }

      function updateEntityLinkPreview(ref) {
        const preview = document.querySelector("#ecLinkPreview");
        if (!preview || !ref) return;
        const picked = document.querySelector("#ecLinkTarget")?.value || "";
        const relationType = document.querySelector("#ecLinkType")?.value || "related_to";
        const inbound = document.querySelector("#ecLinkDir")?.value === "in";
        if (!picked) {
          preview.textContent = "Select a target to preview the relation direction.";
          return;
        }
        const source = inbound ? picked : ref;
        const target = inbound ? ref : picked;
        preview.textContent = entityDisplayLabel(source) + " --" + relationType + "--> " + entityDisplayLabel(target);
      }

      function openEntityWorkspace(ref) {
        workspaceRef = ref;
        if (!entityContextCache[ref]) {
          vscode?.postMessage({ type: "loadEntityContext", ref });
        }
        setActiveView("workspace");
        renderWorkspace();
      }

      function focusGraphOnEntity(ref) {
        const target = findGraphNodeForEntityRef(ref);
        const filterInput = document.querySelector("#filter");
        if (filterInput) filterInput.value = "";
        setGraphPerspective("focus");
        graphDepth = 2;
        setActiveView("map");
        if (target) {
          activeGraphTypes.add(graphViewType(target));
          graphExcludedValues[graphViewType(target)]?.delete(target.id);
          focusedNodeId = target.id;
          renderLegend();
          renderGraphFilterPanel();
          selectNode(target);
          window.setTimeout(() => graphViewer?.focusSelected?.(), 80);
          return;
        }
        selectedNodeId = graphNodeIdForEntityRef(ref);
        focusedNodeId = selectedNodeId;
        renderFocusSelector();
        renderGraph();
      }

      function findGraphNodeForEntityRef(ref) {
        const targetId = graphNodeIdForEntityRef(ref);
        return (state.graph.nodes || []).find((node) => node.id === targetId || entityRefForNode(node) === ref);
      }

      function graphNodeIdForEntityRef(ref) {
        const parts = String(ref || "").split(":");
        const kind = parts.shift();
        const id = parts.join(":");
        if (!kind || !id) return ref;
        if (kind === "product") return "product:" + id;
        if (kind === "repository") return "repository:" + id;
        if (kind === "domain" || kind === "subdomain" || kind === "team") return "entity:" + id;
        return "entity:" + kind + ":" + id;
      }

      function renderWorkspace() {
        const root = document.querySelector("#workspace");
        if (!root) return;
        const ctx = workspaceRef ? entityContextCache[workspaceRef] : undefined;
        if (!ctx) {
          root.innerHTML = '<div class="title-row"><div><h1>Entity workspace</h1><p>Loading entity context…</p></div></div>';
          return;
        }
        const s = ctx.summary;
        const section = (title, items, render) => items && items.length
          ? '<section class="lane"><h2>' + escapeHtml(title) + '<span>' + items.length + '</span></h2>' + items.map(render).join("") + '</section>'
          : '';
        const captureCard = (c) => '<div class="task"><strong>' + escapeHtml(c.title) + '</strong><span>' + escapeHtml(c.contentType + " · " + c.ingestionStatus + " · " + c.primaryEntityKind + ":" + c.primaryEntityId) + '</span></div>';
        const observationCard = (observation) => '<div class="task"><strong>' + escapeHtml(observation.title) + '</strong><span>' + escapeHtml(observation.validationStatus + " · " + observation.evidenceStatus + " · " + (observation.sourceTitle || observation.sourceId) + (observation.sourceRevision ? " @" + observation.sourceRevision : "")) + '</span><span>“' + escapeHtml(observation.excerpt) + '”</span></div>';
        const packageCard = (detail) => '<div class="task"><strong>' + escapeHtml(detail.title) + '</strong><span>' + escapeHtml(detail.status + " · wiki " + detail.wikiDecision) + '</span></div>';
        const relCard = (r) => '<div class="task"><strong>' + escapeHtml(r.label || r.id) + '</strong><span>' + escapeHtml(r.kind + " · " + r.relation + " · " + r.direction) + '</span></div>';
        const taskCard = (t) => '<div class="task"><strong>' + escapeHtml(t.title) + '</strong><span>' + escapeHtml((t.status || "") + " · " + (t.priority || "")) + '</span></div>';
        root.innerHTML =
          '<div class="title-row"><div><h1>' + escapeHtml(ctx.entity.label) + '</h1><p>' + escapeHtml(ctx.entity.kind + " · " + (ctx.entity.status || "unknown") + (ctx.entity.description ? " — " + ctx.entity.description : "")) + '</p></div>' +
          '<div class="proposal-actions"><button class="action" data-ec="note" data-ref="' + escapeAttr(workspaceRef) + '">Add note</button><button class="action" data-ec="capture" data-ref="' + escapeAttr(workspaceRef) + '">Capture</button><button class="action" data-ec="focus" data-ref="' + escapeAttr(workspaceRef) + '">Focus graph</button></div></div>' +
          '<div class="metrics">' + ecMetric("Observations", s.observations) + ecMetric("Accepted", s.acceptedObservations) + ecMetric("Proposed", s.proposedObservations) + ecMetric("Contradicted", s.contradictedObservations) + ecMetric("Captures", s.captures) + ecMetric("Objectives", s.objectives) + ecMetric("Decisions", s.decisions) + ecMetric("Questions", s.openQuestions) + ecMetric("Risks", s.risks) + ecMetric("Tasks", s.tasks) + ecMetric("Sources", s.sources) + ecMetric("Related people", s.relatedPeople) + '</div>' +
          '<div class="columns">' +
          section("Observations", ctx.observations, observationCard) +
          section("Curation packages", ctx.curationPackages, packageCard) +
          section("Objectives", ctx.objectives, captureCard) +
          section("Captures", ctx.captures, captureCard) +
          section("Decisions", ctx.decisions, captureCard) +
          section("Questions", ctx.questions, captureCard) +
          section("Risks", ctx.risks, captureCard) +
          section("Tasks", ctx.tasks, taskCard) +
          section("Related entities", ctx.relatedEntities, relCard) +
          '</div>' +
          (ctx.notes && ctx.notes.length ? '<p class="summary">' + ctx.notes.map(escapeHtml).join(" ") + '</p>' : '');
        bindEntityContextActions(root);
      }

      function resetNodeDetail() {
        selectedNodeId = undefined;
        selectedRelationId = undefined;
        setDetailLegacyVisible(true);
        document.querySelector("#detailTitle").textContent = "No selection";
        document.querySelector("#detailType").textContent = graphPerspective;
        document.querySelector("#detailStatus").textContent = "";
        document.querySelector("#detailSummary").textContent = "Select a visible node or relation to inspect its source, direction, status and provider.";
        document.querySelector("#detailProvider").textContent = "-";
        document.querySelector("#detailConfidence").textContent = "-";
        document.querySelector("#detailDot").style.background = "transparent";
        document.querySelector("#detailExtra").innerHTML = "";
        renderFocusSelector();
      }

      function renderNodeExtra(node) {
        if (isVirtualTypeGroup(node)) {
          const members = Array.isArray(node.meta?.members) ? node.meta.members : [];
          const memberList = members.slice(0, 24).map((member) =>
            '<span class="chip">' + escapeHtml(member.label || member.id) + '</span>'
          ).join("");
          const overflow = members.length > 24 ? '<p class="summary">+' + escapeHtml(String(members.length - 24)) + ' more members hidden in this group.</p>' : "";
          return '<div class="task-detail" style="margin-top:12px">' +
            '<div class="metrics">' + ecMetric("Members", members.length) + ecMetric("Type", typeLabel(node.meta?.groupType)) + '</div>' +
            '<p class="summary">This is a visual group only. It does not exist in the memory database.</p>' +
            '<div class="chips">' + (memberList || '<span class="chip">No entity member</span>') + '</div>' +
            overflow +
            '<div class="detail-actions"><button class="action" data-group-action="context" data-group-id="' + escapeAttr(node.id) + '">Add group to context</button><button class="action" data-group-action="expand" data-group-id="' + escapeAttr(node.id) + '">Expand group</button></div>' +
            '</div>';
        }
        const rows = [
          ["Type", graphViewType(node)],
          ["Stored type", node.type !== graphViewType(node) ? node.type : undefined],
          ["Status", node.status],
          ["Source", node.sourceId],
          ["Path", node.path],
          ["Provider", node.provider],
          ["Focus", node.meta?.focusLevel],
          ["Owners", Array.isArray(node.meta?.ownerIds) ? node.meta.ownerIds.join(", ") : undefined],
          ["Contributors", Array.isArray(node.meta?.contributorIds) ? node.meta.contributorIds.join(", ") : undefined],
          ["Concept type", node.meta?.conceptType],
          ["Inbox type", node.meta?.inboxType],
          ["Source type", node.meta?.sourceType],
          ["Members", Array.isArray(node.meta?.members) ? node.meta.members.map((member) => member.role ? member.name + " - " + member.role : member.name).join("; ") : undefined]
        ].filter((row) => row[1]);
        const fields = rows.map((row) => '<div class="field"><label>' + escapeHtml(row[0]) + '</label><input readonly value="' + escapeAttr(row[1]) + '"></div>').join("");
        const body = node.meta?.body && node.meta.body !== node.meta?.description ? '<div class="field"><label>Body</label><textarea readonly>' + escapeHtml(node.meta.body) + '</textarea></div>' : "";
        const action = node.path ? '<div class="detail-actions"><button class="action" data-detail-open="' + escapeAttr(node.path) + '">Open source</button></div>' : "";
        return fields || body || action ? '<div class="task-detail" style="margin-top:12px">' + fields + body + action + '</div>' : "";
      }

      function bindGraphGroupDetailActions() {
        document.querySelectorAll("[data-group-action]").forEach((button) => button.addEventListener("click", () => {
          const group = graphTypeGroupState.groups.get(button.dataset.groupId);
          if (!group) return;
          if (button.dataset.groupAction === "context") {
            addRefsToContextScope(group.meta?.memberRefs || []);
          } else if (button.dataset.groupAction === "expand") {
            setTypeGroupExpanded(group.meta?.groupType, true);
          }
        }));
      }

      function renderRelationExtra(edge) {
        const sourceNode = graphNodeForEndpoint(edge?.source);
        const targetNode = graphNodeForEndpoint(edge?.target);
        const sourceLabel = sourceNode?.label || sourceNode?.name || graphEndpointId(edge?.source);
        const targetLabel = targetNode?.label || targetNode?.name || graphEndpointId(edge?.target);
        const sourceRef = sourceNode ? entityRefForNode(sourceNode) : undefined;
        const targetRef = targetNode ? entityRefForNode(targetNode) : undefined;
        const meta = edge?.meta || {};
        const deletePayload = graphRelationDeletePayload(edge);
        const source = relationSourceRecord(edge);
        const capture = relationCaptureRecord(edge);
        const capturedFrom = relationCapturedFromRecords(edge);
        const editable = Boolean(deletePayload?.relationId && sourceRef && targetRef);
        const rows = [
          ...(!editable ? [
            ["Source", sourceRef ? sourceLabel + " (" + sourceRef + ")" : sourceLabel],
            ["Target", targetRef ? targetLabel + " (" + targetRef + ")" : targetLabel],
            ["Direction", sourceLabel + " -> " + targetLabel],
            ["Relation type", graphRelationType(edge)]
          ] : []),
          ["Relation category", edgeRelationTypes(edge).map((type) => relationCategoryLabel(type)).filter((value, index, values) => values.indexOf(value) === index).join(", ")],
          ["Status", edge?.status],
          ["Created by", relationOriginLabel(edge)],
          ["Relation id", deletePayload?.relationId],
          ["Organization link id", deletePayload?.linkId],
          ["Source evidence", source ? source.title || source.id : edge?.sourceId],
          ["Capture evidence", capture ? capture.title || capture.id : meta.captureId],
          ["Captured from", capturedFrom.length ? capturedFrom.map((item) => item.title || item.id).join("; ") : undefined]
        ].filter((row) => row[1]);
        const fields = rows.map((row) => '<div class="field"><label>' + escapeHtml(row[0]) + '</label><input readonly value="' + escapeAttr(row[1]) + '"></div>').join("");
        const editor = editable
          ? '<div class="field"><label>Source</label><select id="relationEditSource">' + relationEntityOptionsHtml(sourceRef) + '</select></div>' +
            '<div class="field"><label>Target</label><select id="relationEditTarget">' + relationEntityOptionsHtml(targetRef) + '</select></div>' +
            '<div class="field"><label>Relation type</label><select id="relationEditType">' + relationTypeOptionsHtml(graphRelationType(edge)) + '</select></div>' +
            '<div class="field"><label>Why / note</label><textarea id="relationEditDescription" maxlength="1000" placeholder="Optional reason or context for this relation.">' + escapeHtml(String(meta.description || "")) + '</textarea></div>'
          : (meta.description ? '<div class="field"><label>Why / note</label><textarea readonly>' + escapeHtml(String(meta.description)) + '</textarea></div>' : '<p class="summary">This relation is derived from its source and cannot be edited directly.</p>');
        const metadata = Object.keys(meta).length
          ? '<details class="field"><summary>Technical metadata</summary><textarea readonly>' + escapeHtml(JSON.stringify(meta, null, 2)) + '</textarea></details>'
          : "";
        const actions = '<div class="detail-actions">' +
          (editable ? '<button class="action" data-relation-save="true">Save relation</button>' : '') +
          (sourceRef ? '<button class="action" data-relation-focus="' + escapeAttr(sourceRef) + '">Focus source</button>' : '') +
          (targetRef ? '<button class="action" data-relation-focus="' + escapeAttr(targetRef) + '">Focus target</button>' : '') +
          (deletePayload ? '<button class="action" data-relation-delete="true">Delete relation</button>' : '') +
          '</div>';
        return '<div class="task-detail" style="margin-top:12px">' + editor + fields + metadata + actions + '</div>';
      }

      function bindRelationDetailActions(edge) {
        document.querySelector("[data-relation-save]")?.addEventListener("click", () => {
          const payload = graphRelationDeletePayload(edge);
          const sourceNode = graphNodeForEndpoint(edge?.source);
          const targetNode = graphNodeForEndpoint(edge?.target);
          const originalSource = sourceNode ? entityRefForNode(sourceNode) : undefined;
          const originalTarget = targetNode ? entityRefForNode(targetNode) : undefined;
          const source = document.querySelector("#relationEditSource")?.value || "";
          const target = document.querySelector("#relationEditTarget")?.value || "";
          const relationType = document.querySelector("#relationEditType")?.value || "";
          if (!payload?.relationId || !source || !target || !relationType || source === target) return;
          vscode?.postMessage({
            type: "updateGraphRelation",
            relationId: payload.relationId,
            originalSource,
            originalTarget,
            originalRelationType: graphRelationType(edge),
            source,
            target,
            relationType,
            description: document.querySelector("#relationEditDescription")?.value || "",
            capturedFrom: Array.isArray(edge?.meta?.capturedFrom) ? edge.meta.capturedFrom : []
          });
        });
        document.querySelectorAll("[data-relation-focus]").forEach((button) => {
          button.addEventListener("click", () => focusGraphOnEntity(button.dataset.relationFocus));
        });
        document.querySelector("[data-relation-delete]")?.addEventListener("click", () => {
          const payload = graphRelationDeletePayload(edge);
          if (payload) vscode?.postMessage({ type: "deleteGraphRelation", label: graphRelationMenuTitle(edge), ...payload });
        });
      }

      function renderCurationQueue() {
        const badge = document.querySelector("#curationQueueBadge");
        if (!badge) return;
        const waiting = (state.captures || []).filter((capture) =>
          capture.curationStatus === "pending" || capture.curationStatus === "failed" || capture.curationStatus === "curating"
        ).length;
        badge.style.display = waiting > 0 ? "" : "none";
        badge.textContent = "⚙ " + waiting + " to curate";
        badge.disabled = false;
      }

      document.querySelector("#curationQueueBadge")?.addEventListener("click", (event) => {
        event.target.disabled = true;
        event.target.textContent = "⚙ curating...";
        vscode?.postMessage({ type: "curatePending" });
      });

      function renderReadiness() {
        const report = state.readiness || { score: 0, signals: [] };
        const score = report.score || 0;
        const scoreElement = document.querySelector("#score");
        if (scoreElement) {
          scoreElement.textContent = score;
          scoreElement.title = "Planning readiness for the current scope: " + score + "/100";
        }
      }

      function renderDiagnostics() {
        const diagnostics = (state.graph.diagnostics || []).slice();
        const countElement = document.querySelector("#diagCount");
        const diagnosticsElement = document.querySelector("#diagnostics");
        if (countElement) countElement.textContent = diagnostics.length + "";
        if (diagnosticsElement) diagnosticsElement.innerHTML = diagnostics.length ? diagnostics.map((diagnostic) =>
          '<div class="feed-item"><strong>' + escapeHtml(diagnostic.provider + " · " + diagnostic.status) + '</strong><span>' + escapeHtml(diagnostic.message) + '</span>' +
          (diagnostic.action ? '<button class="action diag-action" data-diag-action="' + escapeAttr(diagnostic.action.id) + '">' + escapeHtml(diagnostic.action.label) + '</button>' : '') +
          '</div>'
        ).join("") : '<div class="feed-item"><strong>Ready</strong><span>No diagnostics.</span></div>';
        document.querySelectorAll("[data-diag-action]").forEach((button) => {
          button.addEventListener("click", () => {
            button.disabled = true;
            vscode?.postMessage({ type: button.dataset.diagAction });
          });
        });
      }

      function renderGraphFilterPanel() {
        const panel = document.querySelector("#graphFilterPanel");
        if (!panel) return;
        renderGraphFilterToggle();
        panel.classList.toggle("collapsed", !graphFilterPanelOpen);
        const counts = graphTypeCounts();
        const visibleTypes = graphFilterSectionOrder(counts);
        if (!visibleTypes.includes(selectedGraphFilterType)) {
          selectedGraphFilterType = visibleTypes[0] || "product";
        }
        const totalActive = visibleTypes.filter((type) => graphFilterSectionActive(type) && graphCheckedCountForType(type) > 0).length;
        const headHtml = '<div class="filter-head" id="graphFilterHead"><div><strong>Filters</strong><span> ' + escapeHtml(String(totalActive)) + '/' + escapeHtml(String(visibleTypes.length)) + ' categories</span></div><div class="filter-head-actions">' +
          (graphFilterPanelOpen ? '<button class="filter-action" id="resetGraphFilters">Reset</button>' : "") +
          '<button class="filter-toggle-caret" id="collapseGraphFilters" title="' + (graphFilterPanelOpen ? "Collapse filters" : "Expand filters") + '">' + (graphFilterPanelOpen ? "▲" : "▼") + '</button></div></div>';
        if (!graphFilterPanelOpen) {
          panel.innerHTML = headHtml;
          bindGraphFilterPanelToggle();
          return;
        }
        panel.innerHTML =
          headHtml +
          '<div class="filter-sections">' + renderGraphFocusSection() + (visibleTypes.length ? visibleTypes.map((type) => renderGraphFilterSection(type, counts.get(type) || 0)).join("") : '<div class="filter-value"><span>No filter categories</span><small></small></div>') + '</div>';

        bindGraphFilterPanelToggle();
        document.querySelector("#graphFocusEntity")?.addEventListener("change", (event) => {
          const id = event.target.value || undefined;
          if (!id) {
            clearGraphFocus();
            return;
          }
          focusedNodeId = id;
          if (graphPerspective === "map") setGraphPerspective("focus");
          renderGraphFilterPanel();
          renderGraph();
        });
        document.querySelector("#graphDepth")?.addEventListener("change", (event) => {
          graphDepth = Number(event.target.value) || 0;
          renderGraph();
        });
        document.querySelectorAll("[data-graph-focus]").forEach((button) => {
          button.addEventListener("click", () => setGraphFocusThreshold(button.dataset.graphFocus));
        });
        document.querySelectorAll("[data-relation-quick]").forEach((button) => {
          button.addEventListener("click", () => setGraphRelationQuickMode(button.dataset.relationQuick));
        });
        document.querySelector("#resetGraphFilters").addEventListener("click", () => {
          activeGraphTypes.clear();
          typeOrder.forEach((entry) => activeGraphTypes.add(entry));
          for (const key of Object.keys(graphExcludedValues)) delete graphExcludedValues[key];
          for (const key of Object.keys(graphFilterSearches)) delete graphFilterSearches[key];
          graphPinnedNodeIds.clear();
          graphRelationValueMode = "all";
          graphSelectedRelationTypes = new Set();
          graphRelationQuickMode = "all";
          graphSelectedRelationCategories = new Set(RELATION_CATEGORY_ORDER);
          graphExpandedFilterTypes.clear();
          ["product", "team", "source"].forEach((type) => {
            if (typeOrder.includes(type)) graphExpandedFilterTypes.add(type);
          });
          renderLegend();
          renderGraphFilterPanel();
          renderGraph();
          scheduleGraphFiltersSave();
        });
        document.querySelectorAll("[data-filter-section-row]").forEach((row) => {
          row.addEventListener("click", (event) => {
            if (event.target.closest("[data-filter-type-state]")) return;
            toggleGraphFilterSection(row.dataset.filterSectionRow);
          });
        });
        document.querySelectorAll("[data-filter-section-toggle]").forEach((button) => {
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleGraphFilterSection(button.dataset.filterSectionToggle);
          });
        });
        document.querySelectorAll("[data-filter-type-state]").forEach((button) => {
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            const type = button.dataset.filterTypeState;
            applyGraphFilterAction(graphFilterSectionActive(type) ? "hide-type" : "show-type", type);
          });
        });
        document.querySelectorAll("[data-filter-search]").forEach((input) => {
          input.addEventListener("input", () => {
            const type = input.dataset.filterSearch;
            graphFilterSearches[type] = input.value.trim().toLowerCase();
            renderGraphFilterPanel();
            const field = document.querySelector('[data-filter-search="' + cssEscape(type) + '"]');
            field?.focus();
            field?.setSelectionRange(field.value.length, field.value.length);
          });
        });
        document.querySelectorAll("[data-filter-node]").forEach((input) => {
          input.addEventListener("change", () => {
            toggleGraphValue(input.dataset.filterType, input.dataset.filterNode, input.checked);
          });
        });
        document.querySelectorAll("[data-filter-select-all]").forEach((input) => {
          input.addEventListener("change", () => {
            toggleGraphTypeValues(input.dataset.filterSelectAll, input.checked);
          });
        });
        document.querySelectorAll("[data-relation-category]").forEach((input) => {
          input.addEventListener("change", () => {
            toggleGraphRelationCategory(input.dataset.relationCategory, input.checked);
          });
        });
      }

      function bindGraphFilterPanelToggle() {
        document.querySelector("#graphFilterHead")?.addEventListener("click", (event) => {
          if (event.target.closest("#resetGraphFilters")) return;
          toggleGraphFilterPanel();
        });
        document.querySelector("#collapseGraphFilters")?.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleGraphFilterPanel();
        });
      }

      function toggleGraphFilterPanel() {
        graphFilterPanelOpen = !graphFilterPanelOpen;
        renderGraphFilterPanel();
        scheduleGraphFiltersSave();
      }

      function renderGraphFilterToggle() {
        const button = document.querySelector("#toggleGraphFilters");
        if (!button) return;
        button.classList.toggle("active", graphFilterPanelOpen);
        button.setAttribute("aria-expanded", graphFilterPanelOpen ? "true" : "false");
        button.title = graphFilterPanelOpen ? "Close graph filters" : "Open graph filters";
      }

      function graphFilterWheelTarget(target, deltaY) {
        const candidates = [];
        const nested = target?.closest?.(".filter-values");
        const panel = document.querySelector("#graphFilterPanel");
        if (nested) candidates.push(nested);
        if (panel) candidates.push(panel);
        for (const candidate of candidates) {
          const maxScroll = candidate.scrollHeight - candidate.clientHeight;
          if (maxScroll <= 1) continue;
          if (deltaY < 0 && candidate.scrollTop > 0) return candidate;
          if (deltaY > 0 && candidate.scrollTop < maxScroll) return candidate;
        }
        return candidates.find((candidate) => candidate.scrollHeight - candidate.clientHeight > 1);
      }

      // The Focus controls (focused entity, depth, focus level) are node filters,
      // so they live at the top of the filter panel rather than in the toolbar.
      function renderGraphFocusSection() {
        if (graphPerspective !== "map") ensureFocusedNode(state.graph);
        const nodes = focusSelectableNodes(state.graph);
        const options = ['<option value="">None (overview)</option>'].concat(nodes.slice(0, 400).map((node) =>
          '<option value="' + escapeAttr(node.id) + '"' + (node.id === focusedNodeId ? " selected" : "") + '>' + escapeHtml(compactLabel(node.label, 34)) + '</option>'
        )).join("");
        const depthOptions = [["0", "All levels"], ["1", "1 level"], ["2", "2 levels"], ["3", "3 levels"]].map((entry) =>
          '<option value="' + entry[0] + '"' + (String(graphDepth) === entry[0] ? " selected" : "") + '>' + entry[1] + '</option>'
        ).join("");
        const levels = [["primary", "Primary"], ["supporting", "Supporting"], ["informational", "All"]].map((entry) =>
          '<button type="button" data-graph-focus="' + entry[0] + '"' + (graphFocusThreshold === entry[0] ? ' class="active"' : "") + '>' + entry[1] + '</button>'
        ).join("");
        return '<section class="filter-section focus-section">' +
          '<div class="filter-section-head">' +
          '<button class="filter-section-toggle" type="button"><i class="dot" style="background:var(--accent-soft-border)"></i><span class="filter-section-title">Focus</span><span class="filter-section-count">' + (focusedNodeId ? "on" : "off") + '</span></button>' +
          '</div>' +
          '<div class="filter-section-body">' +
          '<label class="focus-field" title="Entity at the center of the focus perspective"><span>Entity</span><select class="control" id="graphFocusEntity">' + options + '</select></label>' +
          '<label class="focus-field" title="Hierarchy levels kept around the focused entity"><span>Depth</span><select class="control" id="graphDepth">' + depthOptions + '</select></label>' +
          '<div class="focus-field" title="Filter nodes by focus level"><span>Level</span><div class="focus-filter" id="graphFocusFilter">' + levels + '</div></div>' +
          '</div></section>';
      }

      function renderGraphFilterSection(type, count) {
        const values = graphValuesForType(type);
        const excluded = graphExcludedValues[type] || new Set();
        const relationSection = type === RELATION_FILTER_TYPE;
        const search = graphFilterSearches[type] || "";
        const expanded = graphExpandedFilterTypes.has(type);
        const checkedCount = graphCheckedCountForType(type);
        const active = graphFilterSectionActive(type);
        const title = graphFilterSectionTitle(type);
        const filteredValues = values.filter((value) => !search || value.label.toLowerCase().includes(search) || value.id.toLowerCase().includes(search));
        const valueRows = filteredValues.slice(0, 180).map((value) => {
          const checked = relationSection ? graphRelationTypeChecked(value.id) : !excluded.has(value.id);
          return '<label class="filter-value" title="' + escapeAttr(value.label) + '"><input type="checkbox" data-filter-type="' + escapeAttr(type) + '" data-filter-node="' + escapeAttr(value.id) + '"' + (checked ? " checked" : "") + '><span>' + escapeHtml(value.label) + '</span><small>' + escapeHtml(value.provider || "") + '</small></label>';
        }).join("");
        const relationCategoryControls = relationSection ? renderRelationCategoryFilters() : "";
        const preciseFilters =
          '<input class="filter-search" data-filter-search="' + escapeAttr(type) + '" placeholder="Search ' + escapeAttr(title) + '" value="' + escapeAttr(search) + '">' +
          '<div class="filter-values">' +
          (valueRows || '<div class="filter-value"><span>No values</span><small></small></div>') +
          '<label class="filter-value select-all"><input type="checkbox" data-filter-select-all="' + escapeAttr(type) + '"' + (checkedCount === count && active ? " checked" : "") + '><span>Select all</span><small>' + escapeHtml(String(count)) + '</small></label>' +
          '</div>';
        const relationPreciseFilters = relationSection
          ? '<div class="relation-type-box"><div class="relation-type-head"><strong>Precise relation types</strong><small>Check individual predicates such as depends_on, owns, part_of or related_to.</small></div>' + preciseFilters + '</div>'
          : preciseFilters;
        const relationQuickControls = relationSection
          ? '<div class="relation-quick" title="' + escapeAttr(graphRelationQuickDescription()) + '"><span>Preset</span>' +
            [["important", "Important"], ["all", "All"], ["custom", "Custom"]].map((entry) =>
              '<button type="button" data-relation-quick="' + entry[0] + '"' + (graphRelationQuickMode === entry[0] ? ' class="active"' : "") + '>' + entry[1] + '</button>'
            ).join("") +
            '</div>'
          : "";
        const body = expanded
          ? '<div class="filter-section-body">' +
            relationQuickControls +
            relationPreciseFilters +
            relationCategoryControls +
            '</div>'
          : "";
        const emptySection = !relationSection && count === 0;
        return '<section class="filter-section' + (active ? "" : " off") + (emptySection ? " empty" : "") + '">' +
          '<div class="filter-section-head" data-filter-section-row="' + escapeAttr(type) + '" title="' + (expanded ? "Close " : "Open ") + escapeAttr(title) + ' filters">' +
          '<button class="filter-section-toggle" type="button" data-filter-section-toggle="' + escapeAttr(type) + '"><i class="dot" style="background:' + escapeAttr(graphFilterSectionColor(type)) + '"></i><span class="filter-section-title">' + escapeHtml(title) + '</span><span class="filter-section-count">' + escapeHtml(active ? checkedCount + "/" + count : "off") + '</span><span class="filter-section-caret">' + (expanded ? "▲" : "▼") + '</span></button>' +
          '<button class="filter-section-state" type="button" data-filter-type-state="' + escapeAttr(type) + '">' + (active ? "Hide" : "Show") + '</button>' +
          '</div>' +
          body +
          '</section>';
      }

      function renderRelationCategoryFilters() {
        const summaries = relationCategorySummaries();
        const visible = summaries.filter((summary) => summary.edgeCount > 0 || graphSelectedRelationCategories.has(summary.id) || IMPORTANT_RELATION_CATEGORIES.has(summary.id));
        const preset = graphRelationQuickMode === "important"
          ? "Important preset = Structural + Ownership + Dependency"
          : graphRelationQuickMode === "all"
            ? "All relation categories are visible"
            : graphRelationQuickDescription();
        const rows = visible.map((summary) => {
          const checked = graphRelationCategoryChecked(summary.id);
          const typeList = summary.types.length ? summary.types.map((entry) => entry.type + " (" + String(entry.count) + ")").join(", ") : "No relation type in this graph";
          return '<label class="relation-category-option' + (checked ? " active" : "") + '" title="' + escapeAttr(typeList) + '">' +
            '<input type="checkbox" data-relation-category="' + escapeAttr(summary.id) + '"' + (checked ? " checked" : "") + '>' +
            '<span><strong>' + escapeHtml(relationCategoryName(summary.id)) + '</strong><small>' + escapeHtml(String(summary.edgeCount)) + ' links</small><em>' + escapeHtml(typeList) + '</em></span>' +
            '</label>';
        }).join("");
        return '<div class="relation-category-box">' +
          '<div class="relation-category-head"><strong>Relation categories</strong><small>' + escapeHtml(preset) + '</small></div>' +
          '<div class="relation-category-list">' + (rows || '<div class="relation-category-empty">No relations in this graph.</div>') + '</div>' +
          '</div>';
      }

      function graphRelationCategoryChecked(category) {
        if (graphRelationQuickMode === "all") return true;
        if (graphRelationQuickMode === "important") return IMPORTANT_RELATION_CATEGORIES.has(category);
        return graphSelectedRelationCategories.has(category);
      }

      function graphRelationTypeChecked(type) {
        const category = relationCategoryForType(type);
        if (graphRelationQuickMode === "all") return true;
        if (graphRelationQuickMode === "important") return IMPORTANT_RELATION_CATEGORIES.has(category);
        if (!graphSelectedRelationCategories.has(category)) return false;
        return graphRelationValueMode === "selected" ? graphSelectedRelationTypes.has(type) : true;
      }

      function relationCategorySummaries() {
        const summaries = new Map(RELATION_CATEGORY_ORDER.map((category) => [category, { id: category, edgeCount: 0, typeCounts: new Map(), types: [] }]));
        for (const edge of state.graph.edges || []) {
          const edgeCategories = new Set();
          for (const type of edgeRelationTypes(edge)) {
            const category = relationCategoryForType(type);
            if (!summaries.has(category)) summaries.set(category, { id: category, edgeCount: 0, typeCounts: new Map(), types: [] });
            const summary = summaries.get(category);
            summary.typeCounts.set(type, (summary.typeCounts.get(type) || 0) + 1);
            edgeCategories.add(category);
          }
          for (const category of edgeCategories) {
            const summary = summaries.get(category);
            if (summary) summary.edgeCount += 1;
          }
        }
        const ordered = [];
        const pushSummary = (summary) => {
          summary.types = Array.from(summary.typeCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([type, count]) => ({ type, count }));
          ordered.push(summary);
        };
        for (const category of RELATION_CATEGORY_ORDER) {
          const summary = summaries.get(category);
          if (summary) pushSummary(summary);
        }
        for (const [category, summary] of summaries.entries()) {
          if (!RELATION_CATEGORY_ORDER.includes(category)) pushSummary(summary);
        }
        return ordered;
      }

      function toggleGraphFilterSection(type) {
        if (!graphFilterSectionExists(type)) return;
        selectedGraphFilterType = type;
        if (graphExpandedFilterTypes.has(type)) {
          graphExpandedFilterTypes.delete(type);
        } else {
          graphExpandedFilterTypes.add(type);
        }
        renderGraphFilterPanel();
        scheduleGraphFiltersSave();
      }

      function toggleGraphTypeValues(type, checked) {
        type = graphViewTypeForType(type);
        if (!graphFilterSectionExists(type)) return;
        if (type === RELATION_FILTER_TYPE) {
          graphRelationQuickMode = "custom";
          graphSelectedRelationCategories = checked ? new Set(RELATION_CATEGORY_ORDER) : new Set();
          graphRelationValueMode = checked ? "all" : "selected";
          graphSelectedRelationTypes = new Set();
          renderGraphFilterSurfaces();
          return;
        }
        if (checked) {
          delete graphExcludedValues[type];
          delete graphFilterSearches[type];
          activeGraphTypes.add(type);
        } else {
          graphExcludedValues[type] = new Set(graphValuesForType(type).map((value) => value.id));
          activeGraphTypes.add(type);
        }
        renderGraphFilterSurfaces();
      }

      function graphCheckedCountForType(type) {
        const values = graphValuesForType(type);
        if (type === RELATION_FILTER_TYPE) {
          if (graphRelationQuickMode === "all") return values.length;
          if (graphRelationQuickMode === "important") {
            return values.filter((value) => IMPORTANT_RELATION_CATEGORIES.has(relationCategoryForType(value.id))).length;
          }
          const categoryFiltered = values.filter((value) => graphSelectedRelationCategories.has(relationCategoryForType(value.id)));
          return graphRelationValueMode === "selected"
            ? categoryFiltered.filter((value) => graphSelectedRelationTypes.has(value.id)).length
            : categoryFiltered.length;
        }
        const excluded = graphExcludedValues[type];
        return excluded && excluded.size ? values.filter((value) => !excluded.has(value.id)).length : values.length;
      }

      function renderGraphFilterSurfaces() {
        renderLegend();
        renderGraphFilterPanel();
        renderGraphRelationQuickControls();
        renderGraph();
        scheduleGraphFiltersSave();
      }

      function applyGraphFilterAction(action, type) {
        type = graphViewTypeForType(type);
        if (type === RELATION_FILTER_TYPE) {
          graphRelationQuickMode = action === "show-type" || action === "all-values" ? "all" : "custom";
          if (action === "show-type" || action === "all-values") {
            graphRelationValueMode = "all";
            graphSelectedRelationTypes = new Set();
            graphSelectedRelationCategories = new Set(RELATION_CATEGORY_ORDER);
          } else if (action === "hide-type" || action === "no-values") {
            graphRelationValueMode = "selected";
            graphSelectedRelationTypes = new Set();
            graphSelectedRelationCategories = new Set(RELATION_CATEGORY_ORDER);
          }
          renderGraphFilterSurfaces();
          return;
        }
        if (action === "show-type") {
          activeGraphTypes.add(type);
        } else if (action === "hide-type") {
          activeGraphTypes.delete(type);
        } else if (action === "all-values") {
          delete graphExcludedValues[type];
          activeGraphTypes.add(type);
        } else if (action === "no-values") {
          graphExcludedValues[type] = new Set(graphValuesForType(type).map((value) => value.id));
          activeGraphTypes.add(type);
        }
        renderGraphFilterSurfaces();
      }

      function toggleGraphValue(type, nodeId, checked) {
        type = graphViewTypeForType(type);
        if (type === RELATION_FILTER_TYPE) {
          toggleGraphRelationType(nodeId, checked);
          return;
        }
        activeGraphTypes.add(type);
        const excluded = graphExcludedValues[type] || new Set();
        if (checked) {
          excluded.delete(nodeId);
        } else {
          excluded.add(nodeId);
        }
        if (excluded.size) {
          graphExcludedValues[type] = excluded;
        } else {
          delete graphExcludedValues[type];
        }
        renderGraphFilterSurfaces();
      }

      function matchesGraphValueFilter(node) {
        return !graphExcludedValues[graphViewType(node)]?.has(node.id);
      }

      function toggleGraphRelationType(relationType, checked) {
        const values = graphRelationValues();
        const previousMode = graphRelationQuickMode;
        graphRelationQuickMode = "custom";
        graphSelectedRelationCategories = relationCategorySelectionForMode(previousMode);
        if (graphRelationValueMode !== "selected") {
          graphSelectedRelationTypes = new Set(values.map((value) => value.id));
          graphRelationValueMode = "selected";
        }
        if (checked) {
          graphSelectedRelationTypes.add(relationType);
          graphSelectedRelationCategories.add(relationCategoryForType(relationType));
        } else {
          graphSelectedRelationTypes.delete(relationType);
        }
        graphExpandedFilterTypes.add(RELATION_FILTER_TYPE);
        renderGraphFilterSurfaces();
      }

      function toggleGraphRelationCategory(category, checked) {
        if (!RELATION_CATEGORY_ORDER.includes(category)) return;
        const previousMode = graphRelationQuickMode;
        graphRelationQuickMode = "custom";
        graphSelectedRelationCategories = relationCategorySelectionForMode(previousMode);
        if (checked) {
          graphSelectedRelationCategories.add(category);
        } else {
          graphSelectedRelationCategories.delete(category);
        }
        graphExpandedFilterTypes.add(RELATION_FILTER_TYPE);
        renderGraphFilterSurfaces();
      }

      function matchesGraphRelationFilter(edge) {
        if (graphRelationQuickMode === "all") return true;
        if (graphRelationQuickMode === "important") return edgeHasImportantRelation(edge);
        const types = edgeRelationTypes(edge);
        const selectedTypes = types.filter((type) => graphSelectedRelationCategories.has(relationCategoryForType(type)));
        if (!selectedTypes.length) return false;
        if (graphRelationValueMode !== "selected") return true;
        return selectedTypes.some((type) => graphSelectedRelationTypes.has(type));
      }

      function graphTypeCounts() {
        const counts = new Map();
        for (const node of state.graph.nodes || []) {
          const type = graphViewType(node);
          counts.set(type, (counts.get(type) || 0) + 1);
        }
        return counts;
      }

      function graphValuesForType(type) {
        if (type === RELATION_FILTER_TYPE) return graphRelationValues();
        return (state.graph.nodes || [])
          .filter((node) => graphViewType(node) === type)
          .sort((left, right) => left.label.localeCompare(right.label));
      }

      function graphFilterSectionOrder(counts) {
        // Every taxonomy type keeps a section even with no loaded node — hiding
        // empty categories made whole entity kinds look unfilterable. Populated
        // categories come first, empty ones after, both in taxonomy order.
        const populated = typeOrder.filter((type) => (counts.get(type) || 0) > 0 || graphExcludedValues[type]?.size);
        const empty = typeOrder.filter((type) => !populated.includes(type));
        const visible = [...populated, ...empty];
        const relationCount = graphRelationValues().length;
        if (relationCount > 0 || graphRelationValueMode === "selected") {
          visible.push(RELATION_FILTER_TYPE);
        }
        return visible;
      }

      function graphFilterSectionExists(type) {
        return type === RELATION_FILTER_TYPE || typeOrder.includes(type);
      }

      function graphFilterSectionActive(type) {
        return type === RELATION_FILTER_TYPE ? graphCheckedCountForType(type) > 0 : activeGraphTypes.has(type);
      }

      function graphFilterSectionTitle(type) {
        if (type === RELATION_FILTER_TYPE) return "Relation types";
        return typeLabel(type);
      }

      function graphFilterSectionColor(type) {
        return type === RELATION_FILTER_TYPE ? "var(--edge-default)" : colors[type] || "var(--muted)";
      }

      function graphRelationValues() {
        const counts = new Map();
        for (const edge of state.graph.edges || []) {
          const type = graphRelationType(edge);
          counts.set(type, (counts.get(type) || 0) + 1);
        }
        return Array.from(counts.entries())
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([type, count]) => ({ id: type, label: type, provider: relationCategoryLabel(type) + " · " + String(count) }));
      }

      // Accepts both the current shape ({ excludedValues }) and the legacy
      // inclusion shape ({ valueMode, selectedValues }); legacy selections are
      // converted to exclusions against the values currently in the graph, so
      // entities created after the filter was saved stay visible.
      function normalizedExcludedValues(saved) {
        const result = {};
        if (!saved || typeof saved !== "object") return result;
        if (saved.excludedValues && typeof saved.excludedValues === "object") {
          for (const [rawType, ids] of Object.entries(saved.excludedValues)) {
            const type = graphViewTypeForType(rawType);
            if (!typeOrder.includes(type) || !Array.isArray(ids) || !ids.length) continue;
            result[type] = (result[type] || []).concat(ids.map((id) => String(id)));
          }
          return result;
        }
        const valueMode = saved.valueMode || {};
        const selectedValues = saved.selectedValues || {};
        for (const type of typeOrder) {
          const legacyTypes = rawTypeOrder.filter((rawType) => graphViewTypeForType(rawType) === type);
          if (valueMode[type] !== "selected" && !legacyTypes.some((rawType) => valueMode[rawType] === "selected")) continue;
          const legacySelected = new Set(legacyTypes.flatMap((rawType) => Array.isArray(selectedValues[rawType]) ? selectedValues[rawType] : []));
          (Array.isArray(selectedValues[type]) ? selectedValues[type] : []).forEach((id) => legacySelected.add(id));
          const excluded = graphValuesForType(type).map((value) => value.id).filter((id) => !legacySelected.has(id));
          if (excluded.length) result[type] = excluded;
        }
        return result;
      }

      function hydrateGraphFilters(saved, options = {}) {
        if (options.preserveLocal) {
          return;
        }
        if (!saved || typeof saved !== "object") {
          return;
        }
        // Deterministic reset: a field absent from the saved payload falls back to its
        // default rather than keeping the value from a previously applied view. Otherwise
        // switching views leaks stale focus/group/layout/level settings (an empty
        // activeTypes array is respected — it means "all types deselected").
        activeGraphTypes.clear();
        for (const type of Array.isArray(saved.activeTypes) ? saved.activeTypes : typeOrder) {
          const viewType = graphViewTypeForType(type);
          if (typeOrder.includes(viewType)) activeGraphTypes.add(viewType);
        }
        const savedSelectedType = graphViewTypeForType(saved.selectedType);
        if (savedSelectedType && graphFilterSectionExists(savedSelectedType)) {
          selectedGraphFilterType = savedSelectedType;
        }
        if (typeof saved.panelOpen === "boolean") {
          graphFilterPanelOpen = saved.panelOpen;
        }
        if (Array.isArray(saved.expandedTypes)) {
          graphExpandedFilterTypes.clear();
          for (const type of saved.expandedTypes) {
            const viewType = graphViewTypeForType(type);
            if (graphFilterSectionExists(viewType)) graphExpandedFilterTypes.add(viewType);
          }
        }
        for (const key of Object.keys(graphExcludedValues)) delete graphExcludedValues[key];
        const excludedValues = normalizedExcludedValues(saved);
        for (const [type, ids] of Object.entries(excludedValues)) {
          if (ids.length) graphExcludedValues[type] = new Set(ids);
        }
        graphHiddenMode = saved.hiddenMode === "fade" ? "fade" : "hide";
        document.querySelectorAll("[data-hidden-mode]").forEach((button) => {
          button.classList.toggle("active", button.dataset.hiddenMode === graphHiddenMode);
        });
        graphPinnedNodeIds = new Set(Array.isArray(saved.pinnedNodes) ? saved.pinnedNodes.map((id) => String(id)) : []);
        graphRelationValueMode = saved.relationValueMode === "selected" ? "selected" : "all";
        graphSelectedRelationTypes = new Set(Array.isArray(saved.selectedRelationTypes) ? saved.selectedRelationTypes : []);
        graphSelectedRelationCategories = new Set(
          Array.isArray(saved.selectedRelationCategories)
            ? saved.selectedRelationCategories.filter((category) => RELATION_CATEGORY_ORDER.includes(category))
            : RELATION_CATEGORY_ORDER
        );
        // Set-or-default (never leave a previous view's value in place).
        graphFocusThreshold = FOCUS_LEVEL_ORDER.includes(saved.focusThreshold) ? saved.focusThreshold : "informational";
        graphGroupMode = ["none", "auto", "by_type"].includes(saved.groupMode) ? saved.groupMode : "none";
        graphLayoutMode = ["force", "hierarchy", "circle", "grid"].includes(saved.layoutMode) ? saved.layoutMode : "force";
        graphRelationQuickMode = ["important", "all", "custom"].includes(saved.relationQuickMode) ? saved.relationQuickMode : "all";
        // activeGraphViewId is not part of a view's own payload; only adopt it when present.
        if (typeof saved.activeGraphViewId === "string" && saved.activeGraphViewId) {
          activeGraphViewId = saved.activeGraphViewId;
        }
        graphExpandedTypeGroups.clear();
        for (const key of Array.isArray(saved.expandedTypeGroups) ? saved.expandedTypeGroups : []) {
          if (String(key).startsWith("type:")) graphExpandedTypeGroups.add(String(key));
        }
        graphCollapsedTypeGroups.clear();
        for (const key of Array.isArray(saved.collapsedTypeGroups) ? saved.collapsedTypeGroups : []) {
          if (String(key).startsWith("type:")) graphCollapsedTypeGroups.add(String(key));
        }
      }

      function serializeGraphFilters() {
        const excludedValues = {};
        for (const [type, values] of Object.entries(graphExcludedValues)) {
          if (values.size) excludedValues[type] = Array.from(values);
        }
        return {
          activeTypes: Array.from(activeGraphTypes),
          excludedValues,
          hiddenMode: graphHiddenMode,
          pinnedNodes: Array.from(graphPinnedNodeIds),
          relationValueMode: graphRelationValueMode,
          selectedRelationTypes: Array.from(graphSelectedRelationTypes),
          selectedRelationCategories: Array.from(graphSelectedRelationCategories),
          focusThreshold: graphFocusThreshold,
          groupMode: graphGroupMode,
          layoutMode: graphLayoutMode,
          activeGraphViewId: activeGraphViewId,
          relationQuickMode: graphRelationQuickMode,
          expandedTypeGroups: Array.from(graphExpandedTypeGroups),
          collapsedTypeGroups: Array.from(graphCollapsedTypeGroups),
          selectedType: selectedGraphFilterType,
          panelOpen: graphFilterPanelOpen,
          expandedTypes: Array.from(graphExpandedFilterTypes)
        };
      }

      function scheduleGraphFiltersSave() {
        window.clearTimeout(graphFilterSaveTimer);
        graphFilterSaveTimer = window.setTimeout(() => {
          vscode?.postMessage({ type: "saveGraphFilters", payload: serializeGraphFilters() });
        }, 350);
      }

      function activeGraphView() {
        return graphViews.find((view) => view.id === activeGraphViewId);
      }

      // Context view identity and revision are persistence metadata. They change
      // after every successful save and must not make an otherwise identical
      // local draft look dirty forever.
      function comparableGraphViewContext(value) {
        if (!value || typeof value !== "object") return undefined;
        const comparable = normalizeContextScopeDraft(value);
        delete comparable.viewId;
        delete comparable.viewVersion;
        delete comparable.updatedAt;
        return comparable;
      }

      // A saved view is the full visual state minus camera and panel chrome.
      function serializeGraphView() {
        const filters = serializeGraphFilters();
        delete filters.panelOpen;
        delete filters.selectedType;
        delete filters.expandedTypes;
        delete filters.activeGraphViewId;
        return {
          filters,
          perspective: graphPerspective,
          depth: graphDepth,
          selfLinks: selfLinksMode,
          focusedNodeId: focusedNodeId || undefined,
          textFilter: (document.querySelector("#filter")?.value || "").trim(),
          context: comparableGraphViewContext(contextScopeDraft)
        };
      }

      function applyGraphView(view) {
        const payload = view?.payload || {};
        hydrateGraphFilters(payload.filters || {});
        setGraphPerspective(payload.perspective || "map");
        graphDepth = Number(payload.depth) || 0;
        selfLinksMode = payload.selfLinks === "fade" || payload.selfLinks === "hide" ? payload.selfLinks : "show";
        document.querySelectorAll("[data-self-links]").forEach((button) => button.classList.toggle("active", button.dataset.selfLinks === selfLinksMode));
        focusedNodeId = payload.focusedNodeId || undefined;
        const filterInput = document.querySelector("#filter");
        if (filterInput) filterInput.value = payload.textFilter || "";
        const savedContext = view?.context || payload.context;
        if (savedContext) {
          contextScopeDraft = normalizeContextScopeDraft(savedContext);
          contextScopeDraftDirty = false;
          contextScopeActivated = Boolean(state.contextScope?.scope?.viewId === view.id && state.contextScope?.scope?.viewVersion === view.version);
          contextScopeCounts = { entities: 0, captures: 0, sources: 0 };
          contextScopePreviewDetails = undefined;
          contextPackHistory = [];
          selectedContextPack = undefined;
          contextPackOutdated = false;
          renderContextScopePanel();
          previewContextScopeDraft();
          if (graphSelectionMode === "context") requestContextPackHistory();
        }
        renderFocusSelector();
        renderGraphFilterPanel();
        renderGraphFocusFilter();
        renderGraphGroupControls();
        renderGraphRelationQuickControls();
        renderGraph();
      }

      // Stable stringify for dirty-compare: object keys sorted, string arrays
      // treated as sets (their order carries no meaning in filter payloads).
      function stableGraphViewString(value) {
        if (Array.isArray(value)) {
          const items = value.map(stableGraphViewString);
          if (value.every((item) => typeof item === "string")) items.sort();
          return "[" + items.join(",") + "]";
        }
        if (value && typeof value === "object") {
          return "{" + Object.keys(value).filter((key) => key !== "updatedAt").sort().map((key) => {
            const item = value[key];
            if (item === undefined) return "";
            return JSON.stringify(key) + ":" + stableGraphViewString(item);
          }).filter(Boolean).join(",") + "}";
        }
        return JSON.stringify(value === undefined ? null : value);
      }

      // Views saved before the exclusion model carry inclusion lists; compare
      // them through the same normalization used by hydrate so applying an old
      // view does not immediately read as dirty.
      function normalizedGraphViewPayload(payload) {
        const filters = payload && typeof payload.filters === "object" && payload.filters ? { ...payload.filters } : {};
        const excludedValues = normalizedExcludedValues(filters);
        delete filters.valueMode;
        delete filters.selectedValues;
        filters.excludedValues = excludedValues;
        if (filters.hiddenMode !== "fade") filters.hiddenMode = "hide";
        if (!Array.isArray(filters.pinnedNodes)) filters.pinnedNodes = [];
        return { ...payload, filters, context: comparableGraphViewContext(payload?.context) };
      }

      function graphViewIsDirty() {
        const view = activeGraphView();
        if (!view) return false;
        return stableGraphViewString(serializeGraphView()) !== stableGraphViewString(normalizedGraphViewPayload({ ...(view.payload || {}), context: view.context }));
      }

      function graphViewVisualIsDirty() {
        const view = activeGraphView();
        if (!view) return false;
        const current = serializeGraphView();
        const saved = normalizedGraphViewPayload({ ...(view.payload || {}), context: view.context });
        delete current.context;
        delete saved.context;
        return stableGraphViewString(current) !== stableGraphViewString(saved);
      }

      function renderGraphViewControls() {
        const select = document.querySelector("#graphViewPreset");
        if (!select) return;
        if (activeGraphViewId && !graphViews.some((view) => view.id === activeGraphViewId)) {
          activeGraphViewId = undefined;
        }
        const dirty = graphViewIsDirty();
        let html = '<option value="">View: none</option>';
        for (const view of graphViews) {
          const isActive = view.id === activeGraphViewId;
          html += '<option value="' + escapeAttr(view.id) + '"' + (isActive ? " selected" : "") + '>View: ' + escapeHtml(view.name) + (isActive && dirty ? " ●" : "") + '</option>';
        }
        select.innerHTML = html;
        select.value = activeGraphViewId || "";
        select.classList.toggle("dirty", dirty);
        select.title = dirty
          ? "Filters differ from this saved view — ✓ updates it, ＋ saves them as a new view"
          : "Saved graph views — presets of every graph filter for a task or topic";
        const updateBtn = document.querySelector("#graphViewUpdate");
        if (updateBtn) updateBtn.style.display = activeGraphViewId && dirty ? "" : "none";
        const renameBtn = document.querySelector("#graphViewRename");
        if (renameBtn) renameBtn.style.display = activeGraphViewId ? "" : "none";
        const duplicateBtn = document.querySelector("#graphViewDuplicate");
        if (duplicateBtn) duplicateBtn.style.display = activeGraphViewId ? "" : "none";
        const compareBtn = document.querySelector("#graphViewCompare");
        if (compareBtn) compareBtn.style.display = activeGraphViewId && graphViews.length > 1 ? "" : "none";
        const deleteBtn = document.querySelector("#graphViewDelete");
        if (deleteBtn) deleteBtn.style.display = activeGraphViewId ? "" : "none";
      }

      function parseEntityRefString(ref) {
        const index = String(ref || "").indexOf(":");
        if (index <= 0) return undefined;
        return { kind: ref.slice(0, index), id: ref.slice(index + 1) };
      }

      function refLabel(ref) {
        const node = (state.graph?.nodes || []).find((candidate) => entityRefForNode(candidate) === ref);
        return node?.label || ref;
      }

      function initContextScopeFromState() {
        const stored = state.contextScope && state.contextScope.scope ? state.contextScope.scope : undefined;
        contextScopeDraft = normalizeContextScopeDraft(stored || {});
        contextScopeCounts = state.contextScope && state.contextScope.counts ? state.contextScope.counts : { entities: 0, captures: 0, sources: 0 };
        contextScopePreviewDetails = state.contextScope || undefined;
        contextScopeActivated = Boolean(stored && Array.isArray(stored.selectedEntities) && stored.selectedEntities.length > 0);
        contextScopeDraftDirty = false;
      }

      function normalizeContextScopeDraft(value) {
        const source = value && typeof value === "object" ? value : {};
        const byRef = new Map();
        for (const selection of Array.isArray(source.nodeSelections) ? source.nodeSelections : []) {
          const entity = selection?.entity;
          if (!entity?.kind || !entity.id) continue;
          const role = ["pinned", "included", "proposed", "exploratory", "excluded"].includes(selection.role) ? selection.role : "included";
          byRef.set(entity.kind + ":" + entity.id, { ...selection, entity: { kind: entity.kind, id: entity.id }, role });
        }
        for (const entity of Array.isArray(source.selectedEntities) ? source.selectedEntities : []) {
          if (!entity?.kind || !entity.id) continue;
          const ref = entity.kind + ":" + entity.id;
          if (!byRef.has(ref)) byRef.set(ref, { entity: { kind: entity.kind, id: entity.id }, role: "included" });
        }
        for (const entity of Array.isArray(source.excludedEntities) ? source.excludedEntities : []) {
          if (!entity?.kind || !entity.id) continue;
          const ref = entity.kind + ":" + entity.id;
          const existing = byRef.get(ref) || { entity: { kind: entity.kind, id: entity.id } };
          byRef.set(ref, { ...existing, role: "excluded" });
        }
        const draft = {
          ...source,
          depth: Number.isFinite(Number(source.depth)) ? Math.max(0, Math.min(3, Number(source.depth))) : 1,
          mode: ["strict", "guided", "disabled"].includes(source.mode) ? source.mode : "guided",
          includedTypes: Array.isArray(source.includedTypes) ? source.includedTypes.slice() : undefined,
          nodeSelections: Array.from(byRef.values()),
          allowedRelationTypes: Array.isArray(source.allowedRelationTypes) ? source.allowedRelationTypes.slice() : undefined,
          validationStatuses: Array.isArray(source.validationStatuses) ? source.validationStatuses.slice() : undefined,
          entityStatuses: Array.isArray(source.entityStatuses) ? source.entityStatuses.slice() : undefined,
          sourceStatuses: Array.isArray(source.sourceStatuses) ? source.sourceStatuses.slice() : undefined,
          observationValidationStatuses: Array.isArray(source.observationValidationStatuses) ? source.observationValidationStatuses.slice() : undefined,
          observationEvidenceStatuses: Array.isArray(source.observationEvidenceStatuses) ? source.observationEvidenceStatuses.slice() : undefined,
          observationMeasurement: ["any", "measured", "unmeasured"].includes(source.observationMeasurement)
            ? source.observationMeasurement
            : (Array.isArray(source.observationEvidenceStatuses) && source.observationEvidenceStatuses.includes("measured") ? "measured" : "any"),
          sourceAccess: ["none", "metadata", "snippets", "full"].includes(source.sourceAccess) ? source.sourceAccess : "full",
          refreshPolicy: ["frozen", "monitored", "dynamic"].includes(source.refreshPolicy) ? source.refreshPolicy : "monitored",
          tokenBudget: contextTokenBudgetOrDefault(source.tokenBudget)
        };
        syncContextScopeDraft(draft);
        return draft;
      }

      function syncContextScopeDraft(draft = contextScopeDraft) {
        if (!draft) return;
        const activeRoles = new Set(["pinned", "included", "exploratory"]);
        draft.selectedEntities = (draft.nodeSelections || []).filter((selection) => activeRoles.has(selection.role)).map((selection) => selection.entity);
        const excluded = (draft.nodeSelections || []).filter((selection) => selection.role === "excluded").map((selection) => selection.entity);
        draft.excludedEntities = excluded.length ? excluded : undefined;
      }

      function contextScopeSelection(ref) {
        return (contextScopeDraft?.nodeSelections || []).find((selection) => selection.entity.kind + ":" + selection.entity.id === ref);
      }

      function markContextDraftChanged() {
        contextScopeActivated = false;
        contextScopeDraftDirty = true;
        contextPackOutdated = Boolean(selectedContextPack);
      }

      function contextScopeToggleRef(ref) {
        const parsed = parseEntityRefString(ref);
        if (!parsed || !contextScopeDraft) return;
        const existing = contextScopeSelection(ref);
        if (existing) {
          contextScopeDraft.nodeSelections = contextScopeDraft.nodeSelections.filter((selection) => selection !== existing);
        } else {
          contextScopeDraft.nodeSelections.push({ entity: parsed, role: "included" });
        }
        syncContextScopeDraft();
        markContextDraftChanged();
        renderContextScopePanel();
        updateGraphIsolateControls();
        renderGraph();
        previewContextScopeDraft();
      }

      function addRefsToContextScope(refs) {
        if (!contextScopeDraft) return;
        const known = new Set(contextScopeDraft.nodeSelections.map((entry) => entry.entity.kind + ":" + entry.entity.id));
        for (const ref of refs || []) {
          const parsed = parseEntityRefString(ref);
          if (!parsed) continue;
          const key = parsed.kind + ":" + parsed.id;
          if (known.has(key)) continue;
          known.add(key);
          contextScopeDraft.nodeSelections.push({ entity: parsed, role: "included" });
        }
        syncContextScopeDraft();
        markContextDraftChanged();
        renderContextScopePanel();
        updateGraphIsolateControls();
        renderGraph();
        previewContextScopeDraft();
      }

      function seedContextScopeFromView() {
        const seen = new Set();
        const selected = [];
        const types = new Set();
        const previousSelections = new Map((contextScopeDraft?.nodeSelections || []).map((selection) => [selection.entity.kind + ":" + selection.entity.id, selection]));
        const filter = (document.querySelector("#filter")?.value || "").trim().toLowerCase();
        const visibleNodes = computeGraphVisibility(state.graph || { nodes: [], edges: [] }, filter).nodes || [];
        for (const node of visibleNodes) {
          const ref = entityRefForNode(node);
          if (!ref || seen.has(ref)) continue;
          const parsed = parseEntityRefString(ref);
          if (!parsed) continue;
          seen.add(ref);
          selected.push(parsed);
          types.add(parsed.kind);
        }
        contextScopeDraft = normalizeContextScopeDraft({
          ...(contextScopeDraft || {}),
          selectedEntities: selected,
          nodeSelections: selected.map((entity) => {
            const previous = previousSelections.get(entity.kind + ":" + entity.id);
            return previous ? { ...previous, entity } : { entity, role: "included" };
          }),
          depth: 0,
          mode: (contextScopeDraft && contextScopeDraft.mode) || "guided",
          includedTypes: types.size > 0 ? Array.from(types) : undefined,
          sourceAccess: contextScopeDraft?.sourceAccess || "full",
          refreshPolicy: contextScopeDraft?.refreshPolicy || "monitored",
          tokenBudget: contextScopeDraft?.tokenBudget || defaultContextTokenBudget
        });
        markContextDraftChanged();
        renderContextScopePanel();
        updateGraphIsolateControls();
        renderGraph();
        previewContextScopeDraft();
      }

      function contextScopeSetRole(ref, role) {
        const parsed = parseEntityRefString(ref);
        if (!parsed || !contextScopeDraft || !["pinned", "included", "proposed", "exploratory", "excluded"].includes(role)) return;
        const existing = contextScopeSelection(ref);
        if (existing) existing.role = role;
        else contextScopeDraft.nodeSelections.push({ entity: parsed, role });
        syncContextScopeDraft();
        markContextDraftChanged();
        renderContextScopePanel();
        updateGraphIsolateControls();
        renderGraph();
        previewContextScopeDraft();
      }

      function contextScopeSetMode(mode) {
        if (!contextScopeDraft) return;
        contextScopeDraft.mode = mode;
        markContextDraftChanged();
        renderContextScopePanel();
        updateGraphIsolateControls();
        renderGraph();
        previewContextScopeDraft();
      }

      function contextScopeChangeDepth(delta) {
        if (!contextScopeDraft) return;
        contextScopeDraft.depth = Math.max(0, Math.min(3, (Number(contextScopeDraft.depth) || 0) + delta));
        markContextDraftChanged();
        renderContextScopePanel();
        previewContextScopeDraft();
      }

      function previewContextScopeDraft() {
        if (!contextScopeDraft || contextScopeDraft.selectedEntities.length === 0) {
          contextScopeCounts = { entities: 0, captures: 0, sources: 0 };
          renderContextScopeCounts();
          return;
        }
        window.clearTimeout(contextScopePreviewTimer);
        contextScopePreviewTimer = window.setTimeout(() => {
          vscode?.postMessage({ type: "previewContextScope", scope: contextScopeDraft });
        }, 250);
      }

      function activateContextScope() {
        if (!contextScopeDraft || contextScopeDraft.selectedEntities.length === 0) return;
        vscode?.postMessage({ type: "setContextScope", scope: contextScopeDraft });
      }

      function clearContextScope() {
        vscode?.postMessage({ type: "clearContextScope" });
      }

      function contextScopeCountsHtml() {
        const counts = contextScopeCounts || { entities: 0, captures: 0, sources: 0 };
        return '<div class="metric"><span>Entities</span><strong>' + (counts.entities || 0) + '</strong></div>'
          + '<div class="metric"><span>Captures</span><strong>' + (counts.captures || 0) + '</strong></div>'
          + '<div class="metric"><span>Sources</span><strong>' + (counts.sources || 0) + '</strong></div>'
          + '<div class="metric"><span>Observations</span><strong>' + (counts.observations || 0) + '</strong></div>'
          + '<div class="metric"><span>Packages</span><strong>' + (counts.curationPackages || 0) + '</strong></div>'
          + '<div class="metric"><span>Tasks</span><strong>' + (counts.tasks || 0) + '</strong></div>'
          + '<div class="metric"><span>Inbox</span><strong>' + (counts.inbox || 0) + '</strong></div>';
      }

      function renderContextScopeCounts() {
        const counts = document.querySelector("#contextScopeCounts");
        if (counts) counts.innerHTML = contextScopeCountsHtml();
        const status = document.querySelector("#contextScopeStatus");
        if (status) {
          const count = (contextScopeDraft && contextScopeDraft.selectedEntities.length) || 0;
          status.textContent = count === 0 ? "off" : (contextScopeActivated ? "active" : "draft");
        }
        updateGraphIsolateControls();
      }

      function renderContextScopePanel() {
        renderGraphContextPanel();
        const body = document.querySelector("#contextScopeBody");
        if (!body || !contextScopeDraft) return;
        const draft = contextScopeDraft;
        const count = draft.selectedEntities.length;
        const modeBtn = (mode) => '<button type="button" data-cs-mode="' + mode + '" style="height:26px;padding:0 9px;border:1px solid var(--border);border-radius:6px;font-size:11px;' + (draft.mode === mode ? "background:var(--active-bg);color:var(--active-fg);" : "background:transparent;color:var(--muted);") + '">' + mode + '</button>';
        const selections = (draft.nodeSelections || []).slice().sort((left, right) => left.role.localeCompare(right.role) || refLabel(left.entity.kind + ":" + left.entity.id).localeCompare(refLabel(right.entity.kind + ":" + right.entity.id)));
        const roleOptions = (selected) => ["pinned", "included", "proposed", "exploratory", "excluded"].map((role) => '<option value="' + role + '"' + (role === selected ? " selected" : "") + '>' + role + '</option>').join("");
        const chips = selections.length === 0
          ? '<p class="summary" style="color:var(--muted);font-size:12px;margin:0;">No entities yet. Use "Base on current view", or pick nodes in Context mode.</p>'
          : selections.map((selection) => {
              const ref = selection.entity.kind + ":" + selection.entity.id;
              const detail = [selection.reason, Number.isFinite(selection.confidence) ? Math.round(selection.confidence * 100) + "%" : "", Number.isFinite(selection.estimatedTokens) ? "~" + selection.estimatedTokens + " tok" : ""].filter(Boolean).join(" · ");
              return '<div style="display:grid;grid-template-columns:minmax(0,1fr) 92px 22px;gap:5px;align-items:center;width:100%;padding:5px;border:1px solid var(--border);border-radius:7px;">'
                + '<div style="min-width:0;"><div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(refLabel(ref)) + '</div>' + (detail ? '<div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(detail) + '</div>' : "") + '</div>'
                + '<select data-cs-role="' + escapeAttr(ref) + '" style="height:24px;border:1px solid var(--border);border-radius:5px;background:var(--surface-2);color:inherit;font-size:10px;">' + roleOptions(selection.role) + '</select>'
                + '<button type="button" data-cs-remove="' + escapeAttr(ref) + '" title="Remove" style="border:0;background:transparent;color:var(--muted);">×</button></div>';
            }).join("");
        const actionStyle = "height:30px;padding:0 11px;border:1px solid var(--border);border-radius:7px;background:var(--surface-2);color:inherit;font-size:12px;";
        const primaryStyle = "height:30px;padding:0 11px;border:1px solid var(--border-strong);border-radius:7px;background:var(--active-bg);color:var(--active-fg);font-size:12px;";
        const inputStyle = "height:28px;width:100%;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:inherit;padding:0 7px;font-size:11px;";
        const preview = contextScopePreviewDetails || {};
        const estimated = Number(preview.estimatedTokens || 0);
        const budget = Number(preview.budget || draft.tokenBudget || defaultContextTokenBudget);
        const previewLine = 'Included ' + (preview.included?.length || count) + ' · proposed ' + (preview.proposed?.length || selections.filter((item) => item.role === "proposed").length) + ' · excluded ' + (preview.excluded?.length || selections.filter((item) => item.role === "excluded").length) + ' · stale ' + (preview.stale?.length || 0) + ' · out ' + (preview.outOfScope?.length || 0);
        body.innerHTML =
          '<div style="display:flex;gap:6px;margin-bottom:10px;">' + ["strict", "guided", "disabled"].map(modeBtn).join("") + '</div>'
          + '<div style="margin-bottom:10px;"><button type="button" id="contextScopeSeed" style="' + actionStyle + '">Base on current view</button></div>'
          + '<div style="color:var(--muted);font-size:11px;text-transform:uppercase;margin-bottom:6px;">Context roles (' + selections.length + ')</div>'
          + '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px;">' + chips + '</div>'
          + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:13px;"><span style="color:var(--muted);">Depth</span><button type="button" data-cs-depth="-1" style="width:24px;height:24px;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit;">−</button><strong>' + (draft.depth || 0) + '</strong><button type="button" data-cs-depth="1" style="width:24px;height:24px;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit;">+</button><span style="color:var(--muted);font-size:11px;">graph neighbors</span></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px;">'
          + '<label style="font-size:10px;color:var(--muted);">Source access<select id="contextSourceAccess" style="' + inputStyle + '">' + ["none", "metadata", "snippets", "full"].map((value) => '<option value="' + value + '"' + (draft.sourceAccess === value ? " selected" : "") + '>' + value + '</option>').join("") + '</select></label>'
          + '<label style="font-size:10px;color:var(--muted);">Refresh policy<select id="contextRefreshPolicy" style="' + inputStyle + '">' + ["frozen", "monitored", "dynamic"].map((value) => '<option value="' + value + '"' + (draft.refreshPolicy === value ? " selected" : "") + '>' + value + '</option>').join("") + '</select></label>'
          + '<label style="font-size:10px;color:var(--muted);">From<input id="contextTimeFrom" type="date" value="' + escapeAttr(draft.timeRange?.from?.slice(0, 10) || "") + '" style="' + inputStyle + '"></label>'
          + '<label style="font-size:10px;color:var(--muted);">To<input id="contextTimeTo" type="date" value="' + escapeAttr(draft.timeRange?.to?.slice(0, 10) || "") + '" style="' + inputStyle + '"></label>'
          + '<label style="font-size:10px;color:var(--muted);grid-column:1/-1;">Token budget<input id="contextTokenBudget" type="number" min="1" value="' + escapeAttr(draft.tokenBudget || defaultContextTokenBudget) + '" style="' + inputStyle + '"></label>'
          + '<label style="font-size:10px;color:var(--muted);grid-column:1/-1;">Allowed relations<input id="contextAllowedRelations" value="' + escapeAttr((draft.allowedRelationTypes || []).join(", ")) + '" placeholder="all relation types" style="' + inputStyle + '"></label>'
          + '<label style="font-size:10px;color:var(--muted);grid-column:1/-1;">Observation validation<input id="contextObservationValidationStatuses" value="' + escapeAttr((draft.observationValidationStatuses || draft.validationStatuses || []).join(", ")) + '" placeholder="accepted, proposed" style="' + inputStyle + '"></label>'
          + '<label style="font-size:10px;color:var(--muted);">Evidence status<input id="contextObservationEvidenceStatuses" value="' + escapeAttr((draft.observationEvidenceStatuses || []).filter((value) => value !== "measured").join(", ")) + '" placeholder="standalone, corroborated, contradicted" style="' + inputStyle + '"></label>'
          + '<label style="font-size:10px;color:var(--muted);">Measurement<select id="contextObservationMeasurement" style="' + inputStyle + '">' + ["any", "measured", "unmeasured"].map((value) => '<option value="' + value + '"' + (draft.observationMeasurement === value ? ' selected' : '') + '>' + value + '</option>').join("") + '</select></label>'
          + '</div>'
          + '<div class="metrics" id="contextScopeCounts" style="grid-template-columns:repeat(auto-fit,minmax(72px,1fr));margin-bottom:8px;">' + contextScopeCountsHtml() + '</div>'
          + '<div style="font-size:11px;color:' + (estimated > budget ? "var(--danger)" : "var(--muted)") + ';margin-bottom:5px;">~' + estimated + ' / ' + budget + ' tokens</div>'
          + '<div style="font-size:10px;color:var(--muted);margin-bottom:12px;">' + escapeHtml(previewLine) + '</div>'
          + '<div style="display:flex;gap:8px;"><button type="button" id="contextScopeActivate" style="' + primaryStyle + (count === 0 ? "opacity:0.5;" : "") + '"' + (count === 0 ? " disabled" : "") + '>Use as agent context</button><button type="button" id="contextScopeClear" style="' + actionStyle + '">Clear</button></div>'
          + '<div style="margin-top:10px;color:var(--muted);font-size:11px;">Agent searches are limited to this scope while active.</div>';
        body.querySelectorAll("[data-cs-mode]").forEach((button) => button.addEventListener("click", () => contextScopeSetMode(button.dataset.csMode)));
        body.querySelectorAll("[data-cs-depth]").forEach((button) => button.addEventListener("click", () => contextScopeChangeDepth(Number(button.dataset.csDepth))));
        body.querySelectorAll("[data-cs-remove]").forEach((button) => button.addEventListener("click", () => contextScopeToggleRef(button.dataset.csRemove)));
        body.querySelectorAll("[data-cs-role]").forEach((select) => select.addEventListener("change", () => contextScopeSetRole(select.dataset.csRole, select.value)));
        body.querySelector("#contextSourceAccess")?.addEventListener("change", (event) => contextScopeUpdatePolicy("sourceAccess", event.target.value));
        body.querySelector("#contextRefreshPolicy")?.addEventListener("change", (event) => contextScopeUpdatePolicy("refreshPolicy", event.target.value));
        body.querySelector("#contextTimeFrom")?.addEventListener("change", (event) => contextScopeUpdateTimeRange("from", event.target.value));
        body.querySelector("#contextTimeTo")?.addEventListener("change", (event) => contextScopeUpdateTimeRange("to", event.target.value));
        body.querySelector("#contextTokenBudget")?.addEventListener("change", (event) => contextScopeUpdatePolicy("tokenBudget", Math.max(1, Number(event.target.value) || defaultContextTokenBudget)));
        body.querySelector("#contextAllowedRelations")?.addEventListener("change", (event) => contextScopeUpdatePolicy("allowedRelationTypes", commaValues(event.target.value)));
        body.querySelector("#contextObservationValidationStatuses")?.addEventListener("change", (event) => contextScopeUpdatePolicy("observationValidationStatuses", commaValues(event.target.value)));
        body.querySelector("#contextObservationEvidenceStatuses")?.addEventListener("change", (event) => contextScopeUpdatePolicy("observationEvidenceStatuses", commaValues(event.target.value)));
        body.querySelector("#contextObservationMeasurement")?.addEventListener("change", (event) => contextScopeUpdatePolicy("observationMeasurement", event.target.value));
        body.querySelector("#contextScopeSeed")?.addEventListener("click", seedContextScopeFromView);
        body.querySelector("#contextScopeActivate")?.addEventListener("click", activateContextScope);
        body.querySelector("#contextScopeClear")?.addEventListener("click", clearContextScope);
        renderContextScopeCounts();
      }

      function renderGraphContextPanel() {
        const panel = document.querySelector("#graphContextPanel");
        const contextButton = document.querySelector('[data-graph-select="context"]');
        const activeCount = contextScopeDraft?.selectedEntities?.length || 0;
        if (contextButton) contextButton.textContent = activeCount > 0 ? "Context · " + activeCount : "Context";
        if (!panel) return;
        const visible = graphSelectionMode === "context" && !contextPanelDismissed;
        panel.hidden = !visible;
        if (!visible || !contextScopeDraft) return;

        const draft = contextScopeDraft;
        const savedView = activeGraphView();
        const viewDirty = Boolean(savedView && graphViewIsDirty());
        const status = activeCount === 0 ? "off" : (contextScopeActivated && !viewDirty ? "active" : "draft");
        const statusLabel = contextActivationBusy ? "activating" : status;
        const preview = contextScopePreviewDetails || {};
        const counts = contextScopeCounts || {};
        const estimated = Number(preview.estimatedTokens || 0);
        const budget = Number(preview.budget || draft.tokenBudget || defaultContextTokenBudget);
        const selections = (draft.nodeSelections || []).slice().sort((left, right) => left.role.localeCompare(right.role) || refLabel(left.entity.kind + ":" + left.entity.id).localeCompare(refLabel(right.entity.kind + ":" + right.entity.id)));
        const roleOptions = (selected) => ["pinned", "included", "proposed", "exploratory", "excluded"].map((role) => '<option value="' + role + '"' + (role === selected ? " selected" : "") + '>' + role + '</option>').join("");
        const roleRows = selections.length > 0
          ? selections.map((selection) => {
              const ref = selection.entity.kind + ":" + selection.entity.id;
              const detail = [
                selection.reason,
                Number.isFinite(selection.confidence) ? Math.round(selection.confidence * 100) + "% confidence" : "",
                Number.isFinite(selection.estimatedTokens) ? "~" + selection.estimatedTokens + " tokens" : ""
              ].filter(Boolean).join(" · ");
              return '<div class="context-role-row ' + escapeAttr(selection.role) + '"><div class="context-role-main"><span title="' + escapeAttr(ref) + '">' + escapeHtml(refLabel(ref)) + '</span>' + (detail ? '<small title="' + escapeAttr(detail) + '">' + escapeHtml(detail) + '</small>' : '') + '</div><select data-graph-context-role="' + escapeAttr(ref) + '" title="Review Context role">' + roleOptions(selection.role) + '</select><button type="button" data-graph-context-remove="' + escapeAttr(ref) + '" title="Reject or remove">×</button></div>';
            }).join("")
          : '<div class="context-pack-summary">No entity selected. Return to Navigate, prepare the graph, then reopen Context.</div>';
        const modeButton = (mode) => '<button type="button" data-graph-context-mode="' + mode + '" class="' + (draft.mode === mode ? "active" : "") + '">' + mode + '</button>';
        const viewLabel = savedView
          ? savedView.name + " · v" + savedView.version + (viewDirty ? " · modified" : "")
          : "Unsaved ad-hoc view";
        const activateLabel = contextActivationBusy
          ? "Activating…"
          : savedView && viewDirty
            ? "Save & activate"
            : savedView
              ? "Activate view"
              : "Activate draft";
        const previewWarning = estimated > budget
          ? '<div class="context-pack-summary warning">Estimated context exceeds the token budget. The compiled pack will be truncated.</div>'
          : "";
        const pack = selectedContextPack;
        const packSummary = pack
          ? '<div class="context-pack-summary' + (contextPackOutdated ? " warning" : "") + '"><strong>Pack v' + escapeHtml(pack.version) + '</strong> · ' + escapeHtml(pack.actualTokens || 0) + '/' + escapeHtml(pack.budget || 0) + ' tokens · ' + escapeHtml(pack.entryCount ?? (pack.entries || []).length) + ' entries' + (pack.truncated ? ' · truncated' : '') + '<br>' + escapeHtml(pack.request || "") + (contextPackOutdated ? '<br>This pack predates the current Context View draft.' : '') + '</div>'
          : '<div class="context-pack-summary">No Context Pack compiled yet. Activate the view, describe the agent objective, then prepare the concrete pack.</div>';
        const packError = contextPackErrorMessage
          ? '<div class="context-pack-summary warning">' + escapeHtml(contextPackErrorMessage) + '</div>'
          : "";
        const packEntries = pack && Array.isArray(pack.entries) && pack.entries.length > 0
          ? '<div>' + pack.entries.map((entry) => '<details class="context-pack-entry"><summary>' + escapeHtml(entry.title || entry.ref) + ' · ' + escapeHtml(entry.kind) + ' · ' + escapeHtml(entry.tokenCount || 0) + ' tok</summary><div class="context-pack-entry-body">' + escapeHtml(entry.content ? compactLabel(entry.content, 1800) : entry.ref) + (entry.provenance?.length ? '\\n\\nProvenance: ' + escapeHtml(entry.provenance.join(", ")) : '') + (contextPackCitationText(entry) ? '\\nCitation: ' + escapeHtml(contextPackCitationText(entry)) : '') + '</div></details>').join("") + '</div>'
          : "";
        const history = contextPackHistory.length > 0
          ? '<div class="context-pack-history">' + contextPackHistory.slice(0, 6).map((item) => '<button type="button" data-context-pack-id="' + escapeAttr(item.id) + '" class="' + (pack?.id === item.id ? "active" : "") + '"><span>' + escapeHtml(item.request || item.id) + '</span><small>v' + escapeHtml(item.version) + ' · ' + escapeHtml(item.actualTokens || 0) + ' tok</small></button>').join("") + '</div>'
          : '<small style="color:var(--dim);">No pack history for this view.</small>';
        const canCompile = activeCount > 0 && contextScopeActivated && contextPackObjective.trim().length > 0 && !contextPackBusy;

        panel.innerHTML =
          '<div class="graph-context-panel-head"><div class="graph-context-panel-title"><strong>Context control plane</strong><small>' + escapeHtml(viewLabel) + '</small></div><div class="graph-context-panel-head-actions"><button type="button" class="graph-context-close" data-help-guide="context" title="Learn about agent context">?</button><span class="context-status ' + status + '">' + escapeHtml(statusLabel) + '</span><button type="button" class="graph-context-close" id="graphContextPanelClose" title="Close panel">×</button></div></div>'
          + '<div class="graph-context-panel-body">'
          + '<section class="context-panel-section"><div class="context-panel-section-head"><strong>Context View</strong><small>Reusable boundary</small></div>'
          + '<div class="context-panel-metrics"><div class="context-panel-metric"><span>Selected</span><strong>' + activeCount + '</strong></div><div class="context-panel-metric"><span>Resolved</span><strong>' + escapeHtml(counts.entities || 0) + '</strong></div><div class="context-panel-metric"><span>Sources</span><strong>' + escapeHtml(counts.sources || 0) + '</strong></div><div class="context-panel-metric"><span>Observations</span><strong>' + escapeHtml(counts.observations || 0) + '</strong></div></div>'
          + '<div class="context-panel-tabs">' + modeButton("guided") + modeButton("strict") + '</div>'
          + '<div class="context-role-list">' + roleRows + '</div>'
          + '<div class="context-panel-row"><label class="context-panel-field">Depth<select id="graphContextDepth">' + [0,1,2,3].map((value) => '<option value="' + value + '"' + (Number(draft.depth) === value ? " selected" : "") + '>' + value + ' level' + (value === 1 ? "" : "s") + '</option>').join("") + '</select></label><label class="context-panel-field">Source access<select id="graphContextSourceAccess">' + ["none", "metadata", "snippets", "full"].map((value) => '<option value="' + value + '"' + (draft.sourceAccess === value ? " selected" : "") + '>' + value + '</option>').join("") + '</select></label></div>'
          + '<details class="context-advanced"><summary>Advanced settings</summary><div class="context-advanced-body"><div class="context-panel-row"><label class="context-panel-field">Refresh policy<select id="graphContextRefreshPolicy">' + ["frozen", "monitored", "dynamic"].map((value) => '<option value="' + value + '"' + (draft.refreshPolicy === value ? " selected" : "") + '>' + value + '</option>').join("") + '</select></label><label class="context-panel-field">Token budget<input id="graphContextTokenBudget" type="number" min="1" value="' + escapeAttr(draft.tokenBudget || defaultContextTokenBudget) + '"></label></div><div class="context-panel-row"><label class="context-panel-field">From<input id="graphContextTimeFrom" type="date" value="' + escapeAttr(draft.timeRange?.from?.slice(0,10) || "") + '"></label><label class="context-panel-field">To<input id="graphContextTimeTo" type="date" value="' + escapeAttr(draft.timeRange?.to?.slice(0,10) || "") + '"></label></div><label class="context-panel-field">Allowed relations<input id="graphContextAllowedRelations" value="' + escapeAttr((draft.allowedRelationTypes || []).join(", ")) + '" placeholder="all relation types"></label><label class="context-panel-field">Observation validation<input id="graphContextObservationValidationStatuses" value="' + escapeAttr((draft.observationValidationStatuses || draft.validationStatuses || []).join(", ")) + '" placeholder="accepted, proposed"></label><div class="context-panel-row"><label class="context-panel-field">Evidence status<input id="graphContextObservationEvidenceStatuses" value="' + escapeAttr((draft.observationEvidenceStatuses || []).filter((value) => value !== "measured").join(", ")) + '" placeholder="standalone, corroborated, contradicted"></label><label class="context-panel-field">Measurement<select id="graphContextObservationMeasurement">' + ["any", "measured", "unmeasured"].map((value) => '<option value="' + value + '"' + (draft.observationMeasurement === value ? ' selected' : '') + '>' + value + '</option>').join("") + '</select></label></div></div></details>'
          + '<div class="context-pack-summary">Included ' + escapeHtml(preview.included?.length || activeCount) + ' · proposed ' + escapeHtml(preview.proposed?.length || 0) + ' · excluded ' + escapeHtml(preview.excluded?.length || 0) + ' · stale ' + escapeHtml(preview.stale?.length || 0) + '<br>~' + estimated + ' / ' + budget + ' tokens</div>' + previewWarning
          + '<div class="context-panel-actions"><button type="button" id="graphContextSync">Use visible nodes</button><button type="button" id="graphContextClear">Clear</button><button type="button" class="primary" id="graphContextActivate"' + (activeCount === 0 || contextActivationBusy ? " disabled" : "") + '>' + escapeHtml(activateLabel) + '</button></div></section>'
          + '<section class="context-panel-section"><div class="context-panel-section-head"><strong>Context Pack</strong><small>Concrete agent payload</small></div>'
          + '<label class="context-panel-field">Agent objective<textarea class="context-pack-objective" id="contextPackObjective" placeholder="What should the agent accomplish with this context?">' + escapeHtml(contextPackObjective) + '</textarea></label>'
          + packError + packSummary + packEntries
          + '<div class="context-panel-actions"><button type="button" id="contextPackRefresh">Refresh history</button><button type="button" class="primary" id="contextPackCompile"' + (canCompile ? "" : " disabled") + '>' + (contextPackBusy ? "Preparing…" : "Prepare pack") + '</button></div>'
          + '<div class="context-panel-section-head"><strong>Recent packs</strong><small>Versioned and auditable</small></div>' + history + '</section></div>';

        panel.querySelector("#graphContextPanelClose")?.addEventListener("click", () => { contextPanelDismissed = true; renderGraphContextPanel(); });
        panel.querySelectorAll("[data-graph-context-mode]").forEach((button) => button.addEventListener("click", () => contextScopeSetMode(button.dataset.graphContextMode)));
        panel.querySelectorAll("[data-graph-context-role]").forEach((select) => select.addEventListener("change", () => contextScopeSetRole(select.dataset.graphContextRole, select.value)));
        panel.querySelectorAll("[data-graph-context-remove]").forEach((button) => button.addEventListener("click", () => contextScopeToggleRef(button.dataset.graphContextRemove)));
        panel.querySelector("#graphContextDepth")?.addEventListener("change", (event) => contextScopeUpdatePolicy("depth", Number(event.target.value)));
        panel.querySelector("#graphContextSourceAccess")?.addEventListener("change", (event) => contextScopeUpdatePolicy("sourceAccess", event.target.value));
        panel.querySelector("#graphContextRefreshPolicy")?.addEventListener("change", (event) => contextScopeUpdatePolicy("refreshPolicy", event.target.value));
        panel.querySelector("#graphContextTokenBudget")?.addEventListener("change", (event) => contextScopeUpdatePolicy("tokenBudget", Math.max(1, Number(event.target.value) || defaultContextTokenBudget)));
        panel.querySelector("#graphContextTimeFrom")?.addEventListener("change", (event) => contextScopeUpdateTimeRange("from", event.target.value));
        panel.querySelector("#graphContextTimeTo")?.addEventListener("change", (event) => contextScopeUpdateTimeRange("to", event.target.value));
        panel.querySelector("#graphContextAllowedRelations")?.addEventListener("change", (event) => contextScopeUpdatePolicy("allowedRelationTypes", commaValues(event.target.value)));
        panel.querySelector("#graphContextObservationValidationStatuses")?.addEventListener("change", (event) => contextScopeUpdatePolicy("observationValidationStatuses", commaValues(event.target.value)));
        panel.querySelector("#graphContextObservationEvidenceStatuses")?.addEventListener("change", (event) => contextScopeUpdatePolicy("observationEvidenceStatuses", commaValues(event.target.value)));
        panel.querySelector("#graphContextObservationMeasurement")?.addEventListener("change", (event) => contextScopeUpdatePolicy("observationMeasurement", event.target.value));
        panel.querySelector("#graphContextSync")?.addEventListener("click", seedContextScopeFromView);
        panel.querySelector("#graphContextClear")?.addEventListener("click", clearContextScope);
        panel.querySelector("#graphContextActivate")?.addEventListener("click", activateContextFromGraphPanel);
        panel.querySelector("#contextPackObjective")?.addEventListener("input", (event) => {
          contextPackObjective = event.target.value;
          const compileButton = panel.querySelector("#contextPackCompile");
          if (compileButton) {
            compileButton.disabled = !(activeCount > 0 && contextScopeActivated && contextPackObjective.trim().length > 0 && !contextPackBusy);
          }
        });
        panel.querySelector("#contextPackCompile")?.addEventListener("click", compileContextPackFromGraphPanel);
        panel.querySelector("#contextPackRefresh")?.addEventListener("click", requestContextPackHistory);
        panel.querySelectorAll("[data-context-pack-id]").forEach((button) => button.addEventListener("click", () => {
          contextPackBusy = true;
          contextPackErrorMessage = "";
          renderGraphContextPanel();
          vscode?.postMessage({ type: "getContextPack", id: button.dataset.contextPackId });
        }));
      }

      function activateContextFromGraphPanel() {
        if (!contextScopeDraft || contextScopeDraft.selectedEntities.length === 0 || contextActivationBusy) return;
        const view = activeGraphView();
        const dirty = Boolean(view && graphViewIsDirty());
        const visualState = serializeGraphView();
        delete visualState.context;
        contextActivationBusy = true;
        contextPackErrorMessage = "";
        renderGraphContextPanel();
        vscode?.postMessage({
          type: "activateContextDraft",
          scope: contextScopeDraft,
          viewId: view?.id,
          saveChanges: dirty,
          visualState
        });
      }

      function compileContextPackFromGraphPanel() {
        const request = contextPackObjective.trim();
        if (!request || !contextScopeActivated || !contextScopeDraft?.selectedEntities?.length || contextPackBusy) return;
        const cleanSavedView = activeGraphViewId && !graphViewIsDirty() && contextScopeDraft.viewId === activeGraphViewId;
        contextPackBusy = true;
        contextPackErrorMessage = "";
        renderGraphContextPanel();
        vscode?.postMessage({
          type: "compileContextPack",
          request,
          viewId: cleanSavedView ? activeGraphViewId : undefined,
          scope: cleanSavedView ? undefined : contextScopeDraft,
          sessionId: cockpitContextPackSessionId,
          tokenBudget: contextScopeDraft.tokenBudget
        });
      }

      function requestContextPackHistory() {
        contextPackErrorMessage = "";
        vscode?.postMessage({ type: "listContextPacks", viewId: activeGraphViewId, limit: 8 });
      }

      function contextPackSummaryFromDetail(pack) {
        if (!pack || typeof pack !== "object") return {};
        return {
          id: pack.id,
          version: pack.version,
          viewId: pack.viewId,
          viewVersion: pack.viewVersion,
          sessionId: pack.sessionId,
          request: pack.request,
          entryCount: Number.isFinite(Number(pack.entryCount)) ? Number(pack.entryCount) : (Array.isArray(pack.entries) ? pack.entries.length : 0),
          entries: Array.isArray(pack.entries) ? pack.entries.map((entry) => ({ kind: entry.kind, ref: entry.ref, title: entry.title, role: entry.role, content: entry.content, tokenCount: entry.tokenCount, provenance: entry.provenance, citations: entry.citations })) : [],
          exclusions: pack.exclusions,
          provenance: pack.provenance,
          estimatedTokens: pack.estimatedTokens,
          actualTokens: pack.actualTokens,
          budget: pack.budget,
          truncated: Boolean(pack.truncated),
          createdAt: pack.createdAt
        };
      }

      function contextPackCitationText(entry) {
        const citation = Array.isArray(entry?.citations) ? entry.citations[0] : undefined;
        if (!citation) return "";
        return [
          citation.observationId ? "observation:" + citation.observationId : "",
          citation.sourceId ? "source:" + citation.sourceId + (citation.sourceRevision ? "@" + citation.sourceRevision : "") : "",
          citation.chunkId ? "chunk:" + citation.chunkId : ""
        ].filter(Boolean).join(" · ");
      }

      function commaValues(value) {
        const values = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
        return values.length ? Array.from(new Set(values)) : undefined;
      }

      function contextScopeUpdatePolicy(key, value) {
        if (!contextScopeDraft) return;
        contextScopeDraft[key] = value;
        markContextDraftChanged();
        renderContextScopePanel();
        previewContextScopeDraft();
      }

      function contextScopeUpdateTimeRange(key, value) {
        if (!contextScopeDraft) return;
        contextScopeDraft.timeRange = { ...(contextScopeDraft.timeRange || {}), [key]: value || undefined };
        if (!contextScopeDraft.timeRange.from && !contextScopeDraft.timeRange.to) contextScopeDraft.timeRange = undefined;
        markContextDraftChanged();
        renderContextScopePanel();
        previewContextScopeDraft();
      }

      function renderLegend() {
        const counts = graphTypeCounts();
        document.querySelector("#legend").innerHTML = typeOrder.map((type) => {
          const count = counts.get(type) || 0;
          const excluded = graphExcludedValues[type];
          const selected = excluded && excluded.size ? graphCheckedCountForType(type) : count;
          const valueLabel = selected === count ? String(count) : selected + "/" + count;
          return '<button class="chip legend-chip' + (activeGraphTypes.has(type) ? "" : " disabled") + '" data-toggle-type="' + escapeAttr(type) + '" title="Show or hide ' + escapeAttr(typeLabel(type)) + ' nodes"><i class="dot" style="background:' + colors[type] + '"></i>' + escapeHtml(typeLabel(type)) + '<span class="badge">' + escapeHtml(valueLabel) + '</span></button>';
        }).join("");
        document.querySelectorAll("[data-toggle-type]").forEach((button) => {
          button.addEventListener("click", () => {
            const type = button.dataset.toggleType;
            selectedGraphFilterType = type;
            if (activeGraphTypes.has(type)) {
              activeGraphTypes.delete(type);
            } else {
              activeGraphTypes.add(type);
            }
            const selected = (state.graph.nodes || []).find((node) => node.id === selectedNodeId);
            if (selected && !activeGraphTypes.has(selected.type)) resetNodeDetail();
            renderGraphFilterSurfaces();
          });
        });
      }

      function taskEntityOptions(tasks) {
        const options = new Map();
        for (const task of tasks || []) {
          for (const ref of taskEntityRefs(task)) {
            const existing = options.get(ref);
            if (existing) {
              existing.count += 1;
            } else {
              options.set(ref, {
                ref,
                label: taskEntityLabel(ref),
                count: 1
              });
            }
          }
        }
        return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
      }

      function matchesTaskEntityFilter(task) {
        if (!taskEntityFilterRefs.size) return true;
        const refs = taskEntityRefs(task);
        return refs.some((ref) => taskEntityFilterRefs.has(ref));
      }

      function pruneTaskEntityFilters(options) {
        const validRefs = new Set(options.map((option) => option.ref));
        for (const ref of Array.from(taskEntityFilterRefs)) {
          if (!validRefs.has(ref)) taskEntityFilterRefs.delete(ref);
        }
      }

      function taskEntityFilterLabel(options) {
        if (!taskEntityFilterRefs.size) return "All linked entities";
        if (taskEntityFilterRefs.size === 1) {
          const ref = Array.from(taskEntityFilterRefs)[0];
          return options.find((option) => option.ref === ref)?.label || taskEntityLabel(ref);
        }
        return taskEntityFilterRefs.size + " linked entities";
      }

      function renderTaskEntityFilter(options) {
        return '<div class="task-entity-filter' + (taskEntityFilterOpen ? " open" : "") + '" id="taskEntityFilter">' +
          '<button class="control task-entity-filter-toggle" id="taskEntityFilterToggle" title="Filter by linked entities">' + escapeHtml(taskEntityFilterLabel(options)) + '</button>' +
          '<div class="task-entity-filter-panel">' +
          '<div class="task-entity-filter-actions"><button data-task-entity-filter-action="all">All linked</button><button data-task-entity-filter-action="close">Close</button></div>' +
          (options.length ? options.map((option) =>
            '<label class="task-entity-filter-option"><input type="checkbox" data-task-entity-filter-value="' + escapeAttr(option.ref) + '"' + (taskEntityFilterRefs.has(option.ref) ? " checked" : "") + '><span>' + escapeHtml(option.label) + '</span><small>' + escapeHtml(option.count) + '</small></label>'
          ).join("") : '<p class="task-entity-filter-empty">No linked entities yet.</p>') +
          '</div></div>';
      }

      function bindTaskEntityFilter(options) {
        document.querySelector("#taskEntityFilterToggle")?.addEventListener("click", () => {
          taskEntityFilterOpen = !taskEntityFilterOpen;
          renderTasks();
        });
        document.querySelectorAll("[data-task-entity-filter-action]").forEach((button) => {
          button.addEventListener("click", () => {
            if (button.dataset.taskEntityFilterAction === "all") {
              taskEntityFilterRefs.clear();
              taskEntityFilterOpen = true;
            }
            if (button.dataset.taskEntityFilterAction === "close") {
              taskEntityFilterOpen = false;
            }
            renderTasks();
            renderTaskDetail();
          });
        });
        document.querySelectorAll("[data-task-entity-filter-value]").forEach((input) => {
          input.addEventListener("change", () => {
            const ref = input.dataset.taskEntityFilterValue;
            if (!ref) return;
            if (input.checked) {
              taskEntityFilterRefs.add(ref);
            } else {
              taskEntityFilterRefs.delete(ref);
            }
            pruneTaskEntityFilters(options);
            taskEntityFilterOpen = true;
            renderTasks();
            renderTaskDetail();
          });
        });
      }

      function groupTasks(tasks, mode) {
        const groups = new Map();
        for (const task of tasks || []) {
          const keys = taskGroupKeys(task, mode);
          for (const key of keys.length ? keys : ["none:none"]) {
            if (!groups.has(key)) {
              groups.set(key, {
                key,
                label: taskEntityLabel(key),
                tasks: []
              });
            }
            groups.get(key).tasks.push(task);
          }
        }
        return Array.from(groups.values()).sort((left, right) => {
          if (left.key === "none:none") return 1;
          if (right.key === "none:none") return -1;
          return left.label.localeCompare(right.label);
        });
      }

      function taskGroupKeys(task, mode) {
        const refs = taskEntityRefs(task);
        if (mode === "product") {
          return refs.filter((ref) => ref.startsWith("product:"));
        }
        if (mode === "entity") {
          return refs;
        }
        if (mode === "entityType") {
          return Array.from(new Set(refs.map((ref) => ref.split(":")[0] + ":*")));
        }
        return [];
      }

      function taskEntityRefs(task) {
        const refs = [];
        addTaskEntityRef(refs, "product", task.productId);
        addTaskEntityRef(refs, "source", task.sourceId);
        for (const link of task.links || []) {
          const ref = taskLinkEntityRef(link);
          if (ref) refs.push(ref);
        }
        return Array.from(new Set(refs));
      }

      function addTaskEntityRef(refs, kind, id) {
        const cleanId = String(id || "").trim();
        if (!cleanId || cleanId === "none" || cleanId === "-" || cleanId === "clear") return;
        refs.push(kind + ":" + cleanId);
      }

      function taskLinkEntityRef(link) {
        if (typeof link === "string") {
          const parts = link.split(":").map((part) => part.trim()).filter(Boolean);
          if (parts.length >= 3) return parts[1] + ":" + parts[2];
          if (parts.length === 2) return parts[0] + ":" + parts[1];
          return undefined;
        }
        const targetKind = String(link?.targetKind || link?.kind || "").trim();
        const targetId = String(link?.targetId || link?.id || "").trim();
        if (!targetKind || !targetId) return undefined;
        return targetKind + ":" + targetId;
      }

      function taskEntityLabel(ref) {
        if (!ref || ref === "none:none") return "No linked entity";
        if (ref.endsWith(":*")) return ref.slice(0, -2).replace(/_/g, " ");
        const [kind, ...idParts] = ref.split(":");
        const id = idParts.join(":");
        const entity = (state.entities || []).find((candidate) => candidate.kind === kind && candidate.id === id);
        if (entity) return (entity.label || entity.id) + " · " + entity.kind;
        const graphNode = (state.graph?.nodes || []).find((node) => entityRefForNode(node) === ref || node.id === ref || node.id === kind + ":" + id);
        if (graphNode) return (graphNode.label || id) + " · " + (graphNode.type || kind);
        return id + " · " + kind;
      }

      function taskEditableLinks(task) {
        const links = Array.isArray(task?.links) ? task.links.slice() : [];
        if (task?.productId && !links.some((link) => link.targetKind === "product" && link.targetId === task.productId)) {
          links.unshift({ relationType: "concerns", targetKind: "product", targetId: task.productId });
        }
        if (task?.sourceId && !links.some((link) => link.targetKind === "source" && link.targetId === task.sourceId)) {
          links.push({ relationType: "related_to", targetKind: "source", targetId: task.sourceId });
        }
        return links;
      }

      function renderTasks() {
        const lanes = ["pending", "open", "blocked", "ready", "done"];
        const allTasks = state.tasks || [];
        const entityOptions = taskEntityOptions(allTasks);
        pruneTaskEntityFilters(entityOptions);
        const tasks = allTasks.filter(matchesTaskEntityFilter);
        if (selectedTaskId && selectedTaskId !== "__new__" && !tasks.some((task) => task.id === selectedTaskId)) {
          selectedTaskId = tasks[0]?.id;
        }
        if (!selectedTaskId && tasks.length) selectedTaskId = tasks[0].id;
        const controls = '<div class="task-view-controls">' +
          '<select class="control" id="taskGroupMode" title="Group tasks"><option value="status"' + (taskGroupMode === "status" ? " selected" : "") + '>Group: Status</option><option value="product"' + (taskGroupMode === "product" ? " selected" : "") + '>Group: Product</option><option value="entity"' + (taskGroupMode === "entity" ? " selected" : "") + '>Group: Linked entity</option><option value="entityType"' + (taskGroupMode === "entityType" ? " selected" : "") + '>Group: Entity type</option></select>' +
          renderTaskEntityFilter(entityOptions) +
          '<button class="action" id="addTask">Add task</button><span class="chip">' + tasks.length + '/' + allTasks.length + ' items</span></div>';
        document.querySelector("#tasks").innerHTML = '<div class="title-row"><div><h1>Tasks</h1><p>Filter by linked entity or group tasks into alternate views.</p></div>' + controls + '</div>' + renderTaskBoard(tasks, lanes);
        document.querySelector("#taskGroupMode").addEventListener("change", (event) => {
          taskGroupMode = event.target.value || "status";
          renderTasks();
        });
        bindTaskEntityFilter(entityOptions);
        document.querySelector("#addTask").addEventListener("click", () => {
          selectedTaskId = "__new__";
          renderTasks();
          renderTaskDetail();
        });
        bindTaskBoardInteractions();
      }

      function renderTaskBoard(tasks, lanes) {
        if (taskGroupMode === "product") {
          return '<div class="task-groups">' + groupTasks(tasks, "product").map((group) =>
            '<section class="task-group"><h2>' + escapeHtml(group.label) + '<span>' + group.tasks.length + ' tasks</span></h2><div class="columns">' + lanes.map((lane) => {
              const laneTasks = group.tasks.filter((task) => normalizeTaskStatus(task.status) === lane);
              return renderTaskLane(lane, laneTasks);
            }).join("") + '</div></section>'
          ).join("") + '</div>';
        }
        if (taskGroupMode === "entity" || taskGroupMode === "entityType") {
          return '<div class="task-groups">' + groupTasks(tasks, taskGroupMode).map((group) =>
            '<section class="task-group"><h2>' + escapeHtml(group.label) + '<span>' + group.tasks.length + ' tasks</span></h2><div class="columns">' + lanes.map((lane) => {
              const laneTasks = group.tasks.filter((task) => normalizeTaskStatus(task.status) === lane);
              return renderTaskLane(lane, laneTasks);
            }).join("") + '</div></section>'
          ).join("") + '</div>';
        }
        return '<div class="columns">' + lanes.map((lane) => {
          const laneTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === lane);
          return renderTaskLane(lane, laneTasks);
        }).join("") + '</div>';
      }

      function renderTaskLane(lane, laneTasks) {
        return '<section class="lane" data-task-lane="' + escapeAttr(lane) + '"><h2>' + lane + '<span>' + laneTasks.length + '</span></h2>' + laneTasks.map((task) => renderTaskCard(task)).join("") + '</section>';
      }

      function bindTaskBoardInteractions() {
        document.querySelectorAll("[data-task]").forEach((card) => card.addEventListener("click", (event) => {
          if (suppressTaskClick) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          selectedTaskId = card.dataset.task;
          renderTasks();
          renderTaskDetail();
        }));
        document.querySelectorAll("[data-task]").forEach((card) => {
          card.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            selectedTaskId = card.dataset.task;
            renderTasks();
            renderTaskDetail();
          });
          card.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            beginTaskPointerDrag(card, event);
            card.setPointerCapture?.(event.pointerId);
          });
          card.addEventListener("pointermove", (event) => {
            updateTaskPointerDrag(event, card.dataset.task);
          });
          card.addEventListener("pointerup", (event) => {
            card.releasePointerCapture?.(event.pointerId);
            finishTaskPointerDrag(event, card.dataset.task);
          });
          card.addEventListener("pointercancel", () => {
            clearTaskDragState();
          });
          card.addEventListener("mousedown", (event) => {
            if (event.button !== 0 || taskPointerDrag) return;
            beginTaskPointerDrag(card, event);
          });
        });
        document.querySelectorAll("[data-task-lane]").forEach((lane) => {
          lane.addEventListener("dragenter", (event) => {
            event.preventDefault();
            lane.classList.add("drag-over");
          });
          lane.addEventListener("dragover", (event) => {
            event.preventDefault();
            lane.classList.add("drag-over");
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = "move";
            }
          });
          lane.addEventListener("dragleave", (event) => {
            if (event.relatedTarget && lane.contains(event.relatedTarget)) return;
            lane.classList.remove("drag-over");
          });
          lane.addEventListener("drop", (event) => {
            event.preventDefault();
            lane.classList.remove("drag-over");
            const id = event.dataTransfer?.getData("application/x-oneagent-task") || event.dataTransfer?.getData("text/plain") || draggingTaskId;
            const status = lane.dataset.taskLane;
            moveTaskToStatus(id, status);
          });
        });
      }

      function taskLaneAtPoint(x, y) {
        return document.elementFromPoint(x, y)?.closest?.("[data-task-lane]");
      }

      function beginTaskPointerDrag(card, event) {
        taskPointerDrag = {
          id: card.dataset.task,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
          card
        };
      }

      function updateTaskPointerDrag(event, expectedId) {
        if (!taskPointerDrag || (expectedId && taskPointerDrag.id !== expectedId)) return;
        const distance = Math.hypot(event.clientX - taskPointerDrag.startX, event.clientY - taskPointerDrag.startY);
        if (!taskPointerDrag.active && distance < 7) return;
        taskPointerDrag.active = true;
        draggingTaskId = taskPointerDrag.id;
        taskPointerDrag.card?.classList.add("dragging");
        event.preventDefault?.();
        highlightTaskLaneAt(event.clientX, event.clientY);
      }

      function finishTaskPointerDrag(event, expectedId) {
        if (!taskPointerDrag || (expectedId && taskPointerDrag.id !== expectedId)) return;
        const wasDragging = taskPointerDrag.active;
        const id = taskPointerDrag.id;
        if (wasDragging) {
          event.preventDefault?.();
          suppressTaskClick = true;
          window.setTimeout(() => { suppressTaskClick = false; }, 0);
          const lane = taskLaneAtPoint(event.clientX, event.clientY);
          clearTaskDragState();
          moveTaskToStatus(id, lane?.dataset.taskLane);
          return;
        }
        clearTaskDragState();
      }

      function highlightTaskLaneAt(x, y) {
        const targetLane = taskLaneAtPoint(x, y);
        document.querySelectorAll("[data-task-lane]").forEach((lane) => {
          lane.classList.toggle("drag-over", lane === targetLane);
        });
      }

      function clearTaskDragState() {
        draggingTaskId = undefined;
        taskPointerDrag?.card?.classList.remove("dragging");
        taskPointerDrag = undefined;
        document.querySelectorAll("[data-task-lane]").forEach((lane) => lane.classList.remove("drag-over"));
      }

      function moveTaskToStatus(id, status) {
        const task = findTask(id);
        if (!task || !status || normalizeTaskStatus(task.status) === status) return;
        draggingTaskId = undefined;
        selectedTaskId = id;
        state.tasks = (state.tasks || []).map((candidate) => candidate.id === id ? { ...candidate, status } : candidate);
        renderTasks();
        renderTaskDetail();
        vscode?.postMessage({ type: "updateTask", id, status });
      }

      function renderTaskCard(task) {
        const selected = task.id === selectedTaskId ? " selected" : "";
        const priority = task.priority || "medium";
        const assignee = task.assignee || "me";
        const deadline = task.deadline ? "Due " + task.deadline : "No deadline";
        const linkCount = Array.isArray(task.links) ? task.links.length : 0;
        return '<article class="task' + selected + '" data-task="' + escapeAttr(task.id) + '" role="button" tabindex="0"><strong>' + escapeHtml(task.title) + '</strong><span>' + escapeHtml(task.body || task.source || task.status || "") + '</span><div class="task-meta"><span class="badge priority-' + escapeAttr(priority) + '">' + escapeHtml(priority) + '</span><span class="badge assignee-' + escapeAttr(assignee) + '">' + escapeHtml(assignee === "agent" ? "agent" : "me") + '</span><span class="badge">' + escapeHtml(deadline) + '</span>' + (linkCount ? '<span class="badge">' + linkCount + ' links</span>' : '') + '</div></article>';
      }

      function renderTaskDetail() {
        if (selectedTaskId === "__new__") {
          renderNewTaskDetail();
          return;
        }
        const task = findTask(selectedTaskId);
        document.querySelector("#taskDetailStatus").textContent = task ? normalizeTaskStatus(task.status) : "none";
        if (!task) {
          document.querySelector("#taskDetail").innerHTML = '<p class="summary">Select a task to inspect details, set owner, priority and deadline.</p><button class="action" id="emptyAddTask">Add task</button>';
          document.querySelector("#emptyAddTask").addEventListener("click", () => {
            selectedTaskId = "__new__";
            renderTasks();
            renderTaskDetail();
          });
          return;
        }
        document.querySelector("#taskDetail").innerHTML =
          '<div class="task-detail">' +
          '<div class="detail-title"><b>Edit task</b><span>' + escapeHtml(task.origin || "") + '</span></div>' +
          '<div class="field"><label>Title</label><input id="taskTitle" maxlength="180" value="' + escapeAttr(task.title) + '"></div>' +
          '<div class="field"><label>Description</label><textarea id="taskBody" maxlength="2000" placeholder="Task description">' + escapeHtml(task.body || "") + '</textarea></div>' +
          customMenuHtml("taskStatus", "Status", ["pending", "open", "blocked", "ready", "done"], normalizeTaskStatus(task.status)) +
          customMenuHtml("taskPriority", "Priority", ["low", "medium", "high", "critical"], task.priority || "medium") +
          customMenuHtml("taskAssignee", "Assignee", ["me", "agent"], task.assignee || "me") +
          '<div class="field"><label>Deadline</label><input id="taskDeadline" type="date" value="' + escapeAttr(task.deadline || "") + '"></div>' +
          '<div class="field"><label>Notes</label><textarea id="taskNotes" placeholder="Operational notes">' + escapeHtml(task.notes || "") + '</textarea></div>' +
          taskLinkSelectorHtml("edit", taskEditableLinks(task)) +
          '<div class="detail-actions"><button class="action" id="archiveTask">Archive</button><button class="action" id="saveTask">Save</button></div>' +
          '</div>';
        bindMenus(document.querySelector("#taskDetail"));
        bindTaskLinkSelector("edit");
        document.querySelector("#saveTask").addEventListener("click", () => {
          vscode?.postMessage({
            type: "updateTask",
            id: task.id,
            title: document.querySelector("#taskTitle").value || "none",
            body: document.querySelector("#taskBody").value || "none",
            status: document.querySelector("#taskStatus").value,
            priority: document.querySelector("#taskPriority").value,
            assignee: document.querySelector("#taskAssignee").value,
            deadline: document.querySelector("#taskDeadline").value || "none",
            notes: document.querySelector("#taskNotes").value || "none",
            links: parseTaskLinksText(document.querySelector("#editTaskLinks").value)
          });
        });
        document.querySelector("#archiveTask").addEventListener("click", () => {
          vscode?.postMessage({ type: "deleteTask", id: task.id });
        });
      }

      function renderNewTaskDetail() {
        document.querySelector("#taskDetailStatus").textContent = "new";
        document.querySelector("#taskDetail").innerHTML =
          '<div class="task-detail">' +
          '<div class="detail-title"><b>Add task</b><span>manual</span></div>' +
          '<div class="field"><label>Title</label><input id="newTaskTitle" maxlength="180" placeholder="Task title"></div>' +
          '<div class="field"><label>Description</label><textarea id="newTaskBody" maxlength="2000" placeholder="Task description"></textarea></div>' +
          customMenuHtml("newTaskStatus", "Status", ["pending", "open", "blocked", "ready", "done"], "open") +
          customMenuHtml("newTaskPriority", "Priority", ["low", "medium", "high", "critical"], "medium") +
          customMenuHtml("newTaskAssignee", "Assignee", ["me", "agent"], "me") +
          '<div class="field"><label>Deadline</label><input id="newTaskDeadline" type="date"></div>' +
          '<div class="field"><label>Notes</label><textarea id="newTaskNotes" placeholder="Operational notes"></textarea></div>' +
          taskLinkSelectorHtml("new", []) +
          '<div class="detail-actions"><button class="action" id="cancelNewTask">Cancel</button><button class="action" id="createTask">Create task</button></div>' +
          '</div>';
        bindMenus(document.querySelector("#taskDetail"));
        bindTaskLinkSelector("new");
        document.querySelector("#cancelNewTask").addEventListener("click", () => {
          selectedTaskId = undefined;
          renderTasks();
          renderTaskDetail();
        });
        document.querySelector("#createTask").addEventListener("click", () => {
          const title = document.querySelector("#newTaskTitle").value.trim();
          if (!title) {
            document.querySelector("#newTaskTitle").focus();
            return;
          }
          vscode?.postMessage({
            type: "createTask",
            title,
            body: document.querySelector("#newTaskBody").value || "",
            status: document.querySelector("#newTaskStatus").value,
            priority: document.querySelector("#newTaskPriority").value,
            assignee: document.querySelector("#newTaskAssignee").value,
            deadline: document.querySelector("#newTaskDeadline").value || "",
            notes: document.querySelector("#newTaskNotes").value || "",
            links: parseTaskLinksText(document.querySelector("#newTaskLinks").value)
          });
        });
      }

      const MANUAL_NOTE_TYPES = [
        { value: "note", label: "Note" },
        { value: "question", label: "Question" }
      ];
      const NOTE_ATTENTION_TAG = "needs-attention";
      const NOTE_RESOLVED_TAG = "resolved";

      function isManualNote(capture) {
        return Boolean(capture && (capture.contentType === "note" || capture.contentType === "question"));
      }

      function manualNoteStateItems(value) {
        const scoped = Array.isArray(value?.manualNotes) ? value.manualNotes : value?.captures;
        return (scoped || []).filter(isManualNote);
      }

      function manualNoteVersion(note) {
        return [
          note?.updatedAt,
          note?.contentHash,
          note?.sourceId,
          note?.status,
          note?.title,
          note?.contentType,
          note?.primaryEntityKind,
          note?.primaryEntityId,
          JSON.stringify(note?.tags || [])
        ].join("|");
      }

      function rememberSavedManualNote(note) {
        pendingSavedManualNotes.set(note.id, {
          note,
          scopeKey: JSON.stringify(state.contextScope?.scope || null)
        });
        state.manualNotes = [
          ...(state.manualNotes || []).filter((item) => item.id !== note.id),
          note
        ];
      }

      function mergePendingSavedManualNotes(nextState) {
        // A background snapshot may have started before a save. Keep the
        // confirmed local note visible until a snapshot contains its version.
        const incomingNotes = Array.isArray(nextState.manualNotes) ? nextState.manualNotes : [];
        const scopeKey = JSON.stringify(nextState.contextScope?.scope || null);
        for (const [id, pending] of pendingSavedManualNotes) {
          if (pending.scopeKey !== scopeKey) {
            pendingSavedManualNotes.delete(id);
            continue;
          }
          const saved = pending.note;
          const incoming = incomingNotes.find((note) => note.id === id);
          if (incoming && (manualNoteVersion(incoming) === manualNoteVersion(saved)
            || manualNoteRecency(incoming) > manualNoteRecency(saved))) {
            pendingSavedManualNotes.delete(id);
          } else {
            nextState.manualNotes = [...(nextState.manualNotes || []).filter((note) => note.id !== id), saved];
          }
        }
      }

      function invalidateChangedManualNoteDetails(previousState, nextState) {
        const previous = new Map(manualNoteStateItems(previousState).map((note) => [note.id, note]));
        const next = new Map(manualNoteStateItems(nextState).map((note) => [note.id, note]));
        const trackedIds = new Set([
          ...Object.keys(noteDetailCache),
          ...Object.keys(manualNoteDetailFailures),
          ...pendingManualNoteDetailIds
        ]);
        for (const id of trackedIds) {
          if (!next.has(id) || manualNoteVersion(previous.get(id)) !== manualNoteVersion(next.get(id))) {
            delete noteDetailCache[id];
            delete manualNoteDetailFailures[id];
            pendingManualNoteDetailIds.delete(id);
            if (pendingNoteDetailId === id) pendingNoteDetailId = undefined;
          }
        }
      }

      function manualNoteTimestamp(note, field) {
        const timestamp = Date.parse(note?.[field] || "");
        return Number.isFinite(timestamp) ? timestamp : undefined;
      }

      function manualNoteRecency(note) {
        return manualNoteTimestamp(note, "updatedAt") ?? manualNoteTimestamp(note, "createdAt") ?? 0;
      }

      function manualNotes() {
        return manualNoteStateItems(state).slice().sort((left, right) =>
          manualNoteRecency(right) - manualNoteRecency(left)
          || String(left.id || "").localeCompare(String(right.id || ""))
        );
      }

      function findManualNote(id) {
        if (!id || id === "__new__") return undefined;
        return manualNotes().find((note) => note.id === id);
      }

      function manualNoteEntityRef(note) {
        return note?.primaryEntityKind && note?.primaryEntityId
          ? note.primaryEntityKind + ":" + note.primaryEntityId
          : "";
      }

      function manualNoteEntityRefs(note) {
        return [...new Set([
          manualNoteEntityRef(note),
          ...(note?.relatedEntities || []).map((related) => related.entityKind + ":" + related.entityId)
        ].filter(Boolean))];
      }

      function manualNoteStatus(note) {
        const tags = new Set(Array.isArray(note?.tags) ? note.tags : []);
        if (note?.status === "superseded") return "archived";
        if (note?.status === "archived" && tags.has(NOTE_RESOLVED_TAG)) return "resolved";
        if (note?.status === "archived") return "archived";
        return "active";
      }

      function manualNoteEntityLabel(note) {
        const ref = manualNoteEntityRef(note);
        if (!ref) return "Limited context";
        if (ref === "oneagent:oneagent") return "General";
        return entityDisplayLabel(ref);
      }

      function activeStrictContext() {
        if (state.contextScope?.scope?.mode !== "strict") return undefined;
        return state.contextScope.resolved || state.contextScope;
      }

      function manualNoteWritableEntities() {
        const entities = captureEntities();
        const context = activeStrictContext();
        if (!context) return entities;
        if ((context.scope?.sourceAccess || "full") !== "full") return [];
        const allowed = new Set((context.entities || []).map((entity) => entity.kind + ":" + entity.id));
        const metadataOnly = new Set(context.metadataOnlyEntityRefs || []);
        return entities.filter((entity) => {
          const ref = entity.kind + ":" + entity.id;
          return allowed.has(ref) && !metadataOnly.has(ref);
        });
      }

      function manualNotePreview(note) {
        const detail = noteDetailCache[note.id];
        if (manualNoteDetailFailures[note.id] || detail?.detailError) {
          return "Content unavailable. Open this note to retry.";
        }
        const content = String(detail?.content || "").trim();
        if (!content) return "Open to read this note.";
        return content.replace(/^#+\\s*/gm, "").replace(/\\s+/g, " ").slice(0, 220);
      }

      function manualNoteMatchesFilters(note) {
        if (noteTypeFilter !== "all" && note.contentType !== noteTypeFilter) return false;
        if (noteStatusFilter !== "all" && manualNoteStatus(note) !== noteStatusFilter) return false;
        if (noteEntityFilter !== "all" && !manualNoteEntityRefs(note).includes(noteEntityFilter)) return false;
        const query = noteSearch.trim().toLowerCase();
        if (!query) return true;
        const searchable = [
          note.title,
          manualNoteEntityLabel(note),
          manualNoteEntityRef(note),
          manualNotePreview(note),
          ...(note.tags || [])
        ].join(" ").toLowerCase();
        return searchable.includes(query);
      }

      function manualNoteEntityFilterOptions(notes) {
        const refs = [...new Set(notes.flatMap(manualNoteEntityRefs))];
        return refs
          .map((ref) => ({ ref, label: ref === "oneagent:oneagent" ? "General" : entityDisplayLabel(ref) }))
          .sort((left, right) => left.label.localeCompare(right.label));
      }

      function renderManualNoteCard(note) {
        const status = manualNoteStatus(note);
        const selected = note.id === selectedNoteId ? " selected" : "";
        const updated = note.updatedAt ? relativeTime(note.updatedAt) || String(note.updatedAt).slice(0, 10) : "";
        return '<button type="button" class="note-card' + selected + '" data-note-id="' + escapeAttr(note.id) + '" aria-pressed="' + (selected ? "true" : "false") + '">' +
          '<strong>' + escapeHtml(note.title || "Untitled note") + '</strong>' +
          '<p>' + escapeHtml(manualNotePreview(note)) + '</p>' +
          '<div class="note-card-meta">' +
          '<span class="badge inbox-kind">' + escapeHtml(note.contentType === "question" ? "Question" : "Note") + '</span>' +
          '<span class="badge">' + escapeHtml(status) + '</span>' +
          '<span class="badge">' + escapeHtml(manualNoteEntityLabel(note)) + '</span>' +
          (updated ? '<span class="badge">' + escapeHtml(updated) + '</span>' : "") +
          '</div></button>';
      }

      function renderNotes() {
        const root = document.querySelector("#notes");
        if (!root) return;
        const allNotes = manualNotes();
        if (document.querySelector('[data-panel="notes"]')?.classList.contains("active")) {
          const missingDetailIds = allNotes
            .filter((note) =>
              !noteDetailCache[note.id]
              && !manualNoteDetailFailures[note.id]
              && !pendingManualNoteDetailIds.has(note.id)
            )
            .map((note) => note.id);
          for (let offset = 0; offset < missingDetailIds.length; offset += 100) {
            const ids = missingDetailIds.slice(offset, offset + 100);
            for (const id of ids) pendingManualNoteDetailIds.add(id);
            vscode?.postMessage({ type: "loadManualNotes", ids });
          }
        }
        const entityOptions = manualNoteEntityFilterOptions(allNotes);
        if (noteEntityFilter !== "all" && !entityOptions.some((entry) => entry.ref === noteEntityFilter)) {
          noteEntityFilter = "all";
        }
        const notes = allNotes.filter(manualNoteMatchesFilters);
        if (selectedNoteId && selectedNoteId !== "__new__" && !notes.some((note) => note.id === selectedNoteId)) {
          selectedNoteId = notes[0]?.id;
        }
        const entityFilterHtml = '<select class="control" id="noteEntityFilter" aria-label="Filter notes by entity"><option value="all">All entities</option>' +
          entityOptions.map((entry) => '<option value="' + escapeAttr(entry.ref) + '"' + (noteEntityFilter === entry.ref ? " selected" : "") + '>' + escapeHtml(entry.label) + '</option>').join("") +
          '</select>';
        root.innerHTML =
          '<div class="title-row"><div><h1>Notes</h1><p>Keep a thought or an open question and link it to the work it concerns.</p></div>' +
          '<div class="proposal-actions"><button class="action" id="addManualNote">+ Note</button><span class="chip">' + notes.length + "/" + allNotes.length + '</span></div></div>' +
          '<div class="note-toolbar">' +
          '<input class="control" id="noteSearch" type="search" aria-label="Search notes by title, text, entity, or tag" value="' + escapeAttr(noteSearch) + '" placeholder="Search title, text, entity, or tag">' +
          '<select class="control" id="noteTypeFilter" aria-label="Filter notes by type"><option value="all">All types</option><option value="note"' + (noteTypeFilter === "note" ? " selected" : "") + '>Notes</option><option value="question"' + (noteTypeFilter === "question" ? " selected" : "") + '>Questions</option></select>' +
          '<select class="control" id="noteStatusFilter" aria-label="Filter notes by status"><option value="all">All statuses</option><option value="active"' + (noteStatusFilter === "active" ? " selected" : "") + '>Active</option><option value="resolved"' + (noteStatusFilter === "resolved" ? " selected" : "") + '>Resolved</option><option value="archived"' + (noteStatusFilter === "archived" ? " selected" : "") + '>Archived</option></select>' +
          entityFilterHtml +
          '</div>' +
          (notes.length ? '<div class="notes-grid">' + notes.map(renderManualNoteCard).join("") + '</div>' : '<div class="note-empty">No note matches these filters.</div>');

        root.querySelector("#addManualNote")?.addEventListener("click", () => openNewManualNote());
        root.querySelector("#noteSearch")?.addEventListener("input", (event) => {
          noteSearch = event.target.value;
          renderNotes();
          renderNoteDetail();
          const field = document.querySelector("#noteSearch");
          field?.focus();
          field?.setSelectionRange(field.value.length, field.value.length);
        });
        root.querySelector("#noteTypeFilter")?.addEventListener("change", (event) => {
          noteTypeFilter = event.target.value || "all";
          renderNotes();
          renderNoteDetail();
        });
        root.querySelector("#noteStatusFilter")?.addEventListener("change", (event) => {
          noteStatusFilter = event.target.value || "active";
          renderNotes();
          renderNoteDetail();
        });
        root.querySelector("#noteEntityFilter")?.addEventListener("change", (event) => {
          noteEntityFilter = event.target.value || "all";
          renderNotes();
          renderNoteDetail();
        });
        root.querySelectorAll("[data-note-id]").forEach((card) => {
          card.addEventListener("click", () => selectManualNote(card.dataset.noteId));
        });
      }

      function openNewManualNote(primary) {
        const entities = manualNoteWritableEntities();
        const available = new Set(entities.map((entity) => entity.kind + ":" + entity.id));
        noteDraftEntityRef = primary && available.has(primary)
          ? primary
          : entities[0]
            ? entities[0].kind + ":" + entities[0].id
            : undefined;
        selectedNoteId = "__new__";
        // Opening another new note should start with a fresh editor.
        const detailRoot = document.querySelector("#noteDetail");
        if (detailRoot) delete detailRoot.dataset.manualNoteEditorId;
        setActiveView("notes");
      }

      function selectManualNote(id) {
        selectedNoteId = id;
        renderNotes();
        renderNoteDetail();
      }

      function manualNoteEditorHtml(note, detail) {
        const creating = !note;
        const prefix = creating ? "newNote" : "editNote";
        const current = creating
          ? {}
          : { ...(detail || {}), ...(note || {}), content: detail?.content };
        const entities = manualNoteWritableEntities();
        const entityOptions = taskLinkEntityOptions(entities);
        const entityRef = creating
          ? noteDraftEntityRef || entityOptions[0]?.ref || ""
          : manualNoteEntityRef(current);
        const picker = taskLinkPickerStateFor(prefix, entityOptions);
        if (entityOptions.some((option) => option.ref === entityRef)) picker.selectedRef = entityRef;
        const tags = new Set(Array.isArray(current.tags) ? current.tags : []);
        const status = creating ? "new" : manualNoteStatus(current);
        const type = current.contentType === "question" ? "question" : "note";
        const historical = current.status === "superseded";
        const canSave = !historical && entityOptions.length > 0 && (!activeStrictContext() || entityOptions.some((option) => option.ref === entityRef));
        const statusActions = creating || historical ? "" :
          status === "active"
            ? (type === "question" ? '<button class="action" id="resolveManualNote">Mark resolved</button>' : "") +
              '<button class="action" id="archiveManualNote">Archive</button>'
            : '<button class="action" id="restoreManualNote">Restore</button>';
        return '<div class="task-detail">' +
          '<div class="detail-title"><b>' + (creating ? "New note" : historical ? "Historical note" : "Edit note") + '</b><span>' + escapeHtml(status) + '</span></div>' +
          '<p class="summary">' + (creating
            ? "Write naturally. OneAgent saves and indexes the note locally."
            : historical
              ? "This version is kept for provenance and audit history."
              : "Changes are saved back to the same local note and made searchable again.") + '</p>' +
          (historical ? '<div class="inbox-problems"><strong>Historical note version</strong><span>This superseded version is read-only and cannot be restored.</span></div>' : "") +
          (!historical && !canSave ? '<div class="inbox-problems"><strong>No writable entity in the active context</strong><span>Change the active context before creating or moving this note.</span></div>' : "") +
          customMenuHtml(prefix + "Type", "Type", MANUAL_NOTE_TYPES, type) +
          taskLinkEntityPickerHtml(prefix, entities) +
          '<div class="field"><label for="' + prefix + 'Title">Title optional</label><input id="' + prefix + 'Title" maxlength="180" value="' + escapeAttr(current.title || "") + '" placeholder="Generated from the first line if empty"></div>' +
          '<div class="field"><label for="' + prefix + 'Content">Your note</label><textarea class="note-body" id="' + prefix + 'Content" maxlength="250000" placeholder="Write a thought, a point to clarify, or a question you want to keep.">' + escapeHtml(current.content || "") + '</textarea></div>' +
          '<label class="filter-value" id="' + prefix + 'AttentionField"' + (type === "question" ? " hidden" : "") + '><input id="' + prefix + 'Attention" type="checkbox"' + (type !== "question" && tags.has(NOTE_ATTENTION_TAG) ? " checked" : "") + '><span>Show in Today</span><small>Keep this visible until you deal with it</small></label>' +
          '<p class="summary" id="' + prefix + 'QuestionTodayHint"' + (type === "question" ? "" : " hidden") + '>Open questions stay in Today until you mark them resolved or archive them.</p>' +
          (!creating ? '<p class="summary">Analyze note is optional. It asks OneAgent to prepare suggestions in Inbox; saving alone never starts that analysis.</p>' : "") +
          '<div class="detail-actions">' +
          '<button class="action" id="cancelManualNote">' + (creating ? "Cancel" : "Close") + '</button>' +
          statusActions +
          (!creating && !historical ? '<button class="action" id="curateManualNote">Analyze note</button>' : "") +
          '<button class="action" id="saveManualNote"' + (canSave ? "" : " disabled") + '>' + (creating ? "Save note" : "Save changes") + '</button>' +
          '</div></div>';
      }

      function renderNoteDetail() {
        const root = document.querySelector("#noteDetail");
        const statusChip = document.querySelector("#noteDetailStatus");
        if (!root || !statusChip) return;
        if (!document.querySelector('[data-panel="notes"]')?.classList.contains("active")) return;
        if (selectedNoteId === "__new__") {
          statusChip.textContent = "new";
          // Background note loads and cockpit refreshes must not replace the
          // textarea while someone is typing in a new note.
          if (root.dataset.manualNoteEditorId === "__new__" && root.querySelector("#newNoteContent")) return;
          root.innerHTML = manualNoteEditorHtml(undefined, undefined);
          root.dataset.manualNoteEditorId = "__new__";
          root.dataset.manualNoteEditorVersion = "";
          root.dataset.manualNoteEditorDirty = "false";
          bindManualNoteEditor(undefined);
          return;
        }
        const note = findManualNote(selectedNoteId);
        statusChip.textContent = note ? manualNoteStatus(note) : "none";
        if (!note) {
          root.innerHTML = '<p class="summary">Select a note to read or edit it.</p><button class="action" id="emptyAddManualNote">+ Note</button>';
          root.querySelector("#emptyAddManualNote")?.addEventListener("click", () => openNewManualNote());
          return;
        }
        if (root.dataset.manualNoteEditorId === note.id
          && root.dataset.manualNoteEditorDirty === "true"
          && root.querySelector("#editNoteContent")) return;
        const detail = noteDetailCache[note.id];
        const detailFailure = manualNoteDetailFailures[note.id] || detail?.detailError;
        if (detailFailure) {
          root.innerHTML =
            '<div class="inbox-problems"><strong>Note content unavailable</strong><span>' + escapeHtml(detailFailure) + '</span></div>' +
            '<div class="detail-actions"><button class="action" id="retryManualNoteDetail">Retry</button></div>';
          root.querySelector("#retryManualNoteDetail")?.addEventListener("click", () => {
            delete noteDetailCache[note.id];
            delete manualNoteDetailFailures[note.id];
            pendingManualNoteDetailIds.add(note.id);
            pendingNoteDetailId = note.id;
            root.innerHTML = '<p class="summary">Loading note…</p>';
            vscode?.postMessage({ type: "loadManualNote", id: note.id });
          });
          return;
        }
        if (!detail) {
          root.innerHTML = '<p class="summary">Loading note…</p>';
          if (!pendingManualNoteDetailIds.has(note.id)) {
            pendingNoteDetailId = note.id;
            pendingManualNoteDetailIds.add(note.id);
            vscode?.postMessage({ type: "loadManualNote", id: note.id });
          }
          return;
        }
        const version = manualNoteVersion(note);
        if (root.dataset.manualNoteEditorId === note.id
          && root.dataset.manualNoteEditorVersion === version
          && root.querySelector("#editNoteContent")) return;
        root.innerHTML = manualNoteEditorHtml(note, detail);
        root.dataset.manualNoteEditorId = note.id;
        root.dataset.manualNoteEditorVersion = version;
        root.dataset.manualNoteEditorDirty = "false";
        bindManualNoteEditor({ ...detail, ...note, content: detail.content });
      }

      function manualNoteEditorTags(note, attention, contentType) {
        const tags = new Set(Array.isArray(note?.tags) ? note.tags : []);
        if (contentType === "question") {
          tags.delete(NOTE_ATTENTION_TAG);
        } else if (attention) {
          tags.add(NOTE_ATTENTION_TAG);
        } else {
          tags.delete(NOTE_ATTENTION_TAG);
        }
        if (contentType !== "question") tags.delete(NOTE_RESOLVED_TAG);
        return [...tags];
      }

      function bindManualNoteEditor(note) {
        const creating = !note;
        const prefix = creating ? "newNote" : "editNote";
        const editor = document.querySelector("#noteDetail");
        if (editor && !editor.dataset.manualNoteDirtyBound) {
          editor.addEventListener("input", () => { editor.dataset.manualNoteEditorDirty = "true"; });
          editor.addEventListener("change", () => { editor.dataset.manualNoteEditorDirty = "true"; });
          editor.dataset.manualNoteDirtyBound = "true";
        }
        bindMenus(editor);
        bindTaskLinkPicker(prefix);
        const syncTodayControl = () => {
          const question = document.querySelector("#" + prefix + "Type")?.value === "question";
          const attentionField = document.querySelector("#" + prefix + "AttentionField");
          const questionHint = document.querySelector("#" + prefix + "QuestionTodayHint");
          if (attentionField) attentionField.hidden = question;
          if (questionHint) questionHint.hidden = !question;
          if (question) {
            const checkbox = document.querySelector("#" + prefix + "Attention");
            if (checkbox) checkbox.checked = false;
          }
        };
        document.querySelectorAll('[data-menu-option="' + prefix + 'Type"]').forEach((option) => {
          option.addEventListener("click", () => {
            if (editor) editor.dataset.manualNoteEditorDirty = "true";
            syncTodayControl();
          });
        });
        syncTodayControl();
        document.querySelector("#cancelManualNote")?.addEventListener("click", () => {
          selectedNoteId = creating ? undefined : note.id;
          renderNotes();
          renderNoteDetail();
        });
        document.querySelector("#saveManualNote")?.addEventListener("click", (event) => {
          const content = document.querySelector("#" + prefix + "Content")?.value || "";
          if (!content.trim()) {
            document.querySelector("#" + prefix + "Content")?.focus();
            return;
          }
          const title = document.querySelector("#" + prefix + "Title")?.value.trim() || deriveCaptureTitle(content);
          const primary = document.querySelector("#" + prefix + "TaskEntity")?.value || "oneagent:oneagent";
          const contentType = document.querySelector("#" + prefix + "Type")?.value === "question" ? "question" : "note";
          const attention = Boolean(document.querySelector("#" + prefix + "Attention")?.checked);
          const tags = manualNoteEditorTags(note, attention, contentType);
          event.currentTarget.disabled = true;
          event.currentTarget.textContent = "Saving...";
          vscode?.postMessage({
            type: creating ? "createManualNote" : "updateManualNote",
            id: note?.id,
            expectedUpdatedAt: note?.updatedAt,
            originalPrimary: note ? manualNoteEntityRef(note) : undefined,
            title,
            content,
            contentType,
            primary,
            tags
          });
        });
        document.querySelector("#resolveManualNote")?.addEventListener("click", () => vscode?.postMessage({ type: "resolveManualNote", id: note.id, primary: manualNoteEntityRef(note) }));
        document.querySelector("#archiveManualNote")?.addEventListener("click", () => vscode?.postMessage({ type: "archiveManualNote", id: note.id, primary: manualNoteEntityRef(note) }));
        document.querySelector("#restoreManualNote")?.addEventListener("click", () => vscode?.postMessage({ type: "restoreManualNote", id: note.id, primary: manualNoteEntityRef(note) }));
        document.querySelector("#curateManualNote")?.addEventListener("click", () => vscode?.postMessage({ type: "curateManualNote", id: note.id }));
      }

      function renderInbox() {
        const inbox = state.inbox || [];
        const graphHistory = state.graphChangeHistory || [];
        const graphHistoryState = state.graphChangeHistoryState || {};
        const packages = state.curationPackages || [];
        const history = state.curationPackageHistory || [];
        const historyState = state.curationPackageHistoryState || {};
        if (!selectedInboxId && !selectedCurationPackageId) {
          if (packages.length) selectedCurationPackageId = packages[0].package.id;
          else if (history.length) selectedCurationPackageId = history[0].package.id;
          else if (inbox.length) selectedInboxId = inbox[0].id;
          else if (graphHistory.length) selectedInboxId = graphHistory[0].id;
        }
        const observationCount = packages.reduce((total, detail) => total + Number(detail.counts?.proposed || 0) + Number(detail.counts?.captured || 0), 0);
        const packageHtml = packages.length
          ? '<div class="inbox-section-head"><strong>To review</strong><span>Grouped by source · ' + observationCount + ' information item(s) pending</span></div>' + packages.map((detail) => renderCurationPackageCard(detail, false)).join("")
          : '<div class="inbox-section-head"><strong>To review</strong><span>Nothing pending</span></div><div class="inbox-history-empty">No sourced information currently requires a decision.</div>';
        const historyNotice = historyState.available === false
          ? '<div class="inbox-problems"><strong>Review history unavailable</strong><span>' + escapeHtml(historyState.error || "The installed runtime cannot load accepted and rejected packages. Cached details remain read-only; no action is available until the backend is updated.") + '</span></div>'
          : historyState.partial === true
            ? '<div class="inbox-problems"><strong>Recent history only</strong><span>The snapshot reached its 500-package safety cap. Current results remain reviewable, but older packages are not loaded in this Cockpit snapshot.</span></div>'
            : '';
        const historyHtml = '<div class="inbox-section-head"><strong>Review history</strong><span>' + history.length + ' reviewed package(s)</span></div>' +
          (history.length
            ? history.map((detail) => renderCurationPackageCard(detail, true)).join("")
            : '<div class="inbox-history-empty">No reviewed sourced-information package yet.</div>') + historyNotice;
        const legacyHtml = inbox.length
          ? '<div class="inbox-section-head"><strong>Other proposals</strong><span>' + inbox.length + ' graph, wiki or operational proposal(s)</span></div>' + inbox.map((item) => renderInboxCard(item, false)).join("")
          : '';
        const graphHistoryHtml = graphHistory.length
          ? '<div class="inbox-section-head"><strong>Graph transaction history</strong><span>' + graphHistory.length + ' accepted or rejected transaction(s)</span></div>' + graphHistory.map((item) => renderInboxCard(item, true)).join("")
          : '';
        const graphHistoryNotice = graphHistoryState.available === false
          ? '<div class="inbox-problems"><strong>Graph history partially unavailable</strong><span>' + escapeHtml(graphHistoryState.error || "Some reviewed graph transactions could not be loaded.") + '</span></div>'
          : graphHistoryState.partial === true
            ? '<div class="inbox-problems"><strong>Recent graph history only</strong><span>At least one decision list reached its 50-transaction safety cap.</span></div>'
            : '';
        document.querySelector("#inbox").innerHTML = '<div class="title-row"><div><h1>Inbox</h1><p>Review sourced information before attaching it to an existing entity. Accepting information never creates a new graph entity.</p></div><span class="chip">' + (packages.length + history.length + inbox.length + graphHistory.length) + ' item(s)</span></div>' +
          packageHtml + historyHtml + legacyHtml + graphHistoryHtml + graphHistoryNotice;
        document.querySelectorAll("[data-curation-package-card]").forEach((card) => card.addEventListener("click", () => {
          selectCurationPackage(card.dataset.curationPackageCard);
        }));
        document.querySelectorAll("[data-inbox-card]").forEach((card) => card.addEventListener("click", (event) => {
          if (event.target.closest("button")) return;
          selectInboxItem(card.dataset.inboxCard);
        }));
        document.querySelectorAll("[data-inspect]").forEach((button) => button.addEventListener("click", () => inspectInboxItem(button.dataset.inspect)));
        document.querySelectorAll("[data-preview]").forEach((button) => button.addEventListener("click", () => runInboxAction("previewInbox", button.dataset.preview)));
        document.querySelectorAll("[data-accept]").forEach((button) => button.addEventListener("click", () => runInboxAction("acceptInbox", button.dataset.accept)));
        document.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", () => rejectInboxItem(button.dataset.reject)));
      }

      function renderCurationPackageCard(detail, historical) {
        const item = detail.package || {};
        const counts = detail.counts || {};
        const source = detail.source || {};
        const capture = detail.capture || {};
        const pending = Number(counts.proposed || 0) + Number(counts.captured || 0);
        const progress = Number(counts.accepted || 0) + ' accepted · ' + Number(counts.rejected || 0) + ' rejected · ' + pending + ' pending';
        const wiki = item.wikiDecision === "suggested" ? "Wiki suggested" : "Wiki not needed";
        const reviewed = historical ? relativeTime(item.reviewedAt || item.updatedAt) : "";
        return '<article class="proposal curation-package-card' + (historical ? " history" : "") + (item.id === selectedCurationPackageId ? " selected" : "") + '" data-curation-package-card="' + escapeAttr(item.id) + '">' +
          '<div><strong>' + escapeHtml(item.title || source.title || item.id) + '</strong>' +
          '<span class="package-progress">' + escapeHtml(item.summary || progress) + '</span>' +
          '<div class="proposal-meta"><span class="badge inbox-kind">Sourced information</span><span class="badge">' + escapeHtml(item.status || "pending") + '</span>' +
          '<span class="badge">' + escapeHtml(progress) + '</span>' +
          (reviewed ? '<span class="badge" title="' + escapeAttr(item.reviewedAt || item.updatedAt) + '">Reviewed ' + escapeHtml(reviewed) + '</span>' : '') +
          (source.revision ? '<span class="badge">Source revision ' + escapeHtml(source.revision) + '</span>' : '') +
          (capture.title ? '<span class="badge">Capture: ' + escapeHtml(capture.title) + '</span>' : '') +
          '<span class="badge">' + escapeHtml(wiki) + '</span></div></div>' +
          '<div class="proposal-actions"><button class="action" data-open-curation-package="' + escapeAttr(item.id) + '">' + (historical ? 'Inspect' : 'Review') + '</button></div></article>';
      }

      function relativeTime(iso) {
        const time = Date.parse(iso || "");
        if (!Number.isFinite(time)) return "";
        const minutes = Math.round((Date.now() - time) / 60000);
        if (minutes < 1) return "just now";
        if (minutes < 60) return minutes + " min ago";
        const hours = Math.round(minutes / 60);
        if (hours < 24) return hours + " h ago";
        const days = Math.round(hours / 24);
        if (days < 7) return days + " d ago";
        return new Date(time).toISOString().slice(0, 10);
      }

      function inboxEntityRefLabel(ref) {
        const resolved = refLabel(ref);
        if (resolved !== ref) return resolved;
        const parsed = parseEntityRefString(ref);
        if (!parsed) return ref;
        const entity = (state.entities || []).find((candidate) => candidate.kind === parsed.kind && candidate.id === parsed.id);
        return entity ? (entity.label || entity.id) + " (" + parsed.kind + ")" : ref;
      }

      function renderInboxCard(item, historical = false) {
        const kind = inboxProposalKind(item);
        const captureLabel = inboxCaptureLabel(item);
        const body = inboxDisplayBody(item);
        const when = relativeTime(item.createdAt);
        return '<article class="proposal' + (historical ? " history" : "") + (item.id === selectedInboxId ? " selected" : "") + '" data-inbox-card="' + escapeAttr(item.id) + '">' +
          '<div><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(body || "No description.") + '</span>' +
          '<div class="proposal-meta"><span class="badge inbox-kind ' + escapeAttr(kind.className) + '">' + escapeHtml(kind.label) + '</span>' +
          (when ? '<span class="badge" title="' + escapeAttr(item.createdAt) + '">' + escapeHtml(when) + '</span>' : '') +
          '<span class="badge">' + escapeHtml(item.type) + '</span>' +
          (historical ? '<span class="badge">' + escapeHtml(item.status || "reviewed") + '</span>' : '') +
          (captureLabel ? '<span class="badge">Capture: ' + escapeHtml(captureLabel) + '</span>' : '') +
          (item.productId ? '<span class="badge">' + escapeHtml(item.productId) + '</span>' : '') +
          '</div></div>' +
          '<div class="proposal-actions"><button class="action" data-inspect="' + escapeAttr(item.id) + '">Inspect</button>' + (hasPreviewPatch(item) ? '<button class="action" data-preview="' + escapeAttr(item.id) + '">' + escapeHtml(item.payload?.proposalKind === "graph_change" ? "Preview graph" : "Preview patch") + '</button>' : '') + (historical ? '' : '<button class="action" data-accept="' + escapeAttr(item.id) + '">Accept</button><button class="action" data-reject="' + escapeAttr(item.id) + '">Reject</button>') + '</div></article>';
      }

      function selectInboxItem(id) {
        selectedCurationPackageId = undefined;
        selectedObservationReviewIds.clear();
        selectedInboxId = id;
        renderInbox();
        renderInboxDetail();
        document.querySelector(".side-inbox")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }

      function selectCurationPackage(id) {
        if (selectedCurationPackageId !== id) selectedObservationReviewIds.clear();
        selectedInboxId = undefined;
        selectedCurationPackageId = id;
        renderInbox();
        renderInboxDetail();
        document.querySelector(".side-inbox")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }

      function inspectInboxItem(id) {
        selectedCurationPackageId = undefined;
        selectedObservationReviewIds.clear();
        selectedInboxId = id;
        pendingInboxDetailId = id;
        renderInbox();
        renderInboxDetail();
        vscode?.postMessage({ type: "inspectInbox", id });
        document.querySelector(".side-inbox")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }

      function runInboxAction(type, id) {
        selectedCurationPackageId = undefined;
        selectedObservationReviewIds.clear();
        selectedInboxId = id;
        renderInbox();
        renderInboxDetail();
        vscode?.postMessage({ type, id });
      }

      function rejectInboxItem(id) {
        selectedCurationPackageId = undefined;
        selectedObservationReviewIds.clear();
        selectedInboxId = id;
        renderInbox();
        renderInboxDetail();
        const field = document.querySelector("#inboxFeedback");
        const feedback = String(field?.value || "").trim();
        const item = findInboxItem(id);
        if (item?.payload?.proposalKind === "graph_change" && !feedback) {
          field?.focus();
          field?.setCustomValidity("Explain why this graph change is rejected so the decision remains auditable.");
          field?.reportValidity();
          field?.addEventListener("input", () => field.setCustomValidity(""), { once: true });
          return;
        }
        vscode?.postMessage({ type: "rejectInbox", id, feedback });
      }

      function renderInboxDetail() {
        const packageDetail = findCurationPackage(selectedCurationPackageId);
        if (packageDetail) {
          renderCurationPackageDetail(packageDetail);
          return;
        }
        const item = findInboxItem(selectedInboxId);
        document.querySelector("#inboxDetailStatus").textContent = item ? item.type : "none";
        if (!item) {
          document.querySelector("#inboxDetail").innerHTML = '<p class="summary">Select an inbox item to inspect its source, payload and available actions.</p>';
          return;
        }
        const payload = item.payload || {};
        const isPending = item.status === "pending";
        const detail = inboxDetailCache[item.id];
        const loading = pendingInboxDetailId === item.id;
        const kind = inboxProposalKind(item, detail);
        const sourceLabel = detail?.source?.title || item.sourceId || "";
        const captureLabel = detail?.capture?.title || payload.captureTitle;
        const reviewPath = payload.targetPath || payload.reviewPath;
        const explainer = inboxKindExplainer(payload);
        const metrics = [];
        if (item.status) metrics.push({ label: "Decision", value: item.status });
        if (item.createdAt) metrics.push({ label: "Proposed", value: relativeTime(item.createdAt) || item.createdAt, title: item.createdAt });
        if (item.updatedAt && item.updatedAt !== item.createdAt) metrics.push({ label: "Updated", value: relativeTime(item.updatedAt) || item.updatedAt, title: item.updatedAt });
        if (typeof payload.primaryEntity === "string" && payload.primaryEntity) metrics.push({ label: "Primary entity", value: inboxEntityRefLabel(payload.primaryEntity) });
        if (item.productId) metrics.push({ label: "Product", value: item.productId });
        if (sourceLabel) metrics.push({ label: "Source", value: sourceLabel });
        if (captureLabel) metrics.push({ label: "Capture", value: captureLabel });
        const metricsHtml = metrics.map((metric) =>
          '<div class="metric"' + (metric.title ? ' title="' + escapeAttr(metric.title) + '"' : '') + '><span>' + escapeHtml(metric.label) + '</span><strong>' + escapeHtml(metric.value) + '</strong></div>'
        ).join("");
        document.querySelector("#inboxDetail").innerHTML =
          '<div class="task-detail">' +
          '<div class="detail-title"><b>' + escapeHtml(item.title) + '</b><span class="badge inbox-kind ' + escapeAttr(kind.className) + '">' + escapeHtml(kind.label) + '</span></div>' +
          (explainer ? '<p class="inbox-explainer">' + escapeHtml(explainer) + '</p>' : '') +
          renderInboxProblems(payload) +
          '<p class="summary">' + escapeHtml(item.body || "No description.") + '</p>' +
          '<div class="metrics">' + metricsHtml + '</div>' +
          (reviewPath ? '<div class="field"><label>' + escapeHtml(payload.targetPath ? "Target path" : "Review path") + '</label><input readonly value="' + escapeAttr(reviewPath) + '"></div>' : '') +
          renderInboxProposedContent(item) +
          renderInboxDecision(item) +
          renderInboxDetailEvidence(detail, loading) +
          '<details class="field"><summary>Technical payload</summary><textarea readonly>' + escapeHtml(JSON.stringify(payload, null, 2)) + '</textarea></details>' +
          (isPending ? '<div class="field"><label>Correction instructions for the agent</label><textarea id="inboxFeedback" maxlength="2000" placeholder="Explain what is wrong and what the agent should correct before proposing again.">' + escapeHtml(payload.rejectionFeedback?.message || "") + '</textarea></div>' : '') +
          '<div class="detail-actions"><button class="action" data-side-inspect="' + escapeAttr(item.id) + '">Inspect</button>' + (hasPreviewPatch(item) ? '<button class="action" data-side-preview="' + escapeAttr(item.id) + '">' + escapeHtml(payload.proposalKind === "graph_change" ? "Preview graph" : "Preview patch") + '</button>' : '') + (isPending ? '<button class="action" data-side-accept="' + escapeAttr(item.id) + '">Accept</button><button class="action" data-side-reject="' + escapeAttr(item.id) + '">Reject with instructions</button>' : '') + '</div>' +
          '</div>';
        document.querySelectorAll("[data-inbox-open]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "openFile", path: button.dataset.inboxOpen })));
        document.querySelectorAll("[data-side-inspect]").forEach((button) => button.addEventListener("click", () => inspectInboxItem(button.dataset.sideInspect)));
        document.querySelectorAll("[data-side-preview]").forEach((button) => button.addEventListener("click", () => runInboxAction("previewInbox", button.dataset.sidePreview)));
        document.querySelectorAll("[data-side-accept]").forEach((button) => button.addEventListener("click", () => runInboxAction("acceptInbox", button.dataset.sideAccept)));
        document.querySelectorAll("[data-side-reject]").forEach((button) => button.addEventListener("click", () => rejectInboxItem(button.dataset.sideReject)));
      }

      function renderCurationPackageDetail(detail) {
        const packageRecord = detail.package || {};
        const source = detail.source || {};
        const capture = detail.capture || {};
        const observations = Array.isArray(detail.observations) ? detail.observations : [];
        const loaded = isCurationPackageLoaded(packageRecord.id);
        const readOnly = !loaded;
        const activeIds = new Set(observations.filter((item) => ["captured", "proposed", "accepted"].includes(item.validationStatus)).map((item) => item.id));
        selectedObservationReviewIds = new Set([...selectedObservationReviewIds].filter((id) => activeIds.has(id)));
        const counts = detail.counts || {};
        const accepted = observations.filter((item) => item.validationStatus === "accepted");
        const pending = observations.filter((item) => item.validationStatus === "captured" || item.validationStatus === "proposed");
        const assessment = detail.wikiAssessment || {};
        const canEditWiki = loaded && packageRecord.status !== "rejected" && source.status === "indexed";
        const availability = readOnly
          ? '<div class="inbox-problems"><strong>Cached package detail</strong><span>This package is no longer returned by the installed history backend. Its last known evidence remains visible, but review, correction and wiki actions are disabled.</span></div>'
          : '';
        document.querySelector("#inboxDetailStatus").textContent = packageRecord.status || "pending";
        document.querySelector("#inboxDetail").innerHTML =
          '<div class="task-detail" data-curation-package-detail="' + escapeAttr(packageRecord.id) + '">' +
          '<div class="detail-title"><b>' + escapeHtml(packageRecord.title || source.title || packageRecord.id) + '</b><span class="badge inbox-kind">Sourced information</span></div>' +
          '<p class="inbox-explainer">When an entity is selected, accepting sourced information enriches that existing entity. Without one, it remains source-backed knowledge. No entity or graph node is created; graph changes are always proposed separately.</p>' +
          '<p class="summary">The agent extracted reviewable information from one source. Reviewed packages remain available here so their evidence and optional wiki decision stay auditable.</p>' +
          availability +
          '<div class="metrics">' +
          '<div class="metric"><span>Source</span><strong>' + escapeHtml(source.title || packageRecord.sourceId || "-") + '</strong></div>' +
          '<div class="metric"><span>Revision</span><strong>' + escapeHtml(source.revision || "-") + '</strong></div>' +
          '<div class="metric"><span>Accepted</span><strong>' + Number(counts.accepted || 0) + '</strong></div>' +
          '<div class="metric"><span>Pending</span><strong>' + (Number(counts.proposed || 0) + Number(counts.captured || 0)) + '</strong></div>' +
          '</div>' +
          (capture.title ? '<div class="field"><label>Capture</label><input readonly value="' + escapeAttr(capture.title) + '"></div>' : '') +
          (packageRecord.summary ? '<p class="summary">' + escapeHtml(packageRecord.summary) + '</p>' : '') +
          '<div class="observation-list">' + (observations.length ? observations.map((observation) => renderObservationReview(detail, observation, readOnly)).join("") : '<div class="empty">No sourced information proposed yet.</div>') + '</div>' +
          (pending.length && !readOnly ? renderCurationBatchReview(packageRecord.id) : '') +
          renderGraphProposalComposer(packageRecord, accepted, readOnly) +
          renderPackageWikiDecision(detail, packageRecord, accepted, assessment, canEditWiki, readOnly) +
          '</div>';
        bindCurationPackageDetail(detail);
      }

      function renderObservationReview(detail, observation, readOnly) {
        const status = String(observation.validationStatus || "proposed");
        const canSelect = !readOnly && ["captured", "proposed", "accepted"].includes(status);
        const canEdit = !readOnly && ["captured", "proposed", "accepted"].includes(status);
        const editDisabled = canEdit ? "" : " disabled";
        const subject = observation.subjectKind && observation.subjectId ? observation.subjectKind + ":" + observation.subjectId : "";
        const source = detail.source || {};
        const citation = 'source:' + observation.sourceId + (source.revision ? '@' + source.revision : '') + (observation.sourceChunkId ? '#' + observation.sourceChunkId : '');
        const kinds = ["claim", "decision", "question", "task", "risk", "feature_request", "insight", "metric", "relationship"];
        const kindLabels = {
          claim: "Factual claim",
          decision: "Decision",
          question: "Open question",
          task: "Action or task",
          risk: "Risk",
          feature_request: "Feature request",
          insight: "Insight",
          metric: "Quantitative result",
          relationship: "Relationship"
        };
        const kindOptions = kinds.map((kind) => '<option value="' + kind + '"' + (kind === observation.kind ? ' selected' : '') + '>' + escapeHtml(kindLabels[kind] || kind.replaceAll("_", " ")) + '</option>').join("");
        const relations = (observation.relations || []).filter((relation) =>
          (relation.sourceObservationId === observation.id || relation.targetObservationId === observation.id) &&
          ["supports", "contradicts"].includes(relation.type)
        );
        const evidence = Array.isArray(observation.evidence) && observation.evidence.length
          ? observation.evidence
          : [{ sourceId: observation.sourceId, sourceChunkId: observation.sourceChunkId, excerpt: observation.excerpt, confidence: observation.confidence }];
        const audit = Array.isArray(observation.events) ? observation.events : [];
        return '<section class="observation-review ' + escapeAttr(status) + '" data-observation-review="' + escapeAttr(observation.id) + '">' +
          '<div class="observation-head"><input type="checkbox" data-observation-selected="' + escapeAttr(observation.id) + '"' + (selectedObservationReviewIds.has(observation.id) ? ' checked' : '') + (canSelect ? '' : ' disabled') + ' aria-label="Select observation">' +
          '<div><strong>' + escapeHtml(observation.title) + '</strong><small>' + escapeHtml(status) + ' · ' + escapeHtml(observation.evidenceStatus || "standalone") + (observation.measurement ? ' · measured' : '') + ' · confidence ' + Math.round(Number(observation.confidence || 0) * 100) + '%</small></div></div>' +
          '<div class="observation-fields">' +
          '<div class="field"><label>Title</label><input data-observation-title value="' + escapeAttr(observation.title) + '"' + editDisabled + '></div>' +
          '<div class="field"><label>Interpretation</label><textarea data-observation-body' + editDisabled + '>' + escapeHtml(observation.body) + '</textarea></div>' +
          '<div class="field"><label>Information type</label><select data-observation-kind' + editDisabled + '>' + kindOptions + '</select></div>' +
          '<div class="field"><label>Entity enriched by this information (optional)</label><input data-observation-subject value="' + escapeAttr(subject) + '" placeholder="insight:checkout-speed"' + editDisabled + '><span class="metadata-readonly-note">This attaches sourced information to an existing entity; it does not create one.</span></div>' +
          '<div class="field"><label>Confidence</label><input data-observation-confidence type="number" min="0" max="1" step="0.05" value="' + escapeAttr(observation.confidence) + '"' + editDisabled + '></div>' +
          '</div>' +
          '<div><label class="observation-citation">Exact source evidence · ' + escapeHtml(citation) + '</label>' + evidence.map((item) =>
            '<blockquote class="observation-quote">“' + escapeHtml(item.excerpt) + '”</blockquote><div class="observation-citation">' + escapeHtml('source:' + item.sourceId + (item.sourceChunkId ? '#' + item.sourceChunkId : '')) + '</div>'
          ).join("") + '</div>' +
          renderObservationMetadata(observation.metadata) +
          (observation.staleSourceRevision ? '<div class="inbox-problems"><strong>Stale source revision</strong><span>This evidence belongs to a superseded revision and cannot be newly accepted.</span></div>' : '') +
          (observation.reviewNote ? '<p class="summary">Review note: ' + escapeHtml(observation.reviewNote) + '</p>' : '') +
          (observation.measurement ? '<p class="summary">Measurement: ' + escapeHtml(observation.measurement.note || "Measured") + (observation.measurement.measuredAt ? ' · ' + escapeHtml(observation.measurement.measuredAt) : '') + '</p>' : '') +
          (relations.length ? '<div class="field"><label>Evidence links to validate</label>' + relations.map((relation) => renderObservationRelation(detail, observation, relation, readOnly)).join("") + '</div>' : '') +
          (audit.length ? '<details class="field"><summary>Audit trail · ' + audit.length + ' event(s)</summary><textarea readonly>' + escapeHtml(audit.map((event) => [event.createdAt, event.actor, event.action, event.reason].filter(Boolean).join(" · ")).join("\\n")) + '</textarea></details>' : '') +
          '<div class="field"><label>Reason or measurement note</label><textarea data-observation-reason maxlength="1000" placeholder="Optional for rejection; required for corrections and measurement notes."></textarea></div>' +
          '<div class="detail-actions">' + (canEdit ? '<button class="action" data-save-observation="' + escapeAttr(observation.id) + '">' + (status === "accepted" ? 'Propose correction' : 'Save edits') + '</button>' : '') +
          (!readOnly && status !== "accepted" && status !== "superseded" ? '<button class="action" data-accept-observation="' + escapeAttr(observation.id) + '">Accept information</button>' : '') +
          (!readOnly && status === "accepted" && !observation.measurement ? '<button class="action" data-measure-observation="' + escapeAttr(observation.id) + '">Add measurement note</button>' : '') +
          (!readOnly && status !== "rejected" && status !== "superseded" ? '<button class="action" data-reject-observation="' + escapeAttr(observation.id) + '">Reject</button>' : '') + '</div>' +
          '</section>';
      }

      function renderObservationMetadata(metadata) {
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || Object.keys(metadata).length === 0) return "";
        const proposals = [];
        const remaining = {};
        for (const [key, value] of Object.entries(metadata)) {
          if (isObservationProposalKey(key)) proposals.push(...flattenObservationProposalValue(value, key));
          else remaining[key] = value;
        }
        const promotionAvailable = state.curationCapabilities?.graphProposalPromotion === true;
        const proposalHtml = proposals.length
          ? '<div class="metadata-proposal-list">' + proposals.map(renderObservationMetadataProposal).join("") + '</div>'
          : '';
        const proposalNotice = proposals.length
          ? '<span class="metadata-readonly-note">Review-only proposal metadata. Nothing is materialized in the graph automatically.' + (promotionAvailable ? ' After accepting the observation, use the graph transaction composer below or ask the agent.' : ' The installed backend exposes no promotion action, so these candidates are intentionally non-actionable here.') + '</span>'
          : '';
        const otherHtml = Object.keys(remaining).length
          ? '<details><summary>Other observation metadata</summary><pre class="metadata-json">' + escapeHtml(JSON.stringify(remaining, null, 2)) + '</pre></details>'
          : '';
        return '<section class="observation-metadata"><strong>' + (proposals.length ? 'Proposed entity or relation changes' : 'Observation metadata') + '</strong>' + proposalNotice + proposalHtml + otherHtml + '</section>';
      }

      function isObservationProposalKey(key) {
        const normalized = String(key || "").replaceAll("_", "").replaceAll("-", "").toLowerCase();
        return normalized.includes("propos") || normalized.includes("candidate") || normalized.includes("graphchange") || normalized.includes("unknownentity") || normalized === "entities" || normalized === "relations";
      }

      function flattenObservationProposalValue(value, path) {
        if (Array.isArray(value)) return value.flatMap((item, index) => flattenObservationProposalValue(item, path + "[" + index + "]"));
        if (value && typeof value === "object") {
          const containers = Object.entries(value).filter(([key]) => ["entity", "entities", "relation", "relations", "change", "changes", "proposal", "proposals"].includes(String(key).toLowerCase()));
          if (containers.length > 0) {
            return containers.flatMap(([key, item]) => flattenObservationProposalValue(item, path + "." + key));
          }
        }
        return [{ path, value }];
      }

      function renderObservationMetadataProposal(proposal) {
        const value = proposal.value;
        const path = String(proposal.path || "graph change");
        const objectValue = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        const source = metadataEntityRef(objectValue.source || objectValue.from || objectValue.sourceEntity || objectValue.sourceRef);
        const target = metadataEntityRef(objectValue.target || objectValue.to || objectValue.targetEntity || objectValue.targetRef);
        const relationType = objectValue.relationType || objectValue.relation || objectValue.predicate || (source && target ? objectValue.type : undefined);
        const entity = metadataEntityRef(objectValue.entity || objectValue.entityRef || objectValue.ref || objectValue);
        const relationLike = Boolean(source && target) || path.toLowerCase().includes("relation");
        const kind = relationLike ? "Relation proposal" : (entity || path.toLowerCase().includes("entit")) ? "Entity proposal" : "Graph change proposal";
        const summary = relationLike && (source || target)
          ? [source || "?", relationType ? "--" + relationType + "-->" : "→", target || "?"].join(" ")
          : entity || (typeof value === "string" ? value : objectValue.label || objectValue.name || objectValue.title || path);
        return '<div class="metadata-proposal"><strong>' + escapeHtml(kind) + '</strong><span>' + escapeHtml(summary) + '</span><span>Metadata path: ' + escapeHtml(path) + '</span>' +
          (value && typeof value === "object" ? '<details><summary>Inspect proposed fields</summary><pre class="metadata-json">' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre></details>' : '') + '</div>';
      }

      function metadataEntityRef(value) {
        if (typeof value === "string") return value;
        if (!value || typeof value !== "object" || Array.isArray(value)) return "";
        if (typeof value.ref === "string") return value.ref;
        if (typeof value.entityRef === "string") return value.entityRef;
        if (value.kind && value.id) return String(value.kind) + ":" + String(value.id);
        return String(value.label || value.name || value.id || "");
      }

      function renderObservationRelation(detail, observation, relation, readOnly) {
        const outgoing = relation.sourceObservationId === observation.id;
        const counterpartId = outgoing ? relation.targetObservationId : relation.sourceObservationId;
        const counterpartContext = findObservationInCurationState(counterpartId);
        const counterpart = counterpartContext?.observation;
        const counterpartPackage = counterpartContext?.detail?.package || {};
        const counterpartSource = counterpartContext?.detail?.source || {};
        const crossPackage = Boolean(counterpartPackage.id && counterpartPackage.id !== detail.package?.id);
        const relationLabel = relation.type === "contradicts" ? "Potential contradiction" : "Potential corroboration";
        const label = relationLabel + (outgoing ? " · points to" : " · comes from");
        const bothAccepted = observation.validationStatus === "accepted" && counterpart?.validationStatus === "accepted";
        const canReview = relation.status === "proposed" && !readOnly && counterpartContext?.loaded && bothAccepted;
        const unavailableReason = !counterpart
          ? (state.curationPackageHistoryState?.available === false
              ? "The related observation cannot be loaded because package history is unavailable. Review actions are disabled."
              : "The related observation is not present in the loaded curation state. Review actions are disabled.")
          : !counterpartContext.loaded
            ? "Only a cached copy of the related observation is available. Review actions are disabled."
            : !bothAccepted
              ? "Accept both observations before validating this evidence link."
              : readOnly
                ? "This package is read-only because its backend detail is unavailable."
                : "";
        const counterpartDetail = counterpart
          ? '<span>' + escapeHtml((counterpart.validationStatus || "unknown") + ' · ' + (counterpart.evidenceStatus || "standalone") + (crossPackage ? ' · package ' + (counterpartPackage.title || counterpartPackage.id) : '')) + '</span>' +
            (counterpart.excerpt ? '<blockquote class="observation-quote">“' + escapeHtml(counterpart.excerpt) + '”</blockquote>' : '') +
            '<span class="observation-citation">' + escapeHtml('source:' + (counterpart.sourceId || counterpartPackage.sourceId || "unknown") + (counterpartSource.revision ? '@' + counterpartSource.revision : '') + (counterpart.sourceChunkId ? '#' + counterpart.sourceChunkId : '')) + '</span>'
          : '';
        const openCounterpart = crossPackage && counterpartContext?.loaded
          ? '<button class="action" data-open-evidence-package="' + escapeAttr(counterpartPackage.id) + '">Open related package</button>'
          : '';
        const reviewActions = relation.status === "proposed" && canReview
          ? '<button class="action" data-review-evidence="accepted" data-relation-from="' + escapeAttr(relation.sourceObservationId) + '" data-relation-to="' + escapeAttr(relation.targetObservationId) + '" data-relation-type="' + escapeAttr(relation.type) + '">Accept link</button><button class="action" data-review-evidence="rejected" data-relation-from="' + escapeAttr(relation.sourceObservationId) + '" data-relation-to="' + escapeAttr(relation.targetObservationId) + '" data-relation-type="' + escapeAttr(relation.type) + '">Reject link</button>'
          : '';
        return '<div class="observation-relation"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(counterpart?.title || counterpartId) + '</span>' +
          counterpartDetail +
          (relation.reason ? '<span>' + escapeHtml(relation.reason) + '</span>' : '') +
          '<span>Status: ' + escapeHtml(relation.status) + '</span>' +
          (relation.status === "proposed" && unavailableReason ? '<span class="relation-unavailable">' + escapeHtml(unavailableReason) + '</span>' : '') +
          (openCounterpart || reviewActions ? '<div class="proposal-actions">' + openCounterpart + reviewActions + '</div>' : '') + '</div>';
      }

      function renderCurationBatchReview(packageId) {
        return '<section class="curation-batch"><strong>Batch review</strong><span class="summary"><span data-selected-observation-count>' + selectedObservationReviewIds.size + '</span> information item(s) selected. Accept, reject, or merge only this selection.</span>' +
          '<div class="field"><label>Batch reason</label><textarea id="curationPackageReviewReason" maxlength="1000" placeholder="Optional for rejection; required for merge."></textarea></div>' +
          '<div class="detail-actions"><button class="action" data-batch-accept="' + escapeAttr(packageId) + '">Accept selected information</button><button class="action" data-batch-reject="' + escapeAttr(packageId) + '">Reject selected</button><button class="action" data-batch-merge="' + escapeAttr(packageId) + '">Merge selected</button></div></section>';
      }

      function renderGraphProposalComposer(packageRecord, accepted, readOnly) {
        if (readOnly || !accepted.length || state.curationCapabilities?.graphProposalPromotion !== true) return "";
        return '<section class="curation-batch graph-proposal-composer"><strong>Reviewable graph transaction</strong>'
          + '<span class="summary">Select one or more accepted information items above. Describe why the graph should change, then provide an atomic list of entity or relation operations. This only creates an Inbox proposal; the graph remains unchanged until a separate acceptance.</span>'
          + '<div class="field"><label>Transaction reason</label><textarea id="graphProposalReason" maxlength="2000" placeholder="Why this accepted information justifies the graph change."></textarea></div>'
          + '<div class="field"><label>Changes (JSON array)</label><textarea id="graphProposalChanges" spellcheck="false" placeholder=\\'[{"op":"create_entity","entity":{"kind":"feature","id":"checkout","label":"Checkout"}}]\\'></textarea></div>'
          + '<div class="detail-actions"><button class="action" data-propose-graph-change="' + escapeAttr(packageRecord.id) + '">Create review proposal</button></div></section>';
      }

      function renderPackageWikiDecision(detail, packageRecord, accepted, assessment, canEdit, readOnly) {
        const evidenceIds = new Set(packageRecord.wikiEvidenceObservationIds || []);
        const disabled = canEdit ? '' : ' disabled';
        const target = packageRecord.wikiTarget || {};
        const acceptedSubjects = [...new Set(accepted.map(observationSubjectRef).filter(Boolean))];
        const targetRef = entityRefValue(target.subject) || (acceptedSubjects.length === 1 ? acceptedSubjects[0] : "");
        const homeRef = entityRefValue(target.home) || (packageRecord.productId ? "product:" + packageRecord.productId : "");
        const page = String(target.page || "index.md");
        const productId = String(target.productId || packageRecord.productId || "");
        const candidates = wikiEvidenceCandidates(detail);
        const reasonOptions = [
          ["multi_source_synthesis", "Multi-source synthesis"],
          ["specification", "Specification"],
          ["durable_reference", "Durable reference"],
          ["publication_required", "Publication required"]
        ].map(([value, label]) => '<option value="' + value + '"' + (value === packageRecord.wikiReason ? ' selected' : '') + '>' + label + '</option>').join("");
        const assessmentText = assessment.recommended
          ? 'A durable synthesis may be useful: ' + (assessment.reasons || []).join(" ")
          : 'No page is required. Keep these findings as observations unless a durable synthesis becomes useful.';
        const unavailable = !canEdit
          ? '<span class="metadata-readonly-note">' + (readOnly ? 'Wiki decisions are disabled while only a cached package detail is available.' : 'This reviewed package has no active accepted evidence that can support a new wiki decision.') + '</span>'
          : '';
        return '<section class="wiki-decision"><strong>Optional wiki synthesis</strong><p class="summary">' + escapeHtml(assessmentText) + '</p>' + unavailable +
          '<div class="field"><label>Decision</label><select id="packageWikiDecision"' + disabled + '><option value="not_needed"' + (packageRecord.wikiDecision !== "suggested" ? ' selected' : '') + '>No wiki page needed</option><option value="suggested"' + (packageRecord.wikiDecision === "suggested" ? ' selected' : '') + '>Suggest a wiki page</option></select></div>' +
          '<div class="field"><label>Documentation reason</label><select id="packageWikiReason"' + disabled + '><option value="">Select a reason</option>' + reasonOptions + '</select></div>' +
          '<div class="observation-fields">' +
          '<div class="field"><label>Target entity</label><input id="packageWikiTarget" value="' + escapeAttr(targetRef) + '" placeholder="feature:checkout"' + disabled + '></div>' +
          '<div class="field"><label>Navigation home</label><input id="packageWikiHome" value="' + escapeAttr(homeRef) + '" placeholder="product:oneff (optional when unambiguous)"' + disabled + '></div>' +
          '<div class="field"><label>Page</label><input id="packageWikiPage" value="' + escapeAttr(page) + '" placeholder="index.md"' + disabled + '></div>' +
          '<div class="field"><label>Product id</label><input id="packageWikiProduct" value="' + escapeAttr(productId) + '" placeholder="optional"' + disabled + '></div>' +
          '</div>' +
          '<div class="field"><label>Compatible accepted information <span data-wiki-evidence-count></span></label><div class="wiki-evidence-list">' + (candidates.length ? candidates.map((candidate) =>
            '<label data-wiki-evidence-row><input type="checkbox" data-wiki-evidence="' + escapeAttr(candidate.observation.id) + '" data-wiki-subject="' + escapeAttr(candidate.subject) + '" data-wiki-product="' + escapeAttr(candidate.productId) + '" data-wiki-package="' + escapeAttr(candidate.packageId) + '" data-wiki-locked="' + escapeAttr(canEdit ? "false" : "true") + '"' + (evidenceIds.has(candidate.observation.id) ? ' checked' : '') + disabled + '><span>' + escapeHtml(candidate.observation.title + " · " + candidate.packageTitle) + '</span></label>'
          ).join("") : '<span class="summary">Accept at least one sourced information item before suggesting a page.</span>') + '</div><span class="metadata-readonly-note">Evidence may come from multiple packages, but every selected item must have the same subject and product. The anchor package must contribute at least one item.</span></div>' +
          '<div class="detail-actions"><button class="action" data-save-wiki-decision="' + escapeAttr(packageRecord.id) + '"' + disabled + '>Save wiki decision</button></div></section>';
      }

      function wikiEvidenceCandidates(anchorDetail) {
        const byId = new Map();
        for (const detail of liveCurationPackageDetails()) {
          const packageRecord = detail.package || {};
          if (detail.source?.status !== "indexed") continue;
          for (const observation of detail.observations || []) {
            const subject = observationSubjectRef(observation);
            if (observation.validationStatus !== "accepted" || observation.staleSourceRevision || !subject) continue;
            byId.set(observation.id, {
              observation,
              subject,
              productId: String(observation.productId || packageRecord.productId || ""),
              packageId: packageRecord.id,
              packageTitle: packageRecord.title || detail.source?.title || packageRecord.id
            });
          }
        }
        // Cached history may be unavailable; never lose the anchor's live evidence.
        for (const observation of anchorDetail.observations || []) {
          const subject = observationSubjectRef(observation);
          if (observation.validationStatus !== "accepted" || observation.staleSourceRevision || !subject || byId.has(observation.id)) continue;
          byId.set(observation.id, {
            observation,
            subject,
            productId: String(observation.productId || anchorDetail.package?.productId || ""),
            packageId: anchorDetail.package?.id || observation.packageId,
            packageTitle: anchorDetail.package?.title || anchorDetail.source?.title || anchorDetail.package?.id
          });
        }
        return [...byId.values()].sort((left, right) => left.packageTitle.localeCompare(right.packageTitle) || left.observation.title.localeCompare(right.observation.title));
      }

      function observationSubjectRef(observation) {
        return observation?.subjectKind && observation?.subjectId ? observation.subjectKind + ":" + observation.subjectId : "";
      }

      function entityRefValue(ref) {
        return ref?.kind && ref?.id ? ref.kind + ":" + ref.id : "";
      }

      function refreshWikiEvidenceCompatibility(root) {
        const target = String(root.querySelector("#packageWikiTarget")?.value || "").trim();
        const home = String(root.querySelector("#packageWikiHome")?.value || "").trim();
        const explicitProduct = String(root.querySelector("#packageWikiProduct")?.value || "").trim();
        const homeProduct = home.startsWith("product:") ? home.slice("product:".length) : "";
        const targetProduct = target.startsWith("product:") ? target.slice("product:".length) : "";
        const productId = explicitProduct || homeProduct || targetProduct;
        let visible = 0;
        root.querySelectorAll("[data-wiki-evidence]").forEach((input) => {
          const sameSubject = Boolean(target) && input.dataset.wikiSubject === target;
          const sameProduct = String(input.dataset.wikiProduct || "") === productId;
          const compatible = sameSubject && sameProduct;
          input.disabled = input.dataset.wikiLocked === "true" || !compatible;
          input.closest("[data-wiki-evidence-row]").hidden = !compatible;
          if (!compatible) input.checked = false;
          if (compatible) visible += 1;
        });
        const count = root.querySelector("[data-wiki-evidence-count]");
        if (count) count.textContent = "· " + visible + " available";
      }

      function bindCurationPackageDetail(detail) {
        const root = document.querySelector("#inboxDetail");
        ["#packageWikiTarget", "#packageWikiHome", "#packageWikiProduct"].forEach((selector) => {
          root.querySelector(selector)?.addEventListener("input", () => refreshWikiEvidenceCompatibility(root));
        });
        refreshWikiEvidenceCompatibility(root);
        root.querySelectorAll("[data-observation-selected]").forEach((checkbox) => checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedObservationReviewIds.add(checkbox.dataset.observationSelected);
          else selectedObservationReviewIds.delete(checkbox.dataset.observationSelected);
          const count = root.querySelector("[data-selected-observation-count]");
          if (count) count.textContent = String(selectedObservationReviewIds.size);
        }));
        root.querySelectorAll("[data-save-observation]").forEach((button) => button.addEventListener("click", () => {
          const card = button.closest("[data-observation-review]");
          const reason = requiredReviewReason(card.querySelector("[data-observation-reason]"));
          if (!reason) return;
          vscode?.postMessage({
            type: "editObservation",
            id: button.dataset.saveObservation,
            title: card.querySelector("[data-observation-title]").value,
            body: card.querySelector("[data-observation-body]").value,
            kind: card.querySelector("[data-observation-kind]").value,
            subjectEntity: card.querySelector("[data-observation-subject]").value.trim(),
            confidence: Number(card.querySelector("[data-observation-confidence]").value),
            reason
          });
        }));
        root.querySelectorAll("[data-accept-observation]").forEach((button) => button.addEventListener("click", () => {
          vscode?.postMessage({ type: "reviewObservation", id: button.dataset.acceptObservation, decision: "accepted" });
        }));
        root.querySelectorAll("[data-reject-observation]").forEach((button) => button.addEventListener("click", () => {
          const card = button.closest("[data-observation-review]");
          const reason = card.querySelector("[data-observation-reason]").value.trim();
          vscode?.postMessage({ type: "reviewObservation", id: button.dataset.rejectObservation, decision: "rejected", reason });
        }));
        root.querySelectorAll("[data-measure-observation]").forEach((button) => button.addEventListener("click", () => {
          const card = button.closest("[data-observation-review]");
          const reason = requiredReviewReason(card.querySelector("[data-observation-reason]"));
          if (!reason) return;
          vscode?.postMessage({ type: "measureObservation", id: button.dataset.measureObservation, reason });
        }));
        root.querySelectorAll("[data-review-evidence]").forEach((button) => button.addEventListener("click", () => {
          const card = button.closest("[data-observation-review]");
          const decision = button.dataset.reviewEvidence;
          const reason = decision === "rejected" ? requiredReviewReason(card.querySelector("[data-observation-reason]")) : card.querySelector("[data-observation-reason]").value.trim();
          if (decision === "rejected" && !reason) return;
          vscode?.postMessage({
            type: "reviewObservationEvidence",
            sourceObservationId: button.dataset.relationFrom,
            targetObservationId: button.dataset.relationTo,
            relationType: button.dataset.relationType,
            decision,
            reason
          });
        }));
        root.querySelector("[data-propose-graph-change]")?.addEventListener("click", (event) => {
          const evidenceObservationIds = selectedPackageObservationIds(detail, ["accepted"]);
          const reasonField = root.querySelector("#graphProposalReason");
          const changesField = root.querySelector("#graphProposalChanges");
          const reason = requiredReviewReason(reasonField);
          if (!reason) return;
          if (evidenceObservationIds.length === 0) {
            reasonField.setCustomValidity("Select at least one accepted observation above.");
            reasonField.reportValidity();
            reasonField.addEventListener("input", () => reasonField.setCustomValidity(""), { once: true });
            return;
          }
          let changes;
          try {
            changes = JSON.parse(String(changesField?.value || ""));
            if (!Array.isArray(changes) || changes.length === 0) throw new Error("empty");
          } catch {
            changesField?.setCustomValidity("Provide a non-empty JSON array of graph operations.");
            changesField?.reportValidity();
            changesField?.addEventListener("input", () => changesField.setCustomValidity(""), { once: true });
            return;
          }
          vscode?.postMessage({
            type: "proposeGraphChange",
            packageId: event.currentTarget.dataset.proposeGraphChange,
            title: "Graph proposal · " + (detail.package?.title || detail.package?.id || "curation"),
            reason,
            evidenceObservationIds,
            changes
          });
        });
        root.querySelectorAll("[data-open-evidence-package]").forEach((button) => button.addEventListener("click", () => {
          selectCurationPackage(button.dataset.openEvidencePackage);
        }));
        root.querySelector("[data-batch-accept]")?.addEventListener("click", (event) => {
          const ids = selectedPackageObservationIds(detail, ["captured", "proposed"]);
          if (!ids.length) return;
          vscode?.postMessage({ type: "reviewCurationPackage", id: event.currentTarget.dataset.batchAccept, acceptObservationIds: ids });
        });
        root.querySelector("[data-batch-reject]")?.addEventListener("click", (event) => {
          const ids = selectedPackageObservationIds(detail, ["captured", "proposed"]);
          const reason = root.querySelector("#curationPackageReviewReason").value.trim();
          if (!ids.length) return;
          vscode?.postMessage({ type: "reviewCurationPackage", id: event.currentTarget.dataset.batchReject, rejectObservationIds: ids, reason });
        });
        root.querySelector("[data-batch-merge]")?.addEventListener("click", () => {
          const ids = selectedPackageObservationIds(detail);
          const reason = requiredReviewReason(root.querySelector("#curationPackageReviewReason"));
          if (ids.length < 2 || !reason) return;
          vscode?.postMessage({ type: "mergeObservations", ids, reason });
        });
        root.querySelector("[data-save-wiki-decision]")?.addEventListener("click", (event) => {
          const decision = root.querySelector("#packageWikiDecision").value;
          const reason = root.querySelector("#packageWikiReason").value;
          const target = root.querySelector("#packageWikiTarget")?.value.trim() || "";
          const home = root.querySelector("#packageWikiHome")?.value.trim() || "";
          const page = root.querySelector("#packageWikiPage")?.value.trim() || "index.md";
          const productId = root.querySelector("#packageWikiProduct")?.value.trim() || "";
          const evidenceInputs = [...root.querySelectorAll("[data-wiki-evidence]:checked")];
          const evidenceObservationIds = evidenceInputs.map((input) => input.dataset.wikiEvidence);
          const evidencePackages = new Set(evidenceInputs.map((input) => input.dataset.wikiPackage));
          const anchorIncluded = evidenceInputs.some((input) => input.dataset.wikiPackage === detail.package.id);
          const invalidMultiSource = reason === "multi_source_synthesis" && (evidenceObservationIds.length < 2 || evidencePackages.size < 2);
          if (decision === "suggested" && (!reason || !target || !evidenceObservationIds.length || !anchorIncluded || invalidMultiSource)) {
            if (!reason) root.querySelector("#packageWikiReason")?.focus();
            else if (!target) root.querySelector("#packageWikiTarget")?.focus();
            else root.querySelector("[data-wiki-evidence]:not([disabled])")?.focus();
            return;
          }
          vscode?.postMessage({ type: "setPackageWikiDecision", id: event.currentTarget.dataset.saveWikiDecision, decision, reason, evidenceObservationIds, target, home, page, productId });
        });
      }

      function selectedPackageObservationIds(detail, statuses) {
        const allowedStatuses = Array.isArray(statuses) ? new Set(statuses) : undefined;
        const packageIds = new Set((detail.observations || []).filter((item) => !allowedStatuses || allowedStatuses.has(item.validationStatus)).map((item) => item.id));
        return [...selectedObservationReviewIds].filter((id) => packageIds.has(id));
      }

      function requiredReviewReason(field) {
        const value = String(field?.value || "").trim();
        if (!value) {
          field?.focus();
          field?.setCustomValidity("Explain the decision so it remains auditable.");
          field?.reportValidity();
          field?.addEventListener("input", () => field.setCustomValidity(""), { once: true });
          return "";
        }
        return value;
      }

      // One plain sentence explaining what this proposal kind IS and what
      // Accept / Reject actually do — review-after-write is not obvious.
      function inboxKindExplainer(payload) {
        const kind = String(payload?.proposalKind || "");
        if (kind === "curation_review") {
          const violations = Array.isArray(payload.violations) ? payload.violations : [];
          if (violations.length > 0) {
            return "This curation run finished but reported problems (below) — the knowledge extracted from this capture may be incomplete or missing. Fix the cause first (see Problems), then Reject with instructions to make the agent redo the curation; Accept only archives this report.";
          }
          return "Recap of a finished curation run: the agent already wrote the entities, relations and wiki updates summarized below. Accept archives this recap; Reject with instructions asks the agent to redo the curation.";
        }
        if (kind === "wiki_write_review") {
          return "The agent wants to write this wiki content. Accept applies it; Reject with instructions sends it back.";
        }
        if (kind === "graph_change") {
          return "Reviewable graph transaction backed by accepted observations. Nothing changes before Accept; Accept applies every valid change atomically, while Reject requires an auditable reason.";
        }
        if (kind === "entity_created" || kind === "relation_created" || kind === "organization_link_created") {
          return "Legacy review record: this direct graph change was already applied. Accept archives the record; Reject stores feedback but does not roll the change back.";
        }
        if (kind === "wiki_lint") {
          return "Wiki maintenance found by the lint pass. Accept applies the fix; Reject discards it.";
        }
        return "";
      }

      function renderInboxProblems(payload) {
        const violations = Array.isArray(payload?.violations) ? payload.violations : [];
        const repairs = Array.isArray(payload?.repairs) ? payload.repairs : [];
        if (violations.length === 0 && repairs.length === 0) return "";
        return '<div class="inbox-problems">' +
          (violations.length ? '<strong>Problems (' + violations.length + ')</strong>' + violations.map((violation) =>
            '<span>• [' + escapeHtml(String(violation.rule || "violation")) + '] ' + escapeHtml(String(violation.message || "")) + '</span>'
          ).join("") : "") +
          (repairs.length ? '<strong>Auto-repairs (' + repairs.length + ')</strong>' + repairs.map((repair) =>
            '<span class="repair">• ' + escapeHtml(String(repair)) + '</span>'
          ).join("") : "") +
          '</div>';
      }

      function renderInboxProposedContent(item) {
        const payload = item?.payload || {};
        if (payload.proposalKind === "graph_change") {
          const evidenceIds = Array.isArray(payload.evidenceObservationIds) ? payload.evidenceObservationIds : [];
          const changes = Array.isArray(payload.changes) ? payload.changes : [];
          return '<div class="field"><label>Graph transaction · ' + changes.length + ' change(s)</label><textarea readonly>' + escapeHtml([
            payload.reason ? "Reason: " + payload.reason : "",
            evidenceIds.length ? "Accepted evidence: " + evidenceIds.join(", ") : "",
            ...changes.map((change, index) => (index + 1) + ". " + graphChangeLabel(change))
          ].filter(Boolean).join("\\n\\n")) + '</textarea></div>';
        }
        if (payload.proposalKind === "wiki_write_review" && typeof payload.content === "string") {
          return '<div class="field"><label>Proposed wiki content</label><textarea readonly>' + escapeHtml(payload.content) + '</textarea></div>';
        }
        if (payload.proposalKind === "entity_created" && payload.entity && typeof payload.entity === "object") {
          const entity = payload.entity;
          return '<div class="field"><label>Proposed entity</label><textarea readonly>' + escapeHtml([
            entity.kind && entity.id ? "Entity: " + entity.kind + ":" + entity.id : "",
            entity.label ? "Name: " + entity.label : "",
            entity.status ? "Status: " + entity.status : "",
            entity.focusLevel ? "Focus level: " + entity.focusLevel : "",
            entity.parentId ? "Parent: " + entity.parentId : "",
            entity.description ? "Description:\\n" + entity.description : ""
          ].filter(Boolean).join("\\n\\n")) + '</textarea></div>';
        }
        if (payload.proposalKind === "relation_created" && payload.relation && typeof payload.relation === "object") {
          const relation = payload.relation;
          return '<div class="field"><label>Proposed relation</label><textarea readonly>' + escapeHtml([
            relation.source && relation.type && relation.target ? relation.source + " --" + relation.type + "--> " + relation.target : "",
            relation.description ? "Why:\\n" + relation.description : "",
            payload.captureTitle ? "Source capture: " + payload.captureTitle : ""
          ].filter(Boolean).join("\\n\\n")) + '</textarea></div>';
        }
        if (payload.proposalKind === "organization_link_created" && payload.link && typeof payload.link === "object") {
          const link = payload.link;
          return '<div class="field"><label>Proposed organization link</label><textarea readonly>' + escapeHtml([
            link.sourceId && link.type && link.targetId ? link.sourceId + " --" + link.type + "--> " + link.targetId : "",
            link.description ? "Why:\\n" + link.description : ""
          ].filter(Boolean).join("\\n\\n")) + '</textarea></div>';
        }
        return "";
      }

      function renderInboxDecision(item) {
        if (!item || item.status === "pending") return "";
        const decision = item.payload?.decision || {};
        const parts = [
          "Status: " + String(item.status || decision.status || "reviewed"),
          decision.decidedAt ? "Decided: " + decision.decidedAt : "",
          decision.reason ? "Reason: " + decision.reason : ""
        ].filter(Boolean);
        return '<div class="field"><label>Human decision</label><textarea readonly>' + escapeHtml(parts.join("\\n")) + '</textarea></div>';
      }

      function renderInboxDetailEvidence(detail, loading) {
        if (loading) {
          return '<p class="summary">Loading source, capture and citation context...</p>';
        }
        if (!detail) {
          return '<p class="summary">Use Inspect to load the source document, capture metadata and preview context.</p>';
        }
        let html = "";
        const paths = Array.isArray(detail.paths) ? detail.paths : [];
        if (paths.length) {
          html += '<div class="field"><label>Documents</label><div class="proposal-actions">' + paths.map((entry) =>
            '<button class="action" data-inbox-open="' + escapeAttr(entry.path) + '">' + escapeHtml(entry.label || "Open") + '</button>'
          ).join("") + '</div></div>';
        }
        const source = detail.source || {};
        if (source.id) {
          html += '<div class="metrics">' +
            '<div class="metric"><span>Source title</span><strong>' + escapeHtml(source.title || source.id) + '</strong></div>' +
            '<div class="metric"><span>Status</span><strong>' + escapeHtml(source.status || "-") + '</strong></div>' +
            '<div class="metric"><span>Chunks</span><strong>' + escapeHtml(source.chunkCount ?? "-") + '</strong></div>' +
            '</div>';
        }
        const capture = detail.capture || {};
        if (capture.id) {
          html += '<div class="metrics">' +
            '<div class="metric"><span>Capture</span><strong>' + escapeHtml(capture.title || capture.id) + '</strong></div>' +
            '<div class="metric"><span>Primary</span><strong>' + escapeHtml((capture.primaryEntityKind || "-") + ":" + (capture.primaryEntityId || "-")) + '</strong></div>' +
            '<div class="metric"><span>Curation</span><strong>' + escapeHtml(capture.curationStatus || "-") + '</strong></div>' +
            '</div>';
          if (Array.isArray(capture.relatedEntities) && capture.relatedEntities.length) {
            html += '<div class="field"><label>Related entities</label><textarea readonly>' + escapeHtml(capture.relatedEntities.map((ref) => ref.entityKind + ":" + ref.entityId + " (" + ref.relationType + ")").join("\\n")) + '</textarea></div>';
          }
        }
        const preview = detail.preview || {};
        if (Array.isArray(preview.changes)) {
          html += '<div class="metrics">' +
            '<div class="metric"><span>Decision state</span><strong>' + escapeHtml(preview.status || "-") + '</strong></div>' +
            '<div class="metric"><span>Ready to accept</span><strong>' + escapeHtml(preview.canAccept ? "yes" : "no") + '</strong></div>' +
            '<div class="metric"><span>Changes</span><strong>' + escapeHtml(preview.changes.length) + '</strong></div>' +
            '<div class="metric"><span>Evidence</span><strong>' + escapeHtml(Array.isArray(preview.evidenceObservationIds) ? preview.evidenceObservationIds.length : 0) + '</strong></div>' +
            '</div>';
          if (Array.isArray(preview.conflicts) && preview.conflicts.length) {
            html += '<div class="inbox-problems"><strong>Graph conflicts (' + preview.conflicts.length + ')</strong>' + preview.conflicts.map((conflict) => '<span>• ' + escapeHtml(conflict) + '</span>').join("") + '</div>';
          }
          html += '<div class="field"><label>Transactional preview</label>' + preview.changes.map((change) =>
            '<details><summary>' + escapeHtml((change.index + 1) + ". " + change.action + " · " + change.target) + '</summary><pre class="metadata-json">' + escapeHtml(JSON.stringify({ op: change.op, before: change.before ?? null, after: change.after ?? null, conflicts: change.conflicts || [] }, null, 2)) + '</pre></details>'
          ).join("") + '</div>';
        }
        const graphEvidence = Array.isArray(detail.graphEvidence) ? detail.graphEvidence : [];
        if (graphEvidence.length) {
          html += '<div class="field"><label>Accepted evidence behind this transaction</label>' + graphEvidence.map((entry) => {
            const observation = entry?.observation || {};
            const source = entry?.source || {};
            const secondary = Array.isArray(entry?.evidence) ? entry.evidence : [];
            const citation = 'source:' + (observation.sourceId || source.id || "unknown")
              + (source.revision ? '@' + source.revision : '')
              + (observation.sourceChunkId ? '#' + observation.sourceChunkId : '');
            return '<article class="observation-relation"><strong>' + escapeHtml(observation.title || observation.id || "Evidence") + '</strong>'
              + '<span>' + escapeHtml((observation.validationStatus || "unknown") + ' · ' + (observation.evidenceStatus || "standalone") + ' · confidence ' + Math.round(Number(observation.confidence || 0) * 100) + '%') + '</span>'
              + (observation.body ? '<span>' + escapeHtml(observation.body) + '</span>' : '')
              + (observation.excerpt ? '<blockquote class="observation-quote">“' + escapeHtml(observation.excerpt) + '”</blockquote>' : '')
              + '<span class="observation-citation">' + escapeHtml(citation) + '</span>'
              + (secondary.length ? '<details><summary>' + secondary.length + ' additional evidence citation(s)</summary><pre class="metadata-json">' + escapeHtml(JSON.stringify(secondary, null, 2)) + '</pre></details>' : '')
              + '</article>';
          }).join("") + '</div>';
        }
        if (detail.diff && Array.isArray(detail.diff.lines) && detail.diff.lines.length) {
          html += '<div class="field"><label>Changes · ' + escapeHtml(detail.diff.title || "Diff") + '</label>' + renderDiff(detail.diff) + '</div>';
        }
        const externalReview = detail.externalReview || {};
        if (externalReview.content) {
          const hashText = externalReview.hashMatches === undefined ? "" : (externalReview.hashMatches ? " · hash verified" : " · file changed since proposal");
          html += '<div class="field"><label>Current reviewed file' + escapeHtml(hashText) + '</label><textarea readonly>' + escapeHtml(externalReview.content + (externalReview.truncated ? "\\n\\n[truncated]" : "")) + '</textarea></div>';
        }
        if (preview.content || preview.reason || preview.targetPath) {
          html += '<div class="field"><label>Preview</label><textarea readonly>' + escapeHtml([preview.targetPath ? "Target: " + preview.targetPath : "", preview.reason || "", preview.content || ""].filter(Boolean).join("\\n\\n")) + '</textarea></div>';
        }
        if (source.content) {
          html += '<div class="field"><label>Source excerpt' + (source.truncated ? " (truncated)" : "") + '</label><textarea readonly>' + escapeHtml(source.content) + '</textarea></div>';
        }
        if (Array.isArray(detail.errors) && detail.errors.length) {
          html += '<div class="field"><label>Inspection warnings</label><textarea readonly>' + escapeHtml(detail.errors.join("\\n")) + '</textarea></div>';
        }
        return html;
      }

      function inboxProposalKind(item, detail) {
        const payload = item?.payload || {};
        const proposalKind = String(payload.proposalKind || "");
        const previewAction = String(detail?.preview?.action || item?.previewAction || "");
        if (proposalKind === "graph_change") return { label: "Graph change", className: "link" };
        if (proposalKind === "entity_created") return { label: "Entity creation", className: "create" };
        if (proposalKind === "relation_created") return { label: "Relation creation", className: "link" };
        if (proposalKind === "organization_link_created") return { label: "Org link creation", className: "link" };
        if (proposalKind === "curation_review") {
          // A run that reported violations did NOT deliver clean knowledge —
          // surface it as a problem, not as a routine memory update.
          const violations = Array.isArray(payload.violations) ? payload.violations : [];
          if (violations.length > 0) return { label: "Curation needs attention", className: "attention" };
          return { label: "Existing memory update", className: "update" };
        }
        if (proposalKind === "wiki_lint") return { label: "Wiki maintenance", className: "update" };
        if (proposalKind === "wiki_write_review") return { label: "Wiki write proposal", className: "update" };
        if (proposalKind === "external_wiki_change") return { label: "External wiki change", className: "update" };
        if (previewAction === "create") return { label: "Page creation", className: "create" };
        if (previewAction === "replace") return { label: "Existing page replacement", className: "update" };
        if (previewAction === "append") return { label: "Existing page update", className: "update" };
        if (typeof payload.targetPath === "string" && payload.targetPath.length > 0) return { label: "Page proposal", className: "" };
        if (item?.type === "task") return { label: "Task proposal", className: "" };
        if (item?.type === "open_question") return { label: "Question proposal", className: "" };
        if (item?.type === "risk") return { label: "Risk proposal", className: "" };
        if (item?.type === "decision_candidate") return { label: "Decision proposal", className: "" };
        return { label: "Review proposal", className: "" };
      }

      function inboxCaptureLabel(item) {
        const payload = item?.payload || {};
        if (typeof payload.captureTitle === "string" && payload.captureTitle.length > 0) return payload.captureTitle;
        if (typeof payload.captureId !== "string" || payload.captureId.length === 0) return "";
        const capture = (state.captures || []).find((candidate) => candidate.id === payload.captureId);
        return capture?.title || "";
      }

      function inboxDisplayBody(item) {
        const body = item?.body || "";
        const payload = item?.payload || {};
        const captureLabel = inboxCaptureLabel(item);
        if (!captureLabel || typeof payload.captureId !== "string" || payload.captureId.length === 0) return body;
        return body.split(payload.captureId).join(captureLabel);
      }

      function renderDiff(diff) {
        return '<div class="diff-view">' + diff.lines.map((line) => {
          const type = line.type === "add" || line.type === "remove" ? line.type : "context";
          const prefix = type === "add" ? "+" : type === "remove" ? "-" : " ";
          return '<div class="diff-line ' + escapeAttr(type) + '"><span class="diff-prefix">' + prefix + '</span><span>' + escapeHtml(line.text || "") + '</span></div>';
        }).join("") + '</div>';
      }

      function hasPreviewPatch(item) {
        return Boolean(item?.payload?.targetPath || item?.payload?.proposalKind === "graph_change");
      }

      function graphChangeLabel(change) {
        if (!change || typeof change !== "object") return "Invalid graph change";
        if (change.op === "create_entity") return "Create " + metadataEntityRef(change.entity);
        if (change.op === "update_entity") return "Update " + metadataEntityRef(change.entity);
        if (change.op === "upsert_relation") {
          return metadataEntityRef(change.source) + " --" + String(change.relationType || "related_to") + "--> " + metadataEntityRef(change.target);
        }
        return String(change.op || "Unknown graph change");
      }

      function todayFinite(value) {
        return value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
      }

      function todayNumber(value, maximumFractionDigits = 2) {
        if (!todayFinite(value)) return "—";
        return Number(value).toLocaleString(undefined, { maximumFractionDigits });
      }

      function todayProgress(value) {
        if (!todayFinite(value)) return undefined;
        return Math.max(0, Math.min(100, Number(value)));
      }

      function todayProgressLabel(value) {
        const progress = todayProgress(value);
        return progress === undefined ? "Not measured" : todayNumber(progress, 0) + "%";
      }

      function todayGraphButton(ref, label = "Show in graph") {
        return '<button class="action" data-outcome-graph="' + escapeAttr(ref) + '">' + escapeHtml(label) + '</button>';
      }

      function renderTodaySparkline(kpi) {
        const values = (kpi.measurements || [])
          .map((measurement) => Number(measurement.value))
          .filter((value) => Number.isFinite(value))
          .slice(-18);
        if (!values.length) return '<span class="today-kpi-meta">No measurement yet</span>';
        const width = 132;
        const height = 42;
        const pad = 3;
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const range = maximum - minimum || 1;
        const points = values.map((value, index) => ({
          x: values.length === 1 ? width / 2 : pad + index * ((width - pad * 2) / (values.length - 1)),
          y: height - pad - ((value - minimum) / range) * (height - pad * 2)
        }));
        const path = points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
        const last = points[points.length - 1];
        return '<svg class="today-sparkline" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="KPI trend over ' + values.length + ' measurements"><path d="' + escapeAttr(path) + '"></path><circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3"></circle></svg>';
      }

      function renderTodayKpi(kpi) {
        const definition = kpi.definition || {};
        const unit = definition.unit || "";
        const latest = kpi.latest;
        const trend = String(kpi.trend || "unknown");
        const trendSymbol = trend === "improving" ? "↗" : trend === "worsening" ? "↘" : trend === "stable" ? "→" : "·";
        const target = definition.direction === "range"
          ? [definition.targetMin, definition.targetMax].filter(todayFinite).map((value) => todayNumber(value)).join("–")
          : todayFinite(definition.targetValue) ? todayNumber(definition.targetValue) : "";
        const targetText = target ? "Target " + target + (unit ? " " + unit : "") : "No target";
        const freshness = !latest ? "No data" : kpi.stale ? "Stale" : "Fresh";
        const change = todayFinite(kpi.change) ? (Number(kpi.change) > 0 ? "+" : "") + todayNumber(kpi.change) : "";
        return '<article class="today-kpi">' +
          '<div class="today-kpi-main"><strong>' + escapeHtml(kpi.label || kpi.id) + '</strong>' +
          '<div class="today-kpi-value"><b>' + escapeHtml(latest ? todayNumber(latest.value) : "—") + '</b><span>' + escapeHtml(unit) + '</span></div>' +
          '<div class="today-kpi-meta">' + escapeHtml([targetText, freshness, latest?.measuredAt ? String(latest.measuredAt).slice(0, 10) : "", change ? "Δ " + change : ""].filter(Boolean).join(" · ")) + '</div>' +
          '<div class="today-card-actions"><button class="action" data-edit-kpi="' + escapeAttr(kpi.id) + '">Edit</button><button class="action" data-record-kpi="' + escapeAttr(kpi.id) + '" data-kpi-label="' + escapeAttr(kpi.label || kpi.id) + '" data-kpi-unit="' + escapeAttr(unit) + '">Add measure</button><button class="action" data-compare-kpi="' + escapeAttr(kpi.id) + '" data-kpi-label="' + escapeAttr(kpi.label || kpi.id) + '">Compare</button><button class="action" data-archive-kpi="' + escapeAttr(kpi.id) + '" data-kpi-label="' + escapeAttr(kpi.label || kpi.id) + '">Archive</button>' + todayGraphButton("kpi:" + kpi.id) + '</div></div>' +
          '<div class="today-kpi-viz">' + renderTodaySparkline(kpi) + '<span class="today-trend ' + escapeAttr(trend) + '">' + trendSymbol + ' ' + escapeHtml(trend) + '</span></div>' +
          '</article>';
      }

      function renderTodayKeyResult(keyResult) {
        const progress = todayProgress(keyResult.progress);
        const unit = keyResult.unit || "";
        const values = [];
        if (todayFinite(keyResult.currentValue)) values.push("Current " + todayNumber(keyResult.currentValue) + (unit ? " " + unit : ""));
        if (todayFinite(keyResult.targetValue)) values.push("Target " + todayNumber(keyResult.targetValue) + (unit ? " " + unit : ""));
        if (!values.length && keyResult.dueDate) values.push("Due " + String(keyResult.dueDate).slice(0, 10));
        return '<div class="today-kr"><div class="today-kr-head"><strong>' + escapeHtml(keyResult.title || keyResult.id) + '</strong><span>' + escapeHtml(String(keyResult.status || "not_started").replace(/_/g, " ")) + '</span></div>' +
          '<div class="today-progress"><div class="bar"><span style="width:' + (progress === undefined ? 0 : progress) + '%"></span></div><b>' + escapeHtml(todayProgressLabel(progress)) + '</b></div>' +
          (values.length ? '<div class="today-kr-values"><span>' + escapeHtml(values.join(" · ")) + '</span>' + (keyResult.kpiId ? '<button class="today-alignment-chip" data-outcome-graph="kpi:' + escapeAttr(keyResult.kpiId) + '">KPI ↗</button>' : "") + '</div>' : "") +
          '</div>';
      }

      function renderTodayOkr(okr) {
        const definition = okr.definition || {};
        const progress = todayProgress(okr.progress);
        const status = String(definition.status || "active");
        const statusClass = okr.atRisk || status === "at_risk" || status === "off_track" ? "risk" : status === "achieved" ? "good" : "";
        const period = [definition.periodStart ? String(definition.periodStart).slice(0, 10) : "", definition.periodEnd ? String(definition.periodEnd).slice(0, 10) : ""].filter(Boolean).join(" → ");
        const keyResults = okr.keyResults || definition.keyResults || [];
        const contributions = okr.contributions || [];
        const kpis = okr.kpis || [];
        const contributionHtml = contributions.length
          ? '<div class="today-alignment-row"><span>Work</span><div class="today-alignment-items">' + contributions.map((contribution) =>
              '<button class="today-alignment-chip" data-outcome-graph="' + escapeAttr(contribution.work.kind + ":" + contribution.work.id) + '" title="' + escapeAttr(contribution.expectedImpact || "Contributes to this OKR") + '">' + escapeHtml(contribution.work.label || contribution.work.id) + ' · ' + escapeHtml(contribution.work.kind) + '</button>'
            ).join("") + '</div></div>'
          : '<div class="today-alignment-row"><span>Work</span><div class="today-alignment-items"><span class="today-alignment-chip">No contribution linked</span></div></div>';
        const kpiHtml = kpis.length
          ? '<div class="today-alignment-row"><span>Measures</span><div class="today-alignment-items">' + kpis.map((kpi) =>
              kpi.lifecycleStatus === "archived"
                ? '<span class="today-alignment-chip" title="Historical KPI; measurement history is preserved">' + escapeHtml(kpi.label || kpi.id) + ' · archived</span>'
                : '<button class="today-alignment-chip" data-outcome-graph="kpi:' + escapeAttr(kpi.id) + '">' + escapeHtml(kpi.label || kpi.id) + '</button>'
            ).join("") + '</div></div>'
          : '<div class="today-alignment-row"><span>Measures</span><div class="today-alignment-items"><span class="today-alignment-chip">No KPI linked</span></div></div>';
        return '<article class="today-okr' + (okr.atRisk ? " at-risk" : "") + '">' +
          '<div class="today-okr-top"><div class="today-okr-title"><strong>' + escapeHtml(okr.label || okr.id) + '</strong><span>' + escapeHtml(okr.objective || period || "Structured OKR") + '</span>' + (okr.objective && period ? '<span>' + escapeHtml(period) + '</span>' : "") + '</div><span class="today-status ' + statusClass + '">' + escapeHtml(status.replace(/_/g, " ")) + '</span></div>' +
          '<div class="today-progress"><div class="bar"><span style="width:' + (progress === undefined ? 0 : progress) + '%"></span></div><b>' + escapeHtml(todayProgressLabel(progress)) + '</b></div>' +
          (keyResults.length ? '<div class="today-kr-list">' + keyResults.map(renderTodayKeyResult).join("") + '</div>' : '<div class="today-empty-outcomes">No key result defined.</div>') +
          '<div class="today-alignment">' + contributionHtml + kpiHtml + '</div>' +
          ((okr.riskReasons || []).length ? '<p class="today-mission-copy">' + escapeHtml(okr.riskReasons.join(" ")) + '</p>' : "") +
          '<div class="today-card-actions"><button class="action" data-edit-okr="' + escapeAttr(okr.id) + '">Edit</button><button class="action" data-link-contribution="' + escapeAttr(okr.id) + '">Link work</button>' + todayGraphButton("okr:" + okr.id) + '</div>' +
          '</article>';
      }

      function renderTodayMission(mission) {
        const progress = todayProgress(mission.progress);
        const okrs = mission.okrs || [];
        return '<section class="today-mission"><div class="today-mission-head"><div><div class="today-mission-title"><strong>' + escapeHtml(mission.label || mission.id) + '</strong><span>' + okrs.length + ' OKR' + (okrs.length === 1 ? "" : "s") + (mission.atRiskOkrs ? " · " + mission.atRiskOkrs + " at risk" : "") + '</span></div>' +
          (mission.description ? '<p class="today-mission-copy">' + escapeHtml(mission.description) + '</p>' : "") + '</div><div class="today-outcome-actions"><div class="today-progress-ring"><strong>' + escapeHtml(todayProgressLabel(progress)) + '</strong><span>mission</span></div>' + todayGraphButton("mission:" + mission.id) + '</div></div>' +
          '<div class="today-okr-grid">' + (okrs.length ? okrs.map(renderTodayOkr).join("") : '<div class="today-empty-outcomes">No OKR linked to this mission yet.</div>') + '</div></section>';
      }

      function renderTodayOutcomes(today) {
        const outcomes = today.outcomes;
        if (!outcomes) return "";
        const summary = outcomes.summary || {};
        const missions = outcomes.missions || [];
        const standalone = outcomes.standaloneOkrs || [];
        const kpis = outcomes.kpis || [];
        const alerts = outcomes.alerts || [];
        const metric = (label, value) => '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value ?? 0)) + '</strong></div>';
        let html = '<section class="today-outcomes"><div class="today-outcome-head"><div><h2>Mission, OKRs & KPIs</h2><p>Expected contribution and measured outcomes remain distinct; a KPI trend alone does not establish causality.</p></div><div class="today-outcome-actions"><button class="action" id="todayAddOkr">Add OKR</button><button class="action" id="todayAddKpi">Add KPI</button><button class="action" id="todayLinkContribution">Link work</button><button class="action" id="todayAddMeasurement">Add measure</button></div></div>';
        html += '<div class="today-outcome-metrics">' + metric("Missions", summary.missions) + metric("OKRs", summary.okrs) + metric("At risk", summary.atRiskOkrs) + metric("KPIs", summary.kpis) + metric("Changed", summary.kpisChanged) + metric("Stale", summary.staleKpis) + metric("Work gaps", summary.workWithoutMeasurement) + '</div>';
        if (missions.length) html += '<div class="today-mission-list">' + missions.map(renderTodayMission).join("") + '</div>';
        if (standalone.length) html += '<section class="today-mission"><div class="today-mission-head"><div class="today-mission-title"><strong>Standalone OKRs</strong><span>' + standalone.length + ' not linked to a mission</span></div></div><div class="today-okr-grid">' + standalone.map(renderTodayOkr).join("") + '</div></section>';
        if (!missions.length && !standalone.length) html += '<div class="today-empty-outcomes">No structured OKR yet. Add one when an objective needs explicit steering and measurement.</div>';
        if (kpis.length) html += '<section class="today-kpi-section"><div class="today-outcome-head"><div><h2>KPI trends</h2><p>Latest values, freshness and direction of travel.</p></div></div><div class="today-kpi-grid">' + kpis.map(renderTodayKpi).join("") + '</div></section>';
        if (alerts.length) html += '<section class="today-alert-section"><div class="today-outcome-head"><div><h2>Needs attention</h2><p>Structural or measurement gaps detected from validated outcome data.</p></div><span class="chip">' + alerts.length + '</span></div><div class="today-alerts">' + alerts.map((alert) =>
          '<div class="today-alert ' + escapeAttr(alert.severity || "warning") + '"><i></i><div><strong>' + escapeHtml(alert.entity?.label || alert.kind || "Outcome alert") + '</strong><span>' + escapeHtml(alert.message || "Needs review") + '</span></div>' + (alert.entity ? todayGraphButton(alert.entity.kind + ":" + alert.entity.id, "Inspect") : "") + '</div>'
        ).join("") + '</div></section>';
        return html + '</section>';
      }

      function bindTodayOutcomeActions(root) {
        root.querySelector("#todayAddOkr")?.addEventListener("click", () => vscode?.postMessage({ type: "createOkr" }));
        root.querySelector("#todayAddKpi")?.addEventListener("click", () => vscode?.postMessage({ type: "createKpi" }));
        root.querySelector("#todayLinkContribution")?.addEventListener("click", () => vscode?.postMessage({ type: "linkOutcomeContribution" }));
        root.querySelector("#todayAddMeasurement")?.addEventListener("click", () => vscode?.postMessage({ type: "recordKpiMeasurement" }));
        root.querySelectorAll("[data-edit-okr]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "editOkr", okrId: button.dataset.editOkr })));
        root.querySelectorAll("[data-edit-kpi]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "editKpi", kpiId: button.dataset.editKpi })));
        root.querySelectorAll("[data-record-kpi]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "recordKpiMeasurement", kpiId: button.dataset.recordKpi, label: button.dataset.kpiLabel, unit: button.dataset.kpiUnit })));
        root.querySelectorAll("[data-compare-kpi]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "compareKpi", kpiId: button.dataset.compareKpi, label: button.dataset.kpiLabel })));
        root.querySelectorAll("[data-archive-kpi]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "archiveKpi", kpiId: button.dataset.archiveKpi, label: button.dataset.kpiLabel })));
        root.querySelectorAll("[data-link-contribution]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "linkOutcomeContribution", okrId: button.dataset.linkContribution })));
        root.querySelectorAll("[data-outcome-graph]").forEach((button) => button.addEventListener("click", () => focusGraphOnEntity(button.dataset.outcomeGraph)));
      }

      function renderToday() {
        const root = document.querySelector("#today");
        if (!root) return;
        const today = state.today;
        if (!today) {
          root.innerHTML = '<div class="title-row"><div><h1>Today</h1><p>Daily operational view. Refresh to load.</p></div></div>';
          return;
        }
        const s = today.summary || {};
        const metric = (label, value) => '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value || 0)) + '</strong></div>';
        const itemCard = (item) => '<div class="task"><strong>' + escapeHtml(item.title) + '</strong><span>' +
          escapeHtml([item.status, item.priority, item.deadline ? "due " + item.deadline : "", (item.reasons || []).join("/")].filter(Boolean).join(" · ")) + '</span></div>';
        const captureCard = (capture) => '<div class="task"><strong>' + escapeHtml(capture.title) + '</strong><span>' +
          escapeHtml(capture.contentType + " · " + capture.primaryEntity.kind + ":" + capture.primaryEntity.id) + '</span></div>';
        const inboxCard = (item) => '<div class="task"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.type) + '</span></div>';
        const contradictionCard = (item) => '<div class="task"><strong>' + escapeHtml(item.title) + '</strong><span>' +
          escapeHtml(["contradicted", item.validationStatus, item.subject ? item.subject.kind + ":" + item.subject.id : "", "source " + item.sourceId].filter(Boolean).join(" · ")) + '</span></div>';
        const contextViewCard = (item) => '<div class="task"><strong>' + escapeHtml(item.name) + '</strong><span>' +
          escapeHtml(String(item.proposedNodes || 0) + " proposed node(s) to review") + '</span></div>';
        const notesToRevisit = manualNotes().filter((note) =>
          manualNoteStatus(note) === "active" &&
          (note.contentType === "question" || (note.tags || []).includes(NOTE_ATTENTION_TAG))
        );
        const noteCard = (note) => '<button type="button" class="note-card" data-today-note="' + escapeAttr(note.id) + '"><strong>' +
          escapeHtml(note.title || "Untitled note") + '</strong><p>' + escapeHtml(manualNotePreview(note)) + '</p><div class="note-card-meta"><span class="badge inbox-kind">' +
          escapeHtml(note.contentType === "question" ? "Open question" : "Note") + '</span><span class="badge">' + escapeHtml(manualNoteEntityLabel(note)) + '</span></div></button>';
        const lane = (title, count, body) => '<section class="lane"><h2>' + escapeHtml(title) + '<span>' + count + '</span></h2>' + body + '</section>';
        const activeScope = state.contextScope?.scope && state.contextScope.scope.mode !== "disabled"
          ? "Active agent context"
          : "Portfolio";

        let html = '<div class="title-row"><div><h1>Today</h1><p>What to look at first today — outcomes and operations inside the active OneAgent context.</p></div><div class="proposal-actions"><span class="chip">' + escapeHtml(activeScope) + '</span><button class="action" data-setting-action="refresh">Refresh</button></div></div>';
        html += '<div class="metrics">' + metric("Due soon", s.dueSoon) + metric("Overdue", s.overdue) + metric("Blocked", s.blocked) + metric("Inbox", s.inboxPending) + metric("Notes", notesToRevisit.length) + metric("Contradictions", s.contradictions) + metric("Context views", s.contextViewsToReview) + metric("Agent", s.agentTasks) + metric("Objectives", s.objectives) + metric("Reviews", s.upcomingReviews) + metric("Readiness", s.readinessScore) + '</div>';
        html += renderTodayOutcomes(today);

        const readiness = state.readiness || { score: 0, status: "blocked", signals: [] };
        const readinessSignals = (readiness.signals || []).map((signal) => {
          const color = signal.status === "ready" ? "var(--green)" : signal.status === "blocked" ? "var(--red)" : "var(--yellow)";
          return '<div class="signal"><span>' + escapeHtml(signal.label) + '</span><div><strong style="color:' + color + '">' + escapeHtml(String(signal.count || 0)) + '</strong><span> · ' + escapeHtml(signal.detail || signal.status) + '</span></div></div>';
        }).join("");
        html += '<section class="today-readiness"><div class="side-head"><h2>Planning readiness</h2><span class="chip">' + escapeHtml(readiness.status || "unknown") + '</span></div>' +
          '<div class="side-body"><div class="readiness-score"><strong>' + escapeHtml(String(readiness.score || 0)) + '</strong><span>out of 100</span></div><div>' +
          '<p class="summary">A workload-hygiene indicator for the current scope. Pending inbox items, open questions, candidate decisions, risks, tasks, unvalidated concepts and unreviewed sources lower the score. It is not a property of a graph entity.</p>' +
          '<div class="signals">' + readinessSignals + '</div><div class="detail-actions"><button class="action" id="todayReadinessInbox">Review inbox</button></div></div></div></section>';

        const columns = [];
        if ((today.dueSoon || []).length) columns.push(lane("Due soon", today.dueSoon.length, today.dueSoon.map(itemCard).join("")));
        if ((today.blocked || []).length) columns.push(lane("Blocked", today.blocked.length, today.blocked.map(itemCard).join("")));
        if ((today.agentQueue || []).length) columns.push(lane("Agent queue", today.agentQueue.length, today.agentQueue.map(itemCard).join("")));
        if (notesToRevisit.length) columns.push(lane("Notes to revisit", notesToRevisit.length, notesToRevisit.map(noteCard).join("")));
        for (const group of today.activeWork || []) {
          columns.push(lane("Active · " + group.entity.label, group.items.length, group.items.map(itemCard).join("")));
        }
        if ((today.objectives || []).length) columns.push(lane("Objectives", today.objectives.length, today.objectives.map(captureCard).join("")));
        if ((today.upcomingReviews || []).length) columns.push(lane("Upcoming reviews", today.upcomingReviews.length, today.upcomingReviews.map(captureCard).join("")));
        if ((today.contradictions || []).length) columns.push(lane("Contradictions to resolve", today.contradictions.length, today.contradictions.map(contradictionCard).join("")));
        if ((today.contextViewsToReview || []).length) columns.push(lane("Context views to review", today.contextViewsToReview.length, today.contextViewsToReview.map(contextViewCard).join("")));
        if ((today.inbox || []).length) columns.push(lane("Inbox to review", today.inbox.length, today.inbox.map(inboxCard).join("")));

        html += columns.length ? '<div class="columns">' + columns.join("") + '</div>' : '<div class="empty">Nothing pressing today.</div>';
        root.innerHTML = html;
        bindSettingsActions(root);
        bindTodayOutcomeActions(root);
        root.querySelector("#todayReadinessInbox")?.addEventListener("click", () => setActiveView("inbox"));
        root.querySelectorAll("[data-today-note]").forEach((card) => card.addEventListener("click", () => {
          setActiveView("notes");
          selectManualNote(card.dataset.todayNote);
        }));
      }

      function renderSources() {
        const sources = (state.sources || []).slice(0, 120);
        const captures = (state.captures || []).slice(0, 120);
        const capturesHtml = '<div class="title-row"><div><h1>Captures</h1><p>Pasted memory written as Markdown, classified on entities, then ingested.</p></div><div class="proposal-actions"><span class="chip">' + captures.length + ' captures</span><button class="action" data-help-guide="ingestion">How ingestion works</button></div></div><div class="list-grid">' + (captures.length ? captures.map((capture) => {
          const relatedSummary = (capture.relatedEntities || []).map((related) => related.entityKind + ":" + related.entityId + " (" + related.relationType + ")").join(", ");
          return '<article class="source-card"><strong>' + escapeHtml(capture.title) + '</strong>' +
            '<span>' + escapeHtml((capture.contentType || "raw_input") + " · " + capture.primaryEntityKind + ":" + capture.primaryEntityId) + '</span>' +
            (relatedSummary ? '<span>related: ' + escapeHtml(relatedSummary) + '</span>' : '') +
            (capture.error ? '<span>ingestion error: ' + escapeHtml(capture.error) + '</span>' : '') +
            (capture.curationStatus === "failed" && capture.curationSummary ? '<span class="failure-detail">Curation failed: ' + escapeHtml(capture.curationSummary) + '</span>' : '') +
            '<div class="proposal-actions"><span class="badge ingestion-' + escapeAttr(capture.ingestionStatus || "not_ingested") + '">' + escapeHtml(capture.ingestionStatus || "not_ingested") + '</span>' +
            '<span class="badge curation-' + escapeAttr(capture.curationStatus || "pending") + '" title="Agent curation status of this capture">curation: ' + escapeHtml(capture.curationStatus || "pending") + '</span>' +
            '<span class="badge">' + escapeHtml(capture.status || "captured") + '</span>' +
            (capture.path ? '<button class="action" data-open-capture="' + escapeAttr(capture.path) + '">Open</button>' : '') +
            '<button class="action" data-reingest-capture="' + escapeAttr(capture.id) + '">Reingest</button>' +
            '<button class="action" data-curate-capture="' + escapeAttr(capture.id) + '">Curate</button>' +
            '<button class="action" data-graph-entity="' + escapeAttr(capture.primaryEntityKind + ":" + capture.primaryEntityId) + '">Show in graph</button>' +
            (capture.status === "reviewed" ? '' : '<button class="action" data-review-capture="' + escapeAttr(capture.id) + '">Mark reviewed</button>') +
            '<button class="action danger" data-delete-capture="' + escapeAttr(capture.id) + '" data-delete-capture-title="' + escapeAttr(capture.title) + '" title="Delete this capture, its indexed content and pending reviews">Delete</button>' +
            '</div></article>';
        }).join("") : '<div class="empty">No captures yet. Use Capture memory to paste one.</div>') + '</div>';
        const sourcesHtml = '<div class="title-row"><div><h1>Sources</h1><p>Indexed source files and wiki pages attached to the active scope.</p></div><span class="chip">' + sources.length + ' indexed</span></div><div class="list-grid">' + (sources.length ? sources.map((source) =>
          '<article class="source-card"><strong>' + escapeHtml(source.title) + '</strong><span>' + escapeHtml((source.sourceType || "source") + " · " + (source.status || "unknown") + " · " + (source.chunkCount || 0) + " chunks") + '</span><span>' + escapeHtml(source.rawPath || source.originUri || source.id) + '</span></article>'
        ).join("") : '<div class="empty">No indexed sources yet.</div>') + '</div>';
        document.querySelector("#sources").innerHTML = capturesHtml + sourcesHtml;
        document.querySelectorAll("[data-reingest-capture]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "reingestCapture", id: button.dataset.reingestCapture })));
        document.querySelectorAll("[data-curate-capture]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "curateCapture", id: button.dataset.curateCapture })));
        document.querySelectorAll("[data-open-capture]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "openFile", path: button.dataset.openCapture })));
        document.querySelectorAll("[data-review-capture]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "reviewCapture", id: button.dataset.reviewCapture })));
        document.querySelectorAll("[data-delete-capture]").forEach((button) => button.addEventListener("click", () => vscode?.postMessage({ type: "deleteCapture", id: button.dataset.deleteCapture, title: button.dataset.deleteCaptureTitle })));
        document.querySelectorAll("[data-graph-entity]").forEach((button) => button.addEventListener("click", () => {
          const filterInput = document.querySelector("#filter");
          if (filterInput) filterInput.value = button.dataset.graphEntity.split(":").slice(1).join(":");
          setActiveView("map");
          renderGraph();
        }));
      }

      function renderSettings() {
        const graph = state.graph || {};
        const diagnostics = state.diagnostics || {};
        const counts = diagnostics.counts || {};
        const version = state.extensionVersion || "unknown";
        document.querySelector("#settings").innerHTML =
          '<div class="title-row"><div><h1>Settings</h1><p>Runtime health and cockpit configuration.</p></div><span class="chip">local-first</span></div>' +
          '<div class="list-grid">' +
          '<article class="settings-card"><strong>Version</strong><span>OneAgent ' + escapeHtml(version) + '</span><span>Installed extension package</span><div class="proposal-actions"><button class="action" data-setting-action="checkForUpdates">Check for updates</button></div></article>' +
          '<article class="settings-card"><strong>Help & guides</strong><span>Built-in, searchable documentation</span><span>Ingestion, Graph, views, agent context, Context Packs, notes and local search.</span><div class="proposal-actions"><button class="action" data-help-guide="start">Open help</button><button class="action" data-help-guide="local-ai">Local search</button></div></article>' +
          '<article class="settings-card"><strong>Runtime</strong><span>Markdown + SQLite full-text</span><span>Local knowledge and graph index</span></article>' +
          '<article class="settings-card"><strong>Storage</strong><span>' + escapeHtml((counts.sources || 0) + " sources · " + (counts.chunks || 0) + " chunks") + '</span><span>' + escapeHtml(diagnostics.databasePath || "No database path") + '</span></article>' +
          '<article class="settings-card"><strong>Scope</strong><span>' + escapeHtml(graph.scope || "portfolio") + '</span><span>' + escapeHtml((graph.includedProductIds || []).join(" · ") || "No product configured") + '</span></article>' +
          '<article class="settings-card"><strong>Graph</strong><span>' + escapeHtml((graph.nodes || []).length + " nodes · " + (graph.edges || []).length + " edges") + '</span><span>Graphify diagnostics: ' + escapeHtml((graph.diagnostics || []).length) + '</span></article>' +
          '<article class="settings-card"><strong>Quick actions</strong><span>Common actions — the full grouped set is in Runtime actions →</span><div class="proposal-actions"><button class="action" data-setting-action="upsertEntity">Add entity</button><button class="action" data-setting-action="showCaptureForm">Capture memory</button><button class="action" data-setting-action="refresh">Refresh</button></div></article>' +
          '</div>' +
          '<section class="settings-section"><div class="side-head"><h2>Taxonomy</h2><span class="chip">workspace</span></div><div class="side-body" id="taxonomyBody"></div></section>' +
          '<section class="settings-section"><div class="side-head"><h2>Agent context</h2><span class="chip" id="contextScopeStatus">off</span></div><div class="side-body" id="contextScopeBody"></div></section>';
        bindSettingsActions(document.querySelector("#settings"));
        renderTaxonomy();
      }

      const TAXONOMY_COLOR_POOL = ["#3643ba", "#10a86b", "#ff9a3d", "#ff62d3", "#b66cff", "#156767", "#72265d", "#5f701d", "#0b1788", "#78381d"];

      function renderTaxonomy() {
        const root = document.querySelector("#taxonomyBody");
        if (!root) return;
        const model = taxonomyModel();
        const entityCount = model.entityKinds.filter((kind) => !kind.aliasOf).length;
        const relationCount = model.relationTypes.filter((type) => !type.aliasOf).length;
        let html = '<div class="tax-tabs">' +
          '<button data-tax="tab" data-tab="entities"' + (taxonomyUi.tab === "entities" ? ' class="active"' : "") + '>Entity types (' + entityCount + ')</button>' +
          '<button data-tax="tab" data-tab="relations"' + (taxonomyUi.tab === "relations" ? ' class="active"' : "") + '>Relation types (' + relationCount + ')</button>' +
          '</div>';
        html += taxonomyUi.tab === "entities" ? taxonomyEntityPaneHtml(model) : taxonomyRelationPaneHtml(model);
        root.innerHTML = html;
        bindTaxonomyActions(root);
      }

      function taxonomyKindLabel(kind) {
        if (!kind.builtin) return kind.label || kind.id;
        return typeLabel(kind.id).replace(/ies$/, "y").replace(/([a-rt-z])s$/, "$1");
      }

      function taxonomyKindRowHtml(kind, model) {
        const isAliased = Boolean(kind.aliasOf);
        const dotColor = kind.builtin ? (colors[kind.id] || "#8a8f9b") : (kind.color || "#8a8f9b");
        const badge = kind.core
          ? '<span class="tax-badge">core</span>'
          : kind.builtin
            ? '<span class="tax-badge">built-in</span>'
            : '<span class="tax-badge custom">custom</span>';
        let actions = "";
        if (isAliased) {
          actions = '<span class="tax-usage">alias → ' + escapeHtml(kind.aliasOf) + '</span>' +
            '<div class="tax-actions"><button class="action" data-tax="unaliasKind" data-id="' + escapeAttr(kind.id) + '" title="Stop redirecting this type">Un-alias</button></div>';
        } else if (kind.core) {
          actions = '<span class="tax-lock" title="Core type: wired into the pipelines (product scoping, people, workspace config) — can never be merged or deleted.">🔒</span>';
        } else if (kind.builtin) {
          actions = '<div class="tax-actions"><button class="action" data-tax="openMergeKind" data-id="' + escapeAttr(kind.id) + '" title="Merge into another type (this built-in becomes an alias)">⇄ Merge</button></div>';
        } else {
          actions = '<div class="tax-actions">' +
            '<button class="action" data-tax="editKind" data-id="' + escapeAttr(kind.id) + '" title="Edit label, color, description">✎</button>' +
            '<button class="action" data-tax="openMergeKind" data-id="' + escapeAttr(kind.id) + '" title="Merge into another type">⇄ Merge</button>' +
            '<button class="action danger" data-tax="deleteKind" data-id="' + escapeAttr(kind.id) + '" data-count="' + escapeAttr(String(kind.count || 0)) + '" title="' + (kind.count ? "Entities still use this type — opens merge" : "Delete this type") + '">🗑</button>' +
            '</div>';
        }
        return '<div class="tax-row">' +
          '<span class="tax-dot" style="background:' + escapeAttr(dotColor) + '"></span>' +
          '<div class="tax-main"><div class="tax-title"><b>' + escapeHtml(taxonomyKindLabel(kind)) + '</b><code>' + escapeHtml(kind.id) + '</code></div>' +
          (kind.description ? '<p class="tax-desc">' + escapeHtml(kind.description) + '</p>' : "") +
          '</div>' +
          '<span class="tax-usage">' + escapeHtml(String(kind.count || 0)) + ' entit' + (kind.count === 1 ? "y" : "ies") + '</span>' +
          badge + actions +
          '</div>' +
          (taxonomyUi.mergeKindId === kind.id ? taxonomyMergeKindBoxHtml(kind, model) : "");
      }

      function taxonomyMergeKindBoxHtml(kind, model) {
        // Sensible targets first: custom kinds, then vocabulary built-ins, then core
        // (minus the oneagent fallback, which should never absorb a whole type).
        const candidates = model.entityKinds
          .filter((entry) => !entry.aliasOf && entry.id !== kind.id && entry.id !== "oneagent")
          .sort((left, right) => (Number(left.builtin) - Number(right.builtin)) || (Number(left.core) - Number(right.core)));
        const options = candidates
          .map((entry) => '<option value="' + escapeAttr(entry.id) + '">' + escapeHtml(taxonomyKindLabel(entry) + " (" + (entry.builtin ? "built-in" : "custom") + ")") + '</option>')
          .join("");
        const explanation = kind.builtin
          ? "Its " + (kind.count || 0) + " entities are retyped. The built-in type is not deleted — it becomes an <b>alias</b>: anything still emitting it is converted automatically. Reversible (un-alias)."
          : "Its " + (kind.count || 0) + " entities are retyped and the custom type disappears. Color, graph filters and the curation prompt follow.";
        return '<div class="tax-box">' +
          '<p>Merge <b>' + escapeHtml(kind.label || kind.id) + '</b> into another type. ' + explanation + '</p>' +
          '<div class="tax-box-row"><span>Merge into</span><select id="taxMergeKindTarget">' + options + '</select>' +
          '<button class="action" data-tax="confirmMergeKind" data-id="' + escapeAttr(kind.id) + '" data-builtin="' + (kind.builtin ? "1" : "") + '">Merge type</button>' +
          '<button class="action" data-tax="closeMergeKind">Cancel</button></div>' +
          '</div>';
      }

      function taxonomyKindFormHtml(model) {
        const editing = taxonomyUi.editKindId ? model.entityKinds.find((kind) => kind.id === taxonomyUi.editKindId) : undefined;
        const customCount = model.entityKinds.filter((kind) => !kind.builtin).length;
        const selectedColor = (editing && editing.color) || TAXONOMY_COLOR_POOL[customCount % TAXONOMY_COLOR_POOL.length];
        const swatches = TAXONOMY_COLOR_POOL.map((color) =>
          '<button type="button" class="tax-swatch' + (color.toLowerCase() === String(selectedColor).toLowerCase() ? " sel" : "") + '" data-tax="swatch" data-color="' + escapeAttr(color) + '" style="background:' + escapeAttr(color) + '"></button>'
        ).join("");
        return '<div class="tax-form">' +
          '<div class="entity-edit-grid">' +
          '<div class="field"><label>Label</label><input id="taxKindLabel" maxlength="60" value="' + escapeAttr(editing ? (editing.label || editing.id) : "") + '" placeholder="OKR"></div>' +
          '<div class="field"><label>Id (slug)</label><input value="' + escapeAttr(editing ? editing.id : "auto from label") + '" disabled></div>' +
          '</div>' +
          '<div class="field"><label>Color</label><div class="tax-swatches">' + swatches + '</div></div>' +
          '<div class="field"><label>When to use *</label><textarea id="taxKindDescription" maxlength="600" placeholder="Quarterly personal or team objective with measurable key results. Use when a capture is about a dated objective, not a product feature.">' + escapeHtml(editing ? (editing.description || "") : "") + '</textarea>' +
          '<span class="hint"><b>⚠ Injected into the curation prompt</b> — this text teaches the agent when to classify into this type.</span></div>' +
          '<div class="detail-actions"><button class="action" data-tax="cancelKindForm">Cancel</button>' +
          '<button class="action" data-tax="saveKind"' + (editing ? ' data-id="' + escapeAttr(editing.id) + '"' : "") + '>' + (editing ? "Save type" : "Create type") + '</button></div>' +
          '</div>';
      }

      function taxonomyEntityPaneHtml(model) {
        const customs = model.entityKinds.filter((kind) => !kind.builtin);
        const builtins = model.entityKinds.filter((kind) => kind.builtin);
        let html = '<div class="tax-banner">🔒 The <b>core</b> types (person, product, team, repository, discovery, oneagent, domain, subdomain) are read-only. Vocabulary built-ins merge by alias; <b>custom</b> types are yours — available immediately in the graph, capture and curation.</div>';
        html += '<div class="tax-sec-head"><label>Custom · ' + customs.length + '</label><button class="action" data-tax="newKind">+ New entity type</button></div>';
        if (taxonomyUi.kindFormOpen || taxonomyUi.editKindId) {
          html += taxonomyKindFormHtml(model);
        }
        html += customs.map((kind) => taxonomyKindRowHtml(kind, model)).join("") || (taxonomyUi.kindFormOpen ? "" : '<p class="summary" style="margin:0">No custom types yet. Add one to extend the agent vocabulary.</p>');
        html += '<div class="tax-sec-head"><label>Built-in · ' + builtins.length + '</label></div>';
        html += '<p class="tax-relgroup">🔒 core — never mergeable (wired into pipelines) · ⇄ vocabulary — mergeable by alias</p>';
        html += builtins.map((kind) => taxonomyKindRowHtml(kind, model)).join("");
        return html;
      }

      function taxonomyRelationPaneHtml(model) {
        const detected = model.detectedCustomRelations;
        const customs = model.relationTypes.filter((type) => !type.builtin);
        const aliases = Object.entries(model.relationTypeAliases);
        let html = '<div class="tax-banner">Custom relations already work with the <b>custom:</b> prefix — here you formalize them: label, category (for the graph filters) and reading direction.</div>';
        if (detected.length) {
          html += '<div class="tax-sec-head"><label>Detected in your data · ' + detected.length + '</label></div>';
          html += detected.map((entry) =>
            '<div class="tax-row"><span class="tax-dot"></span>' +
            '<div class="tax-main"><div class="tax-title"><b>' + escapeHtml(entry.type) + '</b></div><p class="tax-desc">Created on the fly by the agent, never formalized.</p></div>' +
            '<span class="tax-usage">' + escapeHtml(String(entry.count)) + ' relation' + (entry.count === 1 ? "" : "s") + '</span>' +
            '<div class="tax-actions"><button class="action" data-tax="formalize" data-type="' + escapeAttr(entry.type) + '">Formalize</button></div></div>'
          ).join("");
        }
        html += '<div class="tax-sec-head"><label>Custom types · ' + customs.length + '</label><button class="action" data-tax="newRelation">+ New relation type</button></div>';
        if (taxonomyUi.relFormOpen || taxonomyUi.formalizeType) {
          html += taxonomyRelationFormHtml();
        }
        html += customs.map((type) =>
          '<div class="tax-row"><span class="tax-dot" style="background:var(--blue)"></span>' +
          '<div class="tax-main"><div class="tax-title"><b>' + escapeHtml(type.type) + '</b><code>' + escapeHtml(type.category) + '</code></div>' +
          (type.reading ? '<p class="tax-desc">' + escapeHtml(type.reading) + '</p>' : "") + '</div>' +
          '<span class="tax-usage">' + escapeHtml(String(type.count || 0)) + ' relation' + (type.count === 1 ? "" : "s") + '</span>' +
          '<span class="tax-badge custom">custom</span>' +
          '<div class="tax-actions"><button class="action" data-tax="openMergeRel" data-type="' + escapeAttr(type.type) + '">⇄ Merge</button></div></div>' +
          (taxonomyUi.mergeRelType === type.type ? taxonomyMergeRelBoxHtml(type, model) : "")
        ).join("") || (taxonomyUi.relFormOpen || taxonomyUi.formalizeType ? "" : '<p class="summary" style="margin:0">No formalized custom relation types yet.</p>');
        if (aliases.length) {
          html += '<div class="tax-sec-head"><label>Merged types (aliases) · ' + aliases.length + '</label></div>';
          html += aliases.map(([from, alias]) =>
            '<div class="tax-row"><span class="tax-dot"></span>' +
            '<div class="tax-main"><div class="tax-title"><b>' + escapeHtml(from) + '</b><code>→ ' + escapeHtml(alias.into) + (alias.swapDirection ? " (swapped)" : "") + '</code></div></div>' +
            '<div class="tax-actions"><button class="action" data-tax="unaliasRelation" data-type="' + escapeAttr(from) + '">Un-alias</button></div></div>'
          ).join("");
        }
        const vocab = model.relationTypes.filter((type) => type.builtin && !type.aliasOf);
        const categories = [["structural", "Structure"], ["work", "Work"], ["people", "People"], ["practice_mission", "Practice & mission"]];
        html += '<div class="tax-sec-head"><label>Vocabulary · ' + vocab.length + ' built-in</label></div>';
        html += categories.map(([key, label]) =>
          '<p class="tax-relgroup"><b>' + escapeHtml(label) + '</b> · ' + escapeHtml(vocab.filter((type) => type.category === key).map((type) => type.type).join(", ")) + '</p>'
        ).join("");
        return html;
      }

      function taxonomyRelationFormHtml() {
        const prefill = taxonomyUi.formalizeType ? taxonomyUi.formalizeType.replace(/^custom:/, "") : "";
        return '<div class="tax-form">' +
          '<div class="entity-edit-grid">' +
          '<div class="field"><label>Type *</label><input id="taxRelType" maxlength="60" value="' + escapeAttr(prefill) + '" placeholder="informed_by"></div>' +
          '<div class="field"><label>Category</label><select id="taxRelCategory"><option value="structural">Structure</option><option value="work" selected>Work</option><option value="people">People</option><option value="practice_mission">Practice &amp; mission</option></select></div>' +
          '</div>' +
          '<div class="field"><label>Reading direction</label><input id="taxRelReading" maxlength="200" placeholder="A informed_by B reads: A is informed by B">' +
          '<span class="hint">Shown in the relation composer and injected into the curation prompt.</span></div>' +
          (taxonomyUi.formalizeType ? '<p class="hint" style="margin:0">Formalizing <b>' + escapeHtml(taxonomyUi.formalizeType) + '</b>: its existing relations are remapped onto the new type.</p>' : "") +
          '<div class="detail-actions"><button class="action" data-tax="cancelRelForm">Cancel</button>' +
          '<button class="action" data-tax="saveRelation"' + (taxonomyUi.formalizeType ? ' data-absorb="' + escapeAttr(taxonomyUi.formalizeType) + '"' : "") + '>' + (taxonomyUi.formalizeType ? "Formalize type" : "Create type") + '</button></div>' +
          '</div>';
      }

      function taxonomyMergeRelBoxHtml(type, model) {
        const options = model.relationTypes
          .filter((entry) => !entry.aliasOf && entry.type !== type.type)
          .map((entry) => '<option value="' + escapeAttr(entry.type) + '">' + escapeHtml(entry.type + " (" + entry.category + ")") + '</option>')
          .join("");
        return '<div class="tax-box">' +
          '<p>Merge <b>' + escapeHtml(type.type) + '</b> into a vocabulary type: its ' + (type.count || 0) + ' relation(s) are remapped, the type disappears.</p>' +
          '<div class="tax-box-row"><span>Merge into</span><select id="taxMergeRelTarget">' + options + '</select>' +
          '<label><input type="checkbox" id="taxMergeRelSwap"> swap source ↔ target</label></div>' +
          '<div class="tax-box-row"><button class="action" data-tax="confirmMergeRel" data-type="' + escapeAttr(type.type) + '">Merge type</button>' +
          '<button class="action" data-tax="closeMergeRel">Cancel</button></div>' +
          '</div>';
      }

      function bindTaxonomyActions(root) {
        root.querySelectorAll("[data-tax]").forEach((button) => button.addEventListener("click", () => {
          const action = button.dataset.tax;
          if (action === "tab") {
            taxonomyUi.tab = button.dataset.tab;
            renderTaxonomy();
          } else if (action === "newKind") {
            taxonomyUi.kindFormOpen = !taxonomyUi.kindFormOpen;
            taxonomyUi.editKindId = undefined;
            renderTaxonomy();
          } else if (action === "editKind") {
            taxonomyUi.editKindId = button.dataset.id;
            taxonomyUi.kindFormOpen = false;
            renderTaxonomy();
          } else if (action === "cancelKindForm") {
            taxonomyUi.kindFormOpen = false;
            taxonomyUi.editKindId = undefined;
            renderTaxonomy();
          } else if (action === "swatch") {
            root.querySelectorAll(".tax-swatch").forEach((swatch) => swatch.classList.toggle("sel", swatch === button));
          } else if (action === "saveKind") {
            const label = document.querySelector("#taxKindLabel")?.value?.trim() || "";
            const description = document.querySelector("#taxKindDescription")?.value?.trim() || "";
            const color = root.querySelector(".tax-swatch.sel")?.dataset.color || "";
            if (!label || !description) return;
            const editingId = button.dataset.id;
            if (editingId) {
              vscode?.postMessage({ type: "taxonomyAction", action: "updateKind", id: editingId, label, color, description });
            } else {
              vscode?.postMessage({ type: "taxonomyAction", action: "addKind", id: label, label, color, description });
            }
            taxonomyUi.kindFormOpen = false;
            taxonomyUi.editKindId = undefined;
          } else if (action === "openMergeKind") {
            taxonomyUi.mergeKindId = taxonomyUi.mergeKindId === button.dataset.id ? undefined : button.dataset.id;
            renderTaxonomy();
          } else if (action === "closeMergeKind") {
            taxonomyUi.mergeKindId = undefined;
            renderTaxonomy();
          } else if (action === "confirmMergeKind") {
            const target = document.querySelector("#taxMergeKindTarget")?.value || "";
            if (!target) return;
            vscode?.postMessage({ type: "taxonomyAction", action: "mergeKind", from: button.dataset.id, into: target, builtin: Boolean(button.dataset.builtin) });
            taxonomyUi.mergeKindId = undefined;
          } else if (action === "deleteKind") {
            if (Number(button.dataset.count || 0) > 0) {
              taxonomyUi.mergeKindId = button.dataset.id;
              renderTaxonomy();
              return;
            }
            vscode?.postMessage({ type: "taxonomyAction", action: "deleteKind", id: button.dataset.id });
          } else if (action === "unaliasKind") {
            vscode?.postMessage({ type: "taxonomyAction", action: "unaliasKind", id: button.dataset.id });
          } else if (action === "formalize") {
            taxonomyUi.formalizeType = button.dataset.type;
            taxonomyUi.relFormOpen = false;
            renderTaxonomy();
          } else if (action === "newRelation") {
            taxonomyUi.relFormOpen = !taxonomyUi.relFormOpen;
            taxonomyUi.formalizeType = undefined;
            renderTaxonomy();
          } else if (action === "cancelRelForm") {
            taxonomyUi.relFormOpen = false;
            taxonomyUi.formalizeType = undefined;
            renderTaxonomy();
          } else if (action === "saveRelation") {
            const relationType = document.querySelector("#taxRelType")?.value?.trim() || "";
            if (!relationType) return;
            vscode?.postMessage({
              type: "taxonomyAction",
              action: "addRelation",
              relationType,
              category: document.querySelector("#taxRelCategory")?.value || "work",
              reading: document.querySelector("#taxRelReading")?.value?.trim() || "",
              absorb: button.dataset.absorb || ""
            });
            taxonomyUi.relFormOpen = false;
            taxonomyUi.formalizeType = undefined;
          } else if (action === "openMergeRel") {
            taxonomyUi.mergeRelType = taxonomyUi.mergeRelType === button.dataset.type ? undefined : button.dataset.type;
            renderTaxonomy();
          } else if (action === "closeMergeRel") {
            taxonomyUi.mergeRelType = undefined;
            renderTaxonomy();
          } else if (action === "confirmMergeRel") {
            const target = document.querySelector("#taxMergeRelTarget")?.value || "";
            if (!target) return;
            vscode?.postMessage({
              type: "taxonomyAction",
              action: "mergeRelation",
              from: button.dataset.type,
              into: target,
              swap: Boolean(document.querySelector("#taxMergeRelSwap")?.checked)
            });
            taxonomyUi.mergeRelType = undefined;
          } else if (action === "unaliasRelation") {
            vscode?.postMessage({ type: "taxonomyAction", action: "unaliasRelation", from: button.dataset.type });
          }
        }));
      }

      function renderSettingsDetail() {
        const version = state.extensionVersion || "unknown";
        const diagnostics = state.diagnostics || {};
        const counts = diagnostics.counts || {};
        document.querySelector("#settingsDetail").innerHTML =
          '<div class="task-detail">' +
          '<div class="metrics"><div class="metric"><span>Extension</span><strong>OneAgent ' + escapeHtml(version) + '</strong></div><div class="metric"><span>Mode</span><strong>local-first</strong></div></div>' +
          '<div class="metrics"><div class="metric"><span>Search</span><strong>SQLite full-text</strong></div><div class="metric"><span>Indexed chunks</span><strong>' + escapeHtml(String(counts.chunks || 0)) + '</strong></div></div>' +
          '<p class="summary">Markdown pages are indexed locally. No model server is required.</p>' +
          '<div class="action-group"><div class="side-head" style="padding:0"><h2>Diagnostics</h2><span class="chip" id="diagCount">0</span></div><div class="diagnostic-list" id="diagnostics"></div></div>' +
          settingsGroup("Knowledge", [
            { action: "upsertEntity", label: "Add or edit entity" },
            { action: "deleteEntity", label: "Delete entity" },
            { action: "upsertEntityLink", label: "Add or edit relation" },
            { action: "deleteEntityLink", label: "Delete relation" }
          ]) +
          settingsGroup("Capture & wiki", [
            { action: "showCaptureForm", label: "Capture memory" },
            { action: "reingestAllCaptures", label: "Reingest all" },
            { action: "reingestFailedCaptures", label: "Reingest failed" },
            { action: "openCapturesFolder", label: "Open captures folder" }
          ]) +
          settingsGroup("Runtime", [
            { action: "diagnoseRuntime", label: "Diagnose" },
            { action: "runIngestionSmokeTest", label: "Smoke test" },
            { action: "refresh", label: "Refresh cockpit" },
            { action: "refreshGraphify", label: "Refresh Graphify" },
            { action: "openOutput", label: "Open output" },
            { action: "resetMemory", label: "Reset test data" }
          ]) +
          settingsGroup("Updates", [
            { action: "checkForUpdates", label: "Check for updates" }
          ]) +
          '</div>';
        bindSettingsActions(document.querySelector("#settingsDetail"));
      }

      function settingsGroup(title, actions) {
        return '<div class="action-group"><label>' + escapeHtml(title) + '</label><div class="proposal-actions">' +
          actions.map((entry) => '<button class="action" data-setting-action="' + escapeAttr(entry.action) + '">' + escapeHtml(entry.label) + '</button>').join("") +
          '</div></div>';
      }

      function bindSettingsActions(root) {
        root.querySelectorAll("[data-setting-action]").forEach((button) => {
          button.addEventListener("click", () => {
            if (button.dataset.settingAction === "showCaptureForm") {
              renderCaptureForm();
              return;
            }
            vscode?.postMessage({ type: button.dataset.settingAction });
          });
        });
      }

      const CAPTURE_CONTENT_TYPES = ["raw_input", "document", "note", "meeting", "user_interview", "one_to_one", "monthly_update", "mission_review", "feedback", "development_plan", "idea", "feature_idea", "feature_request", "insight", "research", "strategy", "okr", "guide", "best_practice", "decision", "risk", "question", "flow"];
      const CAPTURE_RELATION_TYPES = ["related_to", "scoped_to", "impacts", "informs", "requested_by", "reported_by", "reviewer", "stakeholder_of", "applies_practice", "development_area", "discussed_in", "owned_by", "drives", "supports", "blocks", "implements", "validates"];
      const TASK_RELATION_TYPES = [
        { value: "concerns", label: "concerns" },
        { value: "requested_by", label: "asked by" },
        { value: "needed_for", label: "needed for" },
        { value: "depends_on", label: "depends on" },
        { value: "blocked_by", label: "blocked by" },
        { value: "blocks", label: "blocks" },
        { value: "owned_by", label: "owned by" },
        { value: "reviewer", label: "reviewed by" },
        { value: "stakeholder_of", label: "stakeholder of" },
        { value: "supports", label: "supports" },
        { value: "implements", label: "implements" },
        { value: "validates", label: "validates" },
        { value: "related_to", label: "related to" },
        { value: "follows_up", label: "follows up" }
      ];

      function captureEntities() {
        const entities = (state.entities || []).slice();
        if (!entities.some((entity) => entity.kind === "oneagent" && entity.id === "oneagent")) {
          entities.unshift({ kind: "oneagent", id: "oneagent", label: "OneAgent" });
        }
        return entities;
      }

      function renderCaptureForm(prefillPrimary) {
        const entities = captureEntities();
        const related = [];
        const primaryDefault = prefillPrimary || "oneagent:oneagent";
        document.querySelector("#settingsDetail").innerHTML =
          '<div class="task-detail">' +
          '<div class="detail-title"><b>Paste into memory</b><span>generic capture</span></div>' +
          '<p class="summary">Paste any content. OneAgent writes it as Markdown under .work-memory/captures, classifies it on a primary entity plus typed related entities, then ingests it.</p>' +
          customMenuHtml("captureType", "Content type", CAPTURE_CONTENT_TYPES, "raw_input") +
          entityMenuHtml("capturePrimary", "Primary entity — where it lives", entities, primaryDefault) +
          '<div class="field"><label>Related entities — what else it concerns</label></div>' +
          entityMenuHtml("captureRelEntity", "Entity", entities, (entities[0] ? entities[0].kind + ":" + entities[0].id : "oneagent:oneagent")) +
          customMenuHtml("captureRelType", "Relation", CAPTURE_RELATION_TYPES, "related_to") +
          '<div class="detail-actions"><button class="action" id="addRelated">Add related entity</button></div>' +
          '<div class="chips" id="relatedChips"></div>' +
          '<div class="field"><label>Title optional</label><input id="captureTitle" maxlength="180" placeholder="Auto-generated from the pasted content if empty"></div>' +
          '<div class="field"><label>Tags comma-separated</label><input id="captureTags" placeholder="fulfillment, routing"></div>' +
          '<div class="field"><label>Content</label><textarea id="captureContent" maxlength="250000" placeholder="Paste a transcript, Confluence page, Slack thread, flow description, idea, note or research here."></textarea></div>' +
          '<div class="detail-actions"><button class="action" data-setting-action="refresh">Cancel</button><button class="action" id="saveCapture">Save and ingest</button></div>' +
          '</div>';
        bindMenus(document.querySelector("#settingsDetail"));
        bindSettingsActions(document.querySelector("#settingsDetail"));

        function renderRelatedChips() {
          document.querySelector("#relatedChips").innerHTML = related.map((item, index) =>
            '<span class="chip">' + escapeHtml(item.ref) + ' · ' + escapeHtml(item.relation) + ' <button type="button" class="chip-x" data-rmrel="' + index + '" aria-label="remove">×</button></span>'
          ).join("");
          document.querySelectorAll("[data-rmrel]").forEach((button) => button.addEventListener("click", () => {
            related.splice(Number(button.dataset.rmrel), 1);
            renderRelatedChips();
          }));
        }

        document.querySelector("#addRelated").addEventListener("click", () => {
          const ref = document.querySelector("#captureRelEntity").value;
          const relation = document.querySelector("#captureRelType").value;
          if (ref && !related.some((item) => item.ref === ref && item.relation === relation)) {
            related.push({ ref, relation });
            renderRelatedChips();
          }
        });

        document.querySelector("#saveCapture").addEventListener("click", () => {
          const content = document.querySelector("#captureContent").value;
          const title = document.querySelector("#captureTitle").value.trim() || deriveCaptureTitle(content);
          if (!content.trim()) {
            document.querySelector("#captureContent").focus();
            return;
          }
          document.querySelector("#settingsDetail").innerHTML =
            '<div class="task-detail">' +
            '<div class="detail-title"><b>Capture queued</b><span>ingesting</span></div>' +
            '<p class="summary">OneAgent is saving and ingesting this capture. The Sources and graph panels will update when ingestion finishes.</p>' +
            '</div>';
          vscode?.postMessage({
            type: "captureGeneric",
            contentType: document.querySelector("#captureType").value,
            primary: document.querySelector("#capturePrimary").value,
            related,
            title,
            tags: document.querySelector("#captureTags").value,
            content
          });
        });
      }

      function deriveCaptureTitle(content) {
        const heading = content.match(/^#\\s+(.+)$/m);
        const firstLine = heading?.[1] || content.split(/\\r?\\n/).find((line) => line.trim());
        return (firstLine || "Untitled capture").replace(/^[-*#\\s]+/, "").trim().slice(0, 180) || "Untitled capture";
      }

      function normalizeTaskStatus(status) {
        if (status === "blocked" || status === "ready" || status === "open" || status === "done") return status;
        return "pending";
      }

      function taskLinksToText(links) {
        return (links || []).map((link) => {
          return [link.relationType, link.targetKind, link.targetId, link.label].filter(Boolean).join(":");
        }).join("\\n");
      }

      function taskRelationLabel(value) {
        const normalized = String(value || "").trim();
        return TASK_RELATION_TYPES.find((option) => option.value === normalized)?.label || normalized.replace(/_/g, " ");
      }

      function taskLinkSelectorHtml(prefix, links) {
        const entities = captureEntities();
        return '<div class="field"><label>Entity links</label></div>' +
          customMenuHtml(prefix + "TaskRelation", "Relation", TASK_RELATION_TYPES, "concerns") +
          taskLinkEntityPickerHtml(prefix, entities) +
          '<div class="detail-actions"><button class="action" id="' + escapeAttr(prefix) + 'AddTaskLink">Add link</button></div>' +
          '<input type="hidden" id="' + escapeAttr(prefix) + 'TaskLinks" value="' + escapeAttr(taskLinksToText(links || [])) + '">' +
          '<div class="chips" id="' + escapeAttr(prefix) + 'TaskLinkChips"></div>';
      }

      function taskLinkEntityPickerHtml(prefix, entities) {
        const options = taskLinkEntityOptions(entities);
        const picker = taskLinkPickerStateFor(prefix, options);
        const selected = options.find((option) => option.ref === picker.selectedRef) || options[0];
        const selectedLabel = selected ? selected.text : "No entity available";
        const visibleGroups = taskLinkEntityGroups(options, picker);
        const totalVisible = visibleGroups.reduce((sum, group) => sum + group.visible.length, 0);
        const sections = visibleGroups.map((group) => {
          const collapsed = picker.collapsedKinds.has(group.kind);
          const body = !collapsed
            ? '<div class="task-link-section-body">' +
              '<input class="filter-search" data-task-link-kind-search="' + escapeAttr(prefix) + ':' + escapeAttr(group.kind) + '" aria-label="Search ' + escapeAttr(taskLinkKindLabel(group.kind)) + '" placeholder="Search ' + escapeAttr(taskLinkKindLabel(group.kind)) + '" value="' + escapeAttr(picker.categorySearches[group.kind] || "") + '">' +
              '<div class="task-link-options">' +
              (group.visible.length ? group.visible.slice(0, 120).map((option) =>
                '<button type="button" class="task-link-option' + (option.ref === picker.selectedRef ? " selected" : "") + '" data-task-link-select="' + escapeAttr(prefix) + '" data-ref="' + escapeAttr(option.ref) + '"><span>' + escapeHtml(option.label) + '</span><small>' + escapeHtml(option.id) + '</small></button>'
              ).join("") : '<div class="task-entity-filter-empty">No matching entity.</div>') +
              '</div>' +
              (group.visible.length > 120 ? '<div class="task-link-picker-summary">Showing 120 of ' + escapeHtml(String(group.visible.length)) + '. Refine the search.</div>' : '') +
              '</div>'
            : "";
          return '<section class="task-link-section">' +
            '<div class="task-link-section-head" data-task-link-toggle-kind="' + escapeAttr(prefix) + ':' + escapeAttr(group.kind) + '">' +
            '<button type="button" class="task-link-section-toggle"><span>' + escapeHtml(taskLinkKindLabel(group.kind)) + '</span><small>' + escapeHtml(String(group.visible.length)) + '/' + escapeHtml(String(group.count)) + '</small></button>' +
            '<span class="filter-section-caret">' + (collapsed ? "▼" : "▲") + '</span>' +
            '</div>' +
            body +
            '</section>';
        }).join("");
        return '<div class="field"><label id="' + escapeAttr(prefix) + 'TaskEntityFieldLabel">Entity</label><div class="task-link-picker' + (picker.open ? " open" : "") + '" data-task-link-picker="' + escapeAttr(prefix) + '">' +
          '<button type="button" class="menu-button" data-task-link-toggle="' + escapeAttr(prefix) + '" aria-labelledby="' + escapeAttr(prefix) + 'TaskEntityFieldLabel ' + escapeAttr(prefix) + 'TaskEntityLabel"><span id="' + escapeAttr(prefix) + 'TaskEntityLabel">' + escapeHtml(selectedLabel) + '</span><span class="menu-chevron">⌄</span></button>' +
          '<input type="hidden" id="' + escapeAttr(prefix) + 'TaskEntity" value="' + escapeAttr(selected?.ref || "") + '">' +
          '<div class="task-link-picker-panel">' +
          '<input class="filter-search" data-task-link-search="' + escapeAttr(prefix) + '" aria-label="Search all entities" placeholder="Search all entities" value="' + escapeAttr(picker.globalSearch) + '">' +
          '<div class="task-link-picker-summary">' + escapeHtml(String(totalVisible)) + '/' + escapeHtml(String(options.length)) + ' entities</div>' +
          (sections || '<div class="task-entity-filter-empty">No entities available.</div>') +
          '</div></div></div>';
      }

      function taskLinkEntityOptions(entities) {
        const seen = new Set();
        return (entities || [])
          .map((entity) => {
            const kind = String(entity.kind || "").trim();
            const id = String(entity.id || "").trim();
            if (!kind || !id) return undefined;
            const ref = kind + ":" + id;
            if (seen.has(ref)) return undefined;
            seen.add(ref);
            const label = String(entity.label || id);
            return {
              ref,
              kind,
              id,
              label,
              text: kind + " · " + label,
              searchText: (kind + " " + id + " " + label + " " + ref).toLowerCase()
            };
          })
          .filter(Boolean)
          .sort((left, right) => {
            const leftKind = typeOrder.indexOf(left.kind);
            const rightKind = typeOrder.indexOf(right.kind);
            const leftOrder = leftKind === -1 ? 999 : leftKind;
            const rightOrder = rightKind === -1 ? 999 : rightKind;
            return leftOrder - rightOrder || left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label);
          });
      }

      function taskLinkPickerStateFor(prefix, options) {
        const picker = taskLinkPickerState[prefix] || {
          selectedRef: "",
          open: false,
          globalSearch: "",
          categorySearches: {},
          collapsedKinds: new Set()
        };
        if (!(picker.collapsedKinds instanceof Set)) {
          picker.collapsedKinds = new Set(Array.isArray(picker.collapsedKinds) ? picker.collapsedKinds : []);
        }
        const refs = new Set(options.map((option) => option.ref));
        if (!picker.selectedRef || !refs.has(picker.selectedRef)) {
          const fallback = options.find((option) => option.ref === "oneagent:oneagent") || options[0];
          picker.selectedRef = fallback?.ref || "";
          const selectedKind = fallback?.kind || "";
          picker.collapsedKinds = new Set(options.map((option) => option.kind).filter((kind) => kind !== selectedKind));
        }
        taskLinkPickerState[prefix] = picker;
        return picker;
      }

      function taskLinkEntityGroups(options, picker) {
        const globalSearch = String(picker.globalSearch || "").trim().toLowerCase();
        const groups = new Map();
        for (const option of options) {
          if (!groups.has(option.kind)) groups.set(option.kind, { kind: option.kind, count: 0, visible: [] });
          const group = groups.get(option.kind);
          group.count += 1;
          const categorySearch = String(picker.categorySearches[option.kind] || "").trim().toLowerCase();
          const matchesGlobal = !globalSearch || option.searchText.includes(globalSearch);
          const matchesCategory = !categorySearch || option.searchText.includes(categorySearch);
          if (matchesGlobal && matchesCategory) group.visible.push(option);
        }
        return Array.from(groups.values()).filter((group) => group.visible.length || !globalSearch);
      }

      function taskLinkKindLabel(kind) {
        return String(kind || "entity").replace(/_/g, " ");
      }

      function renderTaskLinkPicker(prefix) {
        const root = document.querySelector('[data-task-link-picker="' + cssEscape(prefix) + '"]');
        if (!root) return;
        const entities = captureEntities();
        const wrapper = document.createElement("div");
        wrapper.innerHTML = taskLinkEntityPickerHtml(prefix, entities);
        const next = wrapper.querySelector('[data-task-link-picker="' + cssEscape(prefix) + '"]');
        if (next) {
          root.replaceWith(next);
          bindTaskLinkPicker(prefix);
        }
      }

      function renderTaskLinkChips(fieldId, chipsId) {
        const field = document.querySelector("#" + fieldId);
        const chips = document.querySelector("#" + chipsId);
        if (!field || !chips) return;
        const links = parseTaskLinksText(field.value);
        chips.innerHTML = links.length ? links.map((link, index) => {
          const ref = link.targetKind + ":" + link.targetId;
          return '<span class="chip">' + escapeHtml(taskRelationLabel(link.relationType) + " -> " + taskEntityLabel(ref)) + ' <button type="button" class="chip-x" data-remove-task-link="' + escapeAttr(fieldId) + ':' + index + '" aria-label="remove">×</button></span>';
        }).join("") : '<span class="chip">No entity link</span>';
        chips.querySelectorAll("[data-remove-task-link]").forEach((button) => {
          button.addEventListener("click", () => {
            const raw = button.dataset.removeTaskLink || "";
            const separator = raw.lastIndexOf(":");
            const targetFieldId = raw.slice(0, separator);
            const index = Number(raw.slice(separator + 1));
            const target = document.querySelector("#" + targetFieldId);
            if (!target || Number.isNaN(index)) return;
            const next = parseTaskLinksText(target.value);
            next.splice(index, 1);
            target.value = taskLinksToText(next);
            renderTaskLinkChips(fieldId, chipsId);
          });
        });
      }

      function bindTaskLinkSelector(prefix) {
        renderTaskLinkChips(prefix + "TaskLinks", prefix + "TaskLinkChips");
        bindTaskLinkPicker(prefix);
        document.querySelector("#" + prefix + "AddTaskLink")?.addEventListener("click", () => {
          const relation = document.querySelector("#" + prefix + "TaskRelation")?.value || "concerns";
          const ref = document.querySelector("#" + prefix + "TaskEntity")?.value || "";
          const [targetKind, ...targetIdParts] = ref.split(":");
          const targetId = targetIdParts.join(":");
          if (!relation || !targetKind || !targetId) return;
          const field = document.querySelector("#" + prefix + "TaskLinks");
          const links = parseTaskLinksText(field?.value || "");
          if (!links.some((link) => link.relationType === relation && link.targetKind === targetKind && link.targetId === targetId)) {
            links.push({ relationType: relation, targetKind, targetId });
          }
          if (field) field.value = taskLinksToText(links);
          renderTaskLinkChips(prefix + "TaskLinks", prefix + "TaskLinkChips");
        });
      }

      function bindTaskLinkPicker(prefix) {
        document.querySelector('[data-task-link-toggle="' + cssEscape(prefix) + '"]')?.addEventListener("click", (event) => {
          event.stopPropagation();
          const picker = taskLinkPickerStateFor(prefix, taskLinkEntityOptions(captureEntities()));
          picker.open = !picker.open;
          renderTaskLinkPicker(prefix);
          if (picker.open) {
            const field = document.querySelector('[data-task-link-search="' + cssEscape(prefix) + '"]');
            field?.focus();
            field?.setSelectionRange(field.value.length, field.value.length);
          }
        });
        document.querySelector('[data-task-link-search="' + cssEscape(prefix) + '"]')?.addEventListener("input", (event) => {
          const picker = taskLinkPickerStateFor(prefix, taskLinkEntityOptions(captureEntities()));
          picker.globalSearch = event.target.value.trim().toLowerCase();
          if (picker.globalSearch) picker.collapsedKinds.clear();
          picker.open = true;
          renderTaskLinkPicker(prefix);
          const field = document.querySelector('[data-task-link-search="' + cssEscape(prefix) + '"]');
          field?.focus();
          field?.setSelectionRange(field.value.length, field.value.length);
        });
        document.querySelectorAll("[data-task-link-kind-search]").forEach((input) => {
          const parsed = parseTaskLinkPickerScopedValue(input.dataset.taskLinkKindSearch || "");
          if (!parsed || parsed.prefix !== prefix) return;
          input.addEventListener("click", (event) => event.stopPropagation());
          input.addEventListener("input", () => {
            const picker = taskLinkPickerStateFor(prefix, taskLinkEntityOptions(captureEntities()));
            picker.categorySearches[parsed.value] = input.value.trim().toLowerCase();
            picker.open = true;
            renderTaskLinkPicker(prefix);
            const field = document.querySelector('[data-task-link-kind-search="' + cssEscape(prefix + ":" + parsed.value) + '"]');
            field?.focus();
            field?.setSelectionRange(field.value.length, field.value.length);
          });
        });
        document.querySelectorAll("[data-task-link-toggle-kind]").forEach((row) => {
          const parsed = parseTaskLinkPickerScopedValue(row.dataset.taskLinkToggleKind || "");
          if (!parsed || parsed.prefix !== prefix) return;
          row.addEventListener("click", () => {
            const picker = taskLinkPickerStateFor(prefix, taskLinkEntityOptions(captureEntities()));
            if (picker.collapsedKinds.has(parsed.value)) {
              picker.collapsedKinds.delete(parsed.value);
            } else {
              picker.collapsedKinds.add(parsed.value);
            }
            picker.open = true;
            renderTaskLinkPicker(prefix);
          });
        });
        document.querySelectorAll('[data-task-link-select="' + cssEscape(prefix) + '"]').forEach((button) => {
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            const picker = taskLinkPickerStateFor(prefix, taskLinkEntityOptions(captureEntities()));
            picker.selectedRef = button.dataset.ref || "";
            picker.open = false;
            const field = document.querySelector("#" + prefix + "TaskEntity");
            if (field) field.value = picker.selectedRef;
            if (prefix === "newNote" || prefix === "editNote") {
              const editor = document.querySelector("#noteDetail");
              if (editor) editor.dataset.manualNoteEditorDirty = "true";
            }
            renderTaskLinkPicker(prefix);
          });
        });
      }

      function parseTaskLinkPickerScopedValue(value) {
        const separator = String(value || "").indexOf(":");
        if (separator < 1) return undefined;
        return { prefix: value.slice(0, separator), value: value.slice(separator + 1) };
      }

      function parseTaskLinksText(value) {
        return String(value || "")
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(":").map((part) => part.trim());
            return {
              relationType: parts[0] || "",
              targetKind: parts[1] || "",
              targetId: parts[2] || "",
              label: parts.slice(3).join(":") || undefined
            };
          })
          .filter((link) => link.relationType && link.targetKind && link.targetId);
      }

      function findTask(id) {
        if (!id) return undefined;
        return (state.tasks || []).find((task) => task.id === id);
      }

      function findInboxItem(id) {
        if (!id) return undefined;
        return [...(state.inbox || []), ...(state.graphChangeHistory || [])].find((item) => item.id === id);
      }

      function findCurationPackage(id) {
        if (!id) return undefined;
        const loaded = liveCurationPackageDetails().find((detail) => detail?.package?.id === id);
        if (loaded) return loaded;
        return state.curationPackageHistoryState?.available === false ? curationPackageDetailCache[id] : undefined;
      }

      function liveCurationPackageDetails(value = state) {
        return [...(value?.curationPackages || []), ...(value?.curationPackageHistory || [])];
      }

      function rememberCurationPackages(value) {
        for (const detail of liveCurationPackageDetails(value)) {
          if (detail?.package?.id) curationPackageDetailCache[detail.package.id] = detail;
        }
      }

      function isCurationPackageLoaded(id) {
        if (!id) return false;
        return liveCurationPackageDetails().some((detail) => detail?.package?.id === id);
      }

      function findObservationInCurationState(id) {
        if (!id) return undefined;
        for (const detail of liveCurationPackageDetails()) {
          const observation = (detail.observations || []).find((item) => item.id === id);
          if (observation) return { observation, detail, loaded: true };
        }
        if (state.curationPackageHistoryState?.available === false) {
          for (const detail of Object.values(curationPackageDetailCache)) {
            const observation = (detail.observations || []).find((item) => item.id === id);
            if (observation) return { observation, detail, loaded: false };
          }
        }
        return undefined;
      }

      function customMenuHtml(id, label, values, selected) {
        const options = values.map((value) => typeof value === "object" ? value : { value, label: value });
        const selectedOption = options.find((option) => option.value === selected) || { value: selected, label: selected };
        return '<div class="field"><label id="' + escapeAttr(id) + 'FieldLabel">' + escapeHtml(label) + '</label><div class="menu-control" data-menu-control="' + escapeAttr(id) + '">' +
          '<button type="button" class="menu-button" data-menu-button="' + escapeAttr(id) + '" aria-labelledby="' + escapeAttr(id) + 'FieldLabel ' + escapeAttr(id) + 'ValueLabel"><span id="' + escapeAttr(id) + 'ValueLabel" data-menu-label="' + escapeAttr(id) + '">' + escapeHtml(selectedOption.label) + '</span><span class="menu-chevron">⌄</span></button>' +
          '<input type="hidden" id="' + escapeAttr(id) + '" value="' + escapeAttr(selected) + '">' +
          '<div class="menu-options" role="listbox" data-menu-options="' + escapeAttr(id) + '">' + options.map((option) =>
            '<button type="button" class="menu-option' + (option.value === selected ? " selected" : "") + '" data-menu-option="' + escapeAttr(id) + '" data-value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</button>'
          ).join("") + '</div></div></div>';
      }

      function entityMenuHtml(id, label, entities, selectedRef) {
        const options = entities.map((entity) => ({ ref: entity.kind + ":" + entity.id, text: entity.kind + " · " + (entity.label || entity.id) }));
        const selected = options.find((option) => option.ref === selectedRef) || options[0] || { ref: selectedRef, text: selectedRef };
        return '<div class="field"><label>' + escapeHtml(label) + '</label><div class="menu-control" data-menu-control="' + escapeAttr(id) + '">' +
          '<button type="button" class="menu-button" data-menu-button="' + escapeAttr(id) + '"><span data-menu-label="' + escapeAttr(id) + '">' + escapeHtml(selected.text) + '</span><span class="menu-chevron">⌄</span></button>' +
          '<input type="hidden" id="' + escapeAttr(id) + '" value="' + escapeAttr(selected.ref) + '">' +
          '<div class="menu-options" role="listbox" data-menu-options="' + escapeAttr(id) + '">' + options.map((option) =>
            '<button type="button" class="menu-option' + (option.ref === selected.ref ? " selected" : "") + '" data-menu-option="' + escapeAttr(id) + '" data-value="' + escapeAttr(option.ref) + '">' + escapeHtml(option.text) + '</button>'
          ).join("") + '</div></div></div>';
      }

      function bindMenus(root) {
        root.querySelectorAll("[data-menu-button]").forEach((button) => {
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            const control = button.closest("[data-menu-control]");
            const wasOpen = control.classList.contains("open");
            closeMenus();
            control.classList.toggle("open", !wasOpen);
          });
        });
        root.querySelectorAll("[data-menu-option]").forEach((option) => {
          option.addEventListener("click", (event) => {
            event.stopPropagation();
            const id = option.dataset.menuOption;
            const value = option.dataset.value || "";
            document.querySelector("#" + id).value = value;
            document.querySelector('[data-menu-label="' + id + '"]').textContent = option.textContent;
            document.querySelectorAll('[data-menu-option="' + id + '"]').forEach((item) => item.classList.toggle("selected", item === option));
            closeMenus();
          });
        });
      }

      function closeMenus() {
        document.querySelectorAll("[data-menu-control].open").forEach((control) => control.classList.remove("open"));
      }

      function closeTaskLinkPickers() {
        let changed = false;
        for (const picker of Object.values(taskLinkPickerState)) {
          if (picker && picker.open) {
            picker.open = false;
            changed = true;
          }
        }
        if (changed) {
          document.querySelectorAll("[data-task-link-picker].open").forEach((control) => control.classList.remove("open"));
        }
      }

      function createSvg(tag, attrs) {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        return node;
      }

      function compactLabel(value, limit = 38) {
        return value.length > limit ? value.slice(0, Math.max(0, limit - 3)) + "..." : value;
      }

      function parseCsvList(value) {
        return String(value || "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      }

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
      }

      function escapeAttr(value) {
        return escapeHtml(value);
      }

      function cssEscape(value) {
        return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      const documentationLaunch = state.documentation?.launchState || {};
      const initialView = state.documentationOnly || documentationLaunch.showWelcome || documentationLaunch.isFirstWorkspaceUse
        ? "help"
        : "today";
      render();
      setActiveView(initialView);
    </script>
  </body>
</html>`;
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = {
  renderCockpitHtml
};
