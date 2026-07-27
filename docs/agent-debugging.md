# Agent Debugging

Steps to troubleshoot an AgentCore agent that stalls, hangs, or returns errors. Work top to bottom; each section narrows the problem further.

## Check agent logs

The AgentCore runtime writes to CloudWatch Logs under `/aws/bedrock-agentcore/runtimes/`. Find the exact log group:

```bash
aws logs describe-log-groups \
  --region <region> \
  | grep "bedrock-agentcore"
```

Tail the last ten minutes:

```bash
aws logs tail "/aws/bedrock-agentcore/runtimes/<runtime-name>" \
  --since 10m \
  --region <region>
```

Things to look for:

- `Processing agentcore query` appears but nothing follows. The orchestrator received the request and stalled.
- `AgentCore query processed successfully` is the completion marker. Healthy requests log this within 30 to 60 seconds.
- Memory operation warnings. See [Memory issues](#memory-issues).
- Knowledge base retrieval errors. See [Knowledge base issues](#knowledge-base-issues).

## Check the stream Lambda

The chat Lambda Function URL proxies the AgentCore response back to the browser. If logs show the request was received but no response streamed, inspect that function:

```bash
aws logs tail "<stream-function-log-group>" \
  --since 10m \
  --region <region>
```

Look for `Invoking Runtime directly via AgentCore`. If you see that line but no follow-up, the runtime never returned. Check the agent logs above.

## Knowledge base issues

Most agent hangs come from the knowledge base. Three common causes:

### Wrong or missing KB ID

Verify the KB referenced by the runtime exists:

```bash
aws bedrock-agent list-knowledge-bases \
  --region <region> \
  --query 'knowledgeBaseSummaries[*].[knowledgeBaseId,name]' \
  --output table
```

Check which ID the runtime is using:

```bash
aws bedrock-agentcore describe-runtime \
  --runtime-arn <runtime-arn> \
  --region <region>
```

The `BEDROCK_KB_ID` environment variable on the runtime should match an ID from the first command. If it does not, redeploy: the CDK stack passes the KB ID in as an environment variable at deploy time.

### KB not responding

Test retrieval directly:

```bash
aws bedrock-agent retrieve \
  --knowledge-base-id <kb-id> \
  --retrieval-query "test query" \
  --region <region>
```

A timeout or empty result indicates the KB itself is the problem. Check that the KB has been ingested. The Analytics KB re-hydrates daily via EventBridge; on first deploy it can take several minutes before the first ingestion job completes.

### Permission denied

The runtime IAM role needs `bedrock:Retrieve` and `bedrock:RetrieveAndGenerate` on the KB ARN. These are granted by the CDK stack. If you see `AccessDeniedException` in runtime logs, the role is missing a grant. Verify the CDK deployment completed without errors.

## Memory issues

AgentCore Memory calls can stall on first invocation or when a session is corrupted. Bypass memory temporarily to confirm whether it is the cause. Set the runtime environment variable:

```
DISABLE_MEMORY=true
```

Redeploy. If the agent responds normally with memory disabled, the issue is in memory retrieval or storage. Check the AgentCore Memory resource exists and the runtime role has the required permissions.

Re-enable memory once the underlying issue is fixed.

## Verify after a fix

1. Redeploy with `npm run cdk -- deploy "dev/*"`.
2. Send a simple query through the frontend.
3. Confirm `AgentCore query processed successfully` appears in the runtime log.
4. Response time should be 30 to 60 seconds for most queries.

## Reference commands

```bash
# Get the first KB ID in the account
aws bedrock-agent list-knowledge-bases \
  --query 'knowledgeBaseSummaries[0].knowledgeBaseId' \
  --output text \
  --region <region>

# Inspect runtime configuration including environment variables
aws bedrock-agentcore describe-runtime \
  --runtime-arn <runtime-arn> \
  --region <region>

# Direct KB retrieval test
aws bedrock-agent retrieve \
  --knowledge-base-id <kb-id> \
  --retrieval-query "test query" \
  --region <region>
```
