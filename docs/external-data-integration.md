# External Data Source Integration

Integrate external SQL data sources (Databricks, Snowflake, PostgreSQL, MySQL, Redshift, and any DB-API 2.0 compatible database) into the Agentic Live Ops multi-agent system. Agents can query external sources alongside Athena using the same natural language chat interface.

## Overview

The integration adds a new `external_sql` tool set to the agent runtime. Agents that include `"external_sql"` in their `tool_sets` config get a `query_external` tool that connects to any supported SQL source using credentials stored in AWS Secrets Manager.

No code changes are needed to add a new data source — operators configure connection details in Secrets Manager and reference the secret in their agent config.

### How It Fits Into the Existing Architecture

```
User asks a question
    ↓
Orchestrator picks a sub-agent
    ↓
Agent's config says: "tool_sets": ["external_sql"]
    ↓
Agent Factory maps "external_sql" → create_external_sql_tools()
    ↓
Tool reads connection config from agent's config_overrides → Secrets Manager
    ↓
Connects via native Python SDK (databricks-sql-connector / snowflake-connector-python / psycopg2 / etc.)
    ↓
Executes SQL, returns formatted rows (same format as Athena tool)
    ↓
Agent reasons over results → response to user
```

The `query_external` tool follows the exact same contract as the existing `query_data` (Athena) tool: takes SQL, returns a text table, caps at 200 rows, tracks query artifacts for the frontend sources panel.

## Compatibility

### Supported Sources (Bundled)

These drivers are included in the runtime container and work out of the box:

| Source     | Python Driver                | `source_type` value | Connection Pattern                              |
| ---------- | ---------------------------- | ------------------- | ----------------------------------------------- |
| Databricks | `databricks-sql-connector`   | `databricks`        | Host + HTTP path + access token                 |
| Snowflake  | `snowflake-connector-python` | `snowflake`         | Account + warehouse + user/password or key pair |
| PostgreSQL | `psycopg2-binary`            | `postgresql`        | Host + port + database + user/password          |

### Supported Sources (Add Driver Required)

These adapters exist in the code but their Python drivers are not bundled. Add the driver to `requirements.txt` and redeploy:

| Source   | Python Driver to Add | `source_type` value | Connection Pattern                     |
| -------- | -------------------- | ------------------- | -------------------------------------- |
| MySQL    | `pymysql`            | `mysql`             | Host + port + database + user/password |
| Redshift | `redshift-connector` | `redshift`          | Host + port + database + user/password |

### Compatible (Add Adapter + Driver)

Any database with a Python DB-API 2.0 compliant driver can be integrated by adding an adapter function. See [Adding Support for a New Database Type](#adding-support-for-a-new-database-type). Examples:

| Source          | Python Driver           | Effort                                                                          |
| --------------- | ----------------------- | ------------------------------------------------------------------------------- |
| Google BigQuery | `google-cloud-bigquery` | New adapter (~10 lines) + driver                                                |
| Oracle          | `oracledb`              | New adapter (~10 lines) + driver                                                |
| SQL Server      | `pymssql` or `pyodbc`   | New adapter (~10 lines) + driver                                                |
| ClickHouse      | `clickhouse-connect`    | New adapter (~10 lines) + driver                                                |
| Trino / Presto  | `trino`                 | New adapter (~10 lines) + driver                                                |
| CockroachDB     | `psycopg2-binary`       | Works with existing `postgresql` adapter (CockroachDB is PostgreSQL-compatible) |
| AlloyDB         | `psycopg2-binary`       | Works with existing `postgresql` adapter                                        |

The only requirement is a Python driver that returns a DB-API 2.0 compliant connection (supports `.cursor()`, `cursor.execute(sql)`, `cursor.fetchmany(n)`, `cursor.description`).

## Quick Start — Integrate Your Data Source in 5 Steps

### Step 1: Ensure Networking Prerequisites

The agent runtime runs in private isolated subnets (no internet access). Before connecting to any external source, ensure:

**For cloud-hosted sources (Databricks, Snowflake, or any internet-reachable database):**

- **A NAT Gateway is required.** See [Networking Requirements](#nat-gateway-required-for-cloud-hosted-sources) for the one-time setup (~$32/month).

**For databases in the same VPC (RDS, Aurora, Redshift):**

- Add a security group inbound rule allowing traffic from the runtime security group on the database port. See [Same-VPC Databases](#same-vpc-databases-rds-aurora-redshift).

### Step 2: Store Your Credentials in Secrets Manager

Create a secret named `liveops/external/<your-source>` with the connection details. The secret **must** include a `source_type` field that matches one of the supported sources.

**Databricks:**

```bash
aws secretsmanager create-secret \
  --name "liveops/external/databricks" \
  --secret-string '{
    "source_type": "databricks",
    "host": "my-workspace.cloud.databricks.com",
    "http_path": "/sql/1.0/warehouses/abc123",
    "access_token": "dapi..."
  }'
```

**Snowflake:**

```bash
aws secretsmanager create-secret \
  --name "liveops/external/snowflake" \
  --secret-string '{
    "source_type": "snowflake",
    "account": "my-org-my-account",
    "warehouse": "COMPUTE_WH",
    "database": "ANALYTICS",
    "schema": "PUBLIC",
    "user": "service_user",
    "password": "..."
  }'
```

**PostgreSQL (RDS, Aurora, or self-managed):**

```bash
aws secretsmanager create-secret \
  --name "liveops/external/postgresql" \
  --secret-string '{
    "source_type": "postgresql",
    "host": "my-db.cluster-xyz.us-west-2.rds.amazonaws.com",
    "port": 5432,
    "database": "analytics",
    "user": "readonly_user",
    "password": "..."
  }'
```

**MySQL:**

```bash
aws secretsmanager create-secret \
  --name "liveops/external/mysql" \
  --secret-string '{
    "source_type": "mysql",
    "host": "my-db.cluster-xyz.us-west-2.rds.amazonaws.com",
    "port": 3306,
    "database": "analytics",
    "user": "readonly_user",
    "password": "..."
  }'
```

**Redshift:**

```bash
aws secretsmanager create-secret \
  --name "liveops/external/redshift" \
  --secret-string '{
    "source_type": "redshift",
    "host": "my-cluster.abc123.us-west-2.redshift.amazonaws.com",
    "port": 5439,
    "database": "analytics",
    "user": "readonly_user",
    "password": "..."
  }'
```

> **Important:** Secret names must start with `liveops/external/` — the IAM policy scopes access to this prefix.

### Step 3: Create an Agent Config

Create a folder under `data/agent-configs/` with a `config.json` and `prompt.md`:

```
data/agent-configs/my_external_agent/
├── config.json
└── prompt.md
```

**config.json** — point `tool_sets` to `"external_sql"` and set `config_overrides.external_sql_connection_id` to your secret name:

```json
{
    "agent_id": "my_external_agent",
    "display_name": "My External Analytics Agent",
    "description": "Queries our data warehouse for business analytics.",
    "agent_type": "analytics",
    "model_key": "",
    "tool_sets": ["external_sql"],
    "config_overrides": {
        "external_sql_connection_id": "liveops/external/my-source"
    },
    "enabled": true
}
```

**prompt.md** — this is critical for query accuracy. Include:

1. The SQL dialect the agent should use
2. The exact table names and column names with types
3. Foreign key relationships for joins
4. Any filtering conventions (e.g., `status = 'completed'` for net revenue)

```markdown
# My External Analytics Agent

You are a data analyst with access to our data warehouse via the `query_external` tool.

## SQL Dialect

Use standard PostgreSQL SQL syntax.

## Available Tables

**customers** — Customer profiles

- customer_id (SERIAL, PK)
- name (VARCHAR)
- email (VARCHAR)
- segment (VARCHAR) — values: enterprise, smb, startup
- signup_date (DATE)
- country (VARCHAR(2))

**orders** — Purchase transactions

- order_id (SERIAL, PK)
- customer_id (INTEGER, FK → customers)
- order_date (DATE)
- amount (DECIMAL) — order value in USD
- product (VARCHAR) — product name
- status (VARCHAR) — values: completed, refunded

## Rules

- Use LIMIT to keep results manageable (max 200 rows returned)
- You have a maximum of 3 query attempts per request
- JOIN orders to customers via customer_id for revenue-by-segment queries
- Filter status = 'completed' for net revenue
- Write complete, executable queries
- Provide analysis in paragraphs with specific numbers
```

> **Tip:** The more detail you put in the prompt about table schema and column names, the fewer query failures you'll get. Agents guess column names when the schema isn't specified, which leads to SQL errors and wasted query attempts.

### Step 4: Add Schema Documentation (Recommended)

Add markdown schema docs to `data/kb-schema-docs/` so agents can discover your tables via the Schema KB:

```markdown
# Table: customers

Source: PostgreSQL (RDS)
Database: analytics

## Columns

| Column      | Type       | Description                                 |
| ----------- | ---------- | ------------------------------------------- |
| customer_id | INTEGER    | Unique customer identifier                  |
| name        | VARCHAR    | Full name                                   |
| segment     | VARCHAR    | Customer segment (enterprise, smb, startup) |
| signup_date | DATE       | Account creation date                       |
| country     | VARCHAR(2) | Two-letter country code                     |
```

After adding schema docs, the daily hydration job syncs them into the Schema KB and Neptune graph. Agents can then discover these tables using `search_schema` and `find_join_path`.

### Step 5: Deploy and Test

```bash
npm run cdk -- deploy "dev/*"
```

Alternatively, upload the agent config via the Config API at runtime (no deploy needed):

```bash
curl -X POST "$CONFIG_API_URL/agents" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "my_external_agent",
    "display_name": "My External Analytics Agent",
    "description": "Queries our data warehouse.",
    "agent_type": "analytics",
    "tool_sets": ["external_sql"],
    "config_overrides": {"external_sql_connection_id": "liveops/external/my-source"},
    "prompt_template": "You are a data analyst with access to our data warehouse...",
    "enabled": true
  }'
```

Open the chat UI and ask a question that explicitly references your external agent:

> "Use the External Analytics Agent to show me revenue by customer segment"

> **Note:** The orchestrator routes queries based on agent descriptions. If your external agent's description overlaps with existing agents (e.g., both handle "revenue" questions), you may need to name the agent explicitly in your query or adjust the agent description to be more specific.

## Advanced: Multiple External Sources

To query multiple external sources (e.g., Databricks AND PostgreSQL), create separate agents with separate secrets:

```json
{
    "agent_id": "databricks_analytics",
    "display_name": "Databricks Game Analytics Agent",
    "description": "Queries the Databricks lakehouse for game telemetry and player behavior data.",
    "tool_sets": ["external_sql"],
    "config_overrides": {
        "external_sql_connection_id": "liveops/external/databricks"
    }
}
```

```json
{
    "agent_id": "postgres_analytics",
    "display_name": "PostgreSQL CRM Agent",
    "description": "Queries the PostgreSQL CRM database for customer profiles and order history.",
    "tool_sets": ["external_sql"],
    "config_overrides": {
        "external_sql_connection_id": "liveops/external/postgresql"
    }
}
```

The orchestrator routes questions to the right agent based on the description. Make descriptions specific and non-overlapping so routing works correctly.

### Cross-Database Queries

When a user asks a question that spans multiple databases (e.g., "Compare revenue from Game A's database with Game B's database"), the system handles this at two levels:

**Level 1 — Orchestrator aggregation (supported today):** The orchestrator can call multiple agents in parallel (via `ThreadPoolExecutor`), get results from each database, and synthesize a combined answer. This works for comparison and aggregation questions where each database is queried independently.

**Level 2 — Cross-database SQL joins (not supported):** A single SQL query that joins tables from two different databases is not possible through `query_external`, since each tool call connects to one source. For use cases that require real cross-database joins, consider:

- **Athena Federated Query:** Set up Glue Connectors for each external source. Athena can then join across Snowflake + RDS + S3 in a single SQL statement. The existing `query_data` (Athena) tool handles this with no agent code changes — infrastructure only.
- **Warehouse-native federation:** If your primary warehouse is Databricks or Snowflake, configure external tables pointing to other databases. The agent queries the primary warehouse, which federates internally.
- **ETL consolidation:** Use Glue ETL jobs to sync data from all sources into S3/Athena. Most reliable, but data is batch (not live).

## Adding Support for a New Database Type

If your database isn't in the supported list, add a new adapter in three steps:

1. **Add the Python driver** to `requirements.txt`:

    ```
    my-db-connector>=1.0.0
    ```

2. **Add an adapter function** in `tools/external_sql.py`:

    ```python
    def _connect_mydb(creds: dict):
        import mydb_connector
        return mydb_connector.connect(
            host=creds["host"],
            port=creds.get("port", 1234),
            database=creds["database"],
            user=creds["user"],
            password=creds["password"],
        )
    ```

3. **Register it** in the `_ADAPTERS` dict:

    ```python
    _ADAPTERS = {
        "databricks": _connect_databricks,
        "snowflake": _connect_snowflake,
        "postgresql": _connect_postgresql,
        "mysql": _connect_mysql,
        "redshift": _connect_redshift,
        "mydb": _connect_mydb,  # ← new
    }
    ```

4. **Redeploy** and create a Secrets Manager secret with `"source_type": "mydb"`.

The adapter function receives the full credentials dict from Secrets Manager and must return a DB-API 2.0 compliant connection object. That's it — the rest of the tool (SQL validation, result formatting, artifact tracking, retry limits) works automatically.

## Networking Requirements

The agent runtime runs inside a VPC with **private isolated subnets** — no NAT Gateway, no internet access by default. All AWS service access goes through VPC endpoints.

### Prerequisites by Source Location

| Source Location                                                                      | Prerequisite                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **AWS databases (same VPC)** — RDS, Aurora, Redshift                                 | Security group inbound rule only (see below)      |
| **Cloud-hosted databases** — Databricks, Snowflake, or any internet-reachable source | **NAT Gateway required** (see below)              |
| **AWS databases (different VPC)**                                                    | VPC peering or PrivateLink + security group rules |
| **On-premises databases**                                                            | AWS Site-to-Site VPN or Direct Connect            |

### NAT Gateway (Required for Cloud-Hosted Sources)

If you are connecting to Databricks, Snowflake, or any database hosted outside your VPC, the agent runtime needs outbound internet access via a NAT Gateway.

To enable a NAT Gateway, update the VPC configuration in `lib/stacks/backend/constructs/networking.ts`:

```typescript
const vpc = new Vpc(this, "vpc", {
    // ... existing config ...
    natGateways: 1, // Change from 0 to 1
    subnetConfiguration: [
        {
            name: `${subnetPrefix}-privateIsolated`,
            subnetType: SubnetType.PRIVATE_WITH_EGRESS, // Change from PRIVATE_ISOLATED
            cidrMask: 24,
        },
    ],
    // ... rest of config ...
});
```

Then redeploy:

```bash
npm run cdk -- deploy "dev/*"
```

> **Cost:** A single NAT Gateway in one AZ costs approximately $32/month plus data transfer charges. For production, consider NAT Gateways in multiple AZs for high availability.

> **Note:** If you are ONLY connecting to databases within the same VPC (RDS, Aurora, Redshift), a NAT Gateway is NOT required. Same-VPC databases are reachable directly through the private subnets.

### Same-VPC Databases (RDS, Aurora, Redshift)

For databases deployed in the same VPC as the LiveOps stack, add a security group inbound rule allowing traffic from the runtime security group on the database port:

```bash
# Find the runtime security group
RUNTIME_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*runtimeSecurityGroup*" \
  --query "SecurityGroups[0].GroupId" --output text)

# Allow the runtime to connect to your database
aws ec2 authorize-security-group-ingress \
  --group-id <YOUR_DATABASE_SECURITY_GROUP_ID> \
  --protocol tcp \
  --port <DATABASE_PORT> \
  --source-group $RUNTIME_SG
```

Common database ports: PostgreSQL = 5432, MySQL = 3306, Redshift = 5439.

### Required VPC Endpoints

The following VPC endpoint is required and is included in `lib/stacks/backend/constructs/networking.ts`:

| Endpoint                                | Purpose                                            |
| --------------------------------------- | -------------------------------------------------- |
| `com.amazonaws.<region>.secretsmanager` | Fetching database credentials from Secrets Manager |

Without this endpoint, the `query_external` tool will hang on the Secrets Manager call and eventually time out.

## Security Considerations

- **Least-privilege credentials.** Create read-only service accounts on the external source. The tool rejects write operations (INSERT, UPDATE, DELETE, DROP, etc.) at the application layer, but defense in depth at the source is important.
- **Secret naming convention.** All secrets must be under the `liveops/external/` prefix. The IAM policy scopes Secrets Manager access to this prefix only — the runtime cannot read secrets outside this path.
- **Secret rotation.** Use Secrets Manager automatic rotation for external credentials where supported.
- **Network isolation.** Use Private Link where available instead of NAT Gateway for cloud-hosted sources.
- **Query auditing.** All executed queries are logged via AWS Lambda Powertools with the query text (truncated to 200 chars), row count, duration, and source type. Logs go to the AgentCore CloudWatch log group.
- **Write blocking.** The tool validates all SQL before execution and rejects any statement containing INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, MERGE, GRANT, or REVOKE keywords.

## Troubleshooting

### Query hangs indefinitely

**Symptom:** The chat UI shows the agent was invoked but never returns a result.

**Likely causes:**

1. **Missing Secrets Manager VPC endpoint.** Check that `com.amazonaws.<region>.secretsmanager` VPC endpoint exists. Without it, the Secrets Manager API call from the isolated subnet will hang.
2. **Database not reachable from VPC.** Check security group rules — the database must allow inbound from the runtime security group on the database port. For cloud-hosted sources, ensure NAT Gateway or Private Link is configured.
3. **DNS resolution failure.** The VPC must have `enableDnsHostnames` and `enableDnsSupport` set to `true` (this is the default in the CDK construct).

**How to diagnose:** Check the AgentCore runtime CloudWatch logs:

```bash
aws logs tail "/aws/bedrock-agentcore/runtimes/<runtime-name>" \
  --since 5m --format short \
  | grep -iE "external|query_external|secret|error|connect"
```

### Agent generates wrong SQL (column not found errors)

**Symptom:** The agent writes SQL referencing columns that don't exist in your database.

**Cause:** The agent prompt doesn't include the table schema, so the agent guesses column names based on the question context and the Schema KB (which contains the Athena gaming tables, not your external tables).

**Fix:** Include the exact table and column names in the agent's `prompt.md`. The more detailed the schema in the prompt, the more accurate the SQL.

### Orchestrator routes to the wrong agent

**Symptom:** You ask about your external data but the orchestrator picks a built-in gaming agent instead.

**Cause:** The agent descriptions overlap. "Revenue by segment" matches both your external agent and the built-in Performance Metrics agent.

**Fix:** Either name the agent explicitly in your query ("Use the PostgreSQL agent to...") or make the agent description more specific and distinct from existing agents.

### "Unsupported source_type" error

**Symptom:** The tool returns an error listing supported types.

**Cause:** The `source_type` field in your Secrets Manager secret doesn't match any registered adapter.

**Fix:** Check the exact spelling. Valid values: `databricks`, `snowflake`, `postgresql`, `mysql`, `redshift` (all lowercase).

## Files Changed (from original codebase)

| File                                                                 | Change   | Description                                                                          |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `lib/stacks/backend/constructs/agents/runtime/tools/external_sql.py` | **New**  | External SQL query tool with adapter pattern                                         |
| `lib/stacks/backend/constructs/agents/runtime/agent_factory.py`      | Modified | Registered `"external_sql"` in `TOOL_SET_REGISTRY`; added `config_overrides` support |
| `lib/stacks/backend/constructs/agents/runtime/index.py`              | Modified | Added `external_queries` to the SSE sources event                                    |
| `lib/stacks/backend/constructs/agents/runtime/requirements.txt`      | Modified | Added `databricks-sql-connector`, `snowflake-connector-python`, `psycopg2-binary`    |
| `lib/stacks/backend/constructs/agents/index.ts`                      | Modified | Added Secrets Manager IAM permission scoped to `liveops/external/*`                  |
| `lib/stacks/backend/constructs/networking.ts`                        | Modified | Added `com.amazonaws.<region>.secretsmanager` VPC endpoint                           |
| `data/agent-configs/databricks_analytics/`                           | **New**  | Sample Databricks agent config + prompt (disabled by default)                        |
| `data/agent-configs/snowflake_analytics/`                            | **New**  | Sample Snowflake agent config + prompt (disabled by default)                         |
| `tests/test_external_sql.py`                                         | **New**  | 32 unit tests                                                                        |
| `docs/adding-agents.md`                                              | Modified | Added `external_sql` to the tool sets table                                          |
| `docs/external-data-integration.md`                                  | **New**  | This document                                                                        |

## Running the Tests

```bash
python3 -m pytest tests/test_external_sql.py -v
```

32 tests cover: SQL validation (write blocking for INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE/MERGE/GRANT/REVOKE), result formatting, connection adapter routing, tool creation, query attempt limits, credential error handling, and artifact tracking.
