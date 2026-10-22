import assert from "node:assert/strict";
import { test } from "node:test";
import { ARC_LOGO_LINES, TerminalRenderer } from "./terminal.renderer.js";

function captureConsoleOutput(run: () => void): string {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    lines.push(values.join(" "));
  };
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

test("welcome banner displays an eight-line ARC logo", () => {
  assert.equal(ARC_LOGO_LINES.length, 8);
  assert.match(ARC_LOGO_LINES.join("\n"), /A R C\s+\|\s+AUTONOMOUS REASONING CORE/);
  assert.doesNotMatch(ARC_LOGO_LINES.join("\n"), /A M C/);
});

test("development banner exposes provider details", () => {
  const output = captureConsoleOutput(() => {
    new TerminalRenderer({
      mode: "development",
      width: 100,
      interactive: false,
    }).renderWelcomeBanner();
  });

  assert.match(output, /PROVIDER/);
  assert.match(output, /MODEL/);
  assert.match(output, /ITERATIONS/);
  assert.match(output, /Development mode shows model and iteration details/);
});

test("production banner hides development details", () => {
  const output = captureConsoleOutput(() => {
    new TerminalRenderer({
      mode: "production",
      width: 100,
      interactive: false,
    }).renderWelcomeBanner();
  });

  assert.match(output, /PRODUCTION/);
  assert.doesNotMatch(output, /PROVIDER|MODEL|ITERATIONS/);
  assert.doesNotMatch(output, /Development mode shows model and iteration details/);
});

test("test banner identifies its mode without development details", () => {
  const output = captureConsoleOutput(() => {
    new TerminalRenderer({
      mode: "test",
      width: 100,
      interactive: false,
    }).renderWelcomeBanner();
  });

  assert.match(output, /MODE\s+TEST/);
  assert.doesNotMatch(output, /PROVIDER|MODEL|ITERATIONS/);
});

test("input hint fits exactly inside the configured panel width", () => {
  const terminalWidth = 64;
  const output = captureConsoleOutput(() => {
    new TerminalRenderer({
      width: terminalWidth,
      interactive: false,
    }).renderInputBox();
  });
  const hintLine = output
    .split("\n")
    .find((line) => line.includes("Type your request, then press Enter"));

  assert.ok(hintLine);
  assert.equal(
    hintLine.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").length,
    terminalWidth - 2,
  );
});

test("interactive input prompt marks ANSI sequences for readline", () => {
  const originalLog = console.log;
  console.log = () => {};
  let prompt: string;
  try {
    prompt = new TerminalRenderer({
      interactive: true,
    }).renderInputBox();
  } finally {
    console.log = originalLog;
  }

  assert.match(prompt, /\u0001/);
  assert.match(prompt, /\u0002/);
});
