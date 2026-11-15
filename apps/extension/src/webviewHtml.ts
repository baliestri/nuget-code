export interface HtmlInput {
  scriptUri: string;
  styleUri: string;
  /** The origin the editor serves the view's own files from. */
  cspSource: string;
  nonce: string;
}

/**
 * The content security policy of the view. Only the bundle runs and styles the page; images may also come
 * from https, because package icons are served by the feeds. Nothing else is allowed: in particular the
 * page cannot open a network connection, so every request goes through the backend.
 */
export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} https:`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");
}

/** The page of the view: the bundle and the element it renders into. */
export function renderHtml(input: HtmlInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(input.cspSource, input.nonce)}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${input.styleUri}" />
    <title>NuGet</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${input.nonce}" src="${input.scriptUri}"></script>
  </body>
</html>
`;
}
