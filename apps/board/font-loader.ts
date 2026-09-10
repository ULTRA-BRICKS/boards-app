declare const __FONT_WORKER__: string;
let loading: Promise<void> | undefined;
/** Compile original outlines off the UI thread; never block initial controls on font work. */
export function installBoardFont(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const worker = new Worker(__FONT_WORKER__, { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Font worker timed out")); }, 15000);
    worker.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
      clearTimeout(timer);
      try {
        const face = new FontFace("Conloca Sans", event.data, { weight: "300 800", stretch: "85% 125%" });
        await face.load(); document.fonts.add(face); resolve();
      } catch (error) { reject(error); } finally { worker.terminate(); }
    };
    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
  });
  return loading;
}
