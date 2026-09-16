export type StoredPhoto = { image: string; draft: unknown | null; savedAt: number };
export function photoRepository(scope: string) {
  if (!scope) throw Error("Missing photo draft scope");
  let connection: Promise<IDBDatabase> | null = null,
    closed = false;
  const database = () => {
    if (closed) return Promise.reject(Error("Photo draft is closed"));
    return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("boards-private-drafts", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("photos"))
          request.result.createObjectStore("photos");
      };
      request.onerror = () => {
        connection = null;
        reject(request.error);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    }));
  };
  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, result: (v: T) => void) => void,
  ): Promise<T> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || Error("Photo transaction aborted"));
      tx.onerror = () => reject(tx.error);
      try {
        run(tx.objectStore("photos"), (v) => {
          value = v;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  return {
    async read(): Promise<StoredPhoto | null> {
      return transaction("readonly", (store, result) => {
        let record: any = null,
          image = "";
        const a = store.get(scope),
          b = store.get(scope + ":image");
        a.onsuccess = () => {
          record = a.result;
          result(
            record
              ? { image: record.image || image, draft: record.draft, savedAt: record.savedAt }
              : image
                ? { image, draft: null, savedAt: 0 }
                : null,
          );
        };
        b.onsuccess = () => {
          image = typeof b.result === "string" ? b.result : "";
          result(
            record
              ? { image: record.image || image, draft: record.draft, savedAt: record.savedAt }
              : image
                ? { image, draft: null, savedAt: 0 }
                : null,
          );
        };
      });
    },
    async replaceImage(image: string): Promise<void> {
      return transaction("readwrite", (store) => {
        store.put(image, scope + ":image");
        store.put({ draft: null, savedAt: Date.now() }, scope);
      });
    },
    async setImage(image: string): Promise<void> {
      return transaction("readwrite", (store) => {
        store.put(image, scope + ":image");
      });
    },
    async writeDraft(draft: unknown): Promise<void> {
      return transaction("readwrite", (store) => {
        store.put({ draft, savedAt: Date.now() }, scope);
      });
    },
    async remove(): Promise<void> {
      return transaction("readwrite", (store) => {
        store.delete(scope);
        store.delete(scope + ":image");
      });
    },
    close() {
      closed = true;
      void connection?.then((db) => db.close()).catch(() => {});
    },
  };
}
export async function preparePhoto(file: File): Promise<string> {
  if (
    !file ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 12000000
  )
    throw Error("Choose a JPEG, PNG or WebP photo under 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 32 || bitmap.height < 32 || bitmap.width * bitmap.height > 50000000)
      throw Error("Use a clear photo between 32 pixels and 50 megapixels.");
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image decoding is unavailable in this browser.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.75, 0.6]) {
      const image = canvas.toDataURL("image/jpeg", quality);
      if (image.length <= 2800000) return image;
    }
    throw Error("This photo is too detailed. Crop the sheet or choose a smaller photo.");
  } finally {
    bitmap.close();
  }
}
