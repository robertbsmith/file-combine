// src/fileProcessor.ts
import * as vscode from 'vscode';
import * as path from 'path';
import ignore from 'ignore';
import { isText } from 'istextorbinary';
import { ProcessingSummary, IgnoreFileEntry } from './types';
import { createTreeStructure, generateTreeView } from './treeView';
import { CombinedFilesPanel } from './webviewPanel';
import { debugLog, formatFileSize } from './utils';

export const ignoreFileCache = new Map<string, IgnoreFileEntry>();

type CompiledIgnoreMap = Map<string, ignore.Ignore>;

const DEFAULT_EXCLUDE_PATTERNS = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'dist/**', 'build/**', 'node_modules/**',
    '*.min.js', '*.bundle.js', 'tsconfig.tsbuildinfo', '.next/**', '*.svg', '*.jpg', '*.png', '*.ico',
    '.env*', '*.log', 'coverage/**', '.idea/**', '.vscode/**'
];

function shouldExcludeFile(relativePath: string, globalExcluder: ignore.Ignore): boolean {
    return globalExcluder.ignores(relativePath);
}

export async function combineFiles(uris: vscode.Uri[], extensionUri: vscode.Uri) {
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

    const config = vscode.workspace.getConfiguration('fileCombine');
    const excludePatterns = config.get<string[]>('excludePatterns', DEFAULT_EXCLUDE_PATTERNS);
    const globalExcluder = ignore().add(excludePatterns);

    // --- REFACTORED IGNORE LOGIC ---
    const allRelevantIgnoreFiles: IgnoreFileEntry[] = [];
    const uniqueStartDirs = new Set<string>();

    for (const uri of uris) {
        try {
            const stats = await vscode.workspace.fs.stat(uri);
            const startDir = stats.type === vscode.FileType.Directory ? uri.fsPath : path.dirname(uri.fsPath);
            uniqueStartDirs.add(startDir);
        } catch (e) {
            debugLog(`Could not stat URI ${uri.fsPath} for ignore file collection`, e);
        }
    }
    
    const foundIgnoreFiles = new Set<string>();
    for (const dir of uniqueStartDirs) {
        const collected = await getAllRelevantIgnoreFiles(vscode.Uri.file(dir));
        for (const entry of collected) {
            if (!foundIgnoreFiles.has(entry.filePath)) {
                allRelevantIgnoreFiles.push(entry);
                foundIgnoreFiles.add(entry.filePath);
            }
        }
    }
    
    const compiledIgnores: CompiledIgnoreMap = new Map();
    for (const entry of allRelevantIgnoreFiles) {
        const dirPath = path.dirname(entry.filePath);
        if (!compiledIgnores.has(dirPath)) {
            compiledIgnores.set(dirPath, ignore());
        }
        compiledIgnores.get(dirPath)!.add(entry.patterns);
    }
    // --- END REFACTORED IGNORE LOGIC ---

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'Combining Files', cancellable: true
    }, async (progress, token) => {
        const startTime = Date.now();
        const fileUris: vscode.Uri[] = [];
        
        const collectStartTime = Date.now();
        await Promise.all(uris.map(uri => 
            collectFiles(uri, fileUris, summary, processedFilePaths, token, compiledIgnores, globalExcluder)
        ));
        summary.timings.collectFiles = Date.now() - collectStartTime;
        summary.totalFiles = fileUris.length;

        const processStartTime = Date.now();
        for (const uri of fileUris) {
            if (token.isCancellationRequested) { return; }
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

        if (token.isCancellationRequested) { return; }
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
                    const relativeReasonPath = vscode.workspace.asRelativePath(ignored.reason);
                    const reasonKey = `Files ignored by rules in ./${relativeReasonPath}`;
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
            const relativeReasonPath = vscode.workspace.asRelativePath(ignored.reason);
            const reasonKey = `By rules in ./${relativeReasonPath}`;
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
    compiledIgnores: CompiledIgnoreMap,
    globalExcluder: ignore.Ignore
) {
    if (token.isCancellationRequested){ return; }

    try {
        const stats = await vscode.workspace.fs.stat(uri);
        const relativePath = vscode.workspace.asRelativePath(uri);

        if (shouldExcludeFile(relativePath, globalExcluder)) {
            if (!summary.excludedFiles.includes(relativePath)) {
                summary.excludedFiles.push(relativePath);
            }
            return;
        }

        // --- OPTIMIZED IGNORE CHECKING ---
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const workspaceRootPath = workspaceFolder?.uri.fsPath;
        let currentDir = (stats.type === vscode.FileType.Directory) ? uri.fsPath : path.dirname(uri.fsPath);

        while (workspaceRootPath && currentDir.startsWith(workspaceRootPath)) {
            if (compiledIgnores.has(currentDir)) {
                const ig = compiledIgnores.get(currentDir)!;
                const pathToCheck = path.relative(currentDir, uri.fsPath);
                const posixPath = pathToCheck.split(path.sep).join(path.posix.sep);

                if (posixPath && ig.ignores(posixPath)) {
                    if (!summary.ignoredFiles.some(f => f.path === relativePath)) {
                        summary.ignoredFiles.push({ path: relativePath, reason: currentDir });
                    }
                    return;
                }
            }
            if (currentDir === workspaceRootPath) break;
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }
        // --- END OPTIMIZED IGNORE CHECKING ---

        if (stats.type === vscode.FileType.File) {
            if (processedFilePaths.has(uri.fsPath)) { return; }
            fileUris.push(uri);
            processedFilePaths.add(uri.fsPath);
        } else if (stats.type === vscode.FileType.Directory) {
            const dirContent = await vscode.workspace.fs.readDirectory(uri);
            await Promise.all(dirContent.map(([name]) => {
                const childUri = vscode.Uri.joinPath(uri, name);
                return collectFiles(childUri, fileUris, summary, processedFilePaths, token, compiledIgnores, globalExcluder);
            }));
        }
    } catch (error) {
        debugLog(`Error processing ${uri.fsPath} in collectFiles:`, error);
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
                await vscode.workspace.fs.stat(ignoreFileUri);
                const contentBytes = await vscode.workspace.fs.readFile(ignoreFileUri);
                const patterns = contentBytes.toString().split('\n').filter(p => p.trim() !== '' && !p.startsWith('#'));
                const entry: IgnoreFileEntry = { filePath: ignoreFileUri.fsPath, patterns };
                ignoreFileCache.set(ignoreFileUri.fsPath, entry);
                relevantIgnoreFiles.push(entry);
            } catch (error) {
                if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
                    debugLog(`Error reading ${ignoreFileName} at ${ignoreFileUri.fsPath}:`, error);
                }
            }
        }
        if (currentUri.path === workspaceRoot.path) { break; }
        const parentPath = path.dirname(currentUri.fsPath);
        if (parentPath === currentUri.fsPath) { break; }
        currentUri = vscode.Uri.file(parentPath);
    }
    return relevantIgnoreFiles;
}

async function processFile(uri: vscode.Uri, summary: ProcessingSummary): Promise<{ content: string; path: string; size: number; tokens: number } | null> {
    try {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(contentBytes);
        const fileSize = buffer.length;

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