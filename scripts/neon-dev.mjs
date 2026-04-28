#!/usr/bin/env node
import { neonDevRestart, neonDevStart, neonDevStatus, neonDevStop } from "./neon-dev-control.mjs";

const [command = "status", ...args] = process.argv.slice(2);

const parseOptions = () => ({
  forcePorts: args.includes("--force-ports"),
  services: args.filter((arg) => !arg.startsWith("--")),
});

const run = async () => {
  const options = parseOptions();

  if (command === "start") return neonDevStart(options);
  if (command === "stop") return neonDevStop(options);
  if (command === "restart") return neonDevRestart({ ...options, forcePorts: true });
  if (command === "status") return neonDevStatus();

  throw new Error(`Unknown command: ${command}. Use start, stop, restart, or status.`);
};

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
