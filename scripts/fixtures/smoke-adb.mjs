import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const rawArgs = process.argv.slice(2)
const logPath = process.env.AGENTHUB_SMOKE_ADB_LOG

if (logPath) {
  mkdirSync(path.dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${JSON.stringify(rawArgs)}\n`, 'utf8')
}

let args = [...rawArgs]
let deviceId = null
if (args[0] === '-s') {
  deviceId = args[1] ?? null
  args = args.slice(2)
}

const command = args.join(' ')

if (command === 'version') {
  console.log('Android Debug Bridge version 1.0.41')
  console.log('Version 35.0.2-smoke')
  process.exit(0)
}

if (command === 'devices -l') {
  console.log('List of devices attached')
  console.log('smoke-device device product:smoke model:AgentHub_Smoke transport_id:1')
  process.exit(0)
}

if (command === 'shell dumpsys window') {
  console.log('mCurrentFocus=Window{42 u0 com.example.allowed/.MainActivity}')
  console.log('mFocusedApp=ActivityRecord{42 u0 com.example.allowed/.MainActivity t1}')
  process.exit(0)
}

if (args[0] === 'shell' && args[1] === 'input') {
  console.log(`ok ${deviceId ?? 'default'} ${args.slice(2).join(' ')}`)
  process.exit(0)
}

if (command === 'exec-out screencap -p') {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lM8t8wAAAABJRU5ErkJggg==',
    'base64',
  )
  process.stdout.write(png)
  process.exit(0)
}

console.error(`Unsupported smoke adb command: ${rawArgs.join(' ')}`)
process.exit(2)
