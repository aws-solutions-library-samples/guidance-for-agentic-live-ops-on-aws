# Table: liveops.tutorial_steps

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Dimension table describing each step of the branching new-player tutorial (FTUE). One row per step. Use it to order funnels and to label steps by module.

## Columns

| Column          | Type   | Nullable | Description                                                      | Business Term    |
| --------------- | ------ | -------- | ---------------------------------------------------------------- | ---------------- |
| step_id         | string | No       | Unique step key (e.g. first_battle, craft_item)                  | Tutorial Step    |
| step_name       | string | No       | Display name of the step                                         | Step Name        |
| module          | string | No       | Tutorial module: core, combat, crafting, social                  | Tutorial Module  |
| nominal_order   | int    | No       | Designed order of the step (1-16), used to order funnels         | Step Order       |
| is_optional     | int    | No       | 1 if the step belongs to an optional module (crafting or social) | Optional Step    |
| is_branch_entry | int    | No       | 1 for the first step of a hub module                             | Branch Entry     |
| description     | string | Yes      | What the step teaches                                            | Step Description |

## Relationships

- step_id is equivalent to tutorial_events.step_id

## Glossary

- **FTUE**: First-time user experience, the onboarding tutorial new players go through
- **Hub**: The point after first_battle where players choose the order of the combat, crafting and social modules
- **Module**: A group of tutorial steps that teach one feature

## Notes

The tutorial is branching: after the core start, players do the three hub modules in any order, and can skip the optional crafting and social modules. Join to tutorial_events on step_id and order by nominal_order for funnel views.
