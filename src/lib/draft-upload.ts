/**
 * Only reuse a confirmed upload of the same File object within the same draft
 * and operator. Failed uploads are never cached. Clear after the record saves.
 */
export function createDraftUpload<T extends object>() {
  let uploaded: { file: T; scope: string; path: string } | undefined;
  return {
    async get(file: T, scope: string, upload: (file: T) => Promise<string>) {
      if (uploaded?.file === file && uploaded.scope === scope) return uploaded.path;
      uploaded = undefined;
      const path = await upload(file);
      uploaded = { file, scope, path };
      return path;
    },
    clear() {
      uploaded = undefined;
    },
  };
}
