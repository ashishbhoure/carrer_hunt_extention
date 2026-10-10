import type { Request, Response } from "@careerpilot/shared";

export class MessageError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Typed call into the service worker. Rejects with MessageError on failure. */
export async function send<T = unknown>(req: Request): Promise<T> {
  let res: Response<T> | undefined;
  try { res = (await chrome.runtime.sendMessage(req)) as Response<T> | undefined; }
  catch { throw new MessageError("unavailable", "The extension background worker is not responding. Reload the extension."); }
  if (!res) throw new MessageError("no_response", "No response from the extension background worker.");
  if (!res.ok) throw new MessageError(res.error.code, res.error.message);
  return res.data;
}

export const isExtensionContext = () => typeof chrome !== "undefined" && !!chrome.runtime?.id;

export async function openDashboard(route = "/") {
  if (isExtensionContext()) await send({ type: "dashboard/open", route });
}
