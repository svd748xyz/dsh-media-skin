/**
 * 设置的持久化。
 *
 * 存两份东西：
 *   `$DSH_HOME/dsh-media-skin.json`        用户设置（界面滑块写这里）
 *   `$DSH_HOME/dsh-media-skin/media/`      界面上"选择文件"上传进来的素材副本
 *
 * 为什么不写 profile 的 `cordis.patch.yml`：那是用户自己的补丁层，里面还有别的插件的行、
 * 注释和 `!!js` 表达式；插件去改写它迟早会踩到别人的配置。这里写的是插件自己的数据文件，
 * 刷新页面、重启 DSH 都还在。
 *
 * 写文件走"临时文件 + rename"：写到一半崩溃时旧文件仍然完整，不会留下半个 JSON。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DEFAULTS, merge, sanitize } from './defaults.js'

/** 状态文件名（在 $DSH_HOME 下）。 */
const FILE_NAME = 'dsh-media-skin.json'
/** 上传素材的子目录。 */
const MEDIA_DIR = 'dsh-media-skin/media'

/** 解析 $DSH_HOME：环境变量优先，否则退回 `~/.dsh`。 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    try {
      return path.resolve(fromEnv.trim())
    } catch {
      /* 环境变量坏了就退回默认值 */
    }
  }
  return path.join(os.homedir(), '.dsh')
}

/** 设置文件的绝对路径。 */
export function statePath() {
  return path.join(resolveDshHome(), FILE_NAME)
}

/** 上传素材目录的绝对路径。 */
export function mediaDir() {
  return path.join(resolveDshHome(), MEDIA_DIR)
}

/**
 * 读设置。文件不存在、内容坏了、或者读不了，都只返回默认值 —— 皮肤坏了不能连累 DSH 启动。
 * @returns {object} 清洗过的设置。
 */
export function readSettings() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8')
    return sanitize(JSON.parse(raw))
  } catch {
    return sanitize(DEFAULTS)
  }
}

/**
 * 原子写设置。
 * @param {object} settings 已经清洗过的设置。
 */
export function writeSettings(settings) {
  const target = statePath()
  const dir = path.dirname(target)
  fs.mkdirSync(dir, { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, target)
}

/**
 * 合并补丁、清洗、落盘，一次做完。
 * @param {object} patch 部分设置。
 * @returns {object} 落盘后的完整设置。
 */
export function patchSettings(patch) {
  const next = sanitize(merge(readSettings(), patch))
  writeSettings(next)
  return next
}
