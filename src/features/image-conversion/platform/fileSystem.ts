import {
  assertSafeImageFile,
  hasUnsafePathCharacters,
  isSupportedImageName,
} from "../core/inputValidation";

export type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
};

export type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<LocalFileHandle | LocalDirectoryHandle>;
  getDirectoryHandle(
    name: string,
    options: { create: boolean },
  ): Promise<LocalDirectoryHandle>;
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<LocalFileHandle>;
  isSameEntry(other: LocalDirectoryHandle): Promise<boolean>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<LocalDirectoryHandle>;
    webkitAudioContext?: typeof AudioContext;
  }
}

const MAX_DIRECTORY_DEPTH = 32;
const MAX_BATCH_FILES = 2_000;

function assertSafePathSegment(segment: string) {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    hasUnsafePathCharacters(segment)
  ) {
    throw new Error("A folder or file name contains an unsafe path segment.");
  }
}

export async function collectFolderImages(directory: LocalDirectoryHandle) {
  const images: Array<{ file: File; relativeDirectory: string }> = [];

  const visit = async (
    current: LocalDirectoryHandle,
    relativeDirectory: string,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new Error("The selected folder is nested more than 32 levels deep.");
    }

    for await (const entry of current.values()) {
      assertSafePathSegment(entry.name);
      if (entry.kind === "directory") {
        const nestedPath = relativeDirectory
          ? `${relativeDirectory}/${entry.name}`
          : entry.name;
        await visit(entry, nestedPath, depth + 1);
        continue;
      }

      if (!isSupportedImageName(entry.name)) continue;
      const file = await entry.getFile();
      try {
        await assertSafeImageFile(file);
      } catch {
        continue;
      }
      images.push({ file, relativeDirectory });
      if (images.length > MAX_BATCH_FILES) {
        throw new Error("A batch can contain at most 2,000 validated images.");
      }
    }
  };

  await visit(directory, "", 0);
  return images.sort((a, b) => {
    const pathA = `${a.relativeDirectory}/${a.file.name}`;
    const pathB = `${b.relativeDirectory}/${b.file.name}`;
    return pathA.localeCompare(pathB, undefined, { numeric: true });
  });
}

export async function writeToOutputFolder(
  outputRoot: LocalDirectoryHandle,
  relativeDirectory: string,
  fileName: string,
  blob: Blob,
) {
  let destination = outputRoot;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    assertSafePathSegment(segment);
    destination = await destination.getDirectoryHandle(segment, { create: true });
  }

  assertSafePathSegment(fileName);
  const fileHandle = await destination.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}
