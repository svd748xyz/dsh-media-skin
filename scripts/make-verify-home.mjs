/**
 * 造一个**独立、可抛弃**的 DSH_HOME + profile，只挂 dsh-base + dsh-web-app + 本插件，
 * 用来在不碰你正在用的 DSH 的前提下，把界面真跑一遍（配合 ego 浏览器验收）。
 *
 * 用法：node scripts/make-verify-home.mjs [--home <目录>] [--profile verify] [--theme light|dark]
 *
 * --theme 会往 profile 的 cordis.patch.yml 写一条 ui-theme 覆盖，用来在深色壳里验收
 * （宿主真实属性是 body[data-ds-dark-theme]，本插件的深色分支靠它识别）。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

const args = { home: path.join(packageRoot, '.verify-home'), profile: 'verify', theme: null }
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (token === '--home') args.home = process.argv[(index += 1)]
  else if (token === '--profile') args.profile = process.argv[(index += 1)]
  else if (token === '--theme') args.theme = process.argv[(index += 1)]
}
if (args.theme !== null && args.theme !== 'light' && args.theme !== 'dark') {
  throw new Error(`--theme 只接受 light 或 dark，收到：${args.theme}`)
}

const home = path.resolve(args.home)
const profileDir = path.join(home, 'profiles', args.profile)
const linkPath = path.join(profileDir, 'node_modules', manifest.name)

fs.mkdirSync(path.dirname(linkPath), { recursive: true })

const profileManifest = {
  name: `dsh-profile-${args.profile}`,
  private: true,
  dependencies: { [manifest.name]: `link:${packageRoot.replace(/\\/gu, '/')}` },
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', manifest.name],
    },
  },
}
// 关键：不能带 BOM —— 内核用 JSON.parse 读 profile 的 package.json，BOM 会直接抛。
fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8')

try {
  if (fs.lstatSync(linkPath).isSymbolicLink()) fs.unlinkSync(linkPath)
} catch {
  /* 不存在 */
}
fs.symlinkSync(packageRoot, linkPath, 'junction')

// --theme：写 profile 的 patch 层，覆盖壳的 ui-theme（id 由 dsh-web-app 提供）。
if (args.theme !== null) {
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  const patch = [
    '# 由 scripts/make-verify-home.mjs --theme 生成，仅用于验收。',
    '- id: ui-theme',
    '  name: "@deepseek-ai/dsh-client-ui-theme"',
    '  config:',
    `    preference: ${args.theme}`,
    '',
  ].join('\n')
  fs.writeFileSync(patchFile, patch, 'utf8')
}

console.log(JSON.stringify({ home, profileDir, profile: args.profile, theme: args.theme }))
