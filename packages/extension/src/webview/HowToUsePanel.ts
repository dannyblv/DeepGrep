import * as vscode from 'vscode';

export class HowToUsePanel {
  private static panel: vscode.WebviewPanel | null = null;

  static show(): void {
    if (HowToUsePanel.panel) {
      HowToUsePanel.panel.reveal();
      return;
    }

    HowToUsePanel.panel = vscode.window.createWebviewPanel(
      'deepgrep.howToUse',
      'DeepGrep — How to Use',
      vscode.ViewColumn.One,
      { enableScripts: false },
    );

    HowToUsePanel.panel.webview.html = HowToUsePanel.getHtml();

    HowToUsePanel.panel.onDidDispose(() => {
      HowToUsePanel.panel = null;
    });
  }

  private static getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeepGrep — How to Use</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-editor-background, #1e1e1e);
      padding: 40px 32px 56px;
      max-width: 680px;
      margin: 0 auto;
      line-height: 1.6;
    }
    .hero { text-align: center; padding: 16px 0 40px; }
    .hex {
      font-size: 56px; color: #4a9eff; display: block; margin-bottom: 14px;
      animation: pulse 3s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.6; transform: scale(1); }
      50%       { opacity: 1;   transform: scale(1.06); }
    }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .tagline { font-size: 13px; color: var(--vscode-descriptionForeground, #9ca3af); }
    .section { margin-bottom: 40px; }
    .section-title {
      font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #9ca3af);
      border-bottom: 1px solid var(--vscode-widget-border, #333);
      padding-bottom: 6px; margin-bottom: 20px;
    }
    .steps, .benefits { display: flex; flex-direction: column; gap: 20px; }
    .step, .benefit { display: flex; gap: 16px; align-items: flex-start; }
    .step-num {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      background: rgba(74,158,255,.1); border: 1px solid rgba(74,158,255,.35);
      color: #4a9eff; font-size: 11px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .benefit-icon { font-size: 20px; width: 26px; flex-shrink: 0; text-align: center; margin-top: 2px; }
    strong { display: block; font-size: 13px; margin-bottom: 3px; }
    p { font-size: 12px; color: var(--vscode-descriptionForeground, #9ca3af); line-height: 1.5; }
    .tag {
      display: inline-block; font-size: 10px; padding: 1px 8px; border-radius: 10px;
      background: rgba(74,158,255,.12); border: 1px solid rgba(74,158,255,.25);
      color: #4a9eff; font-weight: 600; margin-left: 6px; vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="hero">
    <span class="hex">⬡</span>
    <h1>DeepGrep</h1>
    <p class="tagline">AST-powered structural context for Claude Code</p>
  </div>

  <div class="section">
    <div class="section-title">Get started in 3 steps</div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div>
          <strong>Index your workspace</strong>
          <p>Click <b>Re-index</b> in the graph panel. Builds an AST-derived dependency graph of your entire codebase in seconds.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div>
          <strong>Use Claude Code normally</strong>
          <p>Claude automatically queries the graph via the MCP server for structural context — no changes to your workflow.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div>
          <strong>Explore the dependency graph</strong>
          <p>Click any node to inspect its code, callers, and callees. Hub nodes show the most-connected symbols.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Why DeepGrep?</div>
    <div class="benefits">
      <div class="benefit">
        <span class="benefit-icon">⚡</span>
        <div>
          <strong>Faster answers <span class="tag">ms latency</span></strong>
          <p>Graph-ranked context served in milliseconds vs full-file scans.</p>
        </div>
      </div>
      <div class="benefit">
        <span class="benefit-icon">🎯</span>
        <div>
          <strong>Better precision <span class="tag">AST-exact</span></strong>
          <p>Structural AST search — finds the exact symbol, not nearby text.</p>
        </div>
      </div>
      <div class="benefit">
        <span class="benefit-icon">💰</span>
        <div>
          <strong>70–80% fewer tokens <span class="tag">~70–80% less</span></strong>
          <p>Serve exact symbols and their call-sites, not entire files.</p>
        </div>
      </div>
      <div class="benefit">
        <span class="benefit-icon">🔗</span>
        <div>
          <strong>Cross-file context <span class="tag">auto-traced</span></strong>
          <p>Automatically traces imports, calls, extends, and re-exports.</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}
