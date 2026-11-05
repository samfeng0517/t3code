import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const FILESYSTEM_PATH_MAX_LENGTH = 512;

export const FILESYSTEM_METADATA_BATCH_LIMIT = 64;
const FILESYSTEM_BROWSE_MAX_LIMIT = 500;

export const FilesystemGetMetadataInput = Schema.Struct({
  // Absolute host paths, including ~/; clients must anchor relative paths.
  paths: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(FILESYSTEM_METADATA_BATCH_LIMIT)),
});
export type FilesystemGetMetadataInput = typeof FilesystemGetMetadataInput.Type;

export const FilesystemEntryMetadata = Schema.Struct({
  kind: Schema.Literals(["file", "directory", "other"]),
  byteLength: Schema.optionalKey(NonNegativeInt),
  mimeType: Schema.optionalKey(TrimmedNonEmptyString),
});
export type FilesystemEntryMetadata = typeof FilesystemEntryMetadata.Type;

// Entries follow request order; null means missing, unreadable, or unsupported.
export const FilesystemGetMetadataResult = Schema.Struct({
  entries: Schema.Array(Schema.NullOr(FilesystemEntryMetadata)),
});
export type FilesystemGetMetadataResult = typeof FilesystemGetMetadataResult.Type;

export const FilesystemBrowseInput = Schema.Struct({
  partialPath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  cwd: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH))),
  // Omitted by older clients, which get folders only and the full listing.
  includeFiles: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(
    PositiveInt.check(Schema.isLessThanOrEqualTo(FILESYSTEM_BROWSE_MAX_LIMIT)),
  ),
});
export type FilesystemBrowseInput = typeof FilesystemBrowseInput.Type;

export const FilesystemBrowseEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
  // Absent from servers that list folders only.
  kind: Schema.optionalKey(Schema.Literals(["file", "directory"])),
});
export type FilesystemBrowseEntry = typeof FilesystemBrowseEntry.Type;

export const FilesystemBrowseResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  entries: Schema.Array(FilesystemBrowseEntry),
});
export type FilesystemBrowseResult = typeof FilesystemBrowseResult.Type;

export const FilesystemSearchHomeFoldersInput = Schema.Struct({
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(50)),
});
export type FilesystemSearchHomeFoldersInput = typeof FilesystemSearchHomeFoldersInput.Type;

// Untrimmed: folder names may begin or end with spaces.
export const FilesystemHomeFolderEntry = Schema.Struct({
  name: Schema.NonEmptyString,
  fullPath: Schema.NonEmptyString,
  // Path below the home folder joined with "/" on every platform, e.g. "Documents/app".
  homeRelativePath: Schema.NonEmptyString,
});
export type FilesystemHomeFolderEntry = typeof FilesystemHomeFolderEntry.Type;

export const FilesystemSearchHomeFoldersResult = Schema.Struct({
  entries: Schema.Array(FilesystemHomeFolderEntry),
});
export type FilesystemSearchHomeFoldersResult = typeof FilesystemSearchHomeFoldersResult.Type;

export const FilesystemBrowseFailure = Schema.Literals([
  "windows_path_unsupported",
  "current_project_required",
  "read_directory_failed",
]);
export type FilesystemBrowseFailure = typeof FilesystemBrowseFailure.Type;

function decodedFilesystemBrowseErrorMessage(props: object): string | undefined {
  if (!("message" in props)) return undefined;
  return typeof props.message === "string" ? props.message : undefined;
}

export class FilesystemBrowseError extends Schema.TaggedError<FilesystemBrowseError>()(
  "FilesystemBrowseError",
  {
    partialPath: Schema.optional(TrimmedNonEmptyString),
    cwd: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(FilesystemBrowseFailure),
    parentPath: Schema.optional(TrimmedNonEmptyString),
    platform: Schema.optional(TrimmedNonEmptyString),
    /** Set when the directory does not exist; older clients ignore it. */
    pathMissing: Schema.optional(Schema.Boolean),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly partialPath: string;
    readonly cwd?: string | undefined;
    readonly failure: FilesystemBrowseFailure;
    readonly parentPath?: string;
    readonly platform?: string;
    readonly pathMissing?: boolean;
    readonly cause?: unknown;
  }) {
    const cwd = props.cwd === undefined ? "" : ` from '${props.cwd}'`;
    super({
      ...props,
      message:
        decodedFilesystemBrowseErrorMessage(props) ??
        `Failed to browse filesystem path '${props.partialPath}'${cwd}.`,
    } as any);
  }
}
