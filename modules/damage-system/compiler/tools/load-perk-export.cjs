const fs = require("node:fs");
function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse);
}
function isTruncated(record) {
  return record.fields.some((field) => field.path === "…" || /truncated/i.test((field.note || "") + " " + (field.value || "")));
}
function loadPerkRecords(exportPath, completePath) {
  const records = new Map();
  for (const record of readJsonl(exportPath)) if (record.formid && Array.isArray(record.fields)) records.set(record.formid, record);
  const replaced = [];
  for (const complete of readJsonl(completePath)) {
    if (!complete.formid || !Array.isArray(complete.fields)) continue;
    const previous = records.get(complete.formid);
    if (!previous || !isTruncated(previous)) continue;
    if (previous.winner !== complete.winner || isTruncated(complete)) throw new Error("incomplete or mismatched completion for " + complete.formid);
    records.set(complete.formid, complete);
    replaced.push(complete.formid);
  }
  return { records: [...records.values()].sort((a, b) => a.formid.localeCompare(b.formid)), replaced: replaced.sort() };
}
module.exports = { loadPerkRecords };
