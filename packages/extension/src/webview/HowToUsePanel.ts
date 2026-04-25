import * as vscode from 'vscode';

export class HowToUsePanel {
  private static panel: vscode.WebviewPanel | null = null;

  static show(extensionUri: vscode.Uri): void {
    if (HowToUsePanel.panel) {
      HowToUsePanel.panel.reveal();
      return;
    }

    HowToUsePanel.panel = vscode.window.createWebviewPanel(
      'deepgrep.howToUse',
      'DeepGrep — How to Use',
      vscode.ViewColumn.One,
      {
        enableScripts: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    const coverUri = HowToUsePanel.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'cover.png'),
    );

    HowToUsePanel.panel.webview.html = HowToUsePanel.getHtml(
      coverUri.toString(),
      HowToUsePanel.panel.webview.cspSource,
    );

    HowToUsePanel.panel.onDidDispose(() => {
      HowToUsePanel.panel = null;
    });
  }

  private static getHtml(coverUri: string, cspSource: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeepGrep — How to Use</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-editor-background, #1e1e1e);
      line-height: 1.55;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 0 28px 64px; }

    /* Cover hero */
    .cover-wrap {
      position: relative;
      margin: 0 -28px 36px;
      overflow: hidden;
      background: linear-gradient(180deg, #0b1220 0%, var(--vscode-editor-background, #1e1e1e) 100%);
    }
    .cover-img {
      display: block;
      width: 90%;
      height: auto;
      margin: 0 auto;
    }
    .cover-fade {
      position: absolute; left: 0; right: 0; bottom: 0; height: 80px;
      background: linear-gradient(180deg, transparent, var(--vscode-editor-background, #1e1e1e));
      pointer-events: none;
    }

    .intro { text-align: center; margin-bottom: 40px; }
    .intro h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.01em; }
    .intro p  { font-size: 13px; color: var(--vscode-descriptionForeground, #9ca3af); }

    .section + .section { margin-top: 44px; }
    .section-title {
      font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #9ca3af);
      margin-bottom: 18px;
    }

    /* Steps */
    .steps { display: flex; flex-direction: column; gap: 14px; }
    .step {
      display: flex; gap: 14px; align-items: flex-start;
      padding: 14px 16px;
      background: var(--vscode-editorWidget-background, rgba(255,255,255,0.02));
      border: 1px solid var(--vscode-widget-border, #2a2d31);
      border-radius: 8px;
    }
    .step-num {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      background: rgba(74,158,255,.12); border: 1px solid rgba(74,158,255,.35);
      color: #4a9eff; font-size: 11px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-body strong { display: block; font-size: 13px; font-weight: 600; margin-bottom: 3px; }
    .step-body p { font-size: 12px; color: var(--vscode-descriptionForeground, #9ca3af); line-height: 1.5; }

    /* Benefits — simple 2×2 grid */
    .benefits {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .benefit {
      padding: 14px 16px;
      background: var(--vscode-editorWidget-background, rgba(255,255,255,0.02));
      border: 1px solid var(--vscode-widget-border, #2a2d31);
      border-radius: 8px;
      display: flex; gap: 12px; align-items: flex-start;
    }
    .benefit-icon {
      font-size: 18px; line-height: 1; flex-shrink: 0; margin-top: 1px;
      width: 22px; text-align: center;
    }
    .benefit strong { display: block; font-size: 12px; font-weight: 600; margin-bottom: 2px; }
    .benefit p { font-size: 11px; color: var(--vscode-descriptionForeground, #9ca3af); line-height: 1.45; }

    @media (max-width: 560px) {
      .benefits { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="cover-wrap">
    <img class="cover-img" src="${coverUri}" alt="DeepGrep">
    <div class="cover-fade"></div>
  </div>

  <div class="wrap">
    <div class="intro">
      <h1>Welcome to DeepGrep</h1>
      <p>AST-powered structural context for Claude Code.</p>
    </div>

    <div class="section">
      <div class="section-title">Get started in 3 steps</div>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-body">
            <strong>Index your workspace</strong>
            <p>Click <b>Re-index Workspace</b> in the DeepGrep sidebar. Builds a dependency graph of your codebase in seconds.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-body">
            <strong>Use Claude Code normally</strong>
            <p>Claude queries the graph automatically through the MCP server — nothing else to configure.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-body">
            <strong>Explore the graph</strong>
            <p>Open the dependency graph panel to visualize symbols, trace calls, and jump to any node.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Why DeepGrep</div>
      <div class="benefits">
        <div class="benefit">
          <span class="benefit-icon">⚡</span>
          <div>
            <strong>Faster answers</strong>
            <p>Graph context in milliseconds — no full-file scans.</p>
          </div>
        </div>
        <div class="benefit">
          <span class="benefit-icon">🎯</span>
          <div>
            <strong>Precise results</strong>
            <p>AST-exact search finds the symbol, not nearby text.</p>
          </div>
        </div>
        <div class="benefit">
          <span class="benefit-icon">💰</span>
          <div>
            <strong>70–80% fewer tokens</strong>
            <p>Serves exact symbols and call-sites, not whole files.</p>
          </div>
        </div>
        <div class="benefit">
          <span class="benefit-icon">🔗</span>
          <div>
            <strong>Cross-file context</strong>
            <p>Traces imports, calls, extends, and re-exports automatically.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}
