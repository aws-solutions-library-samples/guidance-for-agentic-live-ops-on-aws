# Adding a New Agent

Sub-agents are loaded from config. Adding one does not require changing any TypeScript or Python code. You have two paths: commit a folder and redeploy, or call the runtime API.

## Config shape

Each agent is defined by these fields:

| Field             | Required      | Description                                                                                |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `agent_id`        | Yes           | Unique identifier. Alphanumeric and underscores only.                                      |
| `display_name`    | Yes           | Human-readable name shown in agent listings.                                               |
| `description`     | No            | One-line summary of what the agent does.                                                   |
| `agent_type`      | No            | Free-form label for grouping (for example, `analytics`, `monitoring`). No semantic effect. |
| `tool_sets`       | Yes           | Array of tool sets the agent can call. See [Tool sets](#tool-sets).                        |
| `model_key`       | No            | Key into `cdk.json` `modelConfig.agents`. Empty uses `defaultModelId`.                     |
| `enabled`         | No            | Defaults to `true`. Set to `false` to disable the agent without deleting it.               |
| `prompt_template` | Path-specific | Inline system prompt (API path only). Folder path uses a separate `prompt.md` file.        |

## Tool sets

Valid values for the `tool_sets` array:

| Tool set            | What the agent can do                                             |
| ------------------- | ----------------------------------------------------------------- |
| `athena`            | Run SQL against Athena tables (the `query_data` tool).            |
| `realtime`          | Read live DynamoDB sliding-window metrics and incident reports.   |
| `schema`            | Semantic search over the Schema Knowledge Base (`search_schema`). |
| `graph`             | Traverse the schema graph for table relationships and join paths. |
| `entity_resolution` | Resolve text mentions to matched tables and columns.              |

Unrecognized tool set names are skipped with a warning.

## Path 1: Commit a folder, redeploy

Create a new folder under `data/agent-configs/` named after the `agent_id`. The folder contains two files:

```
data/agent-configs/
  my_agent/
    config.json
    prompt.md
```

`config.json`:

```json
{
    "agent_id": "my_agent",
    "display_name": "My Agent",
    "description": "What this agent does in one line.",
    "agent_type": "analytics",
    "model_key": "",
    "tool_sets": ["athena"],
    "enabled": true
}
```

`prompt.md` is the system prompt. Keep it short and direct. You can include `{{domain}}` as a placeholder; it gets replaced at runtime with the `branding.domainLabel` from `cdk.json`.

Deploy:

```bash
npm run cdk -- deploy "dev/*"
```

On the next orchestrator request after deploy, the runtime scans the S3 bucket holding the configs, writes them into DynamoDB, and registers the new agent as a tool. This can take up to 30 minutes if the existing DynamoDB cache has not expired. To force an immediate refresh, delete the agent config table rows or wait out the TTL.

## Path 2: Call the Config API

The Config API is a Lambda Function URL with IAM authentication. Use it to add, update, disable, or remove agents without redeploying.

Endpoints:

| Method | Path           | Purpose                             |
| ------ | -------------- | ----------------------------------- |
| POST   | `/agents`      | Create an agent.                    |
| GET    | `/agents`      | List all agents.                    |
| GET    | `/agents/{id}` | Get one agent by `agent_id`.        |
| PUT    | `/agents/{id}` | Update fields on an existing agent. |
| DELETE | `/agents/{id}` | Delete an agent.                    |

POST body example (note `prompt_template` is inline here, replacing the folder's `prompt.md`):

```json
{
    "agent_id": "my_agent",
    "display_name": "My Agent",
    "description": "What this agent does in one line.",
    "agent_type": "analytics",
    "prompt_template": "You are My Agent. Specialize in...",
    "model_key": "",
    "tool_sets": ["athena"],
    "enabled": true
}
```

The API writes to the same DynamoDB table the runtime reads from. Changes take effect on the next runtime refresh (up to 30 minutes).

## Per-agent model selection

To run an agent on a different model than the default, add an entry in `cdk.json`:

```json
"modelConfig": {
    "defaultModelId": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "agents": {
        "orchestrator": "us.anthropic.claude-sonnet-4-6",
        "my_agent": "us.anthropic.claude-sonnet-4-6"
    }
}
```

Then set `model_key` in the agent config to the key name (`my_agent` in this example). Redeploy so the updated `MODEL_CONFIG` env var reaches the runtime.

## Disable without delete

Set `enabled: false` in the config. The runtime skips disabled agents when building the tool list. Re-enable by flipping to `true` and waiting for the cache to refresh.

## Verify the agent loaded

Check the runtime log after your next query:

```bash
aws logs tail "/aws/bedrock-agentcore/runtimes/<runtime-name>" \
  --since 10m \
  --region <region> \
  | grep "Agent registry refreshed"
```

The log line lists how many agents loaded and their IDs. If your new agent is not listed, it was either disabled, had an unrecognized `tool_set`, or failed validation (check for warnings in the same log group).
