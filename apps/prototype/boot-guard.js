/* Inlined ahead of the application module so failed/stalled JS cannot leave an endless skeleton. */
(() => {
  const skeleton = () => document.querySelector(".loading-shell");
  const show = (failed) => {
    const panel = skeleton();
    if (!panel || document.querySelector("[role=alertdialog]")) return;
    const title = document.getElementById("opening-title");
    if (title)
      title.textContent = failed
        ? "The page could not start"
        : "This connection is taking longer than usual";
    let recovery = document.getElementById("boot-recovery");
    if (!recovery) {
      recovery = document.createElement("div");
      recovery.id = "boot-recovery";
      recovery.className = "boot-recovery";
      const message = document.createElement("p");
      message.textContent =
        "The app is waiting for its files or the cloud. This screen does not mean that your tasks have been deleted.";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Retry opening";
      button.onclick = () => location.reload();
      recovery.append(message, button);
      panel.prepend(recovery);
    }
  };
  window.addEventListener(
    "error",
    (event) => {
      if (
        event.target instanceof HTMLScriptElement &&
        event.target.hasAttribute("data-boards-entry")
      )
        show(true);
    },
    true,
  );
  setTimeout(() => show(false), 6000);
})();
