# Evaluation Guide

This guide covers three evaluation flows for the deployed stack: Knowledge Base retrieval quality, overall agent quality, and data path correctness. Each runs independently. Run them after a deploy to validate the system, or in CI to catch regressions.

## Prerequisites

- Stack deployed (`npm run cdk -- deploy "dev/*"`).
- AWS credentials configured via the default chain. If you use multiple accounts, set `AWS_PROFILE` to target the account you deployed into.
- Python with `boto3` installed (`uv pip install boto3` or equivalent).
- **Transaction Search enabled** in CloudWatch for the region where you deployed. Required for agent evaluation. One-time setup:
    1. Open the CloudWatch console in the deployed region.
    2. Go to Settings → Transaction Search.
    3. Enable it for the account.

## KB evaluation

Uses the Bedrock Evaluations API to score how well the Knowledge Base retrieves and answers questions. Scores across seven dimensions: correctness, completeness, helpfulness, coherence, faithfulness, harmfulness, and refusal.

### Datasets

- `scripts/kb-eval/eval_dataset.jsonl` — 29 questions covering player data, campaigns, KPIs, segments, purchases, incidents.
- `scripts/kb-eval/eval_dataset_remediations.jsonl` — 5 questions covering remediation playbooks for battle errors, session drops, purchase failures, churn, and API abuse.

### Run the player data KB eval

```bash
npm run eval:kb -- --stage dev
```

### Run the remediations KB eval

```bash
npm run eval:kb:remediations -- --stage dev
```

### Options

| Flag        | Default    | Description                                          |
| ----------- | ---------- | ---------------------------------------------------- |
| `--stage`   | `dev`      | Deployment stage.                                    |
| `--kb-name` | (first KB) | Filter KB by name (for example, `remediations`).     |
| `--metrics` | `all`      | Comma-separated metrics to score, or `all`.          |
| `--no-poll` | false      | Submit the job and exit without waiting for results. |
| `--timeout` | 60         | Polling timeout in minutes.                          |

### How it works

1. Finds the deployed KB by listing knowledge bases in the account.
2. Uploads the eval dataset to the KB's S3 data bucket.
3. Creates a Bedrock evaluation job with the specified metrics.
4. Polls until completion and prints aggregated scores.
5. Saves full results to S3 under `kb-eval/results/`.

### Viewing results

Download the detailed JSONL output from S3:

```bash
aws s3 cp s3://<bucket>/kb-eval/results/ ./kb-eval-results/ --recursive
```

For a per-question summary:

```bash
python scripts/kb-eval/parse_results.py <path-to-output.jsonl>
```

## Agent evaluation

Uses the AgentCore Online Evaluations API to score live traces from the runtime. The online config monitors every query, not just test invocations, and runs five built-in LLM-as-judge evaluators.

### Evaluators

| Evaluator                       | Level   | What it measures                            |
| ------------------------------- | ------- | ------------------------------------------- |
| `Builtin.Helpfulness`           | Trace   | How useful and actionable the response is.  |
| `Builtin.Correctness`           | Trace   | Factual accuracy of information returned.   |
| `Builtin.Coherence`             | Trace   | Logical consistency without contradictions. |
| `Builtin.GoalSuccessRate`       | Session | Whether all user goals were achieved.       |
| `Builtin.ToolSelectionAccuracy` | Tool    | Whether the right tools were selected.      |

### Step 1: create the online eval config (one-time)

```bash
npm run eval:agents -- --stage dev --action setup
```

Creates an IAM role and an online evaluation config that monitors the runtime's log group with 100 percent sampling. The config persists; run this once per stage.

### Step 2: send test queries

```bash
npm run eval:agents -- --stage dev --action invoke --limit 5
```

Sends questions from `scripts/agent-eval/eval_dataset.jsonl` (10 total) to the runtime. Any query you send through the frontend also generates evaluated traces; the test queries just give you a repeatable baseline.

### Step 3: check results

```bash
npm run eval:agents -- --stage dev --action results
```

Wait 3 to 5 minutes after invoking before checking. Results are written to `reports/agent-eval-<timestamp>.json`.

### Run all three steps at once

```bash
npm run eval:agents -- --stage dev --action full --limit 5 --wait 180
```

### Options

| Flag       | Default | Description                                 |
| ---------- | ------- | ------------------------------------------- |
| `--stage`  | `dev`   | Deployment stage.                           |
| `--action` | `full`  | `setup`, `invoke`, `results`, or `full`.    |
| `--limit`  | 5       | Number of test queries to send.             |
| `--wait`   | 180     | Seconds to wait for results in `full` mode. |

### How it works

1. **Setup**: creates the online evaluation config pointing at the runtime's CloudWatch log group.
2. **Invoke**: sends test queries via `invoke_agent_runtime`, generating OpenTelemetry traces.
3. **Evaluate**: the AgentCore pipeline picks up traces, scores them through the LLM judges, and writes results to `/aws/bedrock-agentcore/evaluations/results/<config-id>`.
4. **Results**: the script queries that log group and aggregates scores.

### Interpreting results

Scores are on a 0.0 to 1.0 scale.

- `GoalSuccessRate` and `ToolSelectionAccuracy` are binary (1.0 = yes, 0.0 = no).
- `Helpfulness`, `Correctness`, and `Coherence` return graded labels. Example:

```
Builtin.Correctness    avg=0.80  n=5
    Labels: {'Perfectly Correct': 3, 'Partially Correct': 2}
```

### Adding test questions

Edit `scripts/agent-eval/eval_dataset.jsonl`. Each line is a JSON object:

```json
{
    "conversationTurns": [
        {
            "prompt": { "content": [{ "text": "Your question here" }] },
            "referenceResponses": [
                { "content": [{ "text": "Expected answer (used by KB eval, not agent eval)" }] }
            ]
        }
    ]
}
```

### Disabling the online config

The online evaluation config runs LLM judges on every trace, which has a cost. To disable without deleting:

```bash
aws bedrock-agentcore-control update-online-evaluation-config \
  --online-evaluation-config-id gaming_agent_eval-<ID> \
  --execution-status DISABLED \
  --region <region>
```

## Data path evaluation

Tests whether agents use the right data source for each question and whether the data they return contains expected values. Complements the KB and agent evaluations, which score retrieval quality and overall response quality respectively, with specific structural checks.

### What it scores

For each test question, produces two scores:

- **Path score** (0.0 to 1.0): structural check. Did the agent call the expected tool (`query_data`, `query_live_metrics`, `get_recent_reports`)? Did it query the expected table? Did results include expected terms?
- **LLM judge score**: a Haiku-based judge rates correctness and completeness of the response against the expected behavior.

### Run all data path checks

```bash
npm run eval:data-paths -- --stage dev
```

### Run a subset

```bash
npm run eval:data-paths -- --stage dev --type athena
npm run eval:data-paths -- --stage dev --type live
```

### Options

| Flag      | Default | Description                                           |
| --------- | ------- | ----------------------------------------------------- |
| `--stage` | `dev`   | Deployment stage.                                     |
| `--type`  | `all`   | Which data path to check: `all`, `athena`, or `live`. |

### What gets checked

- **Athena questions** (8 total): player segment counts, whale combat power, campaign budgets, top purchase items, platform splits, retention by channel, incident impact, game mode popularity. For each, the script verifies the correct table was queried and expected terms appear in the response.
- **Live metrics questions** (4 total): session drop rate, battle errors, purchase failure spikes, recent alerts. For each, the script verifies the Real-Time Monitor agent was invoked and the right tool was called.

### Output

Results are saved to `reports/data-path-eval-<timestamp>.json`. A PASS/FAIL summary is also printed to the terminal, grouped by data path type with aggregate scores.
