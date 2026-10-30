import { readFile } from "node:fs/promises";

export async function readStyles() {
  const entryUrl = new URL("../dist/styles.css", import.meta.url);
  const entry = await readFile(entryUrl, "utf8");
  const partials = [...entry.matchAll(/@import\s+url\(["']([^"']+)["']\)\s*;/g)].map((match) => match[1]);
  if (!partials.length) throw new Error("The stylesheet entry point must import its ordered partials.");
  const sources = await Promise.all(partials.map((partial) => readFile(new URL(partial, entryUrl), "utf8")));
  return [entry, ...sources].join("\n");
}
