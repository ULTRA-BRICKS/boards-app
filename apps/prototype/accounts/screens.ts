import { escapeHTML as escape } from "../lib/html";
import { bindFormDrafts, draftValue, clearUnchangedDraft } from "./drafts";
type API = (path: string, method?: string, body?: unknown) => Promise<any>;
export function accountScreens(host: HTMLElement, api: API) {
  let user: any = null,
    space = "",
    epoch = 0,
    activeView = "",
    draftKey = "";
  const $ = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  function layout(title: string, body: string) {
    document.title = title + " | Boards";
    host.innerHTML = `<article class="account-sheet"><nav aria-label="Workspace navigation"><a href="/">Back to board</a>${user ? '<button data-view="spaces">Spaces</button><button data-view="profile">My profile</button><button data-view="settings">Settings</button><button id="sign-out">Sign out</button>' : ""}</nav><h1>${escape(title)}</h1><div role="status" id="account-status"></div>${body}</article>`;
    host.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
      (button) =>
        (button.onclick = () => {
          void show(button.dataset.view!);
        }),
    );
    draftKey =
      user && activeView !== "login"
        ? "boards:form:" + user.id + ":" + space + ":" + activeView
        : "";
    if (draftKey) bindFormDrafts(host, draftKey);
    const out = host.querySelector<HTMLButtonElement>("#sign-out");
    if (out)
      out.onclick = async () => {
        await api("auth/logout", "POST", {});
        user = null;
        await show("login");
      };
  }
  async function submit(button: HTMLButtonElement, fn: () => Promise<void>) {
    button.disabled = true;
    const key = draftKey,
      requestEpoch = epoch,
      previous = key ? draftValue(key) : null;
    try {
      await fn();
      if (key) clearUnchangedDraft(key, previous);
    } catch (error) {
      if (requestEpoch === epoch && button.isConnected)
        $("#account-status").textContent = String((error as Error).message);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }
  async function show(view: string, selection?: string) {
    const generation = ++epoch;
    activeView = view;
    if (selection) space = selection;
    try {
      if (view === "login") {
        const status = await api("status");
        if (generation !== epoch) return;
        if (!status.configured) {
          layout(
            "Workspace setup",
            "<p>Corporate sign-in is not enabled yet. The workspace administrator needs to finish the secure database, allowed email domains and mail sender configuration.</p><p>Your existing board and read-only shared pages remain available.</p>",
          );
          return;
        }
        layout(
          "Sign in with your work email",
          '<form id="email-form"><label>Corporate email<input id="work-email" type="email" required autocomplete="email"></label><button type="submit">Send sign-in code</button></form>',
        );
        const form = $<HTMLFormElement>("#email-form");
        form.onsubmit = (e) => {
          e.preventDefault();
          const button = form.querySelector("button")!;
          void submit(button, async () => {
            const result = await api("auth/start", "POST", {
              email: $<HTMLInputElement>("#work-email").value,
            });
            layout(
              "Check your work email",
              '<form id="code-form"><label>Six-digit code<input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required maxlength="6"></label><button type="submit">Sign in</button></form>',
            );
            const codeForm = $<HTMLFormElement>("#code-form");
            codeForm.onsubmit = (event) => {
              event.preventDefault();
              void submit(codeForm.querySelector("button")!, async () => {
                const signed = await api("auth/verify", "POST", {
                  challengeId: result.challengeId,
                  code: $<HTMLInputElement>("#code").value,
                });
                user = signed.user;
                await show("spaces");
              });
            };
          });
        };
        return;
      }
      const session = await api("session");
      if (generation !== epoch) return;
      if (!session.user) {
        user = null;
        return show("login");
      }
      user = session.user;
      if (view === "spaces") {
        const result = await api("spaces");
        if (generation !== epoch) return;
        layout(
          "Your spaces",
          '<div class="space-cards">' +
            result.spaces
              .map(
                (s: any) =>
                  '<button data-space="' +
                  escape(s.id) +
                  '"><strong>' +
                  escape(s.name) +
                  "</strong><small>" +
                  escape(s.role) +
                  "</small></button>",
              )
              .join("") +
            '</div><form id="create-space"><label>New space name<input id="space-name" required maxlength="120"></label><label>Corporate domains<input id="space-domains" required placeholder="example.com"></label><button>Create space</button></form>',
        );
        host.querySelectorAll<HTMLButtonElement>("[data-space]").forEach(
          (button) =>
            (button.onclick = () => {
              void show("settings", button.dataset.space);
            }),
        );
        const form = $<HTMLFormElement>("#create-space");
        form.onsubmit = (e) => {
          e.preventDefault();
          void submit(form.querySelector("button")!, async () => {
            const r = await api("spaces", "POST", {
              name: $<HTMLInputElement>("#space-name").value,
              domains: $<HTMLInputElement>("#space-domains")
                .value.split(",")
                .map((s) => s.trim()),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            await show("settings", r.id);
          });
        };
        return;
      }
      if (view === "profile") {
        const { profile } = await api("profile");
        if (generation !== epoch) return;
        layout(
          "My profile",
          `<form id="profile-form"><label>Name<input id="profile-name" value="${escape(profile.name)}" required maxlength="120"></label><label>Verified corporate email<input value="${escape(profile.email)}" type="email" readonly></label><button>Save profile</button></form>`,
        );
        const form = $<HTMLFormElement>("#profile-form");
        form.onsubmit = (e) => {
          e.preventDefault();
          void submit(form.querySelector("button")!, async () => {
            await api("profile", "PUT", { name: $<HTMLInputElement>("#profile-name").value });
            $("#account-status").textContent = "Profile saved";
          });
        };
        return;
      }
      if (view === "settings") {
        if (!space) return show("spaces");
        const data = await api("spaces/" + encodeURIComponent(space) + "/settings");
        if (generation !== epoch) return;
        const admin = ["owner", "admin"].includes(data.role);
        layout(
          "Space settings",
          `<form id="settings-form"><fieldset ${admin ? "" : "disabled"}><label>Space name<input id="settings-name" value="${escape(data.name)}" required maxlength="120"></label><label>Corporate domains<input id="settings-domains" value="${escape(data.allowedDomains.join(", "))}" required></label><label>Time zone<input id="settings-zone" value="${escape(data.timeZone)}" required></label></fieldset><label><input type="checkbox" id="assignment-mail" ${data.preferences.assignmentMail ? "checked" : ""}> Email me new assignments in five-minute batches</label><label><input type="checkbox" id="weekly-mail" ${data.preferences.weeklyMail ? "checked" : ""}> Weekly digest</label><button>Save settings</button></form><section aria-label="Slack integration"><h2>Slack</h2><p>${data.slack ? "Connected to " + escape(data.slack.name) : "Not connected. Sign-in stays on your corporate email; Slack is a separate workspace integration."}</p><button id="slack-connect" ${data.slackAvailable ? "" : "disabled"}>${data.slack ? "Reconnect Slack" : "Connect Slack"}</button>${data.slack ? '<button id="slack-sync">Sync people</button>' : ""}</section><button id="show-people">People and invitations</button>`,
        );
        const form = $<HTMLFormElement>("#settings-form");
        form.onsubmit = (e) => {
          e.preventDefault();
          // Capture the destination and all inputs before any network await.
          const destination = space;
          const values = {
            name: $<HTMLInputElement>("#settings-name").value,
            allowedDomains: $<HTMLInputElement>("#settings-domains")
              .value.split(",")
              .map((s) => s.trim()),
            timeZone: $<HTMLInputElement>("#settings-zone").value,
          };
          const preferences = {
            assignmentMail: $<HTMLInputElement>("#assignment-mail").checked,
            weeklyMail: $<HTMLInputElement>("#weekly-mail").checked,
          };
          void submit(form.querySelector("button")!, async () => {
            if (admin) await api("spaces/" + destination + "/settings", "PUT", values);
            await api("spaces/" + destination + "/preferences", "PUT", preferences);
            if (generation === epoch && form.isConnected)
              $("#account-status").textContent = "Settings saved";
          });
        };
        $("#show-people").onclick = () => {
          void show("people");
        };
        $("#slack-connect").onclick = () => {
          void submit($<HTMLButtonElement>("#slack-connect"), async () => {
            const result = await api("spaces/" + space + "/slack/connect", "POST", {});
            location.assign(result.url);
          });
        };
        const sync = host.querySelector<HTMLButtonElement>("#slack-sync");
        if (sync)
          sync.onclick = () => {
            void submit(sync, async () => {
              await api("spaces/" + space + "/slack/sync", "POST", {});
              await show("people");
            });
          };
        return;
      }
      if (view === "people") {
        if (!space) return show("spaces");
        const result = await api("spaces/" + space + "/people");
        if (generation !== epoch) return;
        layout(
          "People in this space",
          '<div class="people-list">' +
            result.people
              .map(
                (person: any) =>
                  `<section><strong>${escape(person.name)}</strong><p>${escape(person.email)}</p><small>${escape(person.role)}</small></section>`,
              )
              .join("") +
            '</div><form id="invite-form"><label>Name<input id="invite-name" required maxlength="120"></label><label>Corporate email<input id="invite-email" type="email" required></label><button>Invite colleague</button></form>',
        );
        const form = $<HTMLFormElement>("#invite-form");
        form.onsubmit = (e) => {
          e.preventDefault();
          void submit(form.querySelector("button")!, async () => {
            await api("spaces/" + space + "/invites", "POST", {
              email: $<HTMLInputElement>("#invite-email").value,
              name: $<HTMLInputElement>("#invite-name").value,
              personId: crypto.randomUUID(),
              role: "member",
            });
            $("#account-status").textContent =
              "Invitation saved. Your colleague can sign in with this email.";
            form.reset();
          });
        };
        return;
      }
      if (view === "history") {
        const query = new URLSearchParams(location.search),
          board = query.get("board") || "",
          item = query.get("item") || "";
        if (!space || !board || !item) throw Error("Choose an item from its board first.");
        layout(
          "Item history",
          '<p>Changes recorded by the server: who changed the item, when, and what changed. Earlier activity is not invented.</p><ol id="history-list"></ol><button id="history-more">Load more</button>',
        );
        let cursor: string | undefined,
          seen = new Set<string>();
        const load = async () => {
          const result = await api(
            "spaces/" +
              space +
              "/history?" +
              new URLSearchParams({ board, item, ...(cursor ? { before: cursor } : {}) }),
          );
          if (generation !== epoch) return;
          for (const entry of result.items) {
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            const row = document.createElement("li");
            const fields = entry.changes.fields || [];
            row.innerHTML =
              "<strong>" +
              escape(entry.actorName) +
              '</strong> <time datetime="' +
              escape(entry.occurredAt) +
              '">' +
              escape(new Date(entry.occurredAt).toLocaleString()) +
              "</time><p>" +
              escape(entry.kind) +
              " · " +
              escape(fields.join(", ")) +
              "</p>" +
              (entry.changes.before?.text !== entry.changes.after?.text
                ? "<p><del>" +
                  escape(entry.changes.before?.text || "") +
                  "</del><br>" +
                  escape(entry.changes.after?.text || "") +
                  "</p>"
                : "");
            $("#history-list").append(row);
          }
          cursor = result.nextCursor || undefined;
          $<HTMLButtonElement>("#history-more").hidden = !cursor;
          if (!seen.size) $("#account-status").textContent = "No recorded changes yet";
        };
        $("#history-more").onclick = () => {
          void submit($<HTMLButtonElement>("#history-more"), load);
        };
        await load();
        return;
      }
    } catch (error) {
      if (generation !== epoch) return;
      layout(
        "Unable to open this screen",
        "<p>" +
          escape((error as Error).message) +
          '</p><button id="account-retry">Try again</button>',
      );
      $("#account-retry").onclick = () => {
        void show(view, space);
      };
    }
  }
  return { show };
}
