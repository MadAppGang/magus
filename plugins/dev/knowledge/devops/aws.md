---
description: aws CLI reference (ECS, ECR, Lambda, S3, CloudFront), CDK patterns, and a worked ECS Fargate deployment. Read when the target platform is AWS — `dev:devops` routes here by path.
---

# AWS

Reference for `dev:devops`. Read when the workload targets AWS. Every command is a proposal for the caller to run; the agent that reads this file generates, it does not apply. `aws sts get-caller-identity` is the one read-only check the agent may run itself.

## aws CLI

```bash
# Identity (read-only; safe to run)
aws sts get-caller-identity

# ECS
aws ecs create-cluster --cluster-name {name}
aws ecs create-service --cluster {cluster} --service-name {name} \
  --task-definition {task}:1 --desired-count 2 --launch-type FARGATE
aws ecs update-service --cluster {cluster} --service {name} \
  --task-definition {task}:2 --force-new-deployment

# ECR
aws ecr get-login-password | docker login --username AWS --password-stdin {account}.dkr.ecr.{region}.amazonaws.com
aws ecr create-repository --repository-name {name}
docker push {account}.dkr.ecr.{region}.amazonaws.com/{repo}:{tag}

# Lambda
aws lambda create-function --function-name {name} \
  --runtime nodejs20.x --handler index.handler \
  --role {role-arn} --zip-file fileb://function.zip
aws lambda update-function-code --function-name {name} \
  --zip-file fileb://function.zip

# S3
aws s3 mb s3://{bucket-name}
aws s3 sync ./dist s3://{bucket-name} --delete
aws s3 website s3://{bucket-name} --index-document index.html

# CloudFront
aws cloudfront create-distribution --distribution-config file://config.json
aws cloudfront create-invalidation --distribution-id {id} --paths "/*"
```

## CDK patterns

```typescript
// ECS Fargate service behind an ALB
const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
  cluster,
  taskImageOptions: { image: ecs.ContainerImage.fromRegistry('image') },
  desiredCount: 2,
});

// Lambda behind API Gateway
const fn = new lambda.Function(this, 'Handler', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
});
const api = new apigateway.RestApi(this, 'Api');
api.root.addMethod('GET', new apigateway.LambdaIntegration(fn));
```

## Worked example: Node.js API on ECS Fargate

Request: "Deploy my Node.js API to AWS ECS with Fargate."

Analyse: a Dockerfile exists, no AWS resources exist yet, the workload is a long-running HTTP API.

Research: search "AWS ECS Fargate Node.js best practices" for the current year and "AWS ECR push docker image CLI". Expected pattern: Application Load Balancer, container health checks, logs to CloudWatch.

Design: ECS versus Lambda versus EKS. ECS Fargate fits a long-running API with no server management. Architecture: ALB → ECS service → 2 tasks → ECR image.

CLI:

```bash
# 1. Create the ECR repository
aws ecr create-repository --repository-name my-api

# 2. Build and push the image
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin {account}.dkr.ecr.us-east-1.amazonaws.com
docker build -t my-api .
docker tag my-api:latest {account}.dkr.ecr.us-east-1.amazonaws.com/my-api:latest
docker push {account}.dkr.ecr.us-east-1.amazonaws.com/my-api:latest

# 3. Create the ECS cluster
aws ecs create-cluster --cluster-name my-api-cluster

# 4. Register the task definition (write task-definition.json first)
aws ecs register-task-definition --cli-input-json file://task-definition.json

# 5. Create the service behind the ALB
aws ecs create-service \
  --cluster my-api-cluster \
  --service-name my-api-service \
  --task-definition my-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=my-api,containerPort=3000"
```

IaC alternative (CDK):

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';

const cluster = new ecs.Cluster(this, 'Cluster');

new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MyApi', {
  cluster,
  taskImageOptions: {
    image: ecs.ContainerImage.fromAsset('./'),
    containerPort: 3000,
  },
  desiredCount: 2,
  publicLoadBalancer: true,
});
```

Cost estimate:

| Component | Configuration | Monthly cost |
|-----------|---------------|--------------|
| ECS Fargate | 2 tasks, 0.5 vCPU, 1 GB | ~$30 |
| ALB | 1 load balancer | ~$20 |
| ECR | 1 GB storage | ~$0.10 |
| **Total** | | **~$50/month** |

The account, region, subnets and names above are illustrative. If the prompt did not establish the target account, region and environment, the verdict is BLOCKED naming them; never substitute these placeholders.
