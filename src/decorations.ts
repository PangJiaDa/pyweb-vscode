import * as vscode from "vscode";
import * as path from "path";
import { parseFile, ParsedFragment } from "./cli";

const COLORS = [
  "rgba(65, 105, 225, 0.06)",
  "rgba(50, 180, 100, 0.06)",
  "rgba(200, 150, 50, 0.06)",
  "rgba(180, 80, 180, 0.06)",
];

const BORDER_COLORS = [
  "rgba(65, 105, 225, 0.3)",
  "rgba(50, 180, 100, 0.3)",
  "rgba(200, 150, 50, 0.3)",
  "rgba(180, 80, 180, 0.3)",
];

let decorationTypes: vscode.TextEditorDecorationType[] = [];
let nameDecorations: vscode.TextEditorDecorationType | null = null;

function ensureDecorationTypes(): void {
  if (decorationTypes.length > 0) {
    return;
  }
  for (let i = 0; i < COLORS.length; i++) {
    decorationTypes.push(
      vscode.window.createTextEditorDecorationType({
        backgroundColor: COLORS[i],
        isWholeLine: true,
        borderWidth: "1px 0 0 0",
        borderStyle: "solid",
        borderColor: BORDER_COLORS[i],
      })
    );
  }
  nameDecorations = vscode.window.createTextEditorDecorationType({
    after: {
      color: "rgba(150, 150, 150, 0.6)",
      fontStyle: "italic",
      margin: "0 0 0 2em",
    },
  });
}

export function clearDecorations(editor: vscode.TextEditor): void {
  for (const dt of decorationTypes) {
    editor.setDecorations(dt, []);
  }
  if (nameDecorations) {
    editor.setDecorations(nameDecorations, []);
  }
}

export async function updateDecorations(editor: vscode.TextEditor): Promise<void> {
  ensureDecorationTypes();

  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return;
  }

  const root = folders[0].uri.fsPath;
  const absPath = editor.document.uri.fsPath;
  if (!absPath.startsWith(root)) {
    return;
  }

  const relPath = path.relative(root, absPath);
  let result;
  try {
    result = await parseFile(relPath);
  } catch {
    clearDecorations(editor);
    return;
  }

  if (!result || result.fragments.length === 0) {
    clearDecorations(editor);
    return;
  }

  // Compute depth for each fragment
  const depthMap = new Map<string, number>();
  const byId = new Map(result.fragments.map((f) => [f.id, f]));

  function computeDepth(frag: ParsedFragment, depth: number): void {
    depthMap.set(frag.id, depth);
    for (const cid of frag.children) {
      const child = byId.get(cid);
      if (child) {
        computeDepth(child, depth + 1);
      }
    }
  }

  for (const f of result.fragments) {
    if (f.parent_id === null) {
      computeDepth(f, 0);
    }
  }

  const rangesByDepth: Map<number, vscode.DecorationOptions[]> = new Map();
  const nameRanges: vscode.DecorationOptions[] = [];

  for (const frag of result.fragments) {
    const depth = depthMap.get(frag.id) || 0;
    const colorIdx = depth % COLORS.length;

    if (!rangesByDepth.has(colorIdx)) {
      rangesByDepth.set(colorIdx, []);
    }

    // Highlight the start marker line
    rangesByDepth.get(colorIdx)!.push({
      range: new vscode.Range(frag.start_line, 0, frag.start_line, 0),
    });

    // Add fragment name hint on the start marker line
    nameRanges.push({
      range: new vscode.Range(frag.start_line, Number.MAX_SAFE_INTEGER, frag.start_line, Number.MAX_SAFE_INTEGER),
      renderOptions: {
        after: {
          contentText: `  ◂ ${frag.name}`,
        },
      },
    });
  }

  for (let i = 0; i < decorationTypes.length; i++) {
    editor.setDecorations(decorationTypes[i], rangesByDepth.get(i) || []);
  }

  if (nameDecorations) {
    editor.setDecorations(nameDecorations, nameRanges);
  }
}

export function disposeDecorations(): void {
  for (const dt of decorationTypes) {
    dt.dispose();
  }
  decorationTypes = [];
  if (nameDecorations) {
    nameDecorations.dispose();
    nameDecorations = null;
  }
}
