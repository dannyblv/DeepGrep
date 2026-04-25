import * as vscode from 'vscode';
import type { GraphDatabase } from '../db/GraphDatabase';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly VIEW_TYPE = 'deepgrep.sidebar';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _workspaceRoot: string,
    private readonly _db: GraphDatabase,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri,
        vscode.Uri.file(this._workspaceRoot),
      ],
    };
    webviewView.webview.html = this._html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'ready') this.refresh();
      else if (msg.type === 'openGraph') vscode.commands.executeCommand('deepgrep.openGraph');
      else if (msg.type === 'reindex') vscode.commands.executeCommand('deepgrep.reindexWorkspace');
      else if (msg.type === 'howToUse') vscode.commands.executeCommand('deepgrep.showOnboarding');
    });
  }

  refresh(): void {
    if (!this._view) return;
    try {
      this._view.webview.postMessage({ type: 'stats', data: this._db.getStats() });
    } catch {
      // DB not ready yet
    }
  }

  recordQuery(_served: number): void {
    this.refresh();
  }

  setIndexing(active: boolean, message = ''): void {
    this._isIndexing = active;
    this._view?.webview.postMessage({ type: 'indexing', indexing: active, message });
    vscode.commands.executeCommand('setContext', 'deepgrep.isIndexing', active);
    if (!active) setTimeout(() => this.refresh(), 150);
  }

  private _isIndexing = false;

  private _html(webview: vscode.Webview): string {
    const coverUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'logo.png'),
    );
    const nonce = nonce32();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);overflow-x:hidden}

/* Cover */
.cover{width:100%;display:block;border-bottom:1px solid var(--vscode-sideBar-border,#333)}

/* Status bar */
.status-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--vscode-sideBarSectionHeader-background,#252526);border-bottom:1px solid var(--vscode-sideBar-border,#333);min-height:34px}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:background .4s,box-shadow .4s}
.dot.green{background:#4ec9a8;box-shadow:0 0 7px #4ec9a866}
.dot.yellow{background:#f0a500;box-shadow:0 0 4px #f0a50044}
.dot.spin{background:#4a9eff;box-shadow:0 0 5px #4a9eff55;animation:blink 1s ease-in-out infinite}
.dot.red{background:#cc6666}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
.status-col{flex:1;min-width:0}
.status-main{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status-sub{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:1px}

/* Progress bar */
.prog{overflow:hidden;max-height:0;transition:max-height .25s}
.prog.on{max-height:36px}
.prog-inner{padding:5px 12px 6px;background:var(--vscode-sideBarSectionHeader-background,#252526);border-bottom:1px solid var(--vscode-sideBar-border,#333)}
.track{height:2px;background:var(--vscode-editorWidget-border,#3c3c3c);border-radius:1px;overflow:hidden}
.bar{height:2px;background:#4a9eff;width:30%;border-radius:1px;animation:slide 1.6s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-300%)}100%{transform:translateX(700%)}}
.prog-msg{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Onboarding screen */
.onboard{padding:14px 14px 18px;display:none}
.onboard.on{display:block}
.ob-title{font-size:13px;font-weight:700;margin-bottom:12px;color:var(--vscode-foreground)}
.step-list{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.step{display:flex;gap:10px;align-items:flex-start}
.step-num{width:20px;height:20px;border-radius:50%;background:#4a9eff18;border:1px solid #4a9eff44;color:#4a9eff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.step-body strong{font-size:11px;font-weight:600;display:block;margin-bottom:2px}
.step-body p{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.45}
.divider{height:1px;background:var(--vscode-sideBar-border,#333);margin:12px 0}
.ob-why-title{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:9px}
.ben-list{display:flex;flex-direction:column;gap:7px}
.ben{display:flex;gap:9px;align-items:flex-start}
.ben-icon{font-size:13px;width:18px;text-align:center;flex-shrink:0;margin-top:1px}
.ben-body strong{font-size:11px;font-weight:500;display:block;margin-bottom:1px}
.ben-body span{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.35}

/* Main indexed content */
.main{padding:10px 12px;display:none}
.main.on{display:block}

/* Mini graph chip */
.graph-chip{background:var(--vscode-editorWidget-background,#1e1e1e);border:1px solid var(--vscode-sideBar-border,#333);border-radius:6px;padding:8px 10px 6px;margin-bottom:14px;position:relative;overflow:hidden}
.chip-label{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:4px}
.chip-stat{position:absolute;top:8px;right:9px;text-align:right;line-height:1.2}
.chip-stat-val{font-size:14px;font-weight:700;color:#4ec9a8;display:block}
.chip-stat-lbl{font-size:9px;color:var(--vscode-descriptionForeground)}
.mini-svg{width:100%;height:48px;display:block}
@keyframes np{0%,100%{opacity:.65}50%{opacity:1}}
@keyframes ep{0%{stroke-dashoffset:20;opacity:.12}50%{opacity:.5}100%{stroke-dashoffset:0;opacity:.12}}
.mg-hub{animation:np 2.8s ease-in-out infinite}
.mg-n{animation:np 2.8s ease-in-out infinite}
.mg-flow{stroke-dasharray:5 5;animation:ep 2.8s linear infinite;opacity:.3}

/* Stats sections */
.sec{margin-bottom:14px}
.sh{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-sideBar-border,#333);padding-bottom:4px;margin-bottom:7px}
.row{display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;font-size:12px}
.lbl{color:var(--vscode-descriptionForeground)}
.val{font-weight:600;font-variant-numeric:tabular-nums}
.val.g{color:#4ec9a8}.val.b{color:#4a9eff}.val.a{color:#f0a500}

/* Impact bar */
.ibar-wrap{margin:5px 0 8px}
.ibar-bg{height:4px;background:var(--vscode-editorWidget-border,#3c3c3c);border-radius:2px;overflow:hidden}
.ibar-fill{height:4px;border-radius:2px;background:linear-gradient(90deg,#4a9eff,#4ec9a8);transition:width .7s ease}
.ibar-lbl{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:4px;line-height:1.3}

/* Actions */
.actions{display:flex;flex-direction:column;gap:6px}
.btn{display:flex;align-items:center;gap:8px;padding:6px 10px;border:none;border-radius:4px;font-size:12px;font-family:inherit;cursor:pointer;width:100%;text-align:left;transition:opacity .15s,background .15s}
.btn:active:not(:disabled){opacity:.7}
.btn:disabled{opacity:.35;cursor:not-allowed;pointer-events:none}
.bp{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}
.bp:hover:not(:disabled){background:var(--vscode-button-hoverBackground,#1177bb)}
.bs{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc)}
.bs:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground,#45494e)}
.bh{background:none;border:1px solid var(--vscode-sideBar-border,#333);color:var(--vscode-descriptionForeground)}
.bh:hover{border-color:#4a9eff;color:#4a9eff}
</style>
</head>
<body>
<img src="${coverUri}" class="cover" alt="DeepGrep" onerror="this.style.display='none'">

<!-- Status bar -->
<div class="status-bar">
  <div class="dot yellow" id="dot"></div>
  <div class="status-col">
    <div class="status-main" id="stMain">Loading…</div>
    <div class="status-sub" id="stSub"></div>
  </div>
</div>

<!-- Progress bar (indexing) -->
<div class="prog" id="prog">
  <div class="prog-inner">
    <div class="track"><div class="bar"></div></div>
    <div class="prog-msg" id="progMsg">Building graph…</div>
  </div>
</div>

<!-- Onboarding (shown when never indexed) -->
<div class="onboard on" id="onboard">
  <div class="ob-title">Get started with DeepGrep</div>
  <div class="step-list">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <strong>Index your workspace</strong>
        <p>Click "Re-index Workspace" below — builds an AST dependency graph in seconds.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <strong>Use Claude Code normally</strong>
        <p>Claude automatically queries the graph via MCP for structural context. No extra steps.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <strong>Explore the graph</strong>
        <p>Open the dependency graph panel to visualize your codebase and trace call chains.</p>
      </div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="ob-why-title">Why DeepGrep?</div>
  <div class="ben-list">
    <div class="ben"><div class="ben-icon">⚡</div><div class="ben-body"><strong>Faster answers</strong><span>Graph context in milliseconds vs full-file scans</span></div></div>
    <div class="ben"><div class="ben-icon">🎯</div><div class="ben-body"><strong>Better precision</strong><span>AST structural search — finds the exact symbol</span></div></div>
    <div class="ben"><div class="ben-icon">💰</div><div class="ben-body"><strong>70–80% fewer tokens</strong><span>Serve exact symbols &amp; context, not whole files</span></div></div>
    <div class="ben"><div class="ben-icon">🔗</div><div class="ben-body"><strong>Cross-file context</strong><span>Traces imports, calls &amp; inheritance automatically</span></div></div>
  </div>
  <div style="margin-top:16px">
    <button class="btn bs" id="btnIdxOb">↻&nbsp; Re-index Workspace</button>
  </div>
</div>

<!-- Main content (shown when indexed) -->
<div class="main" id="main">

  <!-- Mini dependency graph visualization (click to open graph panel) -->
  <div class="graph-chip" id="graphChip" style="cursor:pointer" title="Open dependency graph">
    <div class="chip-label">Dependency graph</div>
    <div class="chip-stat"><span class="chip-stat-val" id="gcNodes">—</span><span class="chip-stat-lbl">nodes</span></div>
    <svg class="mini-svg" viewBox="0 0 220 48" xmlns="http://www.w3.org/2000/svg">
      <line x1="16" y1="24" x2="46" y2="10" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="16" y1="24" x2="46" y2="38" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="46" y1="10" x2="86" y2="18" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="46" y1="38" x2="86" y2="30" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="86" y1="18" x2="86" y2="30" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="86" y1="18" x2="126" y2="10" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="86" y1="30" x2="126" y2="38" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="126" y1="10" x2="166" y2="18" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="126" y1="38" x2="166" y2="30" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="166" y1="18" x2="204" y2="24" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <line x1="166" y1="30" x2="204" y2="24" stroke="#4a9eff" stroke-width="1" opacity=".2"/>
      <!-- Animated traversal lines -->
      <line x1="16" y1="24" x2="86" y2="18" stroke="#4a9eff" stroke-width="1.2" class="mg-flow" style="animation-delay:0s"/>
      <line x1="86" y1="18" x2="166" y2="18" stroke="#4ec9a8" stroke-width="1.2" class="mg-flow" style="animation-delay:1s"/>
      <line x1="166" y1="30" x2="204" y2="24" stroke="#f0a500" stroke-width="1.2" class="mg-flow" style="animation-delay:2s"/>
      <!-- Nodes -->
      <circle cx="16" cy="24" r="4.5" fill="#4a9eff" class="mg-hub" style="animation-delay:0s"/>
      <circle cx="46" cy="10" r="3" fill="#7ec8a4" class="mg-n" style="animation-delay:.3s"/>
      <circle cx="46" cy="38" r="3" fill="#7ec8a4" class="mg-n" style="animation-delay:.7s"/>
      <circle cx="86" cy="18" r="4" fill="#4a9eff" class="mg-hub" style="animation-delay:.5s"/>
      <circle cx="86" cy="30" r="3" fill="#f0a500" class="mg-n" style="animation-delay:1.1s"/>
      <circle cx="126" cy="10" r="3" fill="#7ec8a4" class="mg-n" style="animation-delay:1.4s"/>
      <circle cx="126" cy="38" r="3" fill="#7ec8a4" class="mg-n" style="animation-delay:1.8s"/>
      <circle cx="166" cy="18" r="4" fill="#4a9eff" class="mg-hub" style="animation-delay:2s"/>
      <circle cx="166" cy="30" r="3" fill="#f0a500" class="mg-n" style="animation-delay:2.3s"/>
      <circle cx="204" cy="24" r="4.5" fill="#4ec9a8" class="mg-hub" style="animation-delay:.9s"/>
    </svg>
  </div>
  <div style="font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;margin-top:4px;opacity:.7">↑ Click to open dependency graph</div>

  <!-- Index stats -->
  <div class="sec">
    <div class="sh">Index</div>
    <div class="row"><span class="lbl">Nodes</span><span class="val g" id="nc">—</span></div>
    <div class="row"><span class="lbl">Edges</span><span class="val b" id="ec">—</span></div>
    <div class="row"><span class="lbl">Last indexed</span><span class="val" id="li">—</span></div>
    <div class="row"><span class="lbl">Duration</span><span class="val" id="dur">—</span></div>
  </div>

  <!-- Prompt impact -->
  <div class="sec">
    <div class="sh">Prompt Impact</div>
    <div class="ibar-wrap">
      <div class="ibar-bg"><div class="ibar-fill" id="ibarFill" style="width:0%"></div></div>
      <div class="ibar-lbl" id="ibarLbl">No queries yet — ask Claude about your code</div>
    </div>
    <div class="row"><span class="lbl">MCP queries</span><span class="val b" id="qc">—</span></div>
    <div class="row"><span class="lbl">Tokens saved</span><span class="val g" id="ts">—</span></div>
    <div class="row"><span class="lbl">Avg per query</span><span class="val" id="avgq">—</span></div>
  </div>

  <!-- Actions -->
  <div class="sec">
    <div class="sh">Actions</div>
    <div class="actions">
      <button class="btn bs" id="btnIdx">↻&nbsp; Re-index Workspace</button>
      <button class="btn bh" id="btnHow">?&nbsp; How to use</button>
    </div>
  </div>

</div><!-- /main -->

<script nonce="${nonce}">
const vsc=acquireVsCodeApi();
const dot=document.getElementById('dot');
const stMain=document.getElementById('stMain');
const stSub=document.getElementById('stSub');
const prog=document.getElementById('prog');
const onboard=document.getElementById('onboard');
const main=document.getElementById('main');

document.getElementById('graphChip').onclick=()=>vsc.postMessage({type:'openGraph'});
document.getElementById('btnIdx').onclick=()=>vsc.postMessage({type:'reindex'});
document.getElementById('btnIdxOb').onclick=()=>vsc.postMessage({type:'reindex'});
document.getElementById('btnHow').onclick=()=>vsc.postMessage({type:'howToUse'});

let indexing=false;

function fmt(n){return n==null?'—':n.toLocaleString()}
function fmtDur(ms){
  if(ms==null)return'—';
  if(ms<1000)return ms+'ms';
  if(ms<60000)return(ms/1000).toFixed(1)+'s';
  const m=Math.floor(ms/60000),s=Math.round((ms%60000)/1000);
  return m+'m '+(s<10?'0':'')+s+'s';
}
function ago(ts){
  if(!ts)return'—';
  const d=Date.now()-ts;
  if(d<60000)return'just now';
  if(d<3600000)return Math.floor(d/60000)+'m ago';
  if(d<86400000)return Math.floor(d/3600000)+'h ago';
  return new Date(ts).toLocaleDateString();
}

window.addEventListener('message',({data:d})=>{
  if(d.type==='stats'&&d.data){
    const s=d.data;
    const has=s.node_count>0;

    // Status indicator
    if(indexing){
      dot.className='dot spin';
      stMain.textContent='Indexing workspace…';
      stSub.textContent='';
    }else if(has){
      dot.className='dot green';
      stMain.textContent='Ready — Claude Code configured';
      stSub.textContent=fmt(s.node_count)+' nodes · '+fmt(s.edge_count)+' edges';
    }else{
      dot.className='dot yellow';
      stMain.textContent='Index workspace to activate';
      stSub.textContent='Click Re-index to build the graph';
    }

    // Screens
    onboard.className=has?'onboard':'onboard on';
    main.className=has?'main on':'main';

    // Graph chip
    document.getElementById('gcNodes').textContent=s.node_count>0?fmt(s.node_count):'—';

    // Index stats
    document.getElementById('nc').textContent=fmt(s.node_count);
    document.getElementById('ec').textContent=fmt(s.edge_count);
    document.getElementById('li').textContent=ago(s.last_indexed);
    document.getElementById('dur').textContent=fmtDur(s.last_index_duration_ms);

    // Prompt impact
    const qc=s.query_count||0;
    const sav=s.token_savings_estimate||0;
    document.getElementById('qc').textContent=qc?fmt(qc):'—';
    document.getElementById('ts').textContent=sav?'~'+Math.round(sav/1000)+'k':'—';
    document.getElementById('avgq').textContent=(qc>0)?'~'+Math.round(sav/qc).toLocaleString()+'t':'—';
    const pct=Math.min(100,Math.round(sav/2000));
    document.getElementById('ibarFill').style.width=pct+'%';
    document.getElementById('ibarLbl').textContent=
      qc===0?'No queries yet — ask Claude about your code'
      :sav?'~'+Math.round(sav/1000)+'k tokens saved across '+qc+' quer'+(qc===1?'y':'ies')
      :qc+' quer'+(qc===1?'y':'ies')+' — no matches in graph';
  }

  if(d.type==='indexing'){
    indexing=d.indexing;
    prog.className=d.indexing?'prog on':'prog';
    if(d.indexing){
      document.getElementById('progMsg').textContent=d.message||'Building graph…';
      dot.className='dot spin';
      stMain.textContent='Indexing workspace…';
      stSub.textContent='';
    }
  }
});

vsc.postMessage({type:'ready'});
</script>
</body>
</html>`;
  }
}

function nonce32(): string {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}
