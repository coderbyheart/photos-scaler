import { App } from "aws-cdk-lib";
import { PhotosCDNStack } from "./PhotosCDNStack.ts";

export class PhotosCDNApp extends App {
  constructor(args: {
    stackName: string;
    photosBucketName?: string;
    imageMagickLayerBucketName: string;
  }) {
    super();

    new PhotosCDNStack(this, args);
  }
}
