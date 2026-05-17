import { clearCredentials } from '../config.mjs'

export const helpText = `
crawlfix logout

  Delete the locally stored credentials at ~/.crawlfix/credentials.json.
  Does not invalidate the token on the server.
`.trim()

export async function run() {
  const had = await clearCredentials()
  if (had) {
    process.stdout.write('Logged out.\n')
  } else {
    process.stdout.write('No credentials were stored.\n')
  }
}
