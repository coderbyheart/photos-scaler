import {
  Stack,
  aws_lambda as Lambda,
  aws_s3 as S3,
  Duration,
  CfnOutput,
  RemovalPolicy,
} from "aws-cdk-lib";
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import path from "node:path";

export class PhotosCDNStack extends Stack {
  constructor(
    parent: Construct,
    {
      stackName,
      photosBucketName,
      imageMagickLayerBucketName,
    }: {
      stackName: string;
      /**
       * The bucket that serves the images. If undefined, the stack creates one,
       * which is what the end-to-end tests use to upload their fixtures to.
       */
      photosBucketName?: string;
      imageMagickLayerBucketName: string;
    },
  ) {
    super(parent, stackName);

    // This bucket serves the images
    const photosBucket =
      photosBucketName !== undefined
        ? S3.Bucket.fromBucketName(this, "photosBucket", photosBucketName)
        : new S3.Bucket(this, "photosBucket", {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
          });

    // This bucket stores the resized images
    const resizedBucket = new S3.Bucket(this, "resizedBucket", {
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: {
        blockPublicAcls: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
        blockPublicPolicy: false,
      },
      objectOwnership: S3.ObjectOwnership.OBJECT_WRITER,
    });

    // Layer that contains ImageMagick
    const layerVersion = new Lambda.LayerVersion(this, "imagemagick-layer", {
      code: Lambda.Code.fromBucket(
        S3.Bucket.fromBucketName(
          this,
          "layerBucket",
          // Must be in same region as the stack
          imageMagickLayerBucketName,
        ),
        // This is created using https://github.com/CyprusCodes/imagemagick-aws-lambda-2
        "image-magick-layer.zip",
      ),
    });

    const resizeImageFnLogGroup = new LogGroup(this, "resizeImageFnLogGroup", {
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // The lambda that resizes photos
    const resizeImageFn = new Lambda.Function(this, "resizeImageFn", {
      description: "Resize photos and store resized images",
      code: Lambda.Code.fromAsset(path.join(process.cwd(), "lambda.zip")),
      layers: [layerVersion],
      handler: "index.handler",
      runtime: Lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(30),
      memorySize: 1792,
      logGroup: resizeImageFnLogGroup,
      environment: {
        PHOTOS_BUCKET: photosBucket.bucketName,
        RESIZED_BUCKET: resizedBucket.bucketName,
      },
    });
    photosBucket.grantRead(resizeImageFn);
    resizedBucket.grantReadWrite(resizeImageFn);

    const url = resizeImageFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
    });
    new CfnOutput(this, "url", {
      value: url.url,
      exportName: `${this.stackName}:url`,
    });
    new CfnOutput(this, "photosBucketName", {
      value: photosBucket.bucketName,
      exportName: `${this.stackName}:photosBucketName`,
    });
    new CfnOutput(this, "resizedBucketName", {
      value: resizedBucket.bucketName,
      exportName: `${this.stackName}:resizedBucketName`,
    });
  }
}
