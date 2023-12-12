import {
  Stack,
  aws_lambda as Lambda,
  aws_s3 as S3,
  Duration,
  CfnOutput,
  RemovalPolicy,
} from "aws-cdk-lib";
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import path from "node:path";

export class PhotosCDNStack extends Stack {
  constructor(parent: Construct) {
    super(parent, "photos-cdn");

    // This bucket serves the images
    const photosBucket = S3.Bucket.fromBucketName(
      this,
      "photosBucket",
      "photos.coderbyheart"
    );

    // This bucket stores the resized images
    const resizedBucket = new S3.Bucket(this, "resizedBucket", {
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY,
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
          "imagemagick-layer-lambda-eu-central-1"
        ),
        // This is created using https://github.com/CyprusCodes/imagemagick-aws-lambda-2
        "image-magick-layer.zip"
      ),
    });

    // The lambda that resizes photos
    const resizeImageFn = new Lambda.Function(this, "resizeImageFn", {
      description: "Resize photos and store resized images",
      code: Lambda.Code.fromAsset(path.join(process.cwd(), "lambda.zip")),
      layers: [layerVersion],
      handler: "index.handler",
      runtime: Lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 1792,
      logRetention: RetentionDays.ONE_DAY,
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
  }
}
