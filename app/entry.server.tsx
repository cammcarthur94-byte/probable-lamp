import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import type { EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const callbackName =
    isbot(request.headers.get("user-agent") ?? "") ? "onAllReady" : "onShellReady";

  return new Promise<Response>((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError: reject,
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );
    setTimeout(abort, streamTimeout + 1000);
  });
}
