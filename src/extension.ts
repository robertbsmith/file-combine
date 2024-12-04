// Import necessary modules
import * as vscode from 'vscode';

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

// Function to combine files and folders
async function combineFiles(uris: vscode.Uri[]) {
  if (!uris || uris.length === 0) {
    vscode.window.showWarningMessage('No files or folders selected.');
    return;
  }

  let combinedContent = '';

  for (const uri of uris) {
    const stats = await vscode.workspace.fs.stat(uri);
    if (stats.type === vscode.FileType.File) {
      combinedContent += await processFile(uri);
    } else if (stats.type === vscode.FileType.Directory) {
      combinedContent += await processDirectory(uri);
    }
  }

  const doc = await vscode.workspace.openTextDocument({
    content: combinedContent,
    language: 'markdown' // Use markdown language mode for better formatting
  });
  await vscode.window.showTextDocument(doc);
}

// Process a file by reading its content and adding it to the combined content
async function processFile(uri: vscode.Uri): Promise<string> {
  const contentBytes = await vscode.workspace.fs.readFile(uri);
  const content = contentBytes.toString();
  const relativePath = vscode.workspace.asRelativePath(uri);

  // Format the output with headers and code blocks
  const fileContent = `## Path: ${relativePath}\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
  return fileContent;
}

// Recursively process a directory
async function processDirectory(uri: vscode.Uri): Promise<string> {
  let combinedContent = '';
  const entries = await vscode.workspace.fs.readDirectory(uri);
  for (const [name, type] of entries) {
    const childUri = vscode.Uri.joinPath(uri, name);
    if (type === vscode.FileType.File) {
      combinedContent += await processFile(childUri);
    } else if (type === vscode.FileType.Directory) {
      combinedContent += await processDirectory(childUri);
    }
  }
  return combinedContent;
}

// This method is called when your extension is deactivated
export function deactivate() {}
