import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

export class PrivateRuntimePathError extends Error {
  constructor(message = "Una ruta privada no supera las validaciones.") {
    super(message);
    this.name = "PrivateRuntimePathError";
  }
}

export function currentNonRootUid(): number {
  const uid = process.getuid?.();
  if (!Number.isSafeInteger(uid) || uid === undefined || uid <= 0) {
    throw new PrivateRuntimePathError(
      "El flujo privado debe ejecutarse como un operador no-root.",
    );
  }
  return uid;
}

export function absoluteConfiguredRoot(
  configured: string | undefined,
  fallback: string,
): string {
  const value = configured?.trim() || fallback;
  if (!path.isAbsolute(value)) {
    throw new PrivateRuntimePathError(
      "Las raíces privadas deben ser rutas absolutas.",
    );
  }
  return path.resolve(value);
}

export function directChildPath(
  parent: string,
  candidate: string,
): string {
  if (!path.isAbsolute(parent) || !path.isAbsolute(candidate)) {
    throw new PrivateRuntimePathError();
  }
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedParent, resolvedCandidate);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative.includes(path.sep)
  ) {
    throw new PrivateRuntimePathError(
      "La ruta debe ser hija directa de su directorio autorizado.",
    );
  }
  return resolvedCandidate;
}

function modeBits(mode: number): number {
  return mode & 0o777;
}

export async function assertOwnedDirectory(
  directory: string,
  expectedUid: number,
  expectedMode?: number,
): Promise<void> {
  const metadata = await lstat(directory).catch(() => null);
  if (
    !metadata ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== expectedUid ||
    metadata.uid === 0 ||
    (expectedMode !== undefined &&
      modeBits(metadata.mode) !== expectedMode)
  ) {
    throw new PrivateRuntimePathError(
      "Un directorio privado no existe, es enlazado, tiene otro dueño o un modo inseguro.",
    );
  }
}

export async function prepareOwnedJobDirectory(
  jobsDirectory: string,
  outputDirectory: string,
  expectedUid: number,
): Promise<string> {
  const resolved = directChildPath(jobsDirectory, outputDirectory);
  try {
    await mkdir(resolved, { mode: 0o700, recursive: false });
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )
    ) {
      throw error;
    }
  }
  await assertOwnedDirectory(resolved, expectedUid);
  await chmod(resolved, 0o700);
  await assertOwnedDirectory(resolved, expectedUid, 0o700);
  return resolved;
}

type StableFileOptions = {
  expectedUid: number;
  maximumBytes: number;
  expectedMode?: number;
};

type FileIdentity = {
  device: bigint;
  inode: bigint;
  size: bigint;
  modifiedAt: bigint;
  changedAt: bigint;
};

function identity(metadata: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}): FileIdentity {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    size: metadata.size,
    modifiedAt: metadata.mtimeNs,
    changedAt: metadata.ctimeNs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.changedAt === right.changedAt
  );
}

async function checkedFileIdentity(
  handle: FileHandle,
  options: StableFileOptions,
): Promise<FileIdentity> {
  const metadata = await handle.stat({ bigint: true });
  const mode = Number(metadata.mode & 0o777n);
  if (
    !metadata.isFile() ||
    metadata.uid !== BigInt(options.expectedUid) ||
    metadata.uid === 0n ||
    metadata.size < 1n ||
    metadata.size > BigInt(options.maximumBytes) ||
    (options.expectedMode !== undefined &&
      mode !== options.expectedMode)
  ) {
    throw new PrivateRuntimePathError(
      "Un archivo privado tiene tipo, dueño, tamaño o modo inseguro.",
    );
  }
  return identity(metadata);
}

export async function assertOwnedRegularFile(
  filePath: string,
  options: StableFileOptions,
): Promise<void> {
  const metadata = await lstat(filePath).catch(() => null);
  if (
    !metadata ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== options.expectedUid ||
    metadata.uid === 0 ||
    metadata.size < 1 ||
    metadata.size > options.maximumBytes ||
    (options.expectedMode !== undefined &&
      modeBits(metadata.mode) !== options.expectedMode)
  ) {
    throw new PrivateRuntimePathError(
      "Un archivo privado tiene tipo, dueño, tamaño o modo inseguro.",
    );
  }
}

export async function readStableOwnedFile(
  filePath: string,
  options: StableFileOptions,
): Promise<Buffer> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const before = await checkedFileIdentity(handle, options);
    const source = await handle.readFile();
    const after = await checkedFileIdentity(handle, options);
    if (
      !sameIdentity(before, after) ||
      source.byteLength !== Number(after.size)
    ) {
      throw new PrivateRuntimePathError(
        "Un archivo privado cambió durante la lectura.",
      );
    }
    return source;
  } catch (error) {
    if (error instanceof PrivateRuntimePathError) {
      throw error;
    }
    throw new PrivateRuntimePathError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
