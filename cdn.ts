import { PhotosCDNApp } from "./PhotosCDNApp.ts";
import { compile } from "./compile.ts";

await compile();

/** Unset variables are empty strings in GitHub Actions. */
const fromEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
};

const productionStackName = "photos-cdn";
const stackName = fromEnv("STACK_NAME") ?? productionStackName;

new PhotosCDNApp({
  stackName,
  // Only production serves the real photos. Every other stack is an end-to-end
  // test stack and creates a throw-away bucket for its fixtures.
  photosBucketName:
    stackName === productionStackName ? "photos.coderbyheart" : undefined,
  imageMagickLayerBucketName:
    fromEnv("IMAGEMAGICK_LAYER_BUCKET") ??
    "imagemagick-layer-lambda-eu-central-1",
});
