# Photos CDN

Serves scaled images from an AWS S3 bucket.

A Lambda function URL accepts a request for an image in the photos bucket,
scales it with ImageMagick, stores the result in the resized bucket and
redirects there. Subsequent requests for the same variant are served from the
resized bucket without scaling again.

| `f`           | Result                                  |
| ------------- | --------------------------------------- |
| `raw`         | Redirect to the original image          |
| `placeholder` | 16x16 square crop                       |
| `preview`     | 64 pixels wide, aspect ratio preserved  |
| `thumb`       | `w`x`w` square crop                     |
| `scaled`      | `w` pixels wide, aspect ratio preserved |

`w` is rounded down to a multiple of 250 and defaults to 250, `q` (1-10) sets
the WebP quality and defaults to 6.

## Deploy

```bash
export IMAGEMAGICK_LAYER_BUCKET=<the bucket that holds image-magick-layer.zip>
npx cdk deploy
```

`IMAGEMAGICK_LAYER_BUCKET` is required and has no default: a Lambda layer can
only be read from a bucket **in the same region as the stack**, so a default
would silently break any stack deployed to another region.

The bucket must contain `image-magick-layer.zip`, built using
[imagemagick-aws-lambda-2](https://github.com/CyprusCodes/imagemagick-aws-lambda-2).

## End-to-end tests

The end-to-end tests deploy a stack of their own, upload the fixtures in
[`e2e-tests/fixtures`](./e2e-tests/fixtures/) to its photos bucket, and request
every format from the function URL. They assert on the dimensions of the WebP
files the CDN serves, so a dependency update that breaks the scaling fails the
build.

Any stack that is not named `photos-cdn` creates its own photos bucket, so the
tests never touch the production photos.

```bash
export STACK_NAME=photos-cdn-e2e-$USER
export IMAGEMAGICK_LAYER_BUCKET=<the bucket that holds image-magick-layer.zip>
npx cdk deploy "$STACK_NAME" --require-approval never --outputs-file stack-outputs.json
npm run test:e2e
npx cdk destroy -f "$STACK_NAME"
```

### Continuous integration

GitHub Actions runs the end-to-end tests on every push, assuming an IAM role via
OpenID Connect. The repository needs:

- the `CI__AWS_ACCOUNT_ID` secret, holding the account that runs the tests. It
  must be [bootstrapped for CDK](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)
  (`npx cdk bootstrap`) in `CI__AWS_REGION`, and hold a role named
  `coderbyheart-ci-photos-scaler` that trusts the GitHub OIDC provider for this
  repository
- the `CI__AWS_REGION` variable, naming the region to deploy the test stacks to
- the `CI__IMAGEMAGICK_LAYER_BUCKET` secret, naming a bucket **in that region**
  that holds `image-magick-layer.zip`
