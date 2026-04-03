import * as vscode from "vscode";
import * as path from "path";
import { loadFileFragments, FragmentInfo } from "./cli";

// Decoration types for different nesting depths
const COLORS = [
  "rgba(65, 105, 225, 0.06)",  // blue
  "rgba(50, 180, 100, 0.06)",  // green
  "rgba(200, 150, 50, 0.06)",  // amber
  "rgba(180, 80, 180, 0.06)",  // purple
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
  const ff = await loadFileFragments(relPath);
  if (!ff || ff.fragments.length === 0) {
    clearDecorations(editor);
    return;
  }

  // Build depth map
  const childIds = new Set<string>();
  for (const f of ff.fragments) {
    for (const cid of f.children) {
      childIds.add(cid);
    }
  }

  const byId = new Map(ff.fragments.map((f) => [f.id, f]));
  const depthMap = new Map<string, number>();

  function computeDepth(frag: FragmentInfo, depth: number): void {
    depthMap.set(frag.id, depth);
    for (const cid of frag.children) {
      const child = byId.get(cid);
      if (child) {
        computeDepth(child, depth + 1);
      }
    }
  }

  const roots = ff.fragments.filter((f) => !childIds.has(f.id));
  for (const root of roots) {
    computeDepth(root, 0);
  }

  // Group ranges by depth
  const rangesByDepth: Map<number, vscode.DecorationOptions[]> = new Map();
  const nameRanges: vscode.DecorationOptions[] = [];

  for (const frag of ff.fragments) {
    const r = frag.range;
    if (r.start_line < 0) {
      continue; // orphaned
    }

    const depth = depthMap.get(frag.id) || 0;
    const colorIdx = depth % COLORS.length;

    if (!rangesByDepth.has(colorIdx)) {
      rangesByDepth.set(colorIdx, []);
    }

    const startLine = Math.max(0, r.start_line);
    const endLine = Math.max(0, r.end_line - 1); // end is exclusive

    if (startLine <= endLine) {
      rangesByDepth.get(colorIdx)!.push({
        range: new vscode.Range(startLine, 0, startLine, 0),
      });

      // Add fragment name as inline hint on the first line
      nameRanges.push({
        range: new vscode.Range(startLine, Number.MAX_SAFE_INTEGER, startLine, Number.MAX_SAFE_INTEGER),
        renderOptions: {
          after: {
            contentText: `  ◂ ${frag.name}`,
          },
        },
      });
    }
  }

  // Apply decorations
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
