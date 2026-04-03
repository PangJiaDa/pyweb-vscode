import * as vscode from "vscode";
import * as path from "path";
import { loadFileFragments, FragmentInfo, FileFragmentsInfo } from "./cli";

export class FragmentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly fragment: FragmentInfo,
    public readonly hasChildren: boolean
  ) {
    super(
      fragment.name,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    const r = fragment.range;
    this.description = `[${r.start_line}:${r.start_col} - ${r.end_line}:${r.end_col}]`;
    this.tooltip = fragment.prose || fragment.name;
    this.contextValue = "fragment";

    if (r.start_line >= 0) {
      this.command = {
        command: "pyweb.goToFragment",
        title: "Go to Fragment",
        arguments: [fragment],
      };
    }

    if (r.start_line === -1) {
      this.description += " [orphaned]";
      this.iconPath = new vscode.ThemeIcon("warning");
    } else if (fragment.prose) {
      this.iconPath = new vscode.ThemeIcon("bookmark");
    } else {
      this.iconPath = new vscode.ThemeIcon("symbol-structure");
    }
  }
}

export class FragmentTreeProvider implements vscode.TreeDataProvider<FragmentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FragmentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private fileFragments: Map<string, FileFragmentsInfo> = new Map();

  refresh(): void {
    this.fileFragments.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FragmentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FragmentTreeItem): Promise<FragmentTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }
    return this.getChildItems(element.fragment);
  }

  private async getRootItems(): Promise<FragmentTreeItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [];
    }

    const filePath = this.getRelativePath(editor.document.uri);
    if (!filePath) {
      return [];
    }

    const ff = await this.loadFragments(filePath);
    if (!ff || ff.fragments.length === 0) {
      return [];
    }

    // Find roots: fragments not in any other fragment's children
    const childIds = new Set<string>();
    for (const f of ff.fragments) {
      for (const cid of f.children) {
        childIds.add(cid);
      }
    }

    const roots = ff.fragments
      .filter((f) => !childIds.has(f.id))
      .sort((a, b) => a.range.start_line - b.range.start_line);

    return roots.map(
      (f) => new FragmentTreeItem(f, f.children.length > 0)
    );
  }

  private async getChildItems(parent: FragmentInfo): Promise<FragmentTreeItem[]> {
    const ff = await this.loadFragments(parent.file);
    if (!ff) {
      return [];
    }

    const byId = new Map(ff.fragments.map((f) => [f.id, f]));
    return parent.children
      .map((cid) => byId.get(cid))
      .filter((f): f is FragmentInfo => f !== undefined)
      .map((f) => new FragmentTreeItem(f, f.children.length > 0));
  }

  private async loadFragments(filePath: string): Promise<FileFragmentsInfo | null> {
    if (this.fileFragments.has(filePath)) {
      return this.fileFragments.get(filePath)!;
    }
    const ff = await loadFileFragments(filePath);
    if (ff) {
      this.fileFragments.set(filePath, ff);
    }
    return ff;
  }

  private getRelativePath(uri: vscode.Uri): string | null {
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

  /**
   * Get the fragment info for a given fragment ID in the current file.
   */
  async getFragmentById(fileRelPath: string, fragmentId: string): Promise<FragmentInfo | null> {
    const ff = await this.loadFragments(fileRelPath);
    if (!ff) {
      return null;
    }
    return ff.fragments.find((f) => f.id === fragmentId) || null;
  }
}
