import { app } from 'electron'

// Window creation and renderer communication follow in the application shell.
void app.whenReady().then(() => {
  if (process.argv.includes('--smoke')) app.quit()
})
