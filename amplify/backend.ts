import { defineBackend } from "@aws-amplify/backend";
import { Duration, Stack } from "aws-cdk-lib";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Role, ServicePrincipal, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { Alarm, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { dailyFetch } from "./functions/daily-fetch/resource";

// ─────────────────────────────────────────────────────────────────────────────
// Backend definition
// ─────────────────────────────────────────────────────────────────────────────

const backend = defineBackend({ auth, data, dailyFetch });

// ─────────────────────────────────────────────────────────────────────────────
// EventBridge Scheduler
//
// We use EventBridge Scheduler (not EventBridge Rules) so we can configure:
//   - A flexible time window (run any time within 60 min of 02:00 UTC)
//   - A built-in retry policy (2 retries, 2-hour event age window)
//   - A dead-letter queue for permanently failed invocations
//
// The Lambda re-throws on unhandled errors so EventBridge Scheduler can
// observe the failure and enqueue the retry automatically.
// ─────────────────────────────────────────────────────────────────────────────

const lambdaFn = backend.dailyFetch.resources.lambda;
const graphqlApi = backend.data.resources.graphqlApi;

// Inject AppSync endpoint + API key so the Lambda can call AppSync directly
// via API key auth (no Amplify framework / modelIntrospection needed at runtime).
lambdaFn.addEnvironment("APPSYNC_ENDPOINT", graphqlApi.graphqlUrl);
lambdaFn.addEnvironment("APPSYNC_API_KEY", graphqlApi.apiKey ?? "");

const stack = Stack.of(lambdaFn);

// 1. Dead-letter queue — receives events that exhausted all retry attempts
const dlq = new Queue(stack, "DailyFetchDLQ", {
  queueName: "daily-fetch-dlq",
  // Keep failed events for 14 days (the maximum) so ops can inspect and replay
  retentionPeriod: Duration.days(14),
  encryption: QueueEncryption.SQS_MANAGED,
});

// 2. IAM role that EventBridge Scheduler assumes to invoke the Lambda
const schedulerRole = new Role(stack, "DailyFetchSchedulerRole", {
  roleName: "daily-fetch-scheduler-role",
  assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
  description: "Allows EventBridge Scheduler to invoke the daily-fetch Lambda",
});

schedulerRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["lambda:InvokeFunction"],
    // Allow invocation of the function and any published version/alias
    resources: [lambdaFn.functionArn, `${lambdaFn.functionArn}:*`],
  })
);

// Also allow scheduler to send to the DLQ on failure
schedulerRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["sqs:SendMessage"],
    resources: [dlq.queueArn],
  })
);

// 3. EventBridge Scheduler schedule
//
// cron(0 2 * * ? *) = 02:00 UTC every day
// flexibleTimeWindow FLEXIBLE + 60 min = Lambda runs some time between 02:00–03:00 UTC.
//   This smooths out the load spike at exactly midnight and avoids cold-start
//   collisions if other schedules fire at the same second.
//
// retryPolicy:
//   - maximumRetryAttempts: 2 — up to 2 additional attempts after the first failure
//   - maximumEventAgeInSeconds: 7200 — stop retrying after 2 hours regardless
//
// deadLetterConfig: any event that exhausts retries lands in the DLQ.

new CfnSchedule(stack, "DailyFetchSchedule", {
  name: "daily-fetch-schedule",
  description: "Daily ASO customer data ingestion — 02:00 UTC with 60-min flexible window",
  // AWS EventBridge cron format: cron(minutes hours day-of-month month day-of-week year)
  scheduleExpression: "cron(0 2 * * ? *)",
  scheduleExpressionTimezone: "UTC",
  state: "ENABLED",
  flexibleTimeWindow: {
    mode: "FLEXIBLE",
    maximumWindowInMinutes: 60,
  },
  target: {
    arn: lambdaFn.functionArn,
    roleArn: schedulerRole.roleArn,
    retryPolicy: {
      maximumRetryAttempts: 2,
      maximumEventAgeInSeconds: 7_200, // 2 hours
    },
    deadLetterConfig: {
      arn: dlq.queueArn,
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CloudWatch Alarm — alert when messages land in the DLQ
//
// A message in the DLQ means the Lambda failed on all 3 attempts (1 + 2 retries).
// Wire this to an SNS topic or PagerDuty in your ops setup.
// ─────────────────────────────────────────────────────────────────────────────

new Alarm(stack, "DailyFetchDLQAlarm", {
  alarmName: "daily-fetch-dlq-messages",
  alarmDescription:
    "daily-fetch Lambda has exhausted all retry attempts — check CloudWatch Logs",
  metric: dlq.metricNumberOfMessagesSent(),
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});
