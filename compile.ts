import swc from "@swc/core";
import path from "node:path";
import yazl from "yazl";
import { createWriteStream } from "node:fs";

export const compile = async () => {
  const { code } = await swc.transformFile(
    path.join(process.cwd(), "lambda.ts"),
    {
      jsc: {
        target: "es2022",
      },
    }
  );

  const zipfile = new yazl.ZipFile();
  zipfile.addBuffer(Buffer.from(code, "utf-8"), "index.js");
  // Mark it as ES module
  zipfile.addBuffer(
    Buffer.from(
      JSON.stringify({
        type: "module",
      }),
      "utf-8"
    ),
    "package.json"
  );

  await new Promise<void>((resolve) => {
    zipfile.outputStream
      .pipe(createWriteStream(path.join(process.cwd(), "lambda.zip")))
      .on("close", () => {
        resolve();
      });
    zipfile.end();
  });
};
