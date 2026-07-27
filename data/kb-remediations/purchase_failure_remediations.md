# Purchase Failure Remediations

## Symptom: Purchase Failures Exceeding 50 in 2 minutes

### Root Causes & Fixes

**Payment Gateway Timeout**
If failures span multiple payment methods, the payment gateway is likely experiencing latency or downtime. Check the payment provider status page. Enable the backup payment gateway. Queue failed transactions for automatic retry with exponential backoff.

**Platform Store API Degradation**
If failures are isolated to a single platform (iOS App Store or Google Play), the platform's purchase validation API is degraded. Enable offline receipt validation with deferred server-side verification. Credit players immediately and reconcile later.

**Price Configuration Mismatch**
If failures correlate with specific items or bundles, a recent price change may not have propagated to all regions. Verify price tier consistency across all storefronts. Roll back the price change if discrepancies are found.

**Inventory Service Failure**
If failures occur after payment succeeds but item delivery fails, the inventory service is the bottleneck. Check inventory service health and database connectivity. Implement a compensation queue that retries item delivery and notifies players.

**Fraud Detection False Positives**
If failures spike after a fraud rule update, the new rules may be too aggressive. Review the fraud detection thresholds. Temporarily relax the rules while analyzing false positive rates. Whitelist known-good player segments.

## Preventive Measures

Implement dual-path payment processing with automatic failover. Monitor payment success rates per platform, region, and payment method independently. Maintain a 99.9% payment success rate SLA with automated alerting at 99.5%.
