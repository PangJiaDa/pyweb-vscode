# pyweb-vscode

VS Code extension for [PyWeb](https://github.com/PangJiaDa/pyweb) — define named, hierarchical code regions in any source file using comment markers.

Fragments are stored as `@pyweb:start`/`@pyweb:end` comments in your source code. They're just comments — coworkers without the extension see normal code. Coworkers with it get a fragment tree, folding, and navigation.

## Prerequisites

- Python 3.11+
- [pyweb](https://github.com/PangJiaDa/pyweb) CLI installed:
  ```bash
  pip install git+https://github.com/PangJiaDa/pyweb.git
  ```

## Install

Package the extension and install locally:
```bash
cd pyweb-vscode
npm install
npm run compile
vsce package        # produces pyweb-0.0.1.vsix
code --install-extension pyweb-0.0.1.vsix
```

Or press F5 from the repo to run in development mode.

## Usage

### Create a fragment
1. Select some lines of code
2. Right-click → **PyWeb: Create Fragment from Selection**
3. Enter a name
4. Start/end markers are inserted automatically, nesting is inferred from position

### View fragments
- **Sidebar**: The PyWeb Fragments panel shows a tree of all fragments in the active file. Click any to jump to it.
- **Inline hints**: The first line of each fragment shows `◂ fragment_name` in the editor.
- **Folding**: Fragments register as VS Code folding ranges — collapse them with the normal fold shortcuts.

### Manage fragments
All commands work from the tree context menu (right-click) or from the command palette. When invoked from the command palette, they auto-detect the fragment at the cursor position.

- **Rename** — edits the name in the start marker
- **Remove** — strips both markers, code stays
- **Resize** — select new range first, then run the command
- **Add/Edit Prose** — attaches a `@pyweb:prose` comment below the start marker

### Navigate
- **PyWeb: Jump to Matching Marker** — from start marker → end, from end → start, from middle → end
- **PyWeb: Next Fragment** — jump to the next fragment start marker
- **PyWeb: Previous Fragment** — jump to the previous fragment start marker

## Commands

| Command | Description |
|---------|-------------|
| `PyWeb: Create Fragment from Selection` | Insert start/end markers around selection |
| `PyWeb: Remove Fragment` | Strip markers (code stays) |
| `PyWeb: Rename Fragment` | Change a fragment's name |
| `PyWeb: Resize Fragment to Selection` | Move markers to match current selection |
| `PyWeb: Add/Edit Prose` | Set explanation text on a fragment |
| `PyWeb: Jump to Matching Marker` | Jump between start/end markers |
| `PyWeb: Next Fragment` | Jump to next fragment |
| `PyWeb: Previous Fragment` | Jump to previous fragment |
| `PyWeb: Refresh Fragment Tree` | Force refresh the sidebar |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pyweb.pythonPath` | `python3` | Path to Python interpreter |
| `pyweb.cliPath` | `""` | Path to pyweb module. If empty, uses `python3 -m pyweb` |

## Architecture

The extension is a thin UI layer. All logic lives in the [pyweb](https://github.com/PangJiaDa/pyweb) Python CLI.

```
┌──────────────┐   shell out    ┌─────────────┐
│  VS Code     │ ────────────→  │  pyweb CLI  │
│  Extension   │                │  (Python)   │
│              │ ← JSON ──────  │             │
│  tree view   │                │  parser     │
│  decorations │                │  writer     │
│  folding     │                │  comments   │
│  navigation  │                │             │
└──────────────┘                └─────────────┘
```

Every operation (add, remove, rename, parse, etc.) spawns `python3 -m pyweb -p <project> <command>`. The `parse` command returns structured JSON that the extension uses for rendering.

Markers live in the source file as comments — no sidecar files, no anchoring, no sync issues. The file IS the source of truth.

## Development

```bash
git clone https://github.com/PangJiaDa/pyweb-vscode.git
cd pyweb-vscode
npm install
npm run compile
```

Press F5 in VS Code to launch an Extension Development Host.

## Related

- [pyweb](https://github.com/PangJiaDa/pyweb) — core library and CLI
- [INTEGRATION.md](https://github.com/PangJiaDa/pyweb/blob/main/INTEGRATION.md) — guide for building integrations with other editors
