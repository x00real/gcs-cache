/* eslint-disable sonarjs/no-duplicate-string */

import * as exec from '@actions/exec';
import * as semver from 'semver';

import { getState } from './state';

const ZSTD_WITHOUT_LONG_VERSION = '1.3.2';

export enum CompressionMethod {
  GZIP = 'gzip',
  ZSTD_WITHOUT_LONG = 'zstd (without long)',
  ZSTD = 'zstd',
  LZ4 = 'lz4',
}

async function getTarCompressionMethod(): Promise<CompressionMethod> {
  if (process.platform === 'win32') {
    return CompressionMethod.GZIP;
  }
  const state = getState();

  if (state.compressionMethod === CompressionMethod.GZIP) {
    return CompressionMethod.GZIP;
  }

  // Check possible with lz4
  let lz4 = await possibleWithLz4();
  if (lz4 && state.compressionMethod === CompressionMethod.LZ4) {
    return lz4;
  }

  // Check possible with zstd
  let zstd = await possibleWithZstd();
  if (zstd) {
    return zstd;
  }

  // Default Gzip
  return CompressionMethod.GZIP;
}

async function possibleWithZstd(): Promise<CompressionMethod | null> {
  const [zstdOutput, zstdVersion] = await exec
    .getExecOutput('zstd', ['--version'], {
      ignoreReturnCode: true,
      silent: true,
    })
    .then((out) => out.stdout.trim())
    .then((out) => {
      const extractedVersion = /v(\d+(?:\.\d+){0,})/.exec(out);
      return [out, extractedVersion ? extractedVersion[1] : null];
    })
    .catch(() => ['', null]);

  if (!zstdOutput?.toLowerCase().includes('zstd command line interface')) {
    return null;
  } else if (
    !zstdVersion ||
    semver.lt(zstdVersion, ZSTD_WITHOUT_LONG_VERSION)
  ) {
    return CompressionMethod.ZSTD_WITHOUT_LONG;
  } else {
    return CompressionMethod.ZSTD;
  }
}

async function possibleWithLz4(): Promise<CompressionMethod | null> {
  const [lz4Output, _lz4Version] = await exec
    .getExecOutput('lz4', ['--version'], {
      ignoreReturnCode: true,
      silent: true,
    })
    .then((out) => out.stdout.trim())
    .then((out) => {
      const extractedVersion = /(\d+(?:\.\d+){0,})/.exec(out);
      return [out, extractedVersion ? extractedVersion[1] : null];
    })
    .catch(() => ['', null]);

  if (!lz4Output?.toLowerCase().includes('lz4 command line interface')) {
    return null;
  } else {
    return CompressionMethod.LZ4;
  }
}

export async function createTar(
  archivePath: string,
  paths: string[],
  cwd: string,
): Promise<CompressionMethod> {
  const compressionMethod = await getTarCompressionMethod();
  console.log(`🔹 Using '${compressionMethod}' compression method.`);

  const compressionArgs = buildCompressionArgs(compressionMethod);

  await exec.exec('tar', [
    '-c',
    ...compressionArgs,
    '--posix',
    '-P',
    '-f',
    archivePath,
    '-C',
    cwd,
    ...paths,
  ]);

  return compressionMethod;
}

export async function extractTar(
  archivePath: string,
  compressionMethod: CompressionMethod,
  cwd: string,
): Promise<void> {
  console.log(
    `🔹 Detected '${compressionMethod}' compression method from object metadata.`,
  );

  const compressionArgs = buildDecompressionArgs(compressionMethod);

  await exec.exec('tar', [
    '-x',
    ...compressionArgs,
    '-P',
    '-f',
    archivePath,
    '-C',
    cwd,
  ]);
}

function buildCompressionArgs(method: CompressionMethod): string[] {
  switch (method) {
    case CompressionMethod.GZIP:
      return ['-z'];
    case CompressionMethod.ZSTD_WITHOUT_LONG:
      return ['--use-compress-program', 'zstd -T0'];
    case CompressionMethod.ZSTD:
      return ['--use-compress-program', 'zstd -T0 --long=30'];
    case CompressionMethod.LZ4:
      return ['--use-compress-program', 'lz4 --fast -BD'];
  }
}

function buildDecompressionArgs(method: CompressionMethod): string[] {
  switch (method) {
    case CompressionMethod.GZIP:
      return ['-z'];
    case CompressionMethod.ZSTD_WITHOUT_LONG:
      return ['--use-compress-program', 'zstd -d'];
    case CompressionMethod.ZSTD:
      return ['--use-compress-program', 'zstd -d --long=30'];
    case CompressionMethod.LZ4:
      return ['--use-compress-program', 'lz4 -d'];
  }
}
