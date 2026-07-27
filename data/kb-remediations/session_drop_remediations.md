# Session Drop Remediations

## Symptom: Abnormal Session Drops (>200 in 2 minutes)

### Root Causes & Fixes

**CDN or Edge Cache Failure**
If session drops are concentrated in specific regions, check the CDN edge node health in those regions. Failover to backup edge nodes or route traffic through alternate PoPs. Verify SSL certificate validity on edge nodes.

**Memory Leak in Client**
If session drops increase gradually over time and correlate with longer session durations, a client-side memory leak is likely. Identify the leaking component via crash analytics. Push a hotfix or force-restart long-running sessions with a maintenance window.

**Authentication Token Expiry**
If drops happen at regular intervals (e.g., every 60 minutes), the auth token refresh mechanism is failing. Check the token refresh endpoint health. Temporarily extend token TTL while investigating the refresh flow.

**Server Capacity Saturation**
If drops correlate with peak hours and high concurrent user counts, the server fleet is undersized. Scale up the auto-scaling group immediately. Adjust scaling policies to be more aggressive during peak windows.

**Game Update Forced Disconnect**
If drops spike immediately after a deployment, the update mechanism is disconnecting active sessions. Implement graceful session migration that allows in-progress sessions to complete before forcing an update.

## Preventive Measures

Implement session heartbeat monitoring with 30-second intervals. Set up regional health dashboards that alert on session drop rate per region. Maintain warm standby capacity at 120% of expected peak load.
