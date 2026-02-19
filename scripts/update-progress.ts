import { readFile, writeFile } from "fs/promises";
import { join } from "path";

type ProgressStatus = "DONE" | "IN_PROGRESS" | "TODO";

type ProgressItem = {
  id: string;
  title: string;
  status: ProgressStatus;
  details?: string;
};

type ProgressDoc = {
  project: string;
  items: ProgressItem[];
};

const root = process.cwd();
const jsonPath = join(root, "progress", "progress.json");
const markdownPath = join(root, "progress", "PROGRESS.md");

const statusMarker: Record<ProgressStatus, string> = {
  DONE: "[x]",
  IN_PROGRESS: "[-]",
  TODO: "[ ]"
};

async function main() {
  const source = await readFile(jsonPath, "utf8");
  const parsed = JSON.parse(source) as ProgressDoc;

  const lines: string[] = [];
  lines.push(`# ${parsed.project} Progress`);
  lines.push("");
  lines.push(`Last updated: ${new Date().toISOString()}`);
  lines.push("");

  for (const item of parsed.items) {
    lines.push(`- ${statusMarker[item.status]} ${item.title}`);
    if (item.details) {
      lines.push(`  - ${item.details}`);
    }
  }

  lines.push("");
  lines.push("Status legend: `[x]=DONE`, `[-]=IN_PROGRESS`, `[ ]=TODO`");

  await writeFile(markdownPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Updated ${markdownPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
