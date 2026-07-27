# API Abuse Remediations

## Symptom: API Abuse Detection (>25 events in 2 minutes)

### Root Causes & Fixes

**Credential Stuffing Attack**
If abuse events show high-volume login attempts from diverse IPs with low success rates, this is credential stuffing. Enable CAPTCHA on the login endpoint. Activate IP-based rate limiting (max 5 failed logins per IP per minute). Notify affected players to change passwords.

**Bot Farming**
If abuse events show repetitive gameplay patterns (identical action sequences, inhuman reaction times), automated bots are farming resources. Deploy the anti-bot detection model. Temporarily gate suspicious accounts behind a verification challenge. Ban confirmed bot accounts and claw back farmed resources.

**API Scraping**
If abuse events target read-only endpoints (leaderboards, player profiles, item catalogs), someone is scraping game data. Implement API key rotation. Add request signing with short-lived tokens. Rate limit by user agent and add honeypot endpoints.

**Exploit Abuse**
If abuse events correlate with specific game actions that yield abnormal rewards (e.g., completing a quest 100x in a minute), a game exploit is being abused. Disable the affected feature immediately. Patch the exploit. Roll back illegitimate gains for affected accounts.

**DDoS Attack**
If abuse events show massive request volumes from a small number of IPs targeting specific endpoints, this is a DDoS. Activate WAF rate-based rules. Enable AWS Shield Advanced protections. Geo-block the attacking IP ranges if they're outside your player base.

## Preventive Measures

Implement progressive rate limiting that tightens automatically under attack. Deploy WAF rules that detect and block common attack patterns. Maintain an IP reputation database. Run regular penetration tests against game APIs.
