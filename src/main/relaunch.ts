export function relaunchArgs(
  argv: readonly string[],
  folder: string,
): string[] {
  const args: string[] = []
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--reopen-project') {
      index++
      continue
    }
    args.push(argv[index])
  }
  if (folder) args.push('--reopen-project', folder)
  return args
}
