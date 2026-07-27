# Cost Estimate

This document estimates monthly costs for running this Guidance on AWS. Two scenarios are covered: a POC demo for evaluation and a small studio workload for teams actively using the solution.

## Disclaimer

These are estimates based on published AWS pricing as of May 2026 in the US West (Oregon) Region (`us-west-2`) and assumed usage patterns. Actual costs vary with traffic, data volumes, and model invocations. Use the [AWS Pricing Calculator](https://calculator.aws/) to validate for your own workload.

Amazon Bedrock model invocation is the largest variable cost driver. Per-token rates for the Claude Sonnet 4.6 orchestrator, Claude Haiku 4.5 sub-agents, and Titan Embed Text v2 embeddings are published on the [Amazon Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/). Rates used below assume Global Cross-region Inference (the default for the `us.*` inference profile IDs the solution invokes):

- Claude Sonnet 4.6: $3.00 / 1M input tokens, $15.00 / 1M output tokens.
- Claude Haiku 4.5: $1.00 / 1M input tokens, $5.00 / 1M output tokens.

## POC demo

A small deployment for evaluating the solution. 5 internal users running ad-hoc queries against the built-in seed data. Demo heartbeat enabled so the monitoring dashboard always has events to display.

### Assumptions

| Dimension                     | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| Internal users (MAU)          | 5                                                       |
| AI queries per day            | 50 (≈1,500/month)                                       |
| Demo heartbeat                | Enabled, 1 invocation/minute, ~150 events/batch         |
| Kinesis ingestion volume      | ~3 GB/month (heartbeat only, ~0.5 KB × 6.5M events)     |
| Athena data scanned           | ~5 GB/month (≈100 queries × 50 MB average)              |
| DynamoDB traffic              | ~500K writes, ~2M reads / month                         |
| AgentCore Runtime active time | ~12 hours of compute / month (50 queries × ~30s active) |
| CloudFront data transfer out  | ~20 GB/month (frontend assets for 5 users)              |
| CloudWatch Logs ingestion     | ~10 GB/month                                            |

### Monthly cost breakdown

| Service                                    | Calculation                                                   | Monthly cost |
| ------------------------------------------ | ------------------------------------------------------------- | ------------ |
| Amazon Bedrock — Sonnet 4.6 (orchestrator) | ~4.5M input + ~2.25M output tokens                            | ~$47         |
| Amazon Bedrock — Haiku 4.5 (sub-agents)    | ~6M input + ~3M output tokens                                 | ~$21         |
| Amazon Bedrock — Titan Embed v2            | KB embeddings at small volume                                 | <$1          |
| Bedrock AgentCore Runtime                  | ~12 vCPU-hours × $0.0895 + ~12 GB-hours × $0.00945            | ~$1.20       |
| Bedrock AgentCore Memory (short-term)      | ~1,500 events × $0.25 / 1,000                                 | ~$0.40       |
| Amazon Bedrock KBs (S3 Vectors, 3 KBs)     | <1 GB storage + minimal queries                               | <$1          |
| Amazon Neptune Serverless                  | ~1 NCU avg × 730 hours × $0.1098                              | ~$80         |
| VPC Interface Endpoints                    | 10 endpoints × 2 AZs × 720 hours × $0.01                      | ~$144        |
| Amazon Kinesis Data Streams (On-Demand)    | ~3 GB ingested × $0.08 + ~6 GB retrieved × $0.04 + stream-hr  | ~$30         |
| Amazon Data Firehose                       | ~3 GB × $0.029                                                | <$1          |
| Amazon Athena                              | ~5 GB × $5 / TB                                               | <$1          |
| AWS Glue Data Catalog                      | First 1M objects + 1M requests free                           | $0           |
| Amazon DynamoDB (on-demand)                | 500K writes × $0.625/M + 2M reads × $0.125/M + <25 GB storage | <$2          |
| AWS Lambda                                 | ~300K requests + <100 GB-seconds                              | <$1          |
| Amazon Cognito (Essentials plan)           | 5 MAUs, free tier covers first 10K                            | $0           |
| AWS WAF (regional + CloudFront ACLs)       | 2 ACLs × $5 + 9 rules × $1 + Bot Control × 2 × $10            | ~$39         |
| Amazon CloudFront                          | 20 GB (free tier covers up to 1 TB)                           | $0           |
| Amazon S3 (data, logs, vectors)            | <10 GB storage + minimal requests                             | <$1          |
| Amazon CloudWatch Logs                     | 5 GB free + 5 GB × $0.50                                      | ~$2.50       |
| **Total**                                  |                                                               | **~$370**    |

**Note on model invocation:** Model costs assume ~3K input + 1.5K output tokens per orchestrator call and ~2 sub-agent invocations per query at ~2K input + 1K output each. Actual token usage varies with query complexity, response length, and whether the orchestrator invokes one or multiple sub-agents. The Bedrock pricing page and the AWS Pricing Calculator can project more precise figures for your own workload.

## Small studio

A team actively using the solution for live operations. 15 internal users (analysts, producers, PMs) running queries throughout the day. Demo heartbeat disabled; real game events flowing through Kinesis at a moderate rate.

### Assumptions

| Dimension                     | Value                                                        |
| ----------------------------- | ------------------------------------------------------------ |
| Internal users (MAU)          | 15                                                           |
| AI queries per day            | 500 (≈15,000/month)                                          |
| Kinesis ingestion volume      | ~1,000 events/sec avg × 0.5 KB × 86,400 × 30 = ~1.3 TB/month |
| Athena data scanned           | ~100 GB/month (agent-generated SQL + ad-hoc)                 |
| DynamoDB traffic              | ~10M writes, ~20M reads / month                              |
| AgentCore Runtime active time | ~125 hours of compute / month                                |
| CloudFront data transfer out  | ~100 GB/month                                                |
| CloudWatch Logs ingestion     | ~50 GB/month                                                 |

### Monthly cost breakdown

| Service                                      | Calculation                                                      | Monthly cost |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------ |
| Amazon Bedrock — Sonnet 4.6 (orchestrator)   | ~45M input + ~22.5M output tokens                                | ~$472        |
| Amazon Bedrock — Haiku 4.5 (sub-agents)      | ~60M input + ~30M output tokens                                  | ~$210        |
| Amazon Bedrock — Titan Embed v2              | KB embeddings and sync jobs                                      | ~$5          |
| Bedrock AgentCore Runtime                    | ~125 vCPU-hours × $0.0895 + ~125 GB-hours × $0.00945             | ~$12         |
| Bedrock AgentCore Memory (short-term)        | ~15,000 events × $0.25 / 1,000                                   | ~$4          |
| Amazon Bedrock KBs (S3 Vectors, 3 KBs)       | ~2 GB storage + ~100K queries                                    | ~$2          |
| Amazon Neptune Serverless                    | ~2 NCUs avg × 730 × $0.1098                                      | ~$160        |
| VPC Interface Endpoints                      | 20 ENIs × 720 hours × $0.01 + minimal data processed             | ~$144        |
| Amazon Kinesis Data Streams (On-Demand)      | ~1.3 TB ingested × $0.08 + ~2.6 TB retrieved × $0.04 + stream-hr | ~$237        |
| Amazon Data Firehose                         | ~1.3 TB × $0.029                                                 | ~$38         |
| Amazon Athena                                | ~100 GB × $5 / TB                                                | ~$0.50       |
| AWS Glue Data Catalog                        | First 1M objects + 1M requests free                              | $0           |
| Amazon DynamoDB (on-demand)                  | 10M writes × $0.625/M + 20M reads × $0.125/M + <25 GB storage    | ~$9          |
| AWS Lambda                                   | ~2M requests + moderate GB-seconds                               | ~$10         |
| Amazon Cognito (Essentials plan)             | 15 MAUs, free tier covers first 10K                              | $0           |
| AWS WAF (regional + CloudFront ACLs)         | 2 ACLs × $5 + 9 rules × $1 + Bot Control × 2 × $10 + requests    | ~$42         |
| Amazon CloudFront                            | 100 GB (free tier covers up to 1 TB)                             | $0           |
| Amazon S3 (data, logs, vectors, game events) | ~50 GB storage (game events archive grows over time)             | ~$2          |
| Amazon CloudWatch Logs                       | 5 GB free + 45 GB × $0.50                                        | ~$22.50      |
| **Total**                                    |                                                                  | **~$1,370**  |

**Note on model invocation:** Model invocation dominates the bill at this scale and scales linearly with query volume. The estimate above assumes the same per-query token pattern as the POC scenario; complex multi-turn conversations or longer responses push it higher.

## What drives cost at larger scale

- **Model invocation** scales linearly with query volume and dominates the bill at small-studio scale and above.
- **Athena scanning** grows with the size of the `game_events` archive (Firehose writes all raw events). Convert to Parquet + partition by day to cut scan volume 5-10×.
- **Kinesis throughput** at $0.08/GB ingested + $0.04/GB retrieved (× two consumers) adds up quickly. On-Demand Advantage mode can halve this once you reach 10 MB/s sustained throughput.
- **Neptune NCU usage** stays low unless you run heavy Gremlin workloads; the schema graph is small. The cluster bills continuously at its minimum capacity, including while idle.
- **VPC Interface Endpoints** are a fixed floor cost (~$144/mo). They are required for the AgentCore runtime to reach Bedrock, Athena, and other services from the private VPC.

## References

- [AWS Pricing Calculator](https://calculator.aws/)
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- [Amazon Bedrock AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)
- [Amazon Neptune pricing](https://aws.amazon.com/neptune/pricing/)
- [Amazon Kinesis Data Streams pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)
- [Amazon S3 pricing (S3 Vectors section)](https://aws.amazon.com/s3/pricing/)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- [Amazon DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/)
- [Amazon Athena pricing](https://aws.amazon.com/athena/pricing/)
- [AWS WAF pricing](https://aws.amazon.com/waf/pricing/)
- [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)
- [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)
