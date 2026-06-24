// 跨平台启动 electron 主进程的 dev 入口。
// 用 child_process.spawn 注入 AGENTHUB_DEV=1，避免引入 cross-env 依赖。
// 详见 Spec 12 §7.2。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const localElectron = process.platform === 'win32'
  ? path.resolve('node_modules/electron/dist/electron.exe')
  : path.resolve('node_modules/.bin/electron')

const child = spawn(existsSync(localElectron) ? localElectron : 'electron', ['dist-electron/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    AGENTHUB_DEV: '1',
    AGENTHUB_DEV_URL: process.env.AGENTHUB_DEV_URL ?? 'http://localhost:3101',
  },
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0)
  } else {
    process.exit(code ?? 0)
  }
})
