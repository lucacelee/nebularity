import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class EcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, 'Nebularity', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
    });
  }
}

export interface EcsStackProps extends cdk.StackProps {
  repository: ecr.IRepository;
  certificateArn?: string;
  alertEmail?: string;
}

export class EcsStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const imageTag = new cdk.CfnParameter(this, 'ImageTag', {
      type: 'String',
      default: 'latest',
      minLength: 1,
      description: 'Tag of the x86-64 application image in the ECR repository.',
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'Public', subnetType: ec2.SubnetType.PUBLIC }],
    });

    const logGroup = new logs.LogGroup(this, 'ApplicationLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn)
      : undefined;

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'AstroService', {
      vpc,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      certificate,
      redirectHTTP: certificate !== undefined,
      minHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:4321/api/health/live || exit 1'],
        timeout: cdk.Duration.seconds(3),
        startPeriod: cdk.Duration.seconds(30),
      },
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(props.repository, imageTag.valueAsString),
        containerPort: 4321,
        environment: { NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '4321' },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'astro', logGroup }),
      },
    });

    service.targetGroup.configureHealthCheck({
      path: '/api/health/ready',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Send notifications through Amazon SNS.
    const alertTopic = new sns.Topic(this, 'ApplicationAlertTopic', {
      displayName: 'Nebularity application alerts',
    });

    if (props.alertEmail?.trim()) {
      alertTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail.trim()),
      );
    }

    // Attach an SNS action to every alarm.
    const addEmailAlarm = (
      id: string,
      description: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      evaluationPeriods: number,
      comparisonOperator: cloudwatch.ComparisonOperator,
      datapointsToAlarm: number,
    ): cloudwatch.Alarm => {
      const alarm = new cloudwatch.Alarm(this, id, {
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods,
        datapointsToAlarm,
        comparisonOperator,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      alarm.addAlarmAction(
        new cloudwatchActions.SnsAction(alertTopic),
      );

      return alarm;
    }

    // 1. An unhealthy target persists for two minutes.
    addEmailAlarm(
      'UnhealthyTargetAlarm',
      'An application target has remained unhealthy.',
      service.targetGroup.metrics.unhealthyHostCount({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      1,
      2,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      2,
    );

    // 2. Five or more HTTP 5xx responses from the application in five minutes.
    addEmailAlarm(
      'ApplicationServerErrorsAlarm',
      'The application has returned repeated HTTP 5xx responses.',
      service.targetGroup.metrics.httpCodeTarget(
        elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
        {
          period: cdk.Duration.minutes(5),
          statistic: 'Sum',
        },
      ),
      5,
      1,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      1,
    );

    // 3. Five or more HTTP 5xx responses generated by the load balancer.
    addEmailAlarm(
      'LoadBalancerServerErrorsAlarm',
      'The load balancer has returned repeated HTTP 5xx responses.',
      service.loadBalancer.metrics.httpCodeElb(
        elbv2.HttpCodeElb.ELB_5XX_COUNT,
        {
          period: cdk.Duration.minutes(5),
          statistic: 'Sum',
        },
      ),
      5,
      1,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      1,
    );

    // 4. CPU utilisation stays above 85% for 15 minutes.
    addEmailAlarm(
      'HighCpuAlarm',
      'Average ECS service CPU utilisation is too high.',
      service.service.metricCpuUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      85,
      3,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      3,
    );

    // 5. Memory utilisation stays above 85% for 15 minutes.
    addEmailAlarm(
      'HighMemoryAlarm',
      'Average ECS service memory utilisation is too high.',
      service.service.metricMemoryUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      85,
      3,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      3,
    );

    new cdk.CfnOutput(this, 'LoadBalancerDnsName', {
      value: service.loadBalancer.loadBalancerDnsName,
    });
  }
}