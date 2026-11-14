import { useState, type ReactNode } from "react";

/**
 * The icon of a package: the one its feed publishes, when there is one and it loads, else the generic
 * package icon. Only https addresses are tried; anything else is not allowed to load in the view.
 */
export function PackageIcon({ url }: { url?: string | undefined }): ReactNode {
  const [failed, setFailed] = useState(false);
  if (url === undefined || failed || !url.startsWith("https://")) {
    return <span className="asset-package text-muted shrink-0" aria-hidden="true" />;
  }

  return (
    <img
      src={url}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-4 w-4 shrink-0 object-contain"
    />
  );
}
