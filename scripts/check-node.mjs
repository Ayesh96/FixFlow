// Imported first by every entry point. Plain JavaScript so that any Node can run it and explain itself,
// instead of failing with "Unknown file extension .ts" on the first TypeScript import.
const MIN_MAJOR = 24;

if (Number(process.versions.node.split('.')[0]) < MIN_MAJOR) {
  console.error(`Code Akos needs Node ${MIN_MAJOR} or newer; this is Node ${process.versions.node}.`);
  console.error(`Install a current Node (https://nodejs.org, or \`nvm install ${MIN_MAJOR}\`) and try again.`);
  process.exit(1);
}
