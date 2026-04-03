import * as vscode from "vscode";
import { getHierarchicalView } from "./cli";
import * as path from "path";

let currentPanel: vscode.WebviewPanel | null = null;

export async function showHierarchicalView(
  fileRelPath?: string,
  fragmentId?: string
): Promise<void> {
  if (!fileRelPath) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active editor");
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return;
    }
    fileRelPath = path.relative(folders[0].uri.fsPath, editor.document.uri.fsPath);
  }

  let content: string;
  try {
    content = await getHierarchicalView(fileRelPath, fragmentId);
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
    return;
  }

  if (!content || content.trim() === "" || content.includes("No fragments")) {
    vscode.window.showInformationMessage("No fragments defined for this file.");
    return;
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "pywebHierarchical",
      `PyWeb: ${path.basename(fileRelPath)}`,
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    );
    currentPanel.onDidDispose(() => {
      currentPanel = null;
    });
  }

  currentPanel.title = `PyWeb: ${path.basename(fileRelPath)}`;
  currentPanel.webview.html = renderHtml(content, fileRelPath);
}

function renderHtml(content: string, filePath: string): string {
  // Convert the text output to styled HTML
  const escaped = escapeHtml(content);
  const styled = escaped
    .replace(/^(=== .+ ===)$/gm, '<h2 class="root-header">$1</h2>')
    .replace(/^(--- .+ ---)$/gm, '<h3 class="child-header">$1</h3>');

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      line-height: 1.5;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .root-header {
      color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 4px;
      margin-top: 16px;
    }
    .child-header {
      color: var(--vscode-symbolIcon-methodForeground, #dcdcaa);
      margin-top: 12px;
    }
    .file-path {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="file-path">${escapeHtml(filePath)}</div>
  <pre>${styled}</pre>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
