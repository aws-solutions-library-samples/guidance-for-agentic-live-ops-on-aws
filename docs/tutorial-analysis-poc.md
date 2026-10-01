# Tutorial Analysis POC

Adds analysis of a branching new-player tutorial (FTUE) to Agentic Live Ops using synthetic data. Everything is config and data; the agent runtime code is unchanged.

## What was added

| Change                                                                            | File(s)                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Synthetic data generator (stdlib only, seeded)                                    | `scripts/generate-tutorial-data.py`                                           |
| Seed CSVs (generated)                                                             | `data/athena-seed-data/kb_tutorial_{steps,events,players}.csv`                |
| KB summary (generated)                                                            | `data/kb-insights/summaries/tutorial_progression_analysis.md`                 |
| Glue tables `tutorial_steps`, `tutorial_events`, `tutorial_players` + model entry | `cdk.json`                                                                    |
| CSV → table mapping                                                               | `scripts/hydrate-athena.py`                                                   |
| Tutorial Analysis Agent                                                           | `data/agent-configs/tutorial_analysis/`                                       |
| Schema docs for the schema KB and Neptune graph                                   | `data/kb-schema-docs/tutorial_*.md`                                           |
| Demo questions (Tutorial Analysis category)                                       | `lib/stacks/frontend/app/src/components/question-selector/question-parser.ts` |
| Agents modal entry                                                                | `lib/stacks/frontend/app/src/components/Chat/agents-modal.tsx`                |

## Data model

The tutorial has a core start (`intro_cutscene` → `movement_basics` → `first_battle`), a hub where players do the combat, crafting (optional) and social (optional) modules in any order, and a core end (`equip_gear` → … → `boss_battle` → … → `tutorial_complete`). `first_battle` and `boss_battle` can be failed and retried. Players can quit at any step.

Planted patterns the agent should find:

1. `craft_item` is the biggest drop-off step, mostly on tutorial version v1.
2. Players who choose crafting first complete about 10 points less often than those who choose combat or social first.
3. Skipping crafting raises completion but lowers D7 retention among completers by about 40%.
4. Joining a guild in the tutorial raises D7 retention.
5. Failing `first_battle` 2+ times lowers D1; `boss_battle` fail loops drive quits.
6. v2 (installs from 2025-09-25, shorter crafting step) cuts the `craft_item` drop-off roughly in half.

The exact numbers are in the generated KB summary and printed by the generator. Use them to check the agent's answers.

## Deploy

```bash
python scripts/generate-tutorial-data.py      # writes CSVs + KB summary, prints the expected findings
npm run cdk -- deploy "dev/*"                 # Docker must be running
npm run hydrate-athena -- --stage dev         # uploads all seed CSVs, including the new ones
```

After deploying, two caches need attention:

- **Agent config cache.** The Agent Factory only rescans S3 for agents when its DynamoDB agent config table is empty. Delete the items in that table (table name contains `agentConfigTable`, in the `dev-liveops-backend` stack) so the new agent is picked up on the next request. The items are recreated from S3 automatically.
- **Schema KB / Neptune graph and insights KB.** These are refreshed by daily jobs. Until then, the agent relies on the schema in its own prompt, which is enough. To refresh sooner, invoke the schema hydration Lambda and the KB sync Lambda from the console.

## Demo script

1. Open the agents modal and show the Tutorial Analysis Agent.
2. Ask: "Show me the tutorial funnel: how many players reach each step and where do they drop off?"
3. Ask: "Build the step-to-step transition graph for the tutorial and highlight loops and dead ends"
4. Ask: "Which tutorial branch leads to better D7 retention?"
5. Ask: "Do players who skip the optional crafting or social modules retain worse at D7?"
6. Open the sources panel to show the SQL that ran.

## Rollback

```bash
git checkout main
npm run cdk -- deploy "dev/*"
```

This removes the Glue tables, the KB summary, the schema docs (from the docs bucket), the demo questions and the modal entry. Clean up by hand:

- `s3://<agent config bucket>/agents/tutorial_analysis/` (the config deployment uses `prune: false`), then clear the agent config DynamoDB table again.
- `s3://<data source bucket>/athena/tutorial_*/` (uploaded by `hydrate-athena`, harmless if left).
- Tutorial vertices in Neptune remain until the graph is rebuilt; schema search may still mention the tables.
