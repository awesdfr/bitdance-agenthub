import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const stageDir = path.join(root, '.electron-package')
const releaseDir = path.join(root, 'release')

function assertInsideRoot(target, label) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(`${label} is outside project root: ${resolvedTarget}`)
  }
}

function resetDir(target, label) {
  assertInsideRoot(target, label)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
}

function copyDir(src, dest, label) {
  if (!fs.existsSync(src)) {
    throw new Error(`${label} does not exist: ${src}`)
  }
  fs.cpSync(src, dest, { recursive: true, force: true, dereference: true })
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const rootPkg = readJson(path.join(root, 'package.json'))
const electronPkg = readJson(
  path.join(root, 'node_modules', 'electron', 'package.json'),
)
const builderCli = path.join(
  root,
  'node_modules',
  'electron-builder',
  'out',
  'cli',
  'cli.js',
)

resetDir(stageDir, 'Electron staging directory')

copyDir(path.join(root, 'dist-electron'), path.join(stageDir, 'dist-electron'), 'dist-electron')
fs.mkdirSync(path.join(stageDir, '.next'), { recursive: true })
copyDir(
  path.join(root, '.next', 'standalone'),
  path.join(stageDir, '.next', 'standalone'),
  'Next standalone output',
)

const buildConfig = {
  appId: rootPkg.build?.appId ?? 'com.agenthub.app',
  productName: rootPkg.build?.productName ?? 'AgentHub',
  electronVersion: electronPkg.version,
  directories: {
    output: releaseDir,
    buildResources: path.join(root, 'build'),
  },
  asar: true,
  asarUnpack: ['.next/standalone/**'],
  files: ['dist-electron/**', '.next/standalone/**', 'package.json'],
  npmRebuild: false,
  win: rootPkg.build?.win ?? {
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: rootPkg.build?.nsis ?? {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
}

const stagePkg = {
  name: 'agenthub-desktop',
  version: rootPkg.version,
  description: rootPkg.description,
  author: rootPkg.author,
  license: rootPkg.license,
  packageManager: 'npm@10.9.2',
  main: rootPkg.main,
  dependencies: {},
  devDependencies: {},
  build: buildConfig,
}

fs.writeFileSync(
  path.join(stageDir, 'package.json'),
  JSON.stringify(stagePkg, null, 2) + '\n',
)

if (!fs.existsSync(builderCli)) {
  throw new Error(`electron-builder CLI not found: ${builderCli}`)
}

const result = spawnSync(process.execPath, [builderCli, '--projectDir', stageDir], {
  cwd: root,
  env: {
    ...process.env,
    USE_HARD_LINKS: 'false',
  },
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
