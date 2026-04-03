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

  // Folding provider — folds fragments in the editor
  const foldingProvider = new FragmentFoldingProvider();
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider({ scheme: "file" }, foldingProvider)
  );

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
    vscode.commands.registerCommand("pyweb.goToFragment", cmdGoToFragment),
    vscode.commands.registerCommand("pyweb.resizeFragment", cmdResizeFragment)
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

// --- Folding provider ---

class FragmentFoldingProvider implements vscode.FoldingRangeProvider {
  async provideFoldingRanges(
    document: vscode.TextDocument
  ): Promise<vscode.FoldingRange[]> {
    const relPath = getRelativePath(document.uri);
    if (!relPath) {
      return [];
    }

    const ff = await cli.loadFileFragments(relPath);
    if (!ff || ff.fragments.length === 0) {
      return [];
    }

    const ranges: vscode.FoldingRange[] = [];
    for (const frag of ff.fragments) {
      const r = frag.range;
      if (r.start_line < 0) {
        continue; // orphaned
      }
      const endLine = Math.max(r.start_line, r.end_line - 1);
      if (r.start_line < endLine) {
        ranges.push(new vscode.FoldingRange(r.start_line, endLine, vscode.FoldingRangeKind.Region));
      }
    }
    return ranges;
  }
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

  const startLine = selection.start.line;
  const endLine = selection.end.line + (selection.end.character > 0 ? 1 : 0);

  // Auto-infer parent: find the deepest fragment that fully contains the selection
  const ff = await cli.loadFileFragments(relPath);
  let parentId: string | undefined;
  if (ff && ff.fragments.length > 0) {
    let bestParent: cli.FragmentInfo | null = null;
    let bestSize = Infinity;

    for (const f of ff.fragments) {
      const r = f.range;
      if (r.start_line < 0) {
        continue; // orphaned
      }
      // Does this fragment fully contain the selection?
      if (r.start_line <= startLine && endLine <= r.end_line) {
        const size = r.end_line - r.start_line;
        if (size < bestSize) {
          bestSize = size;
          bestParent = f;
        }
      }
    }

    if (bestParent) {
      parentId = bestParent.id;
    }
  }

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
  // If invoked from command palette (no item), pick from list
  if (!item) {
    const picked = await pickFragment();
    if (!picked) {
      return;
    }
    item = picked;
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
    const picked = await pickFragment();
    if (!picked) {
      return;
    }
    item = picked;
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

async function cmdResizeFragment(item?: FragmentTreeItem): Promise<void> {
  // If invoked from tree context menu, use current editor selection as new range
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor");
    return;
  }

  if (!item) {
    const picked = await pickFragment();
    if (!picked) {
      return;
    }
    item = picked;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showErrorMessage("Select the new range for this fragment first");
    return;
  }

  const startLine = selection.start.line;
  const endLine = selection.end.line + (selection.end.character > 0 ? 1 : 0);

  try {
    await cli.resizeFragment(item.fragment.file, item.fragment.id, startLine, endLine);
    vscode.window.showInformationMessage(
      `Resized "${item.fragment.name}" → [${startLine} - ${endLine}]`
    );
    treeProvider.refresh();
    updateDecorations(editor);
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
    const picked = await pickFragment();
    if (!picked) {
      return;
    }
    item = picked;
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

/**
 * Show a quick pick of all fragments in the active file.
 * Used when a command is invoked from the command palette (no tree item).
 */
async function pickFragment(): Promise<FragmentTreeItem | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor");
    return null;
  }

  const relPath = getRelativePath(editor.document.uri);
  if (!relPath) {
    return null;
  }

  const ff = await cli.loadFileFragments(relPath);
  if (!ff || ff.fragments.length === 0) {
    vscode.window.showInformationMessage("No fragments in this file");
    return null;
  }

  const items = ff.fragments.map((f) => ({
    label: f.name,
    description: `[${f.range.start_line} - ${f.range.end_line}]`,
    fragment: f,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a fragment",
  });

  if (!picked) {
    return null;
  }

  return new FragmentTreeItem(picked.fragment, picked.fragment.children.length > 0);
}
