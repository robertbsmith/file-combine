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
        const nonce = getNonce();
        const csp = `default-src 'none'; style-src ${this._panel.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="${csp}">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Combined Files</title>
            <style nonce="${nonce}">
                html, body {
                    margin: 0;
                    padding: 0;
                    height: 100%;
                    overflow: hidden;
                    font-family: var(--vscode-editor-font-family, monospace);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }

                .content-container {
                    height: 100%;
                    width: 100%;
                    overflow-y: auto;
                    box-sizing: border-box;
                    /* MODIFICATION: Reverted padding to a small, uniform value. */
                    /* The content will now start at the top and scroll behind the button. */
                    padding: 15px; 
                }
                
                #editor {
                    white-space: pre-wrap; 
                    word-wrap: break-word;
                }

                .copy-button {
                    position: fixed;
                    top: 15px;
                    right: 20px;
                    padding: 8px 16px; 
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: 1px solid var(--vscode-button-border, transparent);
                    font-size: var(--vscode-font-size);
                    border-radius: 4px;
                    cursor: pointer;
                    z-index: 1000;
                    transition: background-color 0.1s ease-in-out;
                }

                .copy-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }

                .copy-button:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    outline-offset: 2px;
                }

                .copy-button:active {
                    background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
                }
            </style>
        </head>
        <body>
            <button id="copy-btn" class="copy-button">Copy to Clipboard</button>

            <div class="content-container">
                <pre id="editor"></pre>
            </div>
            
            <script nonce="${nonce}">
                (function() {
                    const editorPre = document.getElementById('editor');
                    const copyButton = document.getElementById('copy-btn');
                    
                    const encodedContent = \`${encodeURIComponent(content)}\`;
                    const decodedContent = decodeURIComponent(encodedContent);
                    editorPre.textContent = decodedContent;
    
                    function copyContent() {
                        navigator.clipboard.writeText(decodedContent).then(() => {
                            copyButton.textContent = 'Copied!';
                            setTimeout(() => {
                                copyButton.textContent = 'Copy to Clipboard';
                            }, 2000);
                        }, () => {
                            copyButton.textContent = 'Error!';
                            setTimeout(() => {
                                copyButton.textContent = 'Copy to Clipboard';
                            }, 2000);
                        });
                    }

                    if (copyButton) {
                        copyButton.addEventListener('click', copyContent);
                    }
                }());
            </script>
        </body>
        </html>`;
    }
}