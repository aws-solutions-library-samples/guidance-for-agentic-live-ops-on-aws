# Agent Response Formats

This document describes the structured response formats agents can embed in their text output so the frontend renders them as interactive widgets. Use it when authoring sub-agent prompts in `data/agent-configs/*/prompt.md`.

## Table Data Format

Agents can return tabular data that renders as an interactive, sortable table with CSV export.

### Format Specification

```
TABLE_DATA:
Title: [Table Title]
Headers: [Column1], [Column2], [Column3], ...
Row: [Value1], [Value2], [Value3], ...
Row: [Value1], [Value2], [Value3], ...
END_TABLE_DATA
```

### Example

```
TABLE_DATA:
Title: Player Performance Summary
Headers: Player Name, Level, Score, Achievements, Last Active
Row: John Doe, 85, 12450, 23, 2024-01-15
Row: Jane Smith, 92, 15670, 31, 2024-01-16
Row: Mike Johnson, 78, 9830, 18, 2024-01-14
Row: Sarah Wilson, 95, 18920, 42, 2024-01-17
END_TABLE_DATA
```

### Additional Examples

Player Targeting Agent:

```
TABLE_DATA:
Title: Character Demand Predictions
Headers: Character Name, Predicted Demand, Current Ownership %, Revenue Potential
Row: Shadow Assassin, High, 23%, $45,000
Row: Fire Mage, Medium, 67%, $28,000
Row: Ice Guardian, Low, 89%, $12,000
END_TABLE_DATA
```

Player Segmentation Agent:

```
TABLE_DATA:
Title: Player Segments Analysis
Headers: Segment Name, Player Count, Avg Spend, Retention Rate, Engagement Score
Row: High Spenders, 2450, $89.50, 92%, 8.7
Row: Casual Players, 45600, $12.30, 67%, 5.2
Row: Competitive Players, 8900, $34.70, 85%, 9.1
END_TABLE_DATA
```

Acquisition Optimization Agent:

```
TABLE_DATA:
Title: Campaign Performance Metrics
Headers: Campaign Name, CPI, ROAS, LTV, Retention D7
Row: Facebook Gaming, $2.45, 3.2x, $78.50, 45%
Row: Google UAC, $3.10, 2.8x, $65.20, 38%
Row: TikTok Ads, $1.95, 4.1x, $82.30, 52%
END_TABLE_DATA
```

### Rules

1. **Title**: Optional. Describes what the table contains.
2. **Headers**: Required. Comma-separated list of column headers.
3. **Row**: At least one row is required. Rows should have the same number of values as `Headers`; extra or missing cells are tolerated but produce a misaligned rendering.
4. **Separators**: Row values can be separated by commas, pipes (`|`), tabs, or two or more spaces. The parser picks the right separator automatically.
5. **Multiple tables**: You can include multiple `TABLE_DATA` blocks in a single response.

### Frontend Features

When agents return table data:

- Tables are rendered using Cloudscape Design components.
- Users can sort columns.
- Tables are responsive and have sticky headers.
- A CSV export button is added automatically.

## Chart Data Format

Charts render with Chart.js.

```
CHART_DATA:
Type: bar
Title: Character Acquisition Trends by Player Level
Labels: Level 70-75, Level 76-80, Level 81-85, Level 86-90
Data: 45.2, 32.8, 18.7, 3.3
END_CHART_DATA
```

### Rules

1. **Type**: Optional. One of `bar`, `line`, `pie`, or `doughnut`. Defaults to `bar` if missing or invalid.
2. **Title**: Required.
3. **Labels** and **Data**: Required. Comma-separated lists with the same length.
4. **Multiple charts**: You can include multiple `CHART_DATA` blocks in a single response.

## Combining Tables and Charts

You can include both tables and charts in the same response. The frontend pulls the structured blocks out as widgets and renders surrounding text as Markdown.

```
Here is the player performance analysis you requested:

TABLE_DATA:
Title: Top Players This Week
Headers: Player, Score, Level, Time Played
Row: Alice, 15670, 92, 4.5h
Row: Bob, 12450, 85, 3.2h
Row: Carol, 18920, 95, 5.1h
END_TABLE_DATA

And the score distribution:

CHART_DATA:
Type: bar
Title: Score Distribution
Labels: 0-5000, 5001-10000, 10001-15000, 15001+
Data: 12, 28, 35, 25
END_CHART_DATA
```

## When to Use Tables vs Charts

Use tables for:

- Player lists and rankings
- Detailed performance metrics
- Campaign breakdowns
- Comparative data with multiple attributes
- Raw data that users might want to export
- Data with mixed types (text, numbers, dates)

Use charts for:

- Trends over time
- Distribution patterns
- Simple comparisons (top 5, percentages)
- Visual impact and quick insights

## Best Practices

1. **Use descriptive titles** that clearly explain what the data represents.
2. **Keep column headers concise** but descriptive.
3. **Format data consistently** within each column (dates, numbers, currency).
4. **Use ISO 8601 dates** (`2024-01-15`) so the table sorter treats them as dates.
5. **Combine with text** to provide analysis and insights around the structured blocks.
6. **Use appropriate data types**: numbers for numeric data, dates in ISO format.
7. **Consider table size**: the `query_data` Athena tool caps results at 200 rows, which is also a reasonable upper bound for readability.
8. **Prioritize user value**: use tables when users need detailed, exportable data; use charts for quick visual insight.

## Error Handling

- A table block without `Headers` or without any `Row` is dropped silently.
- A chart block missing `Title`, `Labels`, or `Data`, or with mismatched `Labels` and `Data` lengths, is dropped and a warning is logged to the browser console.
- Surrounding text still renders normally even when a block is dropped.
