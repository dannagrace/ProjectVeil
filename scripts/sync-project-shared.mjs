import { syncProjectShared } from "./project-shared-parity.mjs";

const { changedFiles } = syncProjectShared();

if (changedFiles.length === 0) {
  console.log("project-shared mirror is already up to date.");
} else {
  console.log(`Updated ${changedFiles.length} mirrored file(s):`);
  for (const filePath of changedFiles) {
    console.log(`- ${filePath}`);
  }
}
