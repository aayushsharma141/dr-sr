'use strict';

/** Minimal interactive prompts for the console scripts (no dependencies). */
const readline = require('node:readline');

function ask(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (mask) {
      // Overwrite each typed character with '*' while keeping the input intact.
      rl._writeToOutput = function writeToOutput(string) {
        if (string.includes(question)) rl.output.write(string);
        else if (string === '\r\n' || string === '\n') rl.output.write('\n');
        else rl.output.write('*');
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (mask) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function fail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

function heading(text) {
  const line = '─'.repeat(Math.min(70, text.length + 4));
  console.log(`\n${line}\n  ${text}\n${line}\n`);
}

module.exports = { ask, fail, heading };
