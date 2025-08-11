// src/webviewPanel.ts

import * as vscode from 'vscode';
import { getNonce } from './utils';

export class CombinedFilesPanel {
    public static currentPanel: CombinedFilesPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri) {
        this._panel = panel;
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri, content: string) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (CombinedFilesPanel.currentPanel) {
            CombinedFilesPanel.currentPanel._panel.reveal(column);
            CombinedFilesPanel.currentPanel.updateContent(content);
            return;
        }

        const panel = vscode.window.createWebviewPanel('fileCombine', 'Combined Files', column || vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        CombinedFilesPanel.currentPanel = new CombinedFilesPanel(panel, extensionUri);
        CombinedFilesPanel.currentPanel.updateContent(content);
    }

    public updateContent(content: string) {
        this._panel.webview.html = this._getHtmlForWebview(content);
    }

    public dispose() {
        CombinedFilesPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview(content: string) {
        const encodedContent = encodeURIComponent(content);
        const nonce = getNonce();

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { padding: 0; margin: 0; font-family: monospace; }
                .container { display: flex; }
                #editor { flex-grow: 1; white-space: pre; padding: 10px; box-sizing: border-box; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); overflow-y: hidden; margin: 0; }
                .copy-button { position: fixed; top: 10px; right: 10px; padding: 5px 10px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; z-index: 1000; }
                .copy-button:hover { background-color: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
            <button class="copy-button" onclick="copyContent()">Copy to Clipboard</button>
            <div class="container">
                <pre id="editor" data-content="${encodedContent}"></pre>
            </div>
            <script nonce="${nonce}">
                document.addEventListener('DOMContentLoaded', () => {
                    const editorPre = document.getElementById('editor');
                    const content = decodeURIComponent(editorPre.dataset.content);
                    editorPre.textContent = content;
                });
    
                function copyContent() {
                    const content = document.getElementById('editor').textContent;
                    navigator.clipboard.writeText(content).then(() => {
                        const button = document.querySelector('.copy-button');
                        button.textContent = 'Copied!';
                        setTimeout(() => {
                            button.textContent = 'Copy to Clipboard';
                        }, 2000);
                    });
                }
            </script>
        </body>
        </html>`;
    }
}