import { spawn } from 'node:child_process';

const workspaces = [
  '@aemr/shared',
  '@aemr/core',
  '@aemr/server',
  '@aemr/web',
];

const heapOption = '--max-old-space-size=4096';
const nodeOptions = [process.env.NODE_OPTIONS, heapOption]
  .filter(Boolean)
  .join(' ');
const isWindows = process.platform === 'win32';
const pnpmCommand = isWindows ? 'pnpm' : 'pnpm';

function runTypecheck(workspace) {
  return new Promise((resolve) => {
    console.log(`\n> typecheck ${workspace}`);
    const child = spawn(pnpmCommand, ['-F', workspace, 'typecheck'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
      },
      shell: isWindows,
    });

    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(error);
      resolve(1);
    });
  });
}

for (const workspace of workspaces) {
  const code = await runTypecheck(workspace);
  if (code !== 0) {
    process.exit(code);
  }
}
