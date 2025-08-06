import * as vscode from 'vscode';
import * as path from 'path';
import ignore from 'ignore';
import * as fs from 'fs';

// Enhanced Debug logger with timestamps
function debugLog(message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`, ...args);
}

interface ProcessingSummary {
    totalFiles: number;
    processedFiles: number;
    ignoredFiles: { path: string; reason: string }[];
    excludedFiles: string[];
    binaryFiles: string[];
    totalSize: number;
    estimatedTokens: number;
    timings: { [key: string]: number };
}

interface IgnoreFileEntry {
    filePath: string;
    patterns: string[];
}

const ignoreFileCache = new Map<string, IgnoreFileEntry>();

const DEFAULT_EXCLUDE_PATTERNS = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'dist/**', 'build/**', 'node_modules/**',
    '*.min.js', '*.bundle.js', 'tsconfig.tsbuildinfo', '.next/**', '*.svg', '*.jpg', '*.png', '*.ico',
    '.env*', '*.log', 'coverage/**', '.idea/**', '.vscode/**'
];

function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

interface TreeNode {
    name: string;
    children: { [key: string]: TreeNode };
    isFile: boolean;
}

function createTreeStructure(paths: string[]): TreeNode {
    debugLog('Creating tree structure for paths:', paths);
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
    childrenKeys.sort((a, b) => {
        const childA = node.children[a];
        const childB = node.children[b];
        if (childA.isFile === childB.isFile) {
            return childA.name.localeCompare(childB.name);
        }
        return childA.isFile ? 1 : -1;
    });

    childrenKeys.forEach((key, index) => {
        const child = node.children[key];
        const isLastChild = index === childrenKeys.length - 1;
        const newPrefix = prefix + (node.name === 'root' ? '' : (isLast ? '    ' : '│   '));
        result += generateTreeView(child, newPrefix, isLastChild);
    });

    return result;
}

function shouldExcludeFile(relativePath: string): boolean {
    const config = vscode.workspace.getConfiguration('fileCombine');
    const excludePatterns = config.get<string[]>('excludePatterns', DEFAULT_EXCLUDE_PATTERNS);
    const customIgnore = ignore().add(excludePatterns);
    return customIgnore.ignores(relativePath);
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
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    padding: 0;
                    margin: 0;
                    font-family: monospace;
                }
                .container {
                    display: flex;
                }
                #editor {
                    flex-grow: 1;
                    white-space: pre;
                    padding: 10px;
                    box-sizing: border-box;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    overflow-y: hidden;
                    margin: 0;
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
                    z-index: 1000;
                }
                .copy-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <button class="copy-button" onclick="copyContent()">Copy to Clipboard</button>
            <div class="container">
                <pre id="editor" data-content="${encodedContent}"></pre>
            </div>
            <script>
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

export function activate(context: vscode.ExtensionContext) {
    debugLog('Activating file-combine extension');
    const disposable = vscode.commands.registerCommand('file-combine.combineFiles', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
        const selectedUris = uris && uris.length > 0 ? uris : [uri];
        await combineFiles(selectedUris, context.extensionUri);
    });
    context.subscriptions.push(disposable);
    debugLog('Extension activated successfully');
}

async function combineFiles(uris: vscode.Uri[], extensionUri: vscode.Uri) {
    debugLog('Starting file combination process');
    if (!uris || uris.length === 0) {
        vscode.window.showWarningMessage('No files or folders selected.');
        return;
    }

    let combinedContent = '';
    const summary: ProcessingSummary = {
        totalFiles: 0, processedFiles: 0, ignoredFiles: [], excludedFiles: [],
        binaryFiles: [], totalSize: 0, estimatedTokens: 0, timings: {}
    };
    const processedPaths: string[] = [];
    const processedFilePaths = new Set<string>();
    ignoreFileCache.clear();

    const allRelevantIgnoreFiles: IgnoreFileEntry[] = [];
    for (const uri of uris) {
        const collected = await getAllRelevantIgnoreFiles(uri);
        for (const entry of collected) {
            if (!allRelevantIgnoreFiles.some(e => e.filePath === entry.filePath)) {
                allRelevantIgnoreFiles.push(entry);
            }
        }
    }
    // Reverse the list so the most specific ignore files are checked first (deepest path to shallowest)
    allRelevantIgnoreFiles.reverse();

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'Combining Files', cancellable: true
    }, async (progress, token) => {
        const startTime = Date.now();
        const fileUris: vscode.Uri[] = [];
        summary.timings.collectFiles = 0;
        for (const uri of uris) {
            const collectStartTime = Date.now();
            await collectFiles(uri, fileUris, summary, processedFilePaths, token, collectStartTime, allRelevantIgnoreFiles);
        }
        summary.totalFiles = fileUris.length;

        const processStartTime = Date.now();
        for (const uri of fileUris) {
            if (token.isCancellationRequested) return;
            progress.report({ message: `Processing ${path.basename(uri.fsPath)}` });
            const result = await processFile(uri, summary);
            if (result) {
                processedPaths.push(result.path);
                combinedContent += result.content;
                summary.processedFiles++;
                summary.totalSize += result.size;
                summary.estimatedTokens += result.tokens;
            }
        }
        summary.timings.processFiles = Date.now() - processStartTime;

        if (token.isCancellationRequested) return;
        if (summary.processedFiles === 0) {
            vscode.window.showWarningMessage('No text files found.');
            return;
        }

        const treeStartTime = Date.now();
        let treeView = '';
        if (processedPaths.length > 1) {
            const tree = createTreeStructure(processedPaths);
            treeView = generateTreeView(tree);
        }
        summary.timings.treeGeneration = Date.now() - treeStartTime;
        summary.timings.total = Date.now() - startTime;

        const config = vscode.workspace.getConfiguration('fileCombine');
        let output = '';

        if (config.get<boolean>('showProcessingSummary', false)) {
            output += '# Processing Summary\n```\n';
            output += `Total files found: ${summary.totalFiles}\n`;
            output += `Files processed: ${summary.processedFiles}\n`;
            output += `Total size: ${formatFileSize(summary.totalSize)}\n`;
            output += `Estimated tokens: ~${summary.estimatedTokens.toLocaleString()}\n`;
            output += '```\n\n';
        }

        const llmInstructions = config.get<string>('llmInstructions');
        if (llmInstructions) {
            output += '# Instructions for LLM\n';
            output += `${llmInstructions}\n\n`;
        }

        if (config.get<boolean>('showIgnoredFiles', true)) {
            const groupedIgnores = new Map<string, string[]>();
            if (summary.ignoredFiles.length > 0) {
                for (const ignored of summary.ignoredFiles) {
                    const reasonKey = `Files ignored by ${path.basename(ignored.reason)}`;
                    if (!groupedIgnores.has(reasonKey)) {
                        groupedIgnores.set(reasonKey, []);
                    }
                    groupedIgnores.get(reasonKey)!.push(ignored.path);
                }
                for (const [reason, paths] of groupedIgnores.entries()) {
                    output += `${reason}:\n`;
                    output += paths.map(p => `  - ${p}`).join('\n') + '\n\n';
                }
            }
            if (summary.excludedFiles.length > 0) {
                output += 'Files excluded by global settings:\n';
                output += summary.excludedFiles.map(f => `  - ${f}`).join('\n') + '\n\n';
            }
            if (summary.binaryFiles.length > 0) {
                output += 'Binary files skipped:\n';
                output += summary.binaryFiles.map(f => `  - ${f}`).join('\n') + '\n\n';
            }
        }

        if (config.get<boolean>('showTimings', true)) {
            output += 'Timings:\n```\n';
            for (const [stage, time] of Object.entries(summary.timings)) {
                output += `  - ${stage}: ${time}ms\n`;
            }
            output += '```\n\n';
        }

        if (config.get<boolean>('showFileStructure', true) && treeView.length > 0) {
            output += `# File Structure\n\`\`\`\n${treeView}\`\`\`\n\n`;
        }

        output += '# Combined Files\n\n' + combinedContent;
        CombinedFilesPanel.createOrShow(extensionUri, output);
        printProcessingSummary(summary);
    });
}

function printProcessingSummary(summary: ProcessingSummary) {
    console.log('--- Processing Summary ---');
    console.log(`Total files found: ${summary.totalFiles}`);
    console.log(`Files processed: ${summary.processedFiles}`);
    console.log(`Total size: ${formatFileSize(summary.totalSize)}`);
    console.log(`Estimated tokens: ~${summary.estimatedTokens.toLocaleString()}`);

    if (summary.ignoredFiles.length > 0) {
        console.log('Files ignored by project rules:');
        const groupedIgnores = new Map<string, string[]>();
        for (const ignored of summary.ignoredFiles) {
            const reasonKey = `From ${path.basename(ignored.reason)}`;
            if (!groupedIgnores.has(reasonKey)) {
                groupedIgnores.set(reasonKey, []);
            }
            groupedIgnores.get(reasonKey)!.push(ignored.path);
        }
        for (const [reason, paths] of groupedIgnores.entries()) {
            console.log(`  ${reason}:`);
            paths.forEach(p => console.log(`    - ${p}`));
        }
    }
    if (summary.excludedFiles.length > 0) {
        console.log('Files excluded by global settings:');
        summary.excludedFiles.forEach(f => console.log(`  - ${f}`));
    }
    if (summary.binaryFiles.length > 0) {
        console.log('Binary files skipped:');
        summary.binaryFiles.forEach(f => console.log(`  - ${f}`));
    }
    console.log('Timings:');
    for (const [stage, time] of Object.entries(summary.timings)) {
        console.log(`  - ${stage}: ${time}ms`);
    }
    console.log('--------------------------');
}

async function collectFiles(
    uri: vscode.Uri,
    fileUris: vscode.Uri[],
    summary: ProcessingSummary,
    processedFilePaths: Set<string>,
    token: vscode.CancellationToken,
    collectStartTime: number,
    allRelevantIgnoreFiles: IgnoreFileEntry[]
) {
    if (token.isCancellationRequested) return;

    try {
        const stats = await vscode.workspace.fs.stat(uri);
        const relativePath = vscode.workspace.asRelativePath(uri);

        // First, check against global exclusion settings.
        if (shouldExcludeFile(relativePath)) {
            if (!summary.excludedFiles.includes(relativePath)) {
                summary.excludedFiles.push(relativePath);
            }
            return;
        }

        // --- FIX STARTS HERE ---
        // Second, check against hierarchical .gitignore and .filecombine rules.
        // The 'allRelevantIgnoreFiles' list is already reversed to check from deepest to shallowest.
        // We do NOT reverse it again here.
        for (const ignoreEntry of allRelevantIgnoreFiles) {
            const tempIgnore = ignore().add(ignoreEntry.patterns);
            
            // The path must be relative to the directory containing the ignore file.
            const relativeToIgnoreFile = path.relative(path.dirname(ignoreEntry.filePath), uri.fsPath);
            
            // The 'ignore' library requires POSIX-style paths (with /).
            const posixPath = relativeToIgnoreFile.split(path.sep).join(path.posix.sep);

            if (posixPath && tempIgnore.ignores(posixPath)) {
                if (!summary.ignoredFiles.some(f => f.path === relativePath)) {
                    summary.ignoredFiles.push({ path: relativePath, reason: ignoreEntry.filePath });
                }
                return; // File is ignored, so we stop processing it.
            }
        }
        // --- FIX ENDS HERE ---

        // If not ignored, process the file or directory.
        if (stats.type === vscode.FileType.File) {
            if (processedFilePaths.has(uri.fsPath)) return;
            fileUris.push(uri);
            processedFilePaths.add(uri.fsPath);
        } else if (stats.type === vscode.FileType.Directory) {
            const dirContent = await vscode.workspace.fs.readDirectory(uri);
            for (const [name] of dirContent) {
                const childUri = vscode.Uri.joinPath(uri, name);
                // Pass the correctly ordered ignore list to the recursive call.
                await collectFiles(childUri, fileUris, summary, processedFilePaths, token, Date.now(), allRelevantIgnoreFiles);
            }
        }
    } catch (error) {
        debugLog(`Error processing ${uri.fsPath} in collectFiles:`, error);
    } finally {
        const duration = Date.now() - collectStartTime;
        summary.timings.collectFiles += duration;
    }
}

async function getAllRelevantIgnoreFiles(startUri: vscode.Uri): Promise<IgnoreFileEntry[]> {
    const relevantIgnoreFiles: IgnoreFileEntry[] = [];
    let currentUri: vscode.Uri;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const visitedDirs = new Set<string>();

    try {
        const stats = await vscode.workspace.fs.stat(startUri);
        currentUri = stats.type === vscode.FileType.Directory ? startUri : vscode.Uri.joinPath(startUri, '..');
    } catch {
        currentUri = vscode.Uri.joinPath(startUri, '..');
    }

    while (currentUri && workspaceRoot && currentUri.path.startsWith(workspaceRoot.path) && !visitedDirs.has(currentUri.fsPath)) {
        visitedDirs.add(currentUri.fsPath);
        for (const ignoreFileName of ['.gitignore', '.filecombine']) {
            const ignoreFileUri = vscode.Uri.joinPath(currentUri, ignoreFileName);
            if (ignoreFileCache.has(ignoreFileUri.fsPath)) {
                relevantIgnoreFiles.push(ignoreFileCache.get(ignoreFileUri.fsPath)!);
                continue;
            }
            try {
                // Using fs.existsSync because vscode.workspace.fs.stat throws an error for non-existence.
                if (fs.existsSync(ignoreFileUri.fsPath)) {
                    const contentBytes = await vscode.workspace.fs.readFile(ignoreFileUri);
                    const patterns = contentBytes.toString().split('\n').filter(p => p.trim() !== '' && !p.startsWith('#'));
                    const entry: IgnoreFileEntry = { filePath: ignoreFileUri.fsPath, patterns };
                    ignoreFileCache.set(ignoreFileUri.fsPath, entry);
                    relevantIgnoreFiles.push(entry);
                }
            } catch (error) {
                debugLog(`Error reading ${ignoreFileName} at ${ignoreFileUri.fsPath}:`, error);
            }
        }
        if (currentUri.path === workspaceRoot.path) break;
        const parentPath = path.dirname(currentUri.fsPath);
        if (parentPath === currentUri.fsPath) break; // Reached the top
        currentUri = vscode.Uri.file(parentPath);
    }
    return relevantIgnoreFiles;
}

async function processFile(uri: vscode.Uri, summary: ProcessingSummary): Promise<{ content: string; path: string; size: number; tokens: number } | null> {
    try {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(contentBytes);
        const fileSize = buffer.length;

        const { isText } = await import('istextorbinary');
        if (!isText(path.basename(uri.fsPath), buffer)) {
            summary.binaryFiles.push(vscode.workspace.asRelativePath(uri));
            return null;
        }

        const content = buffer.toString();
        const relativePath = vscode.workspace.asRelativePath(uri);
        const fileExtension = path.extname(uri.fsPath).replace('.', '');
        const estimatedTokens = Math.ceil(content.length / 4);

        return {
            content: `## Path: ${relativePath} (${formatFileSize(fileSize)})\n\n\`\`\`${fileExtension}\n${content}\n\`\`\`\n\n`,
            path: relativePath, size: fileSize, tokens: estimatedTokens
        };
    } catch (error) {
        debugLog('Error in processFile:', error);
        vscode.window.showErrorMessage(`Error reading file: ${uri.fsPath}`);
        return null;
    }
}

export function deactivate() {
    debugLog('Deactivating extension');
    ignoreFileCache.clear();
}