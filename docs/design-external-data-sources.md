# Technical Design: External Data Source Support

**Author:** Gage McGilvra
**Date:** September 21, 2026
**Status:** Draft — Pending Review

---

## What We're Building

A generic framework that lets customers bring their own data into LiveOps without copying it. Customers point us at tables they already have — in their own S3 buckets, in Snowflake, in Databricks — and our agents can query that data immediately alongside the built-in gaming tables.

Today the solution only works with CSV and JSON files that live inside our S3 bucket. That means every customer has to ETL their data into our format before they get any value. This change removes that requirement.

## Why

1. **Customers are asking for it.** Customers using Snowflake want to query their existing data through LiveOps agents. They shouldn't have to duplicate their data into our bucket first.
2. **Broader applicability.** Most game studios already have data in a lakehouse (Snowflake, Databricks, or a Parquet/Iceberg data lake on S3). If we can't read it where it already lives, we're asking them to build an ETL pipeline before they can evaluate the solution.
3. **Production quality.** We're building a reusable generic framework — not a customer-specific proof of concept. This should work for any customer with any supported data format.

## Scope

### In Scope

- Support Parquet and Iceberg table formats in Athena (in addition to existing CSV and JSON)
- Support external S3 buckets (cross-account) as data locations
- Add partition key support for large datasets
- Make column specification optional when schemas can be inferred (Parquet, Iceberg)
- Snowflake integration via Athena Federated Query as the first external platform connector
- Schema discovery pipeline updates so external tables appear in the Schema KB and Neptune graph
- Documentation and end-to-end validation

### Out of Scope (Future)

- Direct SDK connectors (Databricks SQL connector, Snowflake Python connector) — already built separately, can coexist
- UI for managing external connections (Phase 2)
- Real-time streaming from external sources
- Write-back to external sources

## How It Works

### Design Principle: Everything Goes Through Athena

Rather than building separate query tools for each data platform, we extend the existing Athena path. Athena already supports Parquet, Iceberg, and federated connectors natively. This means:

- Agents use the same `query_data` tool they already use — no new tools needed
- Schema discovery, join paths, and entity resolution work the same way
- The orchestrator doesn't need to know whether a table is local CSV or external Snowflake
- We get Athena's query engine, caching, and cost controls for free

```
Today               After This Change
─────               ─────────────────
User question       User question
    ↓                   ↓
Orchestrator        Orchestrator
    ↓                   ↓
Sub-agent           Sub-agent
    ↓                   ↓
query_data →        query_data →
Athena              Athena
    ↓                   ↓
Glue table →        Glue table →
S3 (our bucket,     S3 (any bucket, Parquet/Iceberg/CSV/JSON)
CSV/JSON only)          ↓ ...OR...
                    Glue Connector →
                    Snowflake / Databricks / Redshift
```

No changes to the agent runtime, orchestrator, or tool code. The expansion happens entirely in the infrastructure layer (Glue catalog, IAM, networking) and the configuration layer (cdk.json table definitions).

### Component Changes

#### 1. Table Definition Schema (cdk.json)

Today, table definitions in `cdk.json` look like this:

```json
{
    "tableName": "players",
    "s3DataPath": "data/athena-seed-data/kb_players.csv",
    "columns": [
        { "name": "player_id", "type": "string" },
        { "name": "username", "type": "string" }
    ]
}
```

The new schema adds optional fields while keeping full backward compatibility:

```json
{
    "tableName": "player_sessions",
    "description": "Player session data from customer Snowflake warehouse",

    "format": "parquet",

    "location": {
        "type": "s3",
        "bucket": "customer-data-lake-prod",
        "prefix": "game-analytics/sessions/",
        "accountId": "111122223333"
    },

    "columns": [],

    "partitionKeys": [
        { "name": "event_date", "type": "date" },
        { "name": "region", "type": "string" }
    ],

    "schemaInference": true
}
```

| New Field                       | Required              | Default         | Purpose                                                                                   |
| ------------------------------- | --------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `format`                        | No                    | `csv`           | Table format: `csv`, `json`, `parquet`, `iceberg`                                         |
| `location`                      | No                    | Internal bucket | Where the data lives. If omitted, uses the solution's own S3 bucket (backward compatible) |
| `location.type`                 | Yes (if location set) | —               | `s3` for direct S3 access, `federated` for Glue Connector                                 |
| `location.bucket`               | Yes (if s3)           | —               | S3 bucket name                                                                            |
| `location.prefix`               | Yes (if s3)           | —               | S3 key prefix                                                                             |
| `location.accountId`            | No                    | Same account    | Cross-account bucket owner                                                                |
| `location.connectorName`        | Yes (if federated)    | —               | Glue Connector name for Snowflake/Databricks                                              |
| `location.connectionProperties` | Yes (if federated)    | —               | Connector-specific config (warehouse, database, schema, etc.)                             |
| `partitionKeys`                 | No                    | None            | Partition columns for Hive-style partitioned data                                         |
| `schemaInference`               | No                    | `false`         | If `true` and `columns` is empty, infer schema from data (Parquet/Iceberg only)           |
| `description`                   | No                    | None            | Human-readable description, included in Schema KB docs                                    |

**Backward compatibility:** Every existing field keeps its current meaning and default. A table definition with no new fields behaves exactly as it does today.

#### 2. Glue Catalog Changes (analytics.ts)

The `analytics.ts` construct currently creates Glue tables assuming CSV format and the internal S3 bucket. Changes:

- Read the `format` field and set the appropriate Glue SerDe:
    - `csv` → `org.apache.hadoop.hive.serde2.OpenCSVSerde` (existing)
    - `json` → `org.openx.data.jsonserde.JsonSerDe` (existing)
    - `parquet` → `org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe`
    - `iceberg` → Glue Iceberg table type (uses `table_type=ICEBERG` table property)
- If `location` is set, use the specified bucket/prefix instead of the internal bucket
- If `partitionKeys` is set, register them in the Glue table definition
- If `schemaInference` is true and columns are empty, create the table with no explicit columns and let the SerDe infer from the data files

#### 3. IAM and Cross-Account Access (agents/index.ts)

Today the runtime IAM role has read access to one S3 bucket. Changes:

- Scan all table definitions for unique external `location.bucket` values
- For each external bucket, add `s3:GetObject` and `s3:ListBucket` permissions scoped to that bucket's prefix
- For cross-account buckets (`accountId` specified), the customer must also add a bucket policy granting our role access — document this clearly
- For KMS-encrypted buckets, the customer must grant `kms:Decrypt` to our role — document this clearly

#### 4. Schema Discovery Pipeline Updates

The schema discovery pipeline needs to handle external tables:

- **Schema Agent:** When generating markdown docs for external tables, include the source location and format metadata so agents know where data comes from
- **Schema KB:** External table docs get indexed alongside internal tables — no separate KB needed
- **Neptune graph:** External tables appear in the graph with join paths to internal tables where foreign keys exist
- **Fix existing bug:** The schema lookup currently assumes all tables are in the liveops store. Update to search across all registered tables regardless of location

#### 5. Snowflake Integration (Federated Query)

For the first external platform connector, use Athena Federated Query with the Snowflake Glue Connector:

**Infrastructure additions:**

- Deploy the [Amazon Athena Snowflake Connector](https://docs.aws.amazon.com/athena/latest/ug/connectors-snowflake.html) as a Lambda function
- Register the connector in Glue
- Store Snowflake credentials in Secrets Manager (prefix: `liveops/external/`)
- Grant the connector Lambda access to the Secrets Manager secret

**Configuration example:**

```json
{
    "tableName": "sf_player_revenue",
    "description": "Revenue data from customer Snowflake warehouse",
    "format": "federated",
    "location": {
        "type": "federated",
        "connectorName": "snowflake-connector",
        "connectionProperties": {
            "secretName": "<your-secret-name>",
            "database": "GAME_ANALYTICS",
            "schema": "PUBLIC",
            "table": "PLAYER_REVENUE"
        }
    },
    "columns": [
        { "name": "player_id", "type": "string" },
        { "name": "revenue_usd", "type": "decimal(10,2)" },
        { "name": "transaction_date", "type": "date" }
    ]
}
```

**Why Athena Federation over direct SDK:** The agent uses the same `query_data` tool, the same Athena SQL, and the same schema discovery. No new tool code, no new agent config pattern, no orchestrator changes. The tradeoff is a small latency overhead from the federation hop, but for analytics queries this is acceptable.

#### 6. Networking (networking.ts)

- **External S3 buckets (same region):** No change needed — S3 Gateway Endpoint already handles this
- **Cross-region S3 buckets:** Not supported in this phase (Athena is region-scoped)
- **Snowflake Federation:** The connector Lambda needs outbound internet access to reach Snowflake's API. Deploy it in a subnet with NAT Gateway access. This is the same NAT Gateway requirement as the direct SDK approach (~$32/month)

### Sequence: How a Query Flows

```
1. User: "What's the average revenue per player this month?"

2. Orchestrator: routes to Performance Metrics agent
   (agent description mentions revenue — same as today)

3. Agent: calls search_schema("revenue per player")
   → Schema KB returns both internal "purchases" table AND
     external "sf_player_revenue" table from Snowflake

4. Agent: calls find_join_path("purchases", "sf_player_revenue")
   → Neptune returns: JOIN on player_id

5. Agent: writes SQL that references both tables
   → query_data("""
       SELECT AVG(revenue_usd) as avg_revenue
       FROM sf_player_revenue
       WHERE transaction_date >= DATE '2026-09-01'
     """)

6. Athena: routes the query through the Snowflake connector
   → Connector Lambda calls Snowflake API
   → Results return to Athena → formatted → returned to agent

7. Agent: analyzes results → streams response to user
```

The user and the agent don't know or care that the data came from Snowflake. It looks like any other table.

## Implementation Plan

### Phase 1: Fix Existing Bugs

**Estimated effort:** Small (1-2 days)

1. Widen S3 read permissions to cover all configured bucket locations
2. Fix schema lookup to search across all registered tables, not just the liveops store

### Phase 2: Parquet and Iceberg Support

**Estimated effort:** Medium (3-5 days)

1. Extend `cdk.json` table schema with new fields (`format`, `location`, `partitionKeys`, `schemaInference`)
2. Update `analytics.ts` to create Glue tables with correct SerDe for each format
3. Update IAM to grant access to external S3 buckets
4. Update schema discovery pipeline to handle external tables
5. Test with Parquet tables in an external bucket

### Phase 3: Snowflake Federated Query

**Estimated effort:** Medium (3-5 days)

1. Deploy Athena Snowflake Connector infrastructure (CDK construct)
2. Add `federated` location type to table schema
3. Configure NAT Gateway for connector outbound access
4. Test end-to-end with the customer's Snowflake instance
5. Validate cross-database joins (Athena table + Snowflake table in one query)

### Phase 4: Document and Validate

**Estimated effort:** Small (2-3 days)

1. Write customer-facing integration guide (data shape, registration, cross-account/KMS setup)
2. End-to-end validation: register a Parquet and an Iceberg table from an external bucket, join against existing table, confirm schema lookup returns columns and joins, confirm existing tables still work
3. Update adding-agents.md and architecture.md

## Risks and Mitigations

| Risk                                                                   | Impact                                | Mitigation                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Cross-account S3 access is complex for customers (bucket policy + KMS) | Customer setup friction               | Clear step-by-step docs with copy-paste IAM/bucket policies                                                            |
| Athena Federated Query to Snowflake adds latency (3-10s per query)     | Slower responses for Snowflake data   | Acceptable for analytics; document expected latency; consider caching for repeated queries in future                   |
| Schema inference for Parquet may produce unexpected column types       | Incorrect query generation            | Default `schemaInference` to false; recommend explicit columns for production; inference as convenience for evaluation |
| Snowflake connector Lambda cold starts                                 | First query after idle period is slow | Keep-alive schedule or accept cold start (one-time per session)                                                        |

## What This Doesn't Change

- Existing CSV/JSON tables work exactly as before — zero changes to existing deployments
- The agent runtime (Python code) is unchanged — no new tools, no factory changes
- The orchestrator routing logic is unchanged
- The UI is unchanged
- Agents that don't reference external tables are unaffected

## Open Questions for Review

1. **Databricks connector priority:** Should we add the Athena Databricks Connector in this phase, or defer to a follow-up? The pattern is identical to Snowflake (different connector Lambda, same config shape).
2. **Table registration UX:** Should external tables be defined in `cdk.json` (requires redeploy) or should we extend the Config API to accept table definitions at runtime (more flexible, more work)?
3. **Cost guardrails:** Should we add Athena query cost limits for external tables? Federated queries can scan large datasets in the customer's warehouse. A per-query byte limit or timeout might be prudent.

---

_This document follows the one-page design process: what we're building, why we need it, and how we'll implement it._
