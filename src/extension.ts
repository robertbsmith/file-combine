// src/extension.ts

import * as vscode from 'vscode';
import { combineFiles, ignoreFileCache } from './fileProcessor';
import { debugLog } from './utils';

export function activate(context: vscode.ExtensionContext) {
    debugLog('Activating file-combine extension');
    
    const disposable = vscode.commands.registerCommand('file-combine.combineFiles', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
        const selectedUris = uris && uris.length > 0 ? uris : [uri];
        await combineFiles(selectedUris, context.extensionUri);
    });

    context.subscriptions.push(disposable);
    debugLog('Extension activated successfully');
}

export function deactivate() {
    debugLog('Deactivating extension');
    ignoreFileCache.clear();
}