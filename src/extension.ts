import * as vscode from "vscode";
import * as path from "path";
import * as cli from "./cli";
import { FragmentTreeProvider, FragmentTreeItem } from "./treeView";
import { updateDecorations, clearDecorations, disposeDecorations } from "./decorations";
import { showHierarchicalView } from "./hierarchicalView";

let treeProvider: FragmentTreeProvider;

export function activate(context: vscode.ExtensionContext): void {
  treeProvider = new FragmentTreeProvider();
  const treeView = vscode.window.createTreeView("pywebFragments", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  // Folding provider
  const foldingProvider = new FragmentFoldingProvider();
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider({ scheme: "file" }, foldingProvider)
  );

  // Commands
  context.subscriptions.push(
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
    vscode.commands.registerCommand("pyweb.resizeFragment", cmdResizeFragment),
    vscode.commands.registerCommand("pyweb.jumpToMatchingMarker", cmdJumpToMatchingMarker),
    vscode.commands.registerCommand("pyweb.nextFragment", () => cmdNavigateFragment("next")),
    vscode.commands.registerCommand("pyweb.previousFragment", () => cmdNavigateFragment("prev"))
  );

  // Refresh tree + decorations on editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      treeProvider.refresh();
      if (editor) {
        updateDecorations(editor);
      }
    })
  );

  // Refresh on save (markers may have been manually edited)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      treeProvider.refresh();
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === doc) {
        updateDecorations(editor);
      }
    })
  );

  // Initial
  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor);
  }
}

export function deactivate(): void {
  disposeDecorations();
}

// --- Folding ---

class FragmentFoldingProvider implements vscode.FoldingRangeProvider {
  async provideFoldingRanges(document: vscode.TextDocument): Promise<vscode.FoldingRange[]> {
    const relPath = getRelativePath(document.uri);
    if (!relPath) {
      return [];
    }

    let result;
    try {
      result = await cli.parseFile(relPath);
    } catch {
      return [];
    }

    return result.fragments
      .filter((f) => f.end_line - f.start_line > 1)
      .map((f) => new vscode.FoldingRange(
        f.start_line,
        Math.max(f.start_line, f.end_line - 1), // fold includes end marker
        vscode.FoldingRangeKind.Region
      ));
  }
}

// --- Commands ---

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

  try {
    const output = await cli.addFragment(relPath, name, startLine, endLine);
    vscode.window.showInformationMessage(output.trim());
    treeProvider.refresh();
    updateDecorations(editor);
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

async function cmdRemoveFragment(item?: FragmentTreeItem): Promise<void> {
  const target = item || (await fragmentAtCursor());
  if (!target) {
    vscode.window.showInformationMessage("Cursor is not inside a fragment");
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Remove fragment "${target.fragment.name}"? (Code stays, markers removed)`,
    "Remove",
    "Cancel"
  );
  if (confirm !== "Remove") {
    return;
  }

  try {
    await cli.removeFragment(target.filePath, target.fragment.id);
    treeProvider.refresh();
    refreshActiveEditorDecorations();
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

async function cmdRenameFragment(item?: FragmentTreeItem): Promise<void> {
  // If from tree context menu, use that. Otherwise, find fragment at cursor.
  const target = item || (await fragmentAtCursor());
  if (!target) {
    vscode.window.showInformationMessage("Cursor is not inside a fragment");
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: "New fragment name",
    value: target.fragment.name,
  });
  if (!newName) {
    return;
  }

  try {
    await cli.renameFragment(target.filePath, target.fragment.id, newName);
    treeProvider.refresh();
    refreshActiveEditorDecorations();
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

async function cmdResizeFragment(item?: FragmentTreeItem): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor");
    return;
  }

  const target = item || (await fragmentAtCursor());
  if (!target) {
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showErrorMessage("Select the new range for this fragment first");
    return;
  }

  const startLine = selection.start.line;
  const endLine = selection.end.line + (selection.end.character > 0 ? 1 : 0);

  try {
    await cli.resizeFragment(target.filePath, target.fragment.id, startLine, endLine);
    vscode.window.showInformationMessage(
      `Resized "${target.fragment.name}" → [${startLine} - ${endLine}]`
    );
    treeProvider.refresh();
    updateDecorations(editor);
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

async function cmdShowHierarchicalView(item?: FragmentTreeItem): Promise<void> {
  const fragmentId = item?.fragment.id;
  const fileRelPath = item?.filePath;
  await showHierarchicalView(fileRelPath, fragmentId);
}

async function cmdAddProse(item?: FragmentTreeItem): Promise<void> {
  const target = item || (await fragmentAtCursor());
  if (!target) {
    return;
  }

  const prose = await vscode.window.showInputBox({
    prompt: "Prose / explanation for this fragment",
    value: target.fragment.prose || "",
  });
  if (prose === undefined) {
    return;
  }

  try {
    await cli.setProse(target.filePath, target.fragment.id, prose || null);
    treeProvider.refresh();
    refreshActiveEditorDecorations();
  } catch (e: any) {
    vscode.window.showErrorMessage(`PyWeb: ${e.message}`);
  }
}

function cmdGoToFragment(fragment: cli.ParsedFragment, filePath: string): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return;
  }

  const uri = vscode.Uri.file(path.join(folders[0].uri.fsPath, filePath));
  const range = new vscode.Range(fragment.start_line, 0, fragment.start_line, 0);
  vscode.window.showTextDocument(uri, { selection: range, preserveFocus: false });
}

async function cmdJumpToMatchingMarker(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const relPath = getRelativePath(editor.document.uri);
  if (!relPath) {
    return;
  }

  let result;
  try {
    result = await cli.parseFile(relPath);
  } catch {
    return;
  }

  const cursorLine = editor.selection.active.line;

  // Find the fragment whose start or end marker the cursor is on, or the deepest containing fragment
  for (const f of result.fragments) {
    // On start marker → jump to end
    if (cursorLine === f.start_line) {
      const endMarkerLine = f.end_line - 1; // end_line is exclusive
      goToLine(editor, endMarkerLine);
      return;
    }
    // On end marker → jump to start
    if (cursorLine === f.end_line - 1) {
      goToLine(editor, f.start_line);
      return;
    }
  }

  // In the middle of a fragment → jump to end of deepest containing fragment
  let best: cli.ParsedFragment | null = null;
  let bestSize = Infinity;
  for (const f of result.fragments) {
    if (f.start_line < cursorLine && cursorLine < f.end_line - 1) {
      const size = f.end_line - f.start_line;
      if (size < bestSize) {
        bestSize = size;
        best = f;
      }
    }
  }

  if (best) {
    goToLine(editor, best.end_line - 1);
  }
}

async function cmdNavigateFragment(direction: "next" | "prev"): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const relPath = getRelativePath(editor.document.uri);
  if (!relPath) {
    return;
  }

  let result;
  try {
    result = await cli.parseFile(relPath);
  } catch {
    return;
  }

  if (result.fragments.length === 0) {
    return;
  }

  // Sort all fragment start lines
  const startLines = result.fragments
    .map((f) => f.start_line)
    .sort((a, b) => a - b);

  const cursorLine = editor.selection.active.line;

  if (direction === "next") {
    const next = startLines.find((l) => l > cursorLine);
    if (next !== undefined) {
      goToLine(editor, next);
    }
  } else {
    // Find the last start_line before cursor
    const prev = [...startLines].reverse().find((l) => l < cursorLine);
    if (prev !== undefined) {
      goToLine(editor, prev);
    }
  }
}

function goToLine(editor: vscode.TextEditor, line: number): void {
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
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

  let result;
  try {
    result = await cli.parseFile(relPath);
  } catch {
    vscode.window.showInformationMessage("No fragments in this file");
    return null;
  }

  if (result.fragments.length === 0) {
    vscode.window.showInformationMessage("No fragments in this file");
    return null;
  }

  const items = result.fragments.map((f) => ({
    label: f.name,
    description: `[${f.start_line} - ${f.end_line}]`,
    fragment: f,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a fragment",
  });

  if (!picked) {
    return null;
  }

  return new FragmentTreeItem(picked.fragment, relPath, picked.fragment.children.length > 0);
}

/**
 * Find the deepest fragment containing the cursor position.
 */
async function fragmentAtCursor(): Promise<FragmentTreeItem | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const relPath = getRelativePath(editor.document.uri);
  if (!relPath) {
    return null;
  }

  let result;
  try {
    result = await cli.parseFile(relPath);
  } catch {
    return null;
  }

  const cursorLine = editor.selection.active.line;
  let best: cli.ParsedFragment | null = null;
  let bestSize = Infinity;

  for (const f of result.fragments) {
    if (f.start_line <= cursorLine && cursorLine < f.end_line) {
      const size = f.end_line - f.start_line;
      if (size < bestSize) {
        bestSize = size;
        best = f;
      }
    }
  }

  if (!best) {
    return null;
  }

  return new FragmentTreeItem(best, relPath, best.children.length > 0);
}
