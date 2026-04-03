# pyweb-vscode

VS Code extension for [PyWeb](https://github.com/PangJiaDa/pyweb) — define named, hierarchical code regions over any source file. Zero-buy-in overlay: your source files are never modified, coworkers see nothing.

## What It Does

Select code, name it, nest it. Get a collapsible fragment tree in the sidebar, inline hints showing fragment boundaries, and a hierarchical view you can flick to. Fragments auto-anchor when you save — edits by you or coworkers don't break anything.

## Prerequisites

- Python 3.11+
- The [pyweb](https://github.com/PangJiaDa/pyweb) core library:
  ```bash
  git clone https://github.com/PangJiaDa/pyweb.git
  ```

## Setup

1. Install the extension (from `.vsix` or run from source)
2. Open a project in VS Code
3. Run command: **PyWeb: Initialize Project** (creates `.pyweb/` directory)
4. Configure the Python path if needed in settings (`pyweb.pythonPath`)

## Usage

### Create a fragment
1. Select some lines of code
2. Right-click → **PyWeb: Create Fragment from Selection**
3. Enter a name
4. Optionally pick a parent fragment (for nesting)

### View fragments
- **Sidebar**: The PyWeb Fragments panel shows a tree of all fragments in the active file. Click any fragment to jump to it.
- **Inline hints**: Fragment boundaries are highlighted with subtle colors. The first line of each fragment shows `◂ fragment_name`.
- **Hierarchical view**: Right-click a fragment in the tree → **PyWeb: Show Hierarchical View** to see the prose + code outline in a side panel.

### Manage fragments
- **Rename**: Right-click in tree → **PyWeb: Rename Fragment**
- **Remove**: Right-click in tree → **PyWeb: Remove Fragment** (code stays, only the metadata is removed)
- **Add prose**: Right-click in tree → **PyWeb: Add/Edit Prose** to attach an explanation

### Auto-anchoring
When you save a file, fragment ranges are automatically re-anchored to match your edits. If lines were inserted or deleted, fragments shift accordingly. If a fragment's code was entirely deleted, it's marked as orphaned.

## Commands

| Command | Description |
|---------|-------------|
| `PyWeb: Initialize Project` | Create `.pyweb/` in workspace root |
| `PyWeb: Create Fragment from Selection` | Define a new fragment over selected lines |
| `PyWeb: Remove Fragment` | Delete fragment metadata (keeps source code) |
| `PyWeb: Rename Fragment` | Change a fragment's name |
| `PyWeb: Add/Edit Prose` | Attach explanation text to a fragment |
| `PyWeb: Show Hierarchical View` | Open the hierarchical prose+code view |
| `PyWeb: Refresh Fragment Tree` | Force refresh the sidebar tree |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pyweb.pythonPath` | `python3` | Path to Python interpreter |
| `pyweb.cliPath` | `""` | Path to pyweb CLI module. If empty, uses `python3 -m pyweb.cli` |

## Architecture

This extension is a thin UI layer. All logic lives in the [pyweb](https://github.com/PangJiaDa/pyweb) Python CLI — the extension shells out to it for every operation and reads the `.pyweb/` sidecar JSON files directly for rendering.

```
┌──────────────┐     shell out     ┌─────────────┐
│  VS Code     │ ───────────────→  │  pyweb CLI  │
│  Extension   │                   │  (Python)   │
│              │ ← read JSON ────  │             │
│  tree view   │   .pyweb/         │  core lib   │
│  decorations │   fragments/      │  store      │
│  webview     │   cache/          │  anchorer   │
└──────────────┘                   └─────────────┘
```

## Development

```bash
git clone https://github.com/PangJiaDa/pyweb-vscode.git
cd pyweb-vscode
npm install
npm run compile
```

Then press F5 in VS Code to launch an Extension Development Host.

## Related

- [pyweb](https://github.com/PangJiaDa/pyweb) — core library, CLI, and spec
- [pyweb INTEGRATION.md](https://github.com/PangJiaDa/pyweb/blob/main/INTEGRATION.md) — guide for building integrations with other editors
