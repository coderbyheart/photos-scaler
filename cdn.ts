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

// A Lambda layer can only be read from a bucket in the region of the stack, so
// there is no default that works everywhere. Deploying with the wrong bucket
// replaces the layer of a working stack with a broken one.
const imageMagickLayerBucketName = fromEnv("IMAGEMAGICK_LAYER_BUCKET");
if (imageMagickLayerBucketName === undefined)
  throw new Error(
    `Set IMAGEMAGICK_LAYER_BUCKET to the bucket that holds image-magick-layer.zip in this region!`,
  );

new PhotosCDNApp({
  stackName,
  // Only production serves the real photos. Every other stack is an end-to-end
  // test stack and creates a throw-away bucket for its fixtures.
  photosBucketName:
    stackName === productionStackName ? "photos.coderbyheart" : undefined,
  imageMagickLayerBucketName,
});
