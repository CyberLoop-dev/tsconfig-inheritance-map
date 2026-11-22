#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function stripJsonComments(input) {
  let out = "", inString = false, escaped = false, line = false, block = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (line) { if (ch === "\n") { line = false; out += ch; } else out += " "; continue; }
    if (block) { if (ch === "*" && next === "/") { out += "  "; i++; block = false; } else out += ch === "\n" ? "\n" : " "; continue; }
    if (inString) { out += ch; if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "/" && next === "/") { line = true; out += "  "; i++; continue; }
    if (ch === "/" && next === "*") { block = true; out += "  "; i++; continue; }
    out += ch;
  }
  if (block) throw new Error("Unclosed block comment");
  return out.replace(/,\s*([}\]])/g, "$1");
}
function readConfig(file) {
  try { return JSON.parse(stripJsonComments(fs.readFileSync(file, "utf8"))); }
  catch (error) { throw new Error(file + ": " + error.message); }
}
function locateParent(reference, fromDir) {
  const base = reference.startsWith(".") || path.isAbsolute(reference)
    ? path.resolve(fromDir, reference)
    : path.resolve(process.cwd(), "node_modules", reference);
  const candidates = [base, base + ".json", path.join(base, "tsconfig.json")];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}
function mergeConfig(parent, child) {
  const result = { ...parent, ...child };
  result.compilerOptions = { ...(parent.compilerOptions || {}), ...(child.compilerOptions || {}) };
  return result;
}
function loadChain(file, stack, chain, warnings) {
  const absolute = path.resolve(file);
  if (stack.includes(absolute)) {
    warnings.push("Circular extends detected: " + [...stack, absolute].map(x => path.relative(process.cwd(), x)).join(" -> "));
    return {};
  }
  if (!fs.existsSync(absolute)) { warnings.push("Missing config: " + absolute); return {}; }
  const config = readConfig(absolute);
  const nextStack = [...stack, absolute];
  const refs = config.extends == null ? [] : (Array.isArray(config.extends) ? config.extends : [config.extends]);
  let merged = {};
  for (const ref of refs) {
    if (typeof ref !== "string") { warnings.push("Ignoring non-string extends entry in " + absolute); continue; }
    const parent = locateParent(ref, path.dirname(absolute));
    if (!parent) { warnings.push("Could not resolve extends '" + ref + "' from " + absolute); continue; }
    merged = mergeConfig(merged, loadChain(parent, nextStack, chain, warnings));
  }
  chain.push(absolute);
  return mergeConfig(merged, config);
}
function main() {
  const args = process.argv.slice(2), target = args.find(x => !x.startsWith("--")) || "tsconfig.json";
  const json = args.includes("--json"), chain = [], warnings = [];
  const effective = loadChain(path.resolve(target), [], chain, warnings);
  const result = { entry: path.resolve(target), chain, warnings, effective };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("TSConfig inheritance chain");
    chain.forEach((item, i) => console.log("  " + (i + 1) + ". " + path.relative(process.cwd(), item)));
    console.log("\nEffective compilerOptions");
    console.log(JSON.stringify(effective.compilerOptions || {}, null, 2));
    if (warnings.length) { console.log("\nWarnings"); warnings.forEach(w => console.log("  ! " + w)); }
  }
  if (warnings.length) process.exitCode = 1;
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
