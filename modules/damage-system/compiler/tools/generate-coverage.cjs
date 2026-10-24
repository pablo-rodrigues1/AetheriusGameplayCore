const fs = require("node:fs");
const path = require("node:path");
const { compilePerk } = require("../dist/compiler.js");
const { loadPerkRecords } = require("./load-perk-export.cjs");
const root = path.resolve(__dirname, "../../../../../");
const output = path.join(root, "AetheriusGameplayCore/docs/classes/COBERTURA_PERKS_COMBATE.md");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readJsonl = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse);
const loaded = loadPerkRecords(path.join(root, "_work/exports/combat-20261024/PERK.jsonl"), path.join(root, "_work/exports/combat-20261024/PERK-effects-completos.jsonl"));
const records = new Map(loaded.records.map((record) => [record.formid, record]));
const config = readJson(path.join(root, "AetheriusGameplayCore/modules/class-system/config/classes-config.json"));
const crosswalk = readJsonl(path.join(root, "_work/exports/classes/perk-crosswalk.jsonl"));
const classes = new Map();
for (const row of crosswalk) {
  if (row.status !== "RESOLVED") continue;
  for (const candidate of row.candidates || []) for (const grant of candidate.classes || row.classes || []) {
    const match = grant.match(/^(.+)@(\d+)$/);
    if (!match) continue;
    const classId = match[1], level = Number(match[2]);
    if (!classes.has(classId)) classes.set(classId, new Map());
    const perks = classes.get(classId);
    if (!perks.has(candidate.formid)) perks.set(candidate.formid, { level, label: row.label, record: records.get(candidate.formid) });
  }
}
const entryPoints = ["ModAttackDamage", "CalculateWeaponDamage", "ModPowerAttackDamage", "ModSneakAttackMult", "CalculateMyCriticalHitChance", "CalculateMyCriticalHitDamage", "ModIncomingDamage", "ModTargetDamageResistance", "ModArmorRating", "ModPercentBlocked"];
const classIds = [...new Set([...Object.keys(config), ...classes.keys()])].sort();
const lines = ["# Cobertura de perks de combate por classe", "", "Gerado deterministicamente por modules/damage-system/compiler/tools/generate-coverage.cjs.", "Fonte: crosswalk de classes e records PERK do epoch e2-771486e30fc46d2a; os 10 records truncados foram completados pelo export complementar, sempre buscando por formid e conferindo o winner.", "", "SUPPORTED indica efeito nas dez famílias da Função 4 com condições certificadas. UNSUPPORTED é fail-closed. Outros entry points ficam fora do escopo e são contados.", ""];
for (const classId of classIds) {
  const grants = classes.get(classId) || new Map(), effects = [];
  lines.push("## " + classId, "", "Perks concedidas no crosswalk: " + grants.size + ".");
  for (const [formid, grant] of [...grants.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!grant.record) { effects.push({ formid, label: grant.label, entry: "(record ausente)", status: "UNSUPPORTED", reason: "formid não encontrado nos exports" }); continue; }
    const compiled = compilePerk(grant.record, { sourceKind: "CLASS", sourceKey: classId + "@" + grant.level, classId, level: grant.level });
    for (const rule of compiled.rules) {
      if (!rule.entryPoint) continue;
      const inScope = entryPoints.includes(rule.entryPoint);
      effects.push({ formid, label: grant.label, entry: rule.entryPoint, modification: rule.modification, value: rule.value, actorValue: rule.actorValue, priority: rule.priority, rank: rule.rank, status: inScope ? rule.status : "UNSUPPORTED", reason: inScope ? rule.reason : "fora do escopo: entry point não pertence à função 4", condition: rule.conditionFunctions.join(", ") || "sem condições", inScope });
    }
  }
  const combat = effects.filter((effect) => effect.inScope), supported = combat.filter((effect) => effect.status === "SUPPORTED").length;
  lines.push("Efeitos nas famílias de combate: " + combat.length + "; suportados: " + supported + "; UNSUPPORTED nas famílias: " + (combat.length - supported) + "; fora de escopo: " + (effects.length - combat.length) + ".", "", "| FormID local:plugin | Perk (crosswalk) | Entry point / operação | Valor / AV / prioridade / rank | Estado e motivo | Condições |", "|---|---|---|---|---|---|");
  effects.sort((a, b) => a.formid.localeCompare(b.formid) || a.entry.localeCompare(b.entry) || String(a.priority).localeCompare(String(b.priority)));
  for (const effect of effects) {
    const value = Number.isFinite(effect.value) ? String(effect.value) : "", av = effect.actorValue ? " / " + effect.actorValue : "", priority = effect.priority === undefined ? "" : " / " + effect.priority + " / " + effect.rank, operation = effect.modification ? " / " + effect.modification : "", reason = effect.reason ? ": " + effect.reason : "";
    lines.push("| " + effect.formid + " | " + effect.label + " | " + effect.entry + operation + " | " + value + av + priority + " | " + effect.status + reason + " | " + (effect.condition || "") + " |");
  }
  lines.push("");
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, lines.join("\n") + "\n", "utf8");
console.log("classes=" + classIds.length + " completed-records=" + loaded.replaced.length + " output=" + output);
