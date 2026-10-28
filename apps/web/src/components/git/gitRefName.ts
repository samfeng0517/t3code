// Mirrors `git check-ref-format --branch`, so the dialog rejects what git would refuse.
const FORBIDDEN_PUNCTUATION = /[~^:?*[\\]/;

/** ASCII control characters, DEL and space. */
function hasControlOrSpace(name: string): boolean {
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateGitRefName(name: string): "empty" | "invalid" | null {
  if (name.length === 0) return "empty";
  if (
    name === "@" ||
    name.startsWith("-") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.endsWith(".") ||
    name.includes("..") ||
    name.includes("//") ||
    name.includes("@{") ||
    FORBIDDEN_PUNCTUATION.test(name) ||
    hasControlOrSpace(name) ||
    name.split("/").some((component) => component.startsWith(".") || component.endsWith(".lock"))
  ) {
    return "invalid";
  }
  return null;
}
