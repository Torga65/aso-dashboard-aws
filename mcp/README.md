# ASO Dashboard MCP Server

Connects Claude Code or Cursor to live ASO Dashboard data so you can ask the assistant questions about customers directly.

## One-time setup

```bash
cd mcp
npm install
```

That's it. Claude Code auto-detects `.mcp.json` at the repo root and loads the server on startup — no local app needed.

## Cursor IDE

Cursor does **not** read the repo-root `.mcp.json` (that file is for Claude Code). Configure MCP in Cursor separately.

### 1. One-time: install MCP dependencies

Same as above — from the repository root:

```bash
cd mcp && npm install
```

### 2. Add the server to Cursor

**Option A — Settings UI**

1. Open **Cursor Settings** → **MCP** (or **Features** → **MCP**, depending on version).
2. Choose **Add new MCP server** or **Edit in settings**.
3. Paste or merge the JSON from step B into your MCP config file when Cursor opens it.

**Option B — Config file**

Create **`.cursor/mcp.json`** in the **repository root** (the `.cursor` directory is usually gitignored; create it locally). You can also use a **user-wide** config at `~/.cursor/mcp.json` on macOS/Linux (`%USERPROFILE%\.cursor\mcp.json` on Windows), but then prefer absolute paths or env-based URLs instead of `${workspaceFolder}`.

Use the same server as `.mcp.json`, with paths expanded so `node` can find the entry script from any working directory:

```json
{
  "mcpServers": {
    "aso-dashboard": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp/server.mjs"],
      "env": {
        "ASO_BASE_URL": "https://www.asodashboard.adobecqms.net"
      }
    }
  }
}
```

If `${workspaceFolder}` is not expanded in your Cursor version, replace it with the absolute path to this repo (the folder that contains `mcp/server.mjs`).

### 3. Restart

Fully **quit and reopen Cursor** so it loads the new MCP servers.

### 4. Point at local dev (optional)

Set **`"ASO_BASE_URL": "http://localhost:3000"`** in the `env` block for the server entry in `.cursor/mcp.json`, or launch Cursor from a shell that exports the same variable so the MCP process inherits it:

```bash
export ASO_BASE_URL=http://localhost:3000
# then open Cursor from this terminal
```

## Assistant behavior (recommended)

When answering about a **specific customer** (engagement, status, summary, risks), call **`get_transcripts`** and **`get_comments`** in addition to **`get_customer_data`** (or after **`search_customers`** / **`list_customers`**), unless the user asks for snapshot-only data.

**`get_transcripts`** always loads the **full history** (all meetings and uploaded notes). There is no 30/60/90-day window on this tool.

## Available tools

| Tool | Description |
|---|---|
| `get_transcripts` | All meeting transcripts + notes for a customer (full history, `days=all` only) |
| `get_comments` | ServiceNow comments for a customer |
| `get_customer_data` | Latest snapshot — status, health score, blockers, feedback, ESE lead |
| `list_customers` | All customers, filterable by status and engagement |
| `search_customers` | Full-text search across all customer fields |
| `list_headless_customers` | Customers marked headless (latest snapshot; uses `/api/reports/headless-customers`) |

## Example prompts

- *"Get all transcripts for Acme Corp and summarize the key themes and action items"*
- *"List all At-Risk customers with Low engagement"*
- *"Search for customers mentioning 'performance' in their blockers or feedback"*
- *"Get the latest comments for Adobe and tell me if there are any open action items"*
- *"Compare the health scores across all Onboarding customers"*

## Environments

The `.mcp.json` at the repo root configures **`aso-dashboard`**, pointing at production (`asodashboard.adobecqms.net`).

To point at your local dev server instead, set the env var before starting Claude Code:

```bash
ASO_BASE_URL=http://localhost:3000 claude
```
