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
    ignoredFiles: string[];
    excludedFiles: string[];
    binaryFiles: string[];
    totalSize: number;
    timings: { [key: string]: number }; // Store timings for different stages
}

const DEFAULT_EXCLUDE_PATTERNS = [
    // Package manager files
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    // Build outputs
    'dist/**',
    'build/**',
    // Dependencies
    'node_modules/**',
    // Large generated files
    '*.min.js',
    '*.bundle.js',
    // Common large config files
    'tsconfig.tsbuildinfo',
    '.next/**',
    // Common binary or large assets
    '*.svg',
    '*.jpg',
    '*.png',
    '*.ico',
    // Environment and local config
    '.env*',
    '*.log',
    // Test coverage
    'coverage/**',
    // IDE specific
    '.idea/**',
    '.vscode/**'
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

    debugLog('Checking exclusion for path:', relativePath);
    debugLog('Using exclude patterns:', excludePatterns);

    const customIgnore = ignore().add(excludePatterns);
    const shouldExclude = customIgnore.ignores(relativePath);

    debugLog(`File ${relativePath} excluded: ${shouldExclude}`);
    return shouldExclude;
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
        // We will pass the content as a data attribute to the <pre> element
        // and then set textContent in the webview's JavaScript.
        const encodedContent = encodeURIComponent(content); // Encode for safe data attribute
    
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
                .line-numbers {
                    width: 3em;
                    padding: 10px 0;
                    text-align: right;
                    background-color: var(--vscode-editor-lineHighlightBackground, #2a2a2a);
                    color: var(--vscode-editorLineNumber-foreground, #858585);
                    user-select: none;
                }
                .line-number {
                    padding-right: 1em;
                    display: block;
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
                .summary-section {
                    margin: 10px;
                    padding: 10px;
                    background-color: var(--vscode-editor-lineHighlightBackground, #2a2a2a);
                    border-radius: 4px;
                    font-family: var(--vscode-font-family);
                }
                .summary-section h3 {
                    margin-top: 0;
                    color: var(--vscode-editor-foreground);
                }
                .summary-list {
                    margin: 0;
                    padding-left: 20px;
                    color: var(--vscode-editor-foreground);
                }
            </style>
        </head>
        <body>
            <button class="copy-button" onclick="copyContent()">Copy to Clipboard</button>
            <div class="container">
                <div class="line-numbers" id="lineNumbers"></div>
                <pre id="editor" data-content="${encodedContent}"></pre> <!- Pass content as data attribute -->
            </div>
            <script>
                document.addEventListener('DOMContentLoaded', () => {
                    const editorPre = document.getElementById('editor');
                    const content = decodeURIComponent(editorPre.dataset.content); // Decode the content
                    editorPre.textContent = content; // Set textContent - browser handles escaping
    
                    // Add line numbers
                    const lineNumbers = document.getElementById('lineNumbers');
                    const lines = content.split('\\n'); // Split from the *decoded* content
                    lines.forEach((_, i) => {
                        const span = document.createElement('span');
                        span.className = 'line-number';
                        span.textContent = (i + 1).toString();
                        lineNumbers.appendChild(span);
                    });
    
                    // Synchronize scrolling between line numbers and content
                    editorPre.addEventListener('scroll', () => {
                        lineNumbers.scrollTop = editorPre.scrollTop;
                    });
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
        debugLog('Command executed with URIs:', { primary: uri?.fsPath, additional: uris?.map(u => u.fsPath) });
        const selectedUris = uris && uris.length > 0 ? uris : [uri];
        await combineFiles(selectedUris, context.extensionUri);
    });

    context.subscriptions.push(disposable);
    debugLog('Extension activated successfully');
}

async function combineFiles(uris: vscode.Uri[], extensionUri: vscode.Uri) {
    debugLog('Starting file combination process');

    if (!uris || uris.length === 0) {
        debugLog('No files or folders selected');
        vscode.window.showWarningMessage('No files or folders selected.');
        return;
    }

    let combinedContent = '';
    const summary: ProcessingSummary = {
        totalFiles: 0,
        processedFiles: 0,
        ignoredFiles: [],
        excludedFiles: [],
        binaryFiles: [],
        totalSize: 0,
        timings: {}
    };
    const processedPaths: string[] = [];

    // Track processed file paths to avoid duplicates
    const processedFilePaths = new Set<string>();

    const progressOptions: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: 'Combining Files',
        cancellable: true,
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
        const startTime = Date.now();

        const fileUris: vscode.Uri[] = [];
        summary.timings.collectFiles = 0; // Initialize collectFiles timing
        for (const uri of uris) {
            const collectStartTime = Date.now(); // Start time for this specific collectFiles call
            await collectFiles(uri, fileUris, summary, processedFilePaths, token, collectStartTime);
             // No longer adding here; it's done within collectFiles.
        }
        summary.totalFiles = fileUris.length;
        // collectFiles timing is now correctly calculated within collectFiles

        const processStartTime = Date.now();
        for (const uri of fileUris) {
            if (token.isCancellationRequested) {
                return;
            }
            progress.report({ message: `Processing ${path.basename(uri.fsPath)}` });

            const result = await processFile(uri);
            if (result) {
                processedPaths.push(result.path);
                combinedContent += result.content;
                summary.processedFiles++;
                summary.totalSize += result.size;
            }
        }
        summary.timings.processFiles = Date.now() - processStartTime;


        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('File combination cancelled.');
            return;
        }

        if (summary.processedFiles === 0) {
            vscode.window.showWarningMessage('No text files found.');
            return;
        }
        const treeStartTime = Date.now();

        // Add file structure if more than one file
        let treeView = '';
        if (processedPaths.length > 1) {
            const tree = createTreeStructure(processedPaths);
            treeView = generateTreeView(tree);
        }

        summary.timings.treeGeneration = Date.now() - treeStartTime;
        const totalTime = Date.now() - startTime;
        summary.timings.total = totalTime;
        // Add summary information at the top
        let output = '# Processing Summary\n';
        output += '```\n';
        output += `Total files found: ${summary.totalFiles}\n`;
        output += `Files processed: ${summary.processedFiles}\n`;
        output += `Total size: ${formatFileSize(summary.totalSize)}\n\n`;

        if (summary.ignoredFiles.length > 0) {
            output += 'Files ignored by .gitignore:\n';
            output += summary.ignoredFiles.map(f => `  - ${f}`).join('\n') + '\n\n';
        }

        if (summary.excludedFiles.length > 0) {
            output += 'Files excluded by patterns:\n';
            output += summary.excludedFiles.map(f => `  - ${f}`).join('\n') + '\n\n';
        }

        if (summary.binaryFiles.length > 0) {
            output += 'Binary files skipped:\n';
            output += summary.binaryFiles.map(f => `  - ${f}`).join('\n') + '\n';
        }


        output += 'Timings:\n';
        for (const [stage, time] of Object.entries(summary.timings)) {
          output += `  - ${stage}: ${time}ms\n`;
        }
        output += '```\n\n';


        if (treeView.length > 0){
            output += `# File Structure\n\`\`\`\n${treeView}\`\`\`\n\n`;
        }


        output += '# Combined Files\n\n' + combinedContent;
        CombinedFilesPanel.createOrShow(extensionUri, output);

         // Log the summary to the console
         printProcessingSummary(summary);
    });
}


// Function to print the processing summary to the console
function printProcessingSummary(summary: ProcessingSummary) {
    console.log('--- Processing Summary ---');
    console.log(`Total files found: ${summary.totalFiles}`);
    console.log(`Files processed: ${summary.processedFiles}`);
    console.log(`Total size: ${formatFileSize(summary.totalSize)}`);

    if (summary.ignoredFiles.length > 0) {
        console.log('Files ignored by .gitignore:');
        summary.ignoredFiles.forEach(f => console.log(`  - ${f}`));
    }

    if (summary.excludedFiles.length > 0) {
        console.log('Files excluded by patterns:');
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
    collectStartTime: number // Start time for this particular call
) {
    debugLog(`Collecting files from: ${uri.fsPath}`);

    if (token.isCancellationRequested) {
        return;
    }

    try {
        const stats = await vscode.workspace.fs.stat(uri);
        if (stats.type === vscode.FileType.File) {
            const relativePath = vscode.workspace.asRelativePath(uri);
            debugLog(`Checking file: ${relativePath}`);

            // Skip if this file was already processed
            if (processedFilePaths.has(uri.fsPath)) {
                debugLog(`Skipping already processed file: ${relativePath}`);
                return;
            }

            const ignoreMatcher = await getIgnoreMatcher(uri);
            const isIgnored = ignoreMatcher?.ignores(relativePath);
            const isExcluded = shouldExcludeFile(relativePath);

            if (isIgnored) {
                summary.ignoredFiles.push(relativePath);
            } else if (isExcluded) {
                summary.excludedFiles.push(relativePath);
            } else {
                fileUris.push(uri);
                // Mark this file as processed
                processedFilePaths.add(uri.fsPath);
            }
        } else if (stats.type === vscode.FileType.Directory) {
            const relativePath = vscode.workspace.asRelativePath(uri);
            debugLog(`Checking directory: ${relativePath}`);

            const ignoreMatcher = await getIgnoreMatcher(uri);
            const isIgnored = ignoreMatcher?.ignores(relativePath);
            const isExcluded = shouldExcludeFile(relativePath);
            let dirCollectStartTime: number;

            if (isIgnored) {
                debugLog(`Directory ${relativePath} is ignored by .gitignore`);
                summary.ignoredFiles.push(relativePath);
            } else if (isExcluded) {
                debugLog(`Directory ${relativePath} is excluded by patterns`);
                summary.excludedFiles.push(relativePath);
            } else {
                debugLog(`Processing directory contents: ${relativePath}`);
                const dirContent = await vscode.workspace.fs.readDirectory(uri);
                for (const [name, type] of dirContent) {
                    const childUri = vscode.Uri.joinPath(uri, name);
                    dirCollectStartTime = Date.now(); // Start time for each recursive call
                    await collectFiles(childUri, fileUris, summary, processedFilePaths, token, dirCollectStartTime);

                }
            }
        }
    } catch (error) {
        debugLog('Error in collectFiles:', error);
        throw error; // Re-throw the error to be handled by the caller.  Critical for error reporting.
    } finally {
      const duration = Date.now() - collectStartTime;
      summary.timings.collectFiles += duration;
      debugLog(`collectFiles for ${uri.fsPath} took ${duration}ms`);
    }
}

async function getIgnoreMatcher(uri: vscode.Uri): Promise<ignore.Ignore | null> {
    debugLog(`Looking for .gitignore starting from: ${uri.fsPath}`);
    let currentUri = uri;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

    while (currentUri && workspaceRoot) {
        if (!currentUri.path.startsWith(workspaceRoot.path)) {
          debugLog(`Reached workspace root without finding .gitignore`);
          break;
        }
        const gitignoreUri = vscode.Uri.joinPath(currentUri, '.gitignore');

        try {
            const exists = fs.existsSync(gitignoreUri.fsPath);  // Use synchronous check here.
            if (exists) {
              debugLog(`Found .gitignore at: ${gitignoreUri.fsPath}`);

              const gitignoreContent = await vscode.workspace.fs.readFile(gitignoreUri);
              const content = gitignoreContent.toString();
              debugLog('Git ignore patterns:', content);

              const ignoreInstance = ignore();
              ignoreInstance.add(content);
              return ignoreInstance;
            } else {
                debugLog(`No .gitignore found at: ${gitignoreUri.fsPath}`);
            }

        } catch (error) {
            debugLog(`Error checking for .gitignore at: ${gitignoreUri.fsPath}`, error);
             // Continue searching in the parent directory even if there was an error reading a specific .gitignore.
        }

        if (currentUri.path === workspaceRoot.path) {
            break;
        }

        currentUri = vscode.Uri.joinPath(currentUri, '..');

    }

    debugLog('No .gitignore found in path hierarchy');
    return null;
}

async function processFile(uri: vscode.Uri): Promise<{ content: string; path: string; size: number } | null> {
    try {
        debugLog(`Processing file: ${uri.fsPath}`);
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(contentBytes);
        const fileSize = buffer.length;

        const filename = path.basename(uri.fsPath);
        const { isText } = await import('istextorbinary');
        const isTextFile = isText(filename, buffer);
        debugLog(`File ${filename} is${isTextFile ? '' : ' not'} a text file (${formatFileSize(fileSize)})`);

        if (!isTextFile) {
            return null;
        }

        const content = buffer.toString();
        const relativePath = vscode.workspace.asRelativePath(uri);
        const fileExtension = path.extname(uri.fsPath).replace('.', '');

        debugLog(`Successfully processed ${relativePath} with extension: ${fileExtension}`);
        return {
            content: `## Path: ${relativePath} (${formatFileSize(fileSize)})\n\n\`\`\`${fileExtension}\n${content}\n\`\`\`\n\n`,
            path: relativePath,
            size: fileSize
        };
    } catch (error) {
        debugLog('Error in processFile:', error);
        vscode.window.showErrorMessage(`Error reading file: ${uri.fsPath}`);
        return null;
    }
}

export function deactivate() {
    debugLog('Deactivating extension');
}