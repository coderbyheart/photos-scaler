import { App } from "aws-cdk-lib";
import { PhotosCDNStack } from "./PhotosCDNStack";
export class PhotosCDNApp extends App {
  constructor() {
    super();

    new PhotosCDNStack(this);
  }
}
