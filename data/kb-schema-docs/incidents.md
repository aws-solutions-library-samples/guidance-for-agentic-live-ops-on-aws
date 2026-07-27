# Table: liveops.incidents

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Operational incident log tracking game outages, bugs, and service disruptions. Records severity, affected player count, resolution status, and any compensation issued. Used for operational health monitoring and post-incident analysis.

## Columns

| Column              | Type    | Nullable | Description                                                                                        | Business Term       |
| ------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| incident_id         | string  | No       | Unique incident identifier                                                                         | Incident ID         |
| incident_type       | string  | No       | Category of incident (e.g. server_outage, battle_error, purchase_failure, session_drop, api_abuse) | Incident Type       |
| severity            | string  | No       | Severity level: critical, high, medium, low                                                        | Severity            |
| start_time          | string  | No       | ISO 8601 timestamp when incident began                                                             | Start Time          |
| resolution_time     | string  | Yes      | ISO 8601 timestamp when incident was resolved (null if ongoing)                                    | Resolution Time     |
| affected_players    | int     | Yes      | Estimated number of players impacted                                                               | Affected Players    |
| description         | string  | Yes      | Human-readable description of the incident                                                         | Description         |
| resolution_status   | string  | No       | Current status: resolved, investigating, mitigated                                                 | Resolution Status   |
| compensation_given  | boolean | Yes      | Whether compensation was issued to affected players                                                | Compensation Given  |
| compensation_amount | double  | Yes      | Value of compensation in USD equivalent                                                            | Compensation Amount |

## Relationships

No foreign keys detected.

## Glossary

- **battle_error**: Errors occurring during PvP or PvE combat
- **session_drop**: Unexpected disconnections during gameplay
- **purchase_failure**: Failed in-app purchase transactions
- **api_abuse**: Detected exploitation or abnormal API usage patterns
- **server_outage**: Complete or partial service unavailability

## Notes

Critical table for the real-time monitoring pipeline. Incident types align with the monitored event types in the Kinesis anomaly detection system (battle_error, session_drop, purchase_failure, churn_signal, api_abuse). Resolution time minus start time gives MTTR (Mean Time To Resolution).
