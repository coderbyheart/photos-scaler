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
npx cdk deploy
```

The ImageMagick layer is read from the `imagemagick-layer-lambda-<region>`
bucket, which must exist in the region of the stack. It is created using
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
npx cdk deploy --require-approval never --outputs-file stack-outputs.json
npm run test:e2e
npx cdk destroy -f
```

### Continuous integration

GitHub Actions runs the end-to-end tests on every push. It assumes an IAM role
via OpenID Connect, which is created by a separate stack that must be deployed
once, using credentials for the AWS account that runs the tests:

```bash
npm run deploy:ci
```

The account must be [bootstrapped for CDK](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)
(`npx cdk bootstrap`).

Then configure the repository:

- the `CI__AWS_ACCOUNT_ID` secret
- the `CI__AWS_REGION` variable
- optionally the `IMAGEMAGICK_LAYER_BUCKET` variable, if the ImageMagick layer
  bucket does not follow the default naming
