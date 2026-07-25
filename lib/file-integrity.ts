import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";

type FileIdentity = {
  device: bigint;
  inode: bigint;
  size: bigint;
  mode: bigint;
  modifiedAt: bigint;
  changedAt: bigint;
};

type VerifiedFile = {
  identity: FileIdentity;
  digest: string;
};

const VERIFIED_FILES_KEY = Symbol.for(
  "org.aimauta.verified-content-files.v1"
);
const IN_FLIGHT_FILES_KEY = Symbol.for(
  "org.aimauta.verifying-content-files.v1"
);

function processMap<T>(key: symbol): Map<string, T> {
  const processGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processGlobal[key];
  if (existing instanceof Map) {
    return existing as Map<string, T>;
  }
  const created = new Map<string, T>();
  processGlobal[key] = created;
  return created;
}

const verifiedFiles = processMap<VerifiedFile>(VERIFIED_FILES_KEY);
const inFlightFiles = processMap<Promise<boolean>>(IN_FLIGHT_FILES_KEY);

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.modifiedAt === right.modifiedAt &&
    left.changedAt === right.changedAt
  );
}

function isReadOnly(identity: FileIdentity): boolean {
  return (identity.mode & 0o222n) === 0n;
}

async function identity(handle: FileHandle): Promise<FileIdentity | null> {
  const metadata = await handle.stat({ bigint: true });
  if (!metadata.isFile()) {
    return null;
  }
  return {
    device: metadata.dev,
    inode: metadata.ino,
    size: metadata.size,
    mode: metadata.mode,
    modifiedAt: metadata.mtimeNs,
    changedAt: metadata.ctimeNs
  };
}

async function verifyUncached(
  filePath: string,
  handle: FileHandle,
  openedIdentity: FileIdentity,
  expectedBytes: number,
  expectedSha256: string
): Promise<boolean> {
  if (openedIdentity.size !== BigInt(expectedBytes)) {
    return false;
  }

  const cached = verifiedFiles.get(filePath);
  if (
    cached &&
    cached.digest === expectedSha256 &&
    isReadOnly(openedIdentity) &&
    sameIdentity(cached.identity, openedIdentity)
  ) {
    return true;
  }

  const hash = createHash("sha256");
  const verificationStream = handle.createReadStream({
    start: 0,
    autoClose: false
  });
  for await (const chunk of verificationStream) {
    hash.update(chunk as Buffer);
  }
  const digest = hash.digest("hex");
  const after = await identity(handle);
  if (
    !after ||
    !sameIdentity(openedIdentity, after) ||
    digest !== expectedSha256
  ) {
    verifiedFiles.delete(filePath);
    return false;
  }

  if (isReadOnly(after)) {
    verifiedFiles.set(filePath, { identity: after, digest });
  } else {
    /*
     * Some filesystems expose timestamps at a coarse resolution. Re-hash
     * writable files so a same-size rewrite within one timestamp tick cannot
     * reuse a stale successful checksum.
     */
    verifiedFiles.delete(filePath);
  }
  return true;
}

/**
 * Verifies the already-open descriptor that the caller will stream. The
 * successful digest is cached only for read-only files and their exact
 * device/inode/size/mode/mtime/ctime identity. Writable files are always
 * re-hashed because timestamp granularity is filesystem-dependent.
 */
export async function verifyOpenedPinnedFile(
  filePath: string,
  handle: FileHandle,
  expectedBytes: number,
  expectedSha256: string
): Promise<boolean> {
  const openedIdentity = await identity(handle);
  if (!openedIdentity || openedIdentity.size !== BigInt(expectedBytes)) {
    return false;
  }
  if (!isReadOnly(openedIdentity)) {
    return verifyUncached(
      filePath,
      handle,
      openedIdentity,
      expectedBytes,
      expectedSha256
    );
  }
  const identityKey = [
    openedIdentity.device,
    openedIdentity.inode,
    openedIdentity.size,
    openedIdentity.mode,
    openedIdentity.modifiedAt,
    openedIdentity.changedAt
  ].join(":");
  const cacheKey =
    `${filePath}\0${identityKey}\0${expectedBytes}\0${expectedSha256}`;
  const existing = inFlightFiles.get(cacheKey);
  if (existing) {
    return existing;
  }

  const verification = verifyUncached(
    filePath,
    handle,
    openedIdentity,
    expectedBytes,
    expectedSha256
  ).finally(() => {
    if (inFlightFiles.get(cacheKey) === verification) {
      inFlightFiles.delete(cacheKey);
    }
  });
  inFlightFiles.set(cacheKey, verification);
  return verification;
}
