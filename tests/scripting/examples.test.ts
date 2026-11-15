import { expect, it } from 'vitest'
import ts from 'typescript'
import { scriptDeclarations } from '../../src/shared/script-declarations'
import reprise from '../../docs/examples/reprise-pad.ts?raw'
import split from '../../docs/examples/reprise-split.ts?raw'
import registers from '../../docs/examples/accompaniment-registers.ts?raw'
for (const [name, source] of Object.entries({ reprise, split, registers }))
  it(`typechecks the ${name} example against the emitted project declarations`, () => {
    const options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: [],
      skipLibCheck: true,
    }
    const files: Record<string, string> = {
      '/virtual/script.ts': source,
      '/virtual/xm.d.ts': scriptDeclarations,
    }
    const host = ts.createCompilerHost(options),
      original = host.getSourceFile.bind(host)
    host.getSourceFile = (file, version, onError, create) =>
      files[file] === undefined
        ? original(file, version, onError, create)
        : ts.createSourceFile(file, files[file], version)
    const diagnostics = ts.getPreEmitDiagnostics(
      ts.createProgram(Object.keys(files), options, host),
    )
    expect(
      diagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      ),
    ).toEqual([])
  })
