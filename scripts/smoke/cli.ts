import { runFamilyCli } from "../ops/command-family.ts";

process.exitCode = runFamilyCli({
  argv: process.argv.slice(2),
  family: "smoke",
});
