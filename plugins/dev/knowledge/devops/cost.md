---
description: How `dev:devops` estimates monthly cost — compute, storage, network, managed services — with calculator links and a worked AWS optimisation pass. Read when a budget is named or the caller asks what a proposal costs.
---

# Cost estimation

Reference for `dev:devops`. Read when a budget or scale limit is given, or when the proposal must carry a cost table. Estimates are order-of-magnitude; the calculators below give the number the caller signs off on.

## Estimation approach

1. **Compute**: instance type × hours × instance count. Spot or preemptible capacity saves 60–90% for interruptible work. Factor the auto-scaling range, not the minimum.
2. **Storage**: GB stored × storage-class rate. Lifecycle policies and access frequency decide the class.
3. **Network**: data transfer out (ingress is usually free), cross-region and cross-AZ transfer, load-balancer hours.
4. **Managed services**: databases bill instance + storage + IOPS; managed Kubernetes bills a control-plane fee; serverless bills invocations + duration.

## Calculators

- AWS: https://calculator.aws/
- GCP: https://cloud.google.com/products/calculator
- Azure: https://azure.microsoft.com/pricing/calculator/

## Optimisation levers, in the order they usually pay

1. Reserved capacity or savings plans for steady 24/7 load.
2. Spot or preemptible instances for batch and non-critical workloads.
3. Right-sizing from utilisation data, never from the instance name.
4. Auto-scaling ranges with a real minimum, and scheduled shutdown for dev environments.
5. Storage tiering and lifecycle rules.
6. CDN price class restricted to the regions that actually serve traffic.

## Worked example: AWS cost optimisation

Request: "Estimate and optimize costs for my AWS infrastructure."

Research: search "AWS cost optimization best practices" for the current year and "AWS reserved instances vs savings plans". Expected levers: Compute Savings Plans, right-sizing, auto-shutdown.

Current state (illustrative):

- 3 × t3.large EC2, 24/7: $0.0832/hr × 720 h × 3 = $180/month
- 1 × RDS db.t3.medium: $0.034/hr × 720 h = $25/month
- S3, 100 GB: $2.30/month
- CloudFront, 500 GB transfer: $42.50/month
- **Current total: ~$250/month**

Recommendations:

1. Compute Savings Plan, 3-year: 66% off EC2 → $60/month (saves $120)
2. Reserved RDS, 1-year: 40% off → $15/month (saves $10)
3. S3 Intelligent-Tiering: 20% off → $1.84/month
4. CloudFront Price Class 100 (NA/EU only): 20% off → $34/month

**Optimised total: ~$111/month (56% saving)**

CLI:

```bash
# 1. Current spend (read-only)
aws ce get-cost-and-usage \
  --time-period Start={first-day-of-month},End={last-day-of-month} \
  --granularity MONTHLY \
  --metrics "UnblendedCost"

# 2. Right-sizing recommendations (read-only)
aws ce get-rightsizing-recommendation \
  --service EC2 \
  --configuration "RecommendationTarget=SAME_INSTANCE_FAMILY,BenefitsConsidered=true"

# 3. Enable S3 Intelligent-Tiering
aws s3api put-bucket-lifecycle-configuration \
  --bucket my-bucket \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "IntelligentTiering",
      "Status": "Enabled",
      "Filter": {},
      "Transitions": [{
        "Days": 0,
        "StorageClass": "INTELLIGENT_TIERING"
      }]
    }]
  }'

# 4. Savings Plans purchase recommendation (read-only)
aws savingsplans get-savings-plans-purchase-recommendation \
  --savings-plans-type "COMPUTE_SP" \
  --term-in-years "THREE_YEARS" \
  --payment-option "NO_UPFRONT"
```

The prices and instance counts above are illustrative and date quickly; recompute from the live calculator. If the prompt did not establish the target account and environment, the verdict is BLOCKED naming them.
