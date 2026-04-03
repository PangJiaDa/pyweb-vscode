import * as vscode from "vscode";
import * as path from "path";
import * as cli from "./cli";
import { FragmentTreeProvider, FragmentTreeItem } from "./treeView";
import { updateDecorations, clearDecorations, disposeDecorations } from "./decorations";
import { showHierarchicalView } from "./hierarchicalView";

let treeProvider: FragmentTreeProvider;

export function activate(context: vscode.ExtensionContext): void {
  // Tree view
  treeProvider = new FragmentTreeProvider();
  const treeView = vscode.window.createTreeView("pywebFragments", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("pyweb.init", cmdInit),
    vscode.commands.registerCommand("pyweb.addFragment", cmdAddFragment),
    vscode.commands.registerCommand("pyweb.removeFragment", cmdRemoveFragment),
    vscode.commands.registerCommand("pyweb.renameFragment", cmdRenameFragment),
    vscode.commands.registerCommand("pyweb.refreshTree", () => {
      treeProvider.refresh();
      refreshActiveEditorDecorations();
    }),
    vscode.commands.registerCommand("pyweb.showHierarchicalView", cmdShowHierarchicalView),
    vscode.commands.registerCommand("pyweb.addProse", cmdAddProse),
    vscode.commands.registerCommand("pyweb.goToFragment", cmdGoToFragment)
  );

  // Refresh on active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      treeProvider.refresh();
      if (editor) {
        updateDecorations(editor);
      }
    })
  );

  // Auto-anchor on file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const relPath = getRelativePath(doc.uri);
      if (!relPath) {
        return;
      }
      try {
        await cli.anchorFile(relPath);
      } catch {
        // Anchor fails silently if no fragments exist for this file
      }
      treeProvider.refresh();
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === doc) {
        updateDecorations(editor);
      }
    })
  );

  // Initial decoration
  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor);
  }
}

export function deactivate(): void {
  disposeDecorations();
}

// --- Command handlers ---

async function cmdInit(): Promise<void> {
  try {
    const output = await cli.init();
    vscode.window.showInformationMessage(output.trim());
    treeProvider.refresh();
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb init failed: ${e.message}`);
  }
}

async function cmdAddFragment(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor");
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showErrorMessage("Select some code first");
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Fragment name",
    placeHolder: "e.g. initialization, error handling",
  });
  if (!name) {
    return;
  }

  const relPath = getRelativePath(editor.document.uri);
  if (!relPath) {
    return;
  }

  // Ask for optional parent
  const ff = await cli.loadFileFragments(relPath);
  let parentId: string | undefined;
  if (ff && ff.fragments.length > 0) {
    const items = [
      { label: "(none — root fragment)", id: undefined },
      ...ff.fragments.map((f) => ({ label: f.name, id: f.id })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Parent fragment (optional)",
    });
    if (picked === undefined) {
      return; // cancelled
    }
    parentId = picked.id;
  }

  const startLine = selection.start.line;
  const endLine = selection.end.line + (selection.end.character > 0 ? 1 : 0);

  try {
    const output = await cli.addFragment(relPath, name, startLine, endLine, parentId);
    vscode.window.showInformationMessage(output.trim());
    treeProvider.refresh();
    updateDecorations(editor);
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

async function cmdRemoveFragment(item?: FragmentTreeItem): Promise<void> {
  if (!item) {
    vscode.window.showErrorMessage("Use the tree view context menu to remove a fragment");
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Remove fragment "${item.fragment.name}"? (Code stays in source)`,
    "Remove",
    "Cancel"
  );
  if (confirm !== "Remove") {
    return;
  }

  try {
    await cli.removeFragment(item.fragment.file, item.fragment.id);
    treeProvider.refresh();
    refreshActiveEditorDecorations();
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

async function cmdRenameFragment(item?: FragmentTreeItem): Promise<void> {
  if (!item) {
    vscode.window.showErrorMessage("Use the tree view context menu to rename a fragment");
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: "New fragment name",
    value: item.fragment.name,
  });
  if (!newName) {
    return;
  }

  try {
    await cli.renameFragment(item.fragment.file, item.fragment.id, newName);
    treeProvider.refresh();
    refreshActiveEditorDecorations();
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

async function cmdShowHierarchicalView(item?: FragmentTreeItem): Promise<void> {
  const fragmentId = item?.fragment.id;
  const fileRelPath = item?.fragment.file;
  await showHierarchicalView(fileRelPath, fragmentId);
}

async function cmdAddProse(item?: FragmentTreeItem): Promise<void> {
  if (!item) {
    return;
  }

  const prose = await vscode.window.showInputBox({
    prompt: "Prose / explanation for this fragment",
    value: item.fragment.prose || "",
  });
  if (prose === undefined) {
    return; // cancelled
  }

  try {
    await cli.setProse(item.fragment.file, item.fragment.id, prose || null);
    treeProvider.refresh();
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

function cmdGoToFragment(fragment: cli.FragmentInfo): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return;
  }

  const uri = vscode.Uri.file(path.join(folders[0].uri.fsPath, fragment.file));
  const range = new vscode.Range(
    fragment.range.start_line,
    fragment.range.start_col,
    fragment.range.start_line,
    fragment.range.start_col
  );

  vscode.window.showTextDocument(uri, { selection: range, preserveFocus: false });
}

// --- Helpers ---

function getRelativePath(uri: vscode.Uri): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return null;
  }
  const root = folders[0].uri.fsPath;
  const absPath = uri.fsPath;
  if (!absPath.startsWith(root)) {
    return null;
  }
  return path.relative(root, absPath);
}

function refreshActiveEditorDecorations(): void {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    updateDecorations(editor);
  }
}
