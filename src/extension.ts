import * as vscode from 'vscode';
import * as path from 'path';
import ignore from 'ignore';

interface TreeNode {
    name: string;
    children: { [key: string]: TreeNode };
    isFile: boolean;
}

function createTreeStructure(paths: string[]): TreeNode {
    const root: TreeNode = { name: 'root', children: {}, isFile: false };
    
    for (const filePath of paths) {
        const parts = filePath.split('/');
        let currentNode = root;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile = i === parts.length - 1;
            
            if (!currentNode.children[part]) {
                currentNode.children[part] = {
                    name: part,
                    children: {},
                    isFile
                };
            }
            currentNode = currentNode.children[part];
        }
    }
    
    return root;
}

function generateTreeView(node: TreeNode, prefix: string = '', isLast = true): string {
    let result = '';
    
    if (node.name !== 'root') {
        result += prefix;
        result += isLast ? '└── ' : '├── ';
        result += node.name + '\n';
    }
    
    const childrenKeys = Object.keys(node.children);
    childrenKeys.forEach((key, index) => {
        const child = node.children[key];
        const isLastChild = index === childrenKeys.length - 1;
        const newPrefix = prefix + (node.name === 'root' ? '' : (isLast ? '    ' : '│   '));
        result += generateTreeView(child, newPrefix, isLastChild);
    });
    
    return result;
}

class CombinedFilesPanel {
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
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CombinedFilesPanel.currentPanel) {
            CombinedFilesPanel.currentPanel._panel.reveal(column);
            CombinedFilesPanel.currentPanel.updateContent(content);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'fileCombine',
            'Combined Files',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

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
        const escapedContent = content
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>');

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    padding: 0;
                    margin: 0;
                }
                #editor {
                    width: 100%;
                    height: 100vh;
                    white-space: pre;
                    font-family: monospace;
                    padding: 10px;
                    box-sizing: border-box;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .copy-button {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    padding: 5px 10px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                }
                .copy-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <button class="copy-button" onclick="copyContent()">Copy to Clipboard</button>
            <pre id="editor">${escapedContent}</pre>
            <script>
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

export function activate(context: vscode.ExtensionContext) {
    console.log('Your extension "file-combine" is now active!');

    const disposable = vscode.commands.registerCommand('file-combine.combineFiles', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
        const selectedUris = uris && uris.length > 0 ? uris : [uri];
        await combineFiles(selectedUris, context.extensionUri);
    });

    context.subscriptions.push(disposable);
}

async function combineFiles(uris: vscode.Uri[], extensionUri: vscode.Uri) {
    if (!uris || uris.length === 0) {
        vscode.window.showWarningMessage('No files or folders selected.');
        return;
    }

    let combinedContent = '';
    let fileCount = 0;
    let processedFileCount = 0;
    const processedPaths: string[] = [];

    const progressOptions: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: 'Combining Files',
        cancellable: true,
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
        const fileUris: vscode.Uri[] = [];
        for (const uri of uris) {
            await collectFiles(uri, fileUris);
        }
        fileCount = fileUris.length;

        for (const uri of fileUris) {
            if (token.isCancellationRequested) {
                return;
            }
            progress.report({ message: `Processing ${path.basename(uri.fsPath)} (${processedFileCount + 1}/${fileCount})` });
            
            const result = await processFile(uri);
            if (result) {
                processedPaths.push(result.path);
                combinedContent += result.content;
                processedFileCount++;
            }
        }

        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('File combination cancelled.');
            return;
        }
            
        if (processedFileCount === 0) {
            vscode.window.showWarningMessage('No text files found.');
            return;
        }

        // Generate tree structure if there's more than one file
        if (processedFileCount > 1) {
            const tree = createTreeStructure(processedPaths);
            const treeView = generateTreeView(tree);
            combinedContent = `# File Structure\n\`\`\`\n${treeView}\`\`\`\n\n# Combined Files\n\n${combinedContent}`;
        }

        CombinedFilesPanel.createOrShow(extensionUri, combinedContent);
    });
}

async function collectFiles(uri: vscode.Uri, fileUris: vscode.Uri[]) {
    const stats = await vscode.workspace.fs.stat(uri);
    if (stats.type === vscode.FileType.File) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const ignoreMatcher = await getIgnoreMatcher(uri);
        if (!ignoreMatcher || !ignoreMatcher.ignores(relativePath)) {
            fileUris.push(uri);
        }
    } else if (stats.type === vscode.FileType.Directory) {
        const ignoreMatcher = await getIgnoreMatcher(uri);
        const entries = await vscode.workspace.fs.readDirectory(uri);

        for (const [name, type] of entries) {
            const childUri = vscode.Uri.joinPath(uri, name);
            const relativePath = vscode.workspace.asRelativePath(childUri);

            if (ignoreMatcher && ignoreMatcher.ignores(relativePath)) {
                continue; // Ignore the file or directory
            }

            if (type === vscode.FileType.File) {
                fileUris.push(childUri);
            } else if (type === vscode.FileType.Directory) {
                await collectFiles(childUri, fileUris);
            }
        }
    }
}

async function getIgnoreMatcher(uri: vscode.Uri): Promise<ignore.Ignore | null> {
    let currentUri = uri;
    while (currentUri) {
        const gitignoreUri = vscode.Uri.joinPath(currentUri, '.gitignore');
        try {
            await vscode.workspace.fs.stat(gitignoreUri);
            const gitignoreContent = await vscode.workspace.fs.readFile(gitignoreUri);
            const ignoreInstance = ignore();
            ignoreInstance.add(gitignoreContent.toString());
            return ignoreInstance;
        } catch (error) {
            // File not found at this level, continue to the parent folder
        }
        if (currentUri.path === vscode.workspace.workspaceFolders?.[0]?.uri.path) {
            break;
        }
        currentUri = vscode.Uri.joinPath(currentUri, '..');
    }

    return null; // No .gitignore found
}

async function processFile(uri: vscode.Uri): Promise<{ content: string; path: string } | null> {
    try {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const { isText } = await import('istextorbinary');
        const buffer = Buffer.from(contentBytes);
        
        if (!isText(path.basename(uri.fsPath), buffer)) {
            return null;
        }

        const content = buffer.toString();
        const relativePath = vscode.workspace.asRelativePath(uri);

        // Get file extension for language code in markdown
        const fileExtension = path.extname(uri.fsPath).replace('.', '');


        return {
            content: `## Path: ${relativePath}\n\n\`\`\`${fileExtension}\n${content}\n\`\`\`\n\n`,
            path: relativePath
        };
    } catch (error) {
        vscode.window.showErrorMessage(`Error reading file: ${uri.fsPath}`);
        return null;
    }
}


export function deactivate() {}