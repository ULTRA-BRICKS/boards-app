import { savePhotoAndCleanDraft } from "./save-result";
import { escapeHTML as esc } from "../lib/html";
import { icon } from "../lib/paper";
import { photoDraft, photoErrorMessage, type PhotoDraft } from "./contract";
import { photoRepository, preparePhoto } from "./storage";
import { coalescedWriter } from "./draft-writer";
export type PhotoScreenOptions = {
  scope: string;
  recognize: (image: string, signal: AbortSignal) => Promise<PhotoDraft>;
  save: (board: PhotoDraft["board"]) => Promise<void>;
  exit: (notice?: string) => void;
};
export async function openPhotoScreen(host: HTMLElement, options: PhotoScreenOptions) {
  let image = "",
    draft: PhotoDraft | null = null,
    sequence = 0,
    controller: AbortController | undefined,
    disposed = false,
    saving = false;
  const repository = photoRepository(options.scope);
  host.innerHTML = `<section class="photo-workspace"><div class="photo-top"><button id="photo-back">${icon("undo")} Back to boards</button><p>From paper to a page</p></div><div class="photo-layout"><aside class="photo-source"><label class="photo-drop" tabindex="0">${icon("camera")}<strong>Choose a photo of your sheet</strong><span>JPEG, PNG or WebP · up to 12 MB</span><input id="sheet-photo" class="photo-file-input" type="file" accept="image/jpeg,image/png,image/webp"></label><img id="source-photo" alt="Your original sheet" hidden><p class="photo-privacy">The image stays in this browser until you press Read photo. Recognition sends it to your configured vision provider.</p><button id="read-photo" disabled>Read photo</button><button id="cancel-photo" hidden>Cancel recognition</button><p id="photo-status" role="status"></p></aside><article class="photo-paper"><div id="photo-result"><h1>A page from your handwriting</h1><p>Columns, task text and completion marks will appear here. You can correct every line before adding the page.</p></div><div class="photo-actions"><button id="save-photo-page" hidden>Add page to this space</button><button id="manual-photo">Type this page instead</button><button id="discard-photo">Discard draft</button></div></article></div></section>`;
  const $ = <T extends HTMLElement>(q: string) => host.querySelector<T>(q)!;
  const say = (value: string) => {
    if (!disposed) $("#photo-status").textContent = value;
  };
  const writer = coalescedWriter(
    () => repository.writeDraft(structuredClone(draft)),
    () => say("Browser draft storage is unavailable. Keep this tab open until the page saves."),
  );
  async function persistDraft() {
    writer.mark();
    await writer.flush();
  }
  function preview() {
    const element = $<HTMLImageElement>("#source-photo");
    element.src = image;
    element.hidden = !image;
    $<HTMLButtonElement>("#read-photo").disabled = !image || saving;
  }
  function renderDraft() {
    if (!draft) return;
    $("#photo-result").innerHTML =
      `<input id="photo-title" aria-label="Page title" maxlength="120" value="${esc(draft.board.title)}"><p class="photo-review-note">Check against the photo. Initials in brackets are unconfirmed, not automatic assignments.</p>${draft.warnings.length ? '<div class="photo-warnings">' + draft.warnings.map((w) => "<p>" + esc(w) + "</p>").join("") + "</div>" : " "}<div class="photo-columns">${draft.board.columns.map((col, c) => `<section><input data-photo-column="${c}" aria-label="Column ${c + 1} title" maxlength="120" value="${esc(col.title)}"><div>${col.items.map((item, i) => `<label class="photo-task"><input type="checkbox" data-photo-check="${c}:${i}" aria-label="Complete task" ${item.done ? "checked" : ""}><textarea data-photo-task="${c}:${i}" aria-label="Task ${i + 1} in column ${c + 1}" maxlength="1000">${esc(item.text)}</textarea>${item.tag ? "<small>" + esc(item.tag) + " · unconfirmed</small>" : ""}</label>`).join("")}</div></section>`).join("")}</div>`;
    $<HTMLButtonElement>("#save-photo-page").hidden = false;
    $("#manual-photo").hidden = true;
    $("#photo-title").oninput = (e) => {
      draft!.board.title = (e.target as HTMLInputElement).value;
      writer.mark();
    };
    host.querySelectorAll<HTMLInputElement>("[data-photo-column]").forEach(
      (input) =>
        (input.oninput = () => {
          draft!.board.columns[Number(input.dataset.photoColumn)].title = input.value;
          writer.mark();
        }),
    );
    host.querySelectorAll<HTMLTextAreaElement>("[data-photo-task]").forEach(
      (input) =>
        (input.oninput = () => {
          const [c, i] = input.dataset.photoTask!.split(":").map(Number);
          draft!.board.columns[c].items[i].text = input.value;
          writer.mark();
        }),
    );
    host.querySelectorAll<HTMLInputElement>("[data-photo-check]").forEach(
      (input) =>
        (input.onchange = () => {
          const [c, i] = input.dataset.photoCheck!.split(":").map(Number);
          draft!.board.columns[c].items[i].done = input.checked;
          writer.mark();
        }),
    );
  }
  async function choose(file: File) {
    if (saving) return;
    const epoch = ++sequence;
    controller?.abort();
    $("#cancel-photo").hidden = true;
    try {
      say("Preparing the photo…");
      const prepared = await preparePhoto(file);
      if (disposed || epoch !== sequence) return;
      await repository.replaceImage(prepared);
      if (disposed || epoch !== sequence) return;
      image = prepared;
      draft = null;
      $("#manual-photo").hidden = false;
      preview();
      $("#photo-result").innerHTML =
        "<h1>Your photo is ready</h1><p>Read it into an editable page, then check the result here.</p>";
      $<HTMLButtonElement>("#save-photo-page").hidden = true;
      await persistDraft();
      say("Ready to read. No page has been created.");
    } catch (error) {
      say((error as Error).message);
    }
  }
  $<HTMLInputElement>("#sheet-photo").onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void choose(file);
  };
  const drop = $(".photo-drop");
  drop.ondragover = (e) => e.preventDefault();
  drop.ondrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) void choose(file);
  };
  drop.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $("#sheet-photo").click();
    }
  };
  host.onpaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      void choose(file);
    }
  };
  $("#read-photo").onclick = async () => {
    if (!image || saving) return;
    const epoch = ++sequence;
    controller?.abort();
    controller = new AbortController();
    $<HTMLButtonElement>("#read-photo").disabled = true;
    $("#cancel-photo").hidden = false;
    say("Reading your handwriting…");
    try {
      const result = await options.recognize(image, controller.signal);
      if (disposed || epoch !== sequence) return;
      draft = result;
      renderDraft();
      await persistDraft();
      say("Draft ready. Check the text before adding this page.");
    } catch (error) {
      if (!disposed && epoch === sequence)
        say(photoErrorMessage((error as { code?: string }).code || "PROVIDER_UNAVAILABLE"));
    } finally {
      if (!disposed && epoch === sequence) {
        $("#cancel-photo").hidden = true;
        $<HTMLButtonElement>("#read-photo").disabled = false;
      }
    }
  };
  function resetRecognition() {
    sequence++;
    controller?.abort();
    $("#cancel-photo").hidden = true;
    $<HTMLButtonElement>("#read-photo").disabled = !image;
  }
  $("#cancel-photo").onclick = () => {
    resetRecognition();
    say("Recognition cancelled. Your photo remains here.");
  };
  $("#manual-photo").onclick = () => {
    if (saving) return;
    resetRecognition();
    draft = photoDraft({
      title: "From a photo",
      columns: [{ title: "Tasks", items: [{ text: "Write your first task" }] }],
      warnings: [],
    });
    draft.board.columns[0].items[0].text = "";
    renderDraft();
    writer.mark();
    say("Type or correct your page directly on the sheet.");
  };
  $("#save-photo-page").onclick = async () => {
    if (!draft || saving) return;
    saving = true;
    const button = $<HTMLButtonElement>("#save-photo-page");
    button.disabled = true;
    host
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "#photo-result input,#photo-result textarea",
      )
      .forEach((e) => (e.disabled = true));
    try {
      if (!draft.board.columns.some((c) => c.items.some((t) => t.text.trim())))
        throw Error("Write at least one task before adding this page.");
      await persistDraft();
      const result = await savePhotoAndCleanDraft(
        () => options.save(structuredClone(draft!.board)),
        () => repository.remove(),
      );
      disposed = true;
      repository.close();
      options.exit(
        result.draftRemoved
          ? undefined
          : "Saved to cloud. The browser recovery copy could not be removed.",
      );
    } catch (error) {
      say((error as Error).message || "The page has not finished saving. Your draft is kept here.");
    } finally {
      saving = false;
      if (!disposed) {
        button.disabled = false;
        host
          .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            "#photo-result input,#photo-result textarea",
          )
          .forEach((e) => (e.disabled = false));
      }
    }
  };
  $("#photo-back").onclick = async () => {
    if (saving) return;
    sequence++;
    controller?.abort();
    try {
      await persistDraft();
    } catch {
      say("Your draft could not be backed up. Keep this tab open until it saves.");
      return;
    }
    disposed = true;
    repository.close();
    options.exit();
  };
  $("#discard-photo").onclick = async () => {
    if (saving) return;
    sequence++;
    controller?.abort();
    try {
      await writer.flush();
      await repository.remove();
    } catch {
      say("The draft could not be removed. Keep this tab open and retry.");
      return;
    }
    disposed = true;
    repository.close();
    options.exit();
  };
  try {
    const restored = await repository.read();
    if (restored && !disposed && sequence === 0) {
      image = restored.image || "";
      if (image) await repository.setImage(image);
      if (disposed || sequence !== 0) return;
      draft = restored.draft as PhotoDraft | null;
      preview();
      if (draft?.board?.columns) renderDraft();
      say("Your unfinished photo draft was restored.");
    }
  } catch {
    say("Draft recovery is unavailable in this browser. Keep this tab open until you save.");
  }
  return () => {
    repository.close();
    disposed = true;
    sequence++;
    controller?.abort();
    host.onpaste = null;
  };
}
