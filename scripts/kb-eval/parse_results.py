# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import os
import sys
import tempfile

f = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.path.join(tempfile.gettempdir(), "kb-eval-results-v2.jsonl")
)
metrics, count, refusals, per_q = {}, 0, 0, []

for line in open(f, encoding="utf-8"):
    r = json.loads(line)
    count += 1
    t = r["conversationTurns"][0]
    p = t["inputRecord"]["prompt"]["content"][0]["text"][:55]
    o = t.get("output", {}).get("text", "")
    if "unable to assist" in o.lower():
        refusals += 1
    qs = {}
    for res in t.get("results", []):
        n = res["metricName"].replace("Builtin.", "")
        v = res.get("result")
        if v is not None:
            metrics.setdefault(n, []).append(v)
            qs[n] = v
    per_q.append((count, p, qs.get("Correctness", "-")))

print(f"Questions: {count} | Refusals: {refusals}\n")
for n in [
    "Correctness",
    "Completeness",
    "Faithfulness",
    "Helpfulness",
    "LogicalCoherence",
    "Harmfulness",
    "Refusal",
]:
    s = metrics.get(n, [])
    if s:
        print(f"  {n:18s} {sum(s) / len(s):.2f}")
print()
for i, p, c in per_q:
    print(f"  Q{i:2d} [{c if isinstance(c, str) else f'{c:.1f}'}] {p}")
