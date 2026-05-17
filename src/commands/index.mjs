import * as login from './login.mjs'
import * as logout from './logout.mjs'
import * as whoami from './whoami.mjs'
import * as scan from './scan.mjs'
import * as issues from './issues.mjs'
import * as fix from './fix.mjs'
import * as history from './history.mjs'
import * as verify from './verify.mjs'
import * as exportCmd from './export.mjs'
import * as compare from './compare.mjs'
import * as monitor from './monitor.mjs'
import * as policy from './policy.mjs'
import * as banner from './banner.mjs'
import * as analytics from './analytics.mjs'
import * as help from './help.mjs'

export const commands = {
  login,
  logout,
  whoami,
  scan,
  issues,
  fix,
  history,
  verify,
  export: exportCmd,
  compare,
  monitor,
  policy,
  banner,
  analytics,
  help,
}
