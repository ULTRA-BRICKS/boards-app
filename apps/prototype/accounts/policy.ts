export type Role = "owner" | "admin" | "member" | "viewer";
export type Identity = {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  expiresAt: number;
};
export type Membership = { spaceId: string; accountId: string; personId: string; role: Role };
export class AccessError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new AccessError("WORK_EMAIL_REQUIRED", 400);
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    )
  )
    throw new AccessError("WORK_EMAIL_REQUIRED", 400);
  return email;
}
export function workEmail(value: unknown, allowedDomains: string[]): string {
  const email = normalizeEmail(value),
    domain = email.slice(email.lastIndexOf("@") + 1);
  const allowed = new Set(allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean));
  if (!allowed.size) throw new AccessError("CORPORATE_DOMAINS_NOT_CONFIGURED", 503);
  if (!allowed.has(domain)) throw new AccessError("CORPORATE_EMAIL_ONLY", 403);
  return email;
}
export function requireIdentity(identity: Identity | null, now = Date.now()): Identity {
  if (!identity || !identity.verified || !identity.id || identity.expiresAt <= now)
    throw new AccessError("SIGN_IN_REQUIRED", 401);
  normalizeEmail(identity.email);
  return identity;
}
export function authorize(
  identity: Identity | null,
  spaceId: string,
  members: Membership[],
  action: "read" | "write" | "manage",
  now = Date.now(),
): Membership {
  const actor = requireIdentity(identity, now),
    member = members.find((m) => m.accountId === actor.id && m.spaceId === spaceId);
  if (
    !member ||
    (action === "write" && member.role === "viewer") ||
    (action === "manage" && !["owner", "admin"].includes(member.role))
  )
    throw new AccessError("SPACE_FORBIDDEN", 403);
  return member;
}
export function mayNotify(
  actorAccountId: string,
  recipient: Membership,
  preferences: { assignment: boolean },
  stillAssigned: boolean,
): boolean {
  return (
    !!recipient.accountId &&
    actorAccountId !== recipient.accountId &&
    preferences.assignment &&
    stillAssigned
  );
}

export function corporateDomains(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 30 ||
    value.some((item) => typeof item !== "string")
  )
    throw new AccessError("INVALID_DOMAINS", 400);
  const result = [...new Set(value.map((domain: string) => domain.trim().toLowerCase()))];
  if (
    result.some(
      (domain) =>
        domain.length > 253 ||
        domain.split(".").length < 2 ||
        domain.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
    )
  )
    throw new AccessError("INVALID_DOMAINS", 400);
  return result;
}
