import { execFile } from "child_process";
import * as vscode from "vscode";
import * as path from "path";

export interface FragmentInfo {
  id: string;
  name: string;
  file: string;
  range: {
    start_line: number;
    start_col: number;
    end_line: number;
    end_col: number;
  };
  children: string[];
  prose: string | null;
}

export interface FileFragmentsInfo {
  file: string;
  content_hash: string;
  fragments: FragmentInfo[];
}

function getProjectRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace folder open");
  }
  return folders[0].uri.fsPath;
}

function getPythonPath(): string {
  const config = vscode.workspace.getConfiguration("pyweb");
  return config.get<string>("pythonPath") || "python3";
}

function getCliArgs(): string[] {
  const config = vscode.workspace.getConfiguration("pyweb");
  const cliPath = config.get<string>("cliPath") || "";
  if (cliPath) {
    return [cliPath];
  }
  return ["-m", "pyweb.cli"];
}

function runCli(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const projectRoot = cwd || getProjectRoot();
    const python = getPythonPath();
    const cliArgs = getCliArgs();
    const fullArgs = [...cliArgs, "-p", projectRoot, ...args];

    execFile(python, fullArgs, { cwd: projectRoot, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function init(): Promise<string> {
  return runCli(["init"]);
}

export async function addFragment(
  file: string,
  name: string,
  startLine: number,
  endLine: number,
  parentId?: string,
  prose?: string
): Promise<string> {
  const args = ["add", file, name, startLine.toString(), endLine.toString()];
  if (parentId) {
    args.push("--parent", parentId);
  }
  if (prose) {
    args.push("--prose", prose);
  }
  return runCli(args);
}

export async function addInlineFragment(
  file: string,
  name: string,
  line: number,
  startCol: number,
  endCol: number,
  parentId?: string
): Promise<string> {
  const args = ["add-inline", file, name, line.toString(), startCol.toString(), endCol.toString()];
  if (parentId) {
    args.push("--parent", parentId);
  }
  return runCli(args);
}

export async function removeFragment(file: string, fragmentId: string): Promise<string> {
  return runCli(["rm", file, fragmentId]);
}

export async function renameFragment(
  file: string,
  fragmentId: string,
  newName: string
): Promise<string> {
  return runCli(["rename", file, fragmentId, newName]);
}

export async function listFragments(file: string): Promise<string> {
  return runCli(["ls", file]);
}

export async function checkFragments(file: string): Promise<string> {
  return runCli(["check", file]);
}

export async function anchorFile(file: string): Promise<string> {
  return runCli(["anchor", file]);
}

export async function getHierarchicalView(
  file: string,
  fragmentId?: string
): Promise<string> {
  const args = ["view", file];
  if (fragmentId) {
    args.push("--fragment", fragmentId);
  }
  return runCli(args);
}

/**
 * Read the fragment JSON file directly for richer data than CLI output provides.
 */
export async function loadFileFragments(file: string): Promise<FileFragmentsInfo | null> {
  const projectRoot = getProjectRoot();
  const fragPath = path.join(projectRoot, ".pyweb", "fragments", file + ".json");

  try {
    const uri = vscode.Uri.file(fragPath);
    const data = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(data).toString("utf-8");
    return JSON.parse(text) as FileFragmentsInfo;
  } catch {
    return null;
  }
}

/**
 * Set prose on a fragment by directly editing the JSON sidecar.
 * (The CLI doesn't have a set-prose command, so we do it directly.)
 */
export async function setProse(
  file: string,
  fragmentId: string,
  prose: string | null
): Promise<void> {
  const projectRoot = getProjectRoot();
  const fragPath = path.join(projectRoot, ".pyweb", "fragments", file + ".json");
  const uri = vscode.Uri.file(fragPath);

  const data = await vscode.workspace.fs.readFile(uri);
  const text = Buffer.from(data).toString("utf-8");
  const ff = JSON.parse(text) as FileFragmentsInfo;

  const frag = ff.fragments.find((f) => f.id === fragmentId);
  if (!frag) {
    throw new Error(`Fragment ${fragmentId} not found`);
  }
  frag.prose = prose;

  const newText = JSON.stringify(ff, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(newText, "utf-8"));
}
