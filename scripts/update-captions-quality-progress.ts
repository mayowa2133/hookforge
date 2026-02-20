import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";

export type TrackStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";

export type TrackKpi = {
  name: string;
  target: string;
  current: string;
  unit: string;
};

export type TrackDeliverable = {
  id: string;
  title: string;
  status: TrackStatus;
  evidencePath: string;
};

export type TrackRisk = {
  id: string;
  severity: string;
  mitigation: string;
};

export type QualityTrack = {
  id: string;
  title: string;
  status: TrackStatus;
  kpis: TrackKpi[];
  deliverables: TrackDeliverable[];
  risks: TrackRisk[];
};

export type QualityProgressDoc = {
  program: string;
  lastUpdated: string;
  owner: string;
  tracks: QualityTrack[];
};

const root = process.cwd();
const progressJsonPath = join(root, "progress", "captions_quality_progress.json");
const progressMarkdownPath = join(root, "progress", "CAPTIONS_QUALITY_PARITY_PLAN.md");

const APPENDIX_START = "<!-- STATIC_APPENDIX_START -->";
const APPENDIX_END = "<!-- STATIC_APPENDIX_END -->";

const statusLabel: Record<TrackStatus, string> = {
  TODO: "TODO",
  IN_PROGRESS: "IN PROGRESS",
  BLOCKED: "BLOCKED",
  DONE: "DONE"
};

const statusCheckbox: Record<TrackStatus, string> = {
  TODO: "[ ]",
  IN_PROGRESS: "[-]",
  BLOCKED: "[!]",
  DONE: "[x]"
};

export function extractAppendix(source: string | null) {
  const fallback = [
    APPENDIX_START,
    "## Static Appendix",
    "",
    "This section is preserved between progress updates.",
    "",
    "### Scope Defaults",
    "- Quality-first parity over feature-count parity.",
    "- English + top 10 launch languages remain the baseline.",
    "- URL workflows remain rights-attested only.",
    APPENDIX_END
  ].join("\n");

  if (!source) {
    return fallback;
  }

  const start = source.indexOf(APPENDIX_START);
  const end = source.indexOf(APPENDIX_END);
  if (start === -1 || end === -1 || end < start) {
    return fallback;
  }

  return source.slice(start, end + APPENDIX_END.length);
}

export function buildTrackStatusRows(tracks: QualityTrack[]) {
  return tracks
    .map(
      (track) =>
        `| ${track.id} | ${track.title} | ${statusLabel[track.status]} | ${track.deliverables.length} | ${track.risks.length} |`
    )
    .join("\n");
}

export function buildKpiRows(tracks: QualityTrack[]) {
  const rows: string[] = [];

  for (const track of tracks) {
    for (const kpi of track.kpis) {
      rows.push(`| ${track.id} | ${kpi.name} | ${kpi.current} | ${kpi.target} | ${kpi.unit} |`);
    }
  }

  return rows.join("\n");
}

export function buildDeliverableLines(tracks: QualityTrack[]) {
  const lines: string[] = [];
  for (const track of tracks) {
    lines.push(`### ${track.title}`);
    for (const deliverable of track.deliverables) {
      lines.push(
        `- ${statusCheckbox[deliverable.status]} ${deliverable.id}: ${deliverable.title} (evidence: \`${deliverable.evidencePath}\`)`
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function buildRiskRows(tracks: QualityTrack[]) {
  const rows: string[] = [];
  for (const track of tracks) {
    for (const risk of track.risks) {
      rows.push(`| ${track.id} | ${risk.id} | ${risk.severity} | ${risk.mitigation} |`);
    }
  }
  return rows.join("\n");
}

export function parseProgressDoc(raw: string) {
  const parsed = JSON.parse(raw) as QualityProgressDoc;
  if (!parsed.program || !parsed.owner || !Array.isArray(parsed.tracks)) {
    throw new Error("Invalid captions quality progress document");
  }
  return parsed;
}

async function main() {
  const jsonRaw = await readFile(progressJsonPath, "utf8");
  const doc = parseProgressDoc(jsonRaw);

  let existingMarkdown: string | null = null;
  try {
    existingMarkdown = await readFile(progressMarkdownPath, "utf8");
  } catch {
    existingMarkdown = null;
  }

  const appendix = extractAppendix(existingMarkdown);
  const nowIso = new Date().toISOString();
  doc.lastUpdated = nowIso;
  await writeFile(progressJsonPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push(`# ${doc.program}`);
  lines.push("");
  lines.push(`Owner: ${doc.owner}`);
  lines.push(`Last updated: ${doc.lastUpdated}`);
  lines.push("");

  lines.push("## Track Status");
  lines.push("");
  lines.push("| Track ID | Title | Status | Deliverables | Risks |");
  lines.push("| --- | --- | --- | --- | --- |");
  lines.push(buildTrackStatusRows(doc.tracks));
  lines.push("");

  lines.push("## KPIs By Track");
  lines.push("");
  lines.push("| Track ID | KPI | Current | Target | Unit |");
  lines.push("| --- | --- | --- | --- | --- |");
  lines.push(buildKpiRows(doc.tracks));
  lines.push("");

  lines.push("## Deliverables Checklist");
  lines.push("");
  lines.push(buildDeliverableLines(doc.tracks));
  lines.push("");

  lines.push("## Risks And Mitigations");
  lines.push("");
  lines.push("| Track ID | Risk ID | Severity | Mitigation |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(buildRiskRows(doc.tracks));
  lines.push("");

  lines.push(appendix);
  lines.push("");
  lines.push("Status legend: `[x]=DONE`, `[-]=IN_PROGRESS`, `[!]=BLOCKED`, `[ ]=TODO`");

  await writeFile(progressMarkdownPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Updated ${progressMarkdownPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
