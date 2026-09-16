import { escapeHTML as escape } from "../lib/html";
import { normalizeEmail } from "./policy";
export type Mail = { from: string; to: string[]; subject: string; text: string; html: string };
export function assignmentMail(input: {
  kind?: "assignment" | "weekly";
  from: string;
  recipient: string;
  space: string;
  origin: string;
  spaceId: string;
  tasks: { boardId: string; itemId: string; text: string; boardTitle: string }[];
}): Mail {
  const url = new URL(input.origin);
  if (url.protocol !== "https:" || url.username || url.password) throw Error("Invalid mail origin");
  const links = input.tasks.map((task) => {
    const link = new URL("/app", url.origin);
    link.searchParams.set("space", input.spaceId);
    link.searchParams.set("board", task.boardId);
    link.searchParams.set("item", task.itemId);
    return { ...task, url: link.href };
  });
  const title =
    input.kind === "weekly"
      ? `Weekly digest · ${input.space}`
      : `${links.length} new assignment${links.length === 1 ? "" : "s"} · ${input.space}`;
  const text =
    title +
    "\n\n" +
    links.map((t) => t.boardTitle + ": " + t.text + "\n" + t.url).join("\n\n") +
    "\n\nAssignments to yourself do not generate these notifications. Change email preferences in your profile.";
  const body = links
    .map(
      (t) =>
        `<tr><td style="padding-top:14px;padding-bottom:14px;font-family:Georgia,serif;font-size:18px;line-height:26px;color:#293f5e"><a href="${escape(t.url)}" style="color:#293f5e;font-size:18px;line-height:26px">${escape(t.text)}</a><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#586a80">${escape(t.boardTitle)}</p></td></tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin-top:0;margin-bottom:0;margin-left:0;margin-right:0"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#f8f6f0" style="background-color:#f8f6f0;padding-top:30px;padding-bottom:30px;padding-left:20px;padding-right:20px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px"><tr><td style="font-family:Georgia,serif;font-size:26px;line-height:34px;color:#293f5e">${escape(title)}</td></tr>${body}</table></td></tr></table></body></html>`;
  return {
    from: input.from,
    to: [normalizeEmail(input.recipient)],
    subject: title.slice(0, 200),
    text,
    html,
  };
}
export class MailFailure extends Error {
  constructor(
    public retryable: boolean,
    public code: string,
  ) {
    super(code);
  }
}
export async function deliverMail(
  key: string,
  mail: Mail,
  id: string,
  transport: typeof fetch = fetch,
): Promise<string> {
  if (!key || !mail.from) throw new MailFailure(false, "MAIL_NOT_CONFIGURED");
  const response = await transport("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "Idempotency-Key": "boards/" + id,
    },
    body: JSON.stringify(mail),
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new MailFailure(
      response.status === 429 || response.status >= 500 || response.status === 409,
      "MAIL_HTTP_" + response.status,
    );
  const body = await response.json();
  if (typeof body.id !== "string") throw new MailFailure(false, "INVALID_MAIL_RESPONSE");
  return body.id;
}
