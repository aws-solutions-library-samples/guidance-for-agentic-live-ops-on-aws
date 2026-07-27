# Schema Discovery Guide

The schema discovery pipeline lets agents work with any data source, not just the built-in Athena tables. You drop raw schema files into S3, an LLM generates standardized markdown docs, a human fills in the gaps, and a daily job indexes everything into a Bedrock Knowledge Base and a Neptune graph. Agents then find the right tables, columns, and join paths at query time.

Use this guide when adapting the solution to a new domain or adding a new data store.

## How it works

```
Upload raw files → Schema Agent (LLM) → Markdown docs → Human review → Daily KB + graph sync
```

1. Drop schema files (SQL DDL, JSON, YAML, free-form text) into the raw schemas S3 bucket under a store prefix.
2. The Schema Agent Lambda reads the files, calls Bedrock Claude, and writes one markdown doc per table to the docs bucket.
3. You review the generated docs and fill in `<!-- TODO -->` markers with business context.
4. A daily EventBridge rule triggers the hydration Lambda, which re-indexes the Schema Knowledge Base and syncs the Neptune schema graph.
5. Agents call `search_schema`, `find_join_path`, `list_table_relationships`, and `resolve_entity` at query time.

## Quick start

### Option A: use the built-in Athena schema docs

The project ships with schema docs for all 14 gaming analytics tables in `data/kb-schema-docs/`. They deploy with the stack and index automatically. No action needed beyond:

```bash
npm run cdk -- deploy "dev/*"
```

### Option B: try the included test schemas

`data/test-schemas/gaming_analytics/` contains schema files covering the same 14 tables in three formats, useful for testing the pipeline end to end.

| File                         | Format         | Tables covered                                                                       |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `player_tables.sql`          | SQL DDL        | `players`, `user_acquisition`, `campaigns`                                           |
| `combat_social.sql`          | SQL DDL        | `arena_battles`, `character_interactions`, `guild_activities`, `social_interactions` |
| `monetization_incidents.sql` | SQL DDL        | `purchases`, `monetization_events`, `incidents`                                      |
| `engagement_tables.json`     | JSON schema    | `gameplay`, `session_details`, `daily_activities`, `event_participation`             |
| `abbreviations.txt`          | Free-form text | Gaming abbreviations (whale, dolphin, CPI, LTV, TB, TW)                              |

Get the raw schemas bucket name from CDK outputs and upload the folder:

```bash
RAW_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name <your-backend-stack> \
  --query "Stacks[0].Outputs[?contains(OutputKey,'rawBucket')].OutputValue" \
  --output text \
  --region <region>)

aws s3 sync data/test-schemas/gaming_analytics/ \
  s3://$RAW_BUCKET/gaming_analytics/ \
  --region <region>
```

The Schema Agent triggers on upload. After a few minutes, check the docs bucket for generated markdown and a `_manifest.json`.

### Option C: onboard your own data store

Get the raw schemas bucket name (same command as option B) and upload under a store prefix:

```bash
aws s3 cp my_schema.sql s3://<raw-bucket>/my_warehouse/ --region <region>

aws s3 sync ./schema_exports/ s3://<raw-bucket>/my_warehouse/ --region <region>
```

Check the generated docs:

```bash
aws s3 ls s3://<docs-bucket>/my_warehouse/ --region <region>

aws s3 cp s3://<docs-bucket>/my_warehouse/_manifest.json . --region <region>
cat _manifest.json
```

The manifest shows how many tables were generated and how many have TODO markers.

Download, edit, and upload back:

```bash
aws s3 sync s3://<docs-bucket>/my_warehouse/ ./schema-review/my_warehouse/ --region <region>

# Edit the .md files to fill in TODOs and add glossary entries.

aws s3 sync ./schema-review/my_warehouse/ s3://<docs-bucket>/my_warehouse/ --region <region>
```

The hydration Lambda runs daily and picks up your changes on the next scheduled run. To check status, inspect the hydration state DynamoDB table or the Lambda's CloudWatch logs.

## Doc format

Each generated doc follows this structure:

```markdown
# Table: store_name.schema.table_name

**Data Store**: store_name (store_type)
**Database**: catalog
**Schema**: schema

## Description

Business description of the table.

## Columns

| Column | Type   | Nullable | Description | Business Term |
| ------ | ------ | -------- | ----------- | ------------- |
| col_a  | string | No       | Description | Business Term |

## Relationships

- col_a → other_table.col_b (FK)

## Glossary

- **PB**: PeanutButter inventory table
- **txn**: Transaction

## Notes

Any business context, data quality notes, or ownership info.
```

The glossary section is indexed alongside the table docs. When a user asks "what's our PB inventory?", the KB matches the glossary entry and returns the right table. Without glossary entries, abbreviation-heavy queries miss.

### Supported input formats

| Format                   | What the LLM extracts                                  |
| ------------------------ | ------------------------------------------------------ |
| CSV with headers         | One table per file, columns from header row            |
| SQL DDL (`CREATE TABLE`) | Tables, columns, types, FKs from DDL                   |
| JSON schema              | Tables from top-level keys, columns from nested fields |
| YAML                     | Tables from top-level keys                             |
| Free-form text           | Best-effort extraction of table and column info        |

For large schemas (500+ tables), the Schema Agent chunks the input across multiple LLM calls.

## Architecture

### CDK constructs

| Construct           | Purpose                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `SchemaIngest`      | Raw schemas S3 bucket (input) and schema docs S3 bucket (output).                                |
| `SchemaPipeline`    | Schema Agent Lambda, hydration Lambda, EventBridge rules, state DynamoDB table.                  |
| `NeptuneServerless` | Neptune Serverless cluster for the schema graph.                                                 |
| `KnowledgeBase`     | Dedicated Bedrock KB (S3 Vectors) for schema metadata, separate from analytics and remediations. |

### Lambdas

| Lambda       | Trigger                             | What it does                                                         |
| ------------ | ----------------------------------- | -------------------------------------------------------------------- |
| Schema Agent | S3 Object Created (via EventBridge) | Reads raw files, calls Bedrock Claude, writes markdown docs.         |
| Hydration    | EventBridge daily schedule          | Detects updated docs, re-indexes the Schema KB, syncs Neptune graph. |

### Agent tools

Agents have four tools for schema awareness:

```python
# Semantic search over the Schema KB
search_schema(query="player purchase history")
search_schema(query="PB inventory", store_filter="warehouse_a")

# Neptune graph traversal
find_join_path(source_table="guild_activities", target_table="campaigns")
list_table_relationships(table_name="players")

# Resolve free-text mentions to tables or columns
resolve_entity(mention="purchases by whales last week")
```

`search_schema` returns table names, relevance scores, and content snippets. `find_join_path` returns the FK chain with SQL join hints. `list_table_relationships` lists all direct FK connections. `resolve_entity` returns matched TABLE and COLUMN vertices with confidence scores, resolved against the Neptune MENTIONS edges.

## Model configuration

The Schema Agent uses the `defaultModelId` from `cdk.json` `modelConfig`, falling back to Claude Haiku 4.5. To change it, update `modelConfig.defaultModelId` in `cdk.json` and redeploy.

## Schema graph

The hydration Lambda parses the `## Columns` and `## Relationships` sections from each doc and upserts nodes and edges into a Neptune Serverless graph. Agents query the graph via Gremlin over a SigV4-authenticated WebSocket on port 8182.

### Graph model

```
Nodes:
  TABLE#gaming_analytics.players             (one per table)
  COLUMN#gaming_analytics.players.player_id  (one per column)

Edges:
  HAS_COLUMN    — TABLE → COLUMN (table owns column)
  JOINS_ON      — COLUMN → COLUMN (FK relationship, bidirectional)
  EQUIVALENT_TO — COLUMN → COLUMN (cross-store equivalence, bidirectional)
  MENTIONS      — MENTION → TABLE or COLUMN (entity resolution, weighted)
```

### Join path discovery

`find_join_path` runs a BFS shortest-path traversal up to 5 hops:

```
find_join_path("gaming_analytics.guild_activities", "gaming_analytics.campaigns")

→ Join path: guild_activities → campaigns (3 hops)
  1. JOIN ON guild_activities.player_id = players.player_id
  2. JOIN ON players.player_id = user_acquisition.player_id
  3. JOIN ON user_acquisition.campaign_id = campaigns.campaign_id
```

Use Neptune for the graph because the schema relationships are a natural fit for a graph database: multi-hop traversal, bidirectional edges, and weighted mentions. Gremlin is also easier to extend than hand-rolled adjacency queries against a key-value store.

## Troubleshooting

### Schema Agent did not trigger

- Verify the file was uploaded under a store prefix (`my_store/file.csv`, not `file.csv` at the root).
- Confirm the raw schemas bucket has EventBridge notifications enabled.
- Check the Schema Agent Lambda's CloudWatch logs.

### Generated docs are empty or wrong

- Open `_manifest.json` for warnings.
- Confirm the raw files are text-based and under 100MB each.
- Check the Lambda logs for LLM errors or truncation.

### Search does not find your table

- Confirm the docs are in the schema docs bucket.
- Check that hydration has run since the docs were updated (the hydration state DynamoDB table records `last_hydration_timestamp`).
- Add glossary entries for any abbreviations your team uses.
- Verify `SCHEMA_KB_ID` on the AgentCore runtime matches the deployed Schema KB.

### Hydration is not picking up changes

- Check the hydration Lambda's CloudWatch logs.
- Verify the doc's S3 `LastModified` timestamp is newer than `last_hydration_timestamp` in DynamoDB.
- The schedule is daily. For immediate indexing, invoke the Lambda manually.

### `find_join_path` returns "no path found"

- Confirm the graph has been populated (`aws neptune-db describe-cluster` or query Gremlin for a vertex count).
- Ensure the docs have `## Relationships` sections in the format `- column_name → target_table.target_column (FK)`.
- Match table names exactly, including store prefix.
- The BFS has a 5-hop limit. Distant tables may not be reachable.
