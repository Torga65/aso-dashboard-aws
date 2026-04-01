# ASO Dashboard MCP Server

Connects Claude Code to live ASO Dashboard data so you can ask Claude questions about customers directly.

## One-time setup

```bash
cd mcp
npm install
```

That's it. Claude Code auto-detects `.mcp.json` at the repo root and loads the server on startup — no local app needed.

## Available tools

| Tool | Description |
|---|---|
| `get_transcripts` | Fetch meeting transcripts for a customer (30/60/90/all days) |
| `get_comments` | Fetch ServiceNow comments for a customer |
| `get_customer_data` | Latest snapshot — status, health score, blockers, feedback, ESE lead |
| `list_customers` | All customers, filterable by status and engagement |
| `search_customers` | Full-text search across all customer fields |

## Example prompts

- *"Get all transcripts for Acme Corp and summarize the key themes and action items"*
- *"List all At-Risk customers with Low engagement"*
- *"Search for customers mentioning 'performance' in their blockers or feedback"*
- *"Get the latest comments for Adobe and tell me if there are any open action items"*
- *"Compare the health scores across all Onboarding customers"*

## Environments

The `.mcp.json` at the repo root configures two servers:

- **`aso-dashboard`** — points at Production (`asodashboard.adobecqms.net`)
- **`aso-dashboard-stage`** — points at Stage (`stage.d26pj15s9ci49q.amplifyapp.com`)

Both are loaded automatically. To use stage data, just tell Claude: *"use the stage environment"* or reference `aso-dashboard-stage` in your prompt.

To point at your local dev server instead, set the env var before starting Claude Code:

```bash
ASO_BASE_URL=http://localhost:3000 claude
```
