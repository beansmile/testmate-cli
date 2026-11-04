"use strict";
// Adds the wrapper's own feedback subcommands to cobra's `feedback --help`
// listing, keeping its alphabetical order and column alignment.
const { SHORT } = require("./verification");

const LINE = /^( {2})(\S+)(\s+)(\S.*)$/;

function injectFeedbackCommands(helpText, extra = SHORT) {
  const lines = helpText.split("\n");
  const start = lines.findIndex((l) => l.trim() === "Available Commands:");
  if (start === -1) return helpText;
  let end = start + 1;
  while (end < lines.length && LINE.test(lines[end])) end++;
  const entries = lines.slice(start + 1, end).map((l) => {
    const m = LINE.exec(l);
    return { name: m[2], short: m[4] };
  });
  if (entries.length === 0) return helpText;
  for (const [name, short] of Object.entries(extra)) {
    if (!entries.some((e) => e.name === name)) entries.push({ name, short });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  // cobra: {{rpad .Name .NamePadding}} {{.Short}}, NamePadding = max(11, longest name).
  const width = Math.max(11, ...entries.map((e) => e.name.length));
  const rendered = entries.map((e) => "  " + e.name.padEnd(width) + " " + e.short);
  return [...lines.slice(0, start + 1), ...rendered, ...lines.slice(end)].join("\n");
}

module.exports = { injectFeedbackCommands };
