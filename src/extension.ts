import * as vscode from 'vscode';
import * as path from 'path';
import ignore from 'ignore';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('Your extension "file-combine" is now active!');

    // Register the command with arguments from the context menu
    const disposable = vscode.commands.registerCommand('file-combine.combineFiles', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
        const selectedUris = uris && uris.length > 0 ? uris : [uri];
        await combineFiles(selectedUris);
    });

    context.subscriptions.push(disposable);
}

const textFileExtensions = ['.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.css', '.scss', '.html', '.htm', '.xml', '.yaml', '.yml', '.log', '.sh', '.py', '.java', '.c', '.cpp', '.h', '.hpp'];

async function combineFiles(uris: vscode.Uri[]) {
    if (!uris || uris.length === 0) {
        vscode.window.showWarningMessage('No files or folders selected.');
        return;
    }
    let combinedContent = '';
    let fileCount = 0;
    let processedFileCount = 0;

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
               combinedContent += await processFile(uri);
               processedFileCount++;

            }

            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage('File combination cancelled.');
                return;
            }
            
            if (processedFileCount === 0){
                    vscode.window.showWarningMessage('No text files found.');
                    return;
            }

            const doc = await vscode.workspace.openTextDocument({
                content: combinedContent,
                language: 'markdown' // Use markdown language mode for better formatting
            });
           await vscode.window.showTextDocument(doc);
    });

}

async function collectFiles(uri: vscode.Uri, fileUris: vscode.Uri[]) {
     const stats = await vscode.workspace.fs.stat(uri);
    if (stats.type === vscode.FileType.File) {
            fileUris.push(uri);

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
          if(currentUri.path === vscode.workspace.workspaceFolders?.[0]?.uri.path){
              break;
        }
         currentUri = vscode.Uri.joinPath(currentUri, '..');

    }

    return null; // No .gitignore found
}


async function processFile(uri: vscode.Uri): Promise<string> {
    const fileExtension = path.extname(uri.fsPath).toLowerCase();

    if (!textFileExtensions.includes(fileExtension)) {
        return ''; // Skip non-text files
    }

    try{
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const content = contentBytes.toString();
        const relativePath = vscode.workspace.asRelativePath(uri);

        // Format the output with headers and code blocks
        const fileContent = `## Path: ${relativePath}\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
        return fileContent;
    } catch (error){
        vscode.window.showErrorMessage(`Error reading file: ${uri.fsPath}.`);
        return '';
    }
}

// This method is called when your extension is deactivated
export function deactivate() {}