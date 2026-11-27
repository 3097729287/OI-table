import { useMessages, type MessageKey } from "../../../../i18n";

const errorMessages: Readonly<Partial<Record<string, MessageKey>>> = {
  invalid_directory: "libraryManagementInvalidDirectory",
  invalid_zip: "libraryManagementInvalidZip",
  invalid_import_source: "libraryManagementInvalidSource",
  missing_manifest: "libraryManagementMissingManifest",
  package_too_large: "libraryManagementPackageTooLarge",
  package_encoding: "libraryManagementPackageEncoding",
  package_file_read: "libraryManagementPackageFileRead",
  native_picker_unavailable: "libraryManagementPickerUnavailable",
  unsupported_database: "libraryManagementUnsupportedDatabase",
  invalid_package: "libraryManagementInvalidPackage",
  stale_release: "libraryManagementStaleRelease",
  release_conflict: "libraryManagementReleaseConflict",
  library_not_found: "libraryManagementNotFound",
  library_uninstalled: "libraryManagementNeedsReinstall",
};

export function format(message: string, values: Record<string, string | number>) {
  return message.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));
}

export function operationError(error: unknown, fallback: MessageKey) {
  const result = typeof error === "object" && error !== null ? error : undefined;
  const code = result && "code" in result && typeof result.code === "string" ? result.code : undefined;
  const detail = result && "message" in result && typeof result.message === "string"
    ? result.message : typeof error === "string" ? error : undefined;
  return { title: code && Object.hasOwn(errorMessages, code) ? errorMessages[code] ?? fallback : fallback, detail };
}

export function ErrorDetails({ detail }: { detail: string }) {
  const messages = useMessages();
  return (
    <details>
      <summary>{messages.libraryManagementErrorDetails}</summary>
      <p data-selectable>{detail}</p>
    </details>
  );
}
