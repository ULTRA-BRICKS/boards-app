declare const FONT_WORKER: string;
export async function installFont() {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(FONT_WORKER, { type: "module" }),
      timer = setTimeout(() => {
        worker.terminate();
        reject(Error("Font timeout"));
      }, 10000);
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(Error("Font failed"));
    };
    worker.onmessage = async (event) => {
      clearTimeout(timer);
      try {
        const face = new FontFace("Conloca Sans", event.data, {
          weight: "300 800",
          stretch: "85% 125%",
        });
        await face.load();
        document.fonts.add(face);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        worker.terminate();
      }
    };
  });
}
