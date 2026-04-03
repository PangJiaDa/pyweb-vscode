import { execFile } from "child_process";
import * as vscode from "vscode";
import * as path from "path";

export interface ParsedFragment {
  id: string;
  name: string;
  start_line: number;
  end_line: number;
  content_start_line: number;
  content_end_line: number;
  children: string[];
  parent_id: string | null;
  prose: string | null;
}

export interface ParseResult {
  file: string;
  fragments: ParsedFragment[];
  warnings: { line: number; message: string }[];
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
  return ["-m", "pyweb"];
}

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const projectRoot = getProjectRoot();
    const python = getPythonPath();
    const cliArgs = getCliArgs();
    const fullArgs = [...cliArgs, "-p", projectRoot, ...args];

    console.log(`[pyweb] ${python} ${fullArgs.join(" ")}`);
    execFile(python, fullArgs, { cwd: projectRoot, timeout: 30000 }, (error, stdout, stderr) => {
      if (stderr) {
        console.log(`[pyweb] stderr: ${stderr}`);
      }
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function addFragment(
  file: string,
  name: string,
  startLine: number,
  endLine: number,
  prose?: string
): Promise<string> {
  const args = ["add", file, name, startLine.toString(), endLine.toString()];
  if (prose) {
    args.push("--prose", prose);
  }
  return runCli(args);
}

export async function removeFragment(file: string, fragmentId: string): Promise<string> {
  return runCli(["rm", file, fragmentId]);
}

export async function renameFragment(file: string, fragmentId: string, newName: string): Promise<string> {
  return runCli(["rename", file, fragmentId, newName]);
}

export async function setProse(file: string, fragmentId: string, text: string | null): Promise<string> {
  const args = ["prose", file, fragmentId];
  if (text) {
    args.push(text);
  }
  return runCli(args);
}

export async function resizeFragment(
  file: string,
  fragmentId: string,
  startLine: number,
  endLine: number
): Promise<string> {
  return runCli(["resize", file, fragmentId, startLine.toString(), endLine.toString()]);
}

export async function listFragments(file: string): Promise<string> {
  return runCli(["ls", file]);
}

export async function getHierarchicalView(file: string, fragmentId?: string): Promise<string> {
  const args = ["view", file];
  if (fragmentId) {
    args.push("--fragment", fragmentId);
  }
  return runCli(args);
}

export async function checkFile(file: string): Promise<string> {
  return runCli(["check", file]);
}

/**
 * Parse markers from a file, returning structured JSON data.
 * This is the primary data source for the extension.
 */
export async function parseFile(file: string): Promise<ParseResult> {
  const output = await runCli(["parse", file]);
  return JSON.parse(output) as ParseResult;
}
