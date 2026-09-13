/** A broken import must display a useful failure, not an endless opening state. */
try {
  await import("/app.mjs");
} catch (error) {
  console.error("Board startup failed", error);
  const main = document.getElementById("app");
  const section = document.createElement("section");
  section.className = "gate";
  const title = document.createElement("h1");
  title.textContent = "This page could not open.";
  const detail = document.createElement("p");
  detail.textContent =
    "No changes were made. Reload the page; if it still fails, check the deployment logs.";
  const retry = document.createElement("button");
  retry.className = "primary";
  retry.textContent = "Reload page";
  retry.addEventListener("click", () => location.reload());
  section.append(title, detail, retry);
  main.replaceChildren(section);
}
