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
    });
  }

  refresh(): void {
    if (!this._view) return;
    try {
      const raw = this._db.getStats();
      this._view.webview.postMessage({
        type: 'stats',
        data: {
          node_count: raw.node_count,
          edge_count: raw.edge_count,
          last_indexed: raw.last_indexed ? parseInt(String(raw.last_indexed), 10) : null,
          last_index_duration_ms: raw.last_index_duration_ms
            ? parseInt(String(raw.last_index_duration_ms), 10)
            : null,
          schema_version: raw.schema_version,
          token_savings_estimate: raw.estimated_token_savings,
          query_count: raw.query_count,
        },
      });
    } catch {
      // DB not ready yet
    }
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
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
.cover{width:100%;display:block;border-bottom:1px solid var(--vscode-sideBar-border,#333)}
.strip{display:flex;align-items:center;gap:7px;padding:6px 10px;background:var(--vscode-sideBarSectionHeader-background,#252526);border-bottom:1px solid var(--vscode-sideBar-border,#333);font-size:11px;min-height:28px}
.dot{width:7px;height:7px;border-radius:50%;background:#4ec9a8;flex-shrink:0;transition:background .3s}
.dot.spin{background:#f0a500;animation:blink 1s ease-in-out infinite}
.dot.warn{background:#cc6666}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
.pw{padding:0 10px;overflow:hidden;max-height:0;transition:max-height .2s}
.pw.on{max-height:40px;padding:5px 10px}
.track{height:2px;background:var(--vscode-editorWidget-border,#3c3c3c);border-radius:1px;overflow:hidden}
.bar{height:2px;background:var(--vscode-progressBar-background,#007acc);width:35%;border-radius:1px;animation:slide 1.5s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}
.pmsg{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.body{padding:10px 12px}
.sec{margin-bottom:14px}
.sh{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-sideBar-border,#333);padding-bottom:4px;margin-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;font-size:12px}
.lbl{color:var(--vscode-descriptionForeground)}
.val{font-weight:600;font-variant-numeric:tabular-nums}
.val.hi{color:#4ec9a8}
.actions{display:flex;flex-direction:column;gap:6px}
.btn{display:flex;align-items:center;gap:8px;padding:5px 10px;border:none;border-radius:3px;font-size:12px;font-family:inherit;cursor:pointer;width:100%;text-align:left;transition:opacity .15s,background .15s}
.btn:active:not(:disabled){opacity:.7}
.btn:disabled{opacity:.38;cursor:not-allowed;pointer-events:none}
.bp{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}
.bp:hover:not(:disabled){background:var(--vscode-button-hoverBackground,#1177bb)}
.bs{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc)}
.bs:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground,#45494e)}
.btn-hint{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;min-height:14px}
</style>
</head>
<body>
<img src="${coverUri}" class="cover" alt="DeepGrep" onerror="this.style.display='none'">
<div class="strip"><div class="dot" id="dot"></div><span id="st">Loading…</span></div>
<div class="pw" id="pw"><div class="track"><div class="bar"></div></div><div class="pmsg" id="pm"></div></div>
<div class="body">
  <div class="sec">
    <div class="sh">Index</div>
    <div class="row"><span class="lbl">Nodes</span><span class="val hi" id="nc">—</span></div>
    <div class="row"><span class="lbl">Edges</span><span class="val" id="ec">—</span></div>
    <div class="row"><span class="lbl">Last indexed</span><span class="val" id="li">—</span></div>
    <div class="row"><span class="lbl">Duration</span><span class="val" id="dur">—</span></div>
  </div>
  <div class="sec">
    <div class="sh">Efficiency</div>
    <div class="row"><span class="lbl">MCP queries</span><span class="val" id="qc">—</span></div>
    <div class="row"><span class="lbl">Tokens saved</span><span class="val hi" id="ts">—</span></div>
    <div class="row"><span class="lbl">Schema</span><span class="val" id="sv">—</span></div>
  </div>
  <div class="sec">
    <div class="sh">Actions</div>
    <div class="actions">
      <button class="btn bp" id="btnGraph" disabled title="Waiting for index…">⬡&nbsp; Open Dependency Graph</button>
      <div class="btn-hint" id="graphHint">Indexing in progress…</div>
      <button class="btn bs" id="btnIdx">↻&nbsp; Re-index Workspace</button>
    </div>
  </div>
</div>
<script nonce="${nonce}">
const vsc=acquireVsCodeApi();
const btnGraph=document.getElementById('btnGraph');
const graphHint=document.getElementById('graphHint');
btnGraph.onclick=()=>vsc.postMessage({type:'openGraph'});
document.getElementById('btnIdx').onclick=()=>vsc.postMessage({type:'reindex'});

let indexing=false;
let hasNodes=false;

function syncGraphBtn(){
  if(indexing){
    btnGraph.disabled=true;
    btnGraph.title='Indexing in progress — please wait';
    graphHint.textContent='Indexing in progress…';
  }else if(!hasNodes){
    btnGraph.disabled=true;
    btnGraph.title='Run Re-index first to build the graph';
    graphHint.textContent='No index yet — click Re-index first';
  }else{
    btnGraph.disabled=false;
    btnGraph.title='';
    graphHint.textContent='';
  }
}

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
    document.getElementById('nc').textContent=fmt(s.node_count);
    document.getElementById('ec').textContent=fmt(s.edge_count);
    document.getElementById('li').textContent=ago(s.last_indexed);
    document.getElementById('dur').textContent=fmtDur(s.last_index_duration_ms);
    document.getElementById('qc').textContent=fmt(s.query_count)||'—';
    document.getElementById('ts').textContent=s.token_savings_estimate?'~'+Math.round(s.token_savings_estimate/1000)+'k':'—';
    document.getElementById('sv').textContent=s.schema_version||'—';
    hasNodes=s.node_count>0;
    const ok=hasNodes;
    document.getElementById('dot').className='dot'+(ok?'':' warn');
    document.getElementById('st').textContent=ok?fmt(s.node_count)+' nodes indexed':'Not indexed yet';
    syncGraphBtn();
  }
  if(d.type==='indexing'){
    const pw=document.getElementById('pw');
    indexing=d.indexing;
    if(d.indexing){
      pw.classList.add('on');
      document.getElementById('dot').className='dot spin';
      document.getElementById('st').textContent='Indexing…';
    }else{
      pw.classList.remove('on');
    }
    syncGraphBtn();
  }
});
syncGraphBtn();
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
