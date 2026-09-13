import sharp from "sharp";
import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
const args = process.argv.slice(2),
  value = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
const destination = value("--output");
if (!destination)
  throw Error(
    "Provide --output <private JSON file>. Optional --source <approved profiles>; otherwise SLACK_BOT_TOKEN is required.",
  );
let people: { id: string; name: string; avatar?: string; image?: string }[] = [];
const source = value("--source");
if (source) people = await Bun.file(source).json();
else {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token)
    throw Error("Set SLACK_BOT_TOKEN with users:read, or pass an approved --source file.");
  let cursor = "";
  do {
    const url = new URL("https://slack.com/api/users.list");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(15000),
      }),
      data = await response.json();
    if (!response.ok || !data.ok)
      throw Error("Slack directory request failed; check scopes and rate limits.");
    for (const p of data.members || [])
      if (!p.deleted && !p.is_bot && p.id !== "USLACKBOT")
        people.push({
          id: "slack-" + p.id,
          name: p.profile?.real_name || p.real_name || p.name,
          image: p.profile?.image_192 || p.profile?.image_72,
        });
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor && people.length < 200);
}
if (!Array.isArray(people) || people.length > 200)
  throw Error("At most 200 approved profiles are supported.");
const allowed = new Set(["avatars.slack-edge.com", "secure.gravatar.com", "www.gravatar.com"]);
const result = [];
let photos = 0;
for (const person of people) {
  let avatar = "";
  try {
    const url = new URL(person.image || person.avatar || "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowed.has(url.hostname)
    )
      throw Error("Unapproved image host");
    if (url.hostname.includes("gravatar.com")) url.searchParams.set("d", "404");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw Error("Photo unavailable");
    const input = await response.arrayBuffer();
    if (input.byteLength > 3000000) throw Error("Photo exceeds limit");
    const bytes = await sharp(input, { limitInputPixels: 16000000 })
      .resize(80, 80, { fit: "cover" })
      .jpeg({ quality: 78 })
      .toBuffer();
    avatar = "data:image/jpeg;base64," + bytes.toString("base64");
    photos++;
  } catch {}
  result.push({
    id: String(person.id).slice(0, 80),
    name: String(person.name).slice(0, 120),
    avatar,
  });
}
const path = resolve(destination);
await Bun.write(path, JSON.stringify(result));
await chmod(path, 0o600);
console.log(
  JSON.stringify({
    people: result.length,
    photos,
    initialFallback: result.length - photos,
    file: path,
  }),
);
// Output has no email, Slack token, raw image URL, messages or unverified account linkage.
