import type { WebviewToExtMsg, ExtToWebviewMsg, CyNode, CyEdge, StatsPayload } from '../../extension/src/webview/messages';

// acquireVsCodeApi is injected by VS Code into the webview context
declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExtMsg): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
};

let _api: ReturnType<typeof acquireVsCodeApi> | null = null;

export function getVscodeApi() {
  if (!_api) {
    try {
      _api = acquireVsCodeApi();
    } catch {
      // Running outside VS Code (dev/storybook) — stub it
      _api = {
        postMessage: (msg) => console.log('[vscode stub] postMessage', msg),
        getState: () => undefined,
        setState: () => {},
      };
    }
  }
  return _api;
}

export function postMessage(msg: WebviewToExtMsg): void {
  getVscodeApi().postMessage(msg);
}

export function onMessage(handler: (msg: ExtToWebviewMsg) => void): () => void {
  const listener = (event: MessageEvent<ExtToWebviewMsg>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export type { WebviewToExtMsg, ExtToWebviewMsg, CyNode, CyEdge, StatsPayload };
