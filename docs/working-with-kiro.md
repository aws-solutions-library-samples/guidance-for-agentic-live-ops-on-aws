# Working with Kiro

This project was built with [Kiro](https://kiro.dev), an agentic development environment from AWS. Kiro is our recommended IDE for contributing to this codebase. It is optional; every command and deploy step in this repo works from any shell.

## What Kiro gives you here

The repo ships a `.kiro/settings/mcp.json` file that pre-configures a set of Model Context Protocol (MCP) servers Kiro loads on project open. These let the AI agent pull live AWS documentation, search Strands Agents and Bedrock AgentCore docs, query AWS regional availability, and drive the browser for frontend testing, without any additional setup on your side.

## Configured MCP servers

Enabled by default:

| Server              | Purpose                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `fetch`             | Fetch arbitrary URLs as context for the agent.                              |
| `aws-knowledge`     | Search AWS documentation, check regional availability of services and APIs. |
| `cdk`               | CDK best practices, Nag rule explanations, Solutions Constructs lookups.    |
| `strands-agents`    | Search and fetch Strands Agents SDK documentation.                          |
| `bedrock-agentcore` | Search and fetch Amazon Bedrock AgentCore documentation.                    |
| `playwright`        | Drive a real browser for frontend testing (navigate, click, screenshot).    |

Disabled by default (enable in `.kiro/settings/mcp.json` if you need them):

| Server           | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `frontend`       | React component documentation lookups.                         |
| `cloudwatch`     | Query CloudWatch metrics directly.                             |
| `synthetic-data` | Generate synthetic seed data from a schema and save it as CSV. |
| `aws-pricing`    | Look up AWS service pricing and analyze CDK project costs.     |

## Using Kiro with this repo

Install Kiro from [kiro.dev](https://kiro.dev), then open the repo folder. Kiro reads `.kiro/settings/mcp.json` on project open and the configured MCP servers become available to the agent. Ask natural-language questions like "find the current battle_error threshold rule and change it to 75" or "run the KB evaluation on dev and summarize the results"; Kiro plans the work, runs commands, and reports back.

## Testing the frontend

The Playwright MCP server lets Kiro exercise the deployed frontend. Useful prompts:

- "Open the chat page, send the query 'Who are the top spenders?', and screenshot the result."
- "Log in as test@example.com and verify the monitor dashboard loads without errors."

This is handy for smoke-testing a deploy before handing off to a human reviewer.

## Not using Kiro

Every task this repo supports is reachable from any shell via the commands in the main [README](../README.md) and the individual guides under `docs/`. Kiro is an accelerator, not a dependency.
