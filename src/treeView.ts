import * as vscode from "vscode";
import * as path from "path";
import { parseFile, ParsedFragment, ParseResult } from "./cli";

export class FragmentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly fragment: ParsedFragment,
    public readonly filePath: string,
    public readonly hasChildren: boolean
  ) {
    super(
      fragment.name,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    this.description = `[${fragment.start_line} - ${fragment.end_line}]`;
    this.tooltip = fragment.prose || fragment.name;
    this.contextValue = "fragment";

    this.command = {
      command: "pyweb.goToFragment",
      title: "Go to Fragment",
      arguments: [fragment, filePath],
    };

    if (fragment.prose) {
      this.iconPath = new vscode.ThemeIcon("bookmark");
    } else {
      this.iconPath = new vscode.ThemeIcon("symbol-structure");
    }
  }
}

export class FragmentTreeProvider implements vscode.TreeDataProvider<FragmentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FragmentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedResult: ParseResult | null = null;
  private cachedFile: string | null = null;

  refresh(): void {
    this.cachedResult = null;
    this.cachedFile = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FragmentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FragmentTreeItem): Promise<FragmentTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }
    return this.getChildItems(element);
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

    const result = await this.loadParsed(filePath);
    if (!result || result.fragments.length === 0) {
      return [];
    }

    // Roots = fragments with no parent
    const roots = result.fragments
      .filter((f) => f.parent_id === null)
      .sort((a, b) => a.start_line - b.start_line);

    return roots.map(
      (f) => new FragmentTreeItem(f, filePath, f.children.length > 0)
    );
  }

  private async getChildItems(parent: FragmentTreeItem): Promise<FragmentTreeItem[]> {
    const result = await this.loadParsed(parent.filePath);
    if (!result) {
      return [];
    }

    const byId = new Map(result.fragments.map((f) => [f.id, f]));
    return parent.fragment.children
      .map((cid) => byId.get(cid))
      .filter((f): f is ParsedFragment => f !== undefined)
      .map((f) => new FragmentTreeItem(f, parent.filePath, f.children.length > 0));
  }

  private async loadParsed(filePath: string): Promise<ParseResult | null> {
    if (this.cachedFile === filePath && this.cachedResult) {
      return this.cachedResult;
    }
    try {
      const result = await parseFile(filePath);
      this.cachedResult = result;
      this.cachedFile = filePath;
      return result;
    } catch {
      return null;
    }
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
}
