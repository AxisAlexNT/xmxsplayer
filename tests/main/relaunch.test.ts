import { expect, it } from 'vitest'
import { relaunchArgs } from '../../src/main/relaunch'
it('preserves the application entry and restores the current folder once',()=>{
  expect(relaunchArgs(['.'],'/songs/Live rig')).toEqual(['.','--reopen-project','/songs/Live rig'])
  expect(relaunchArgs(['.','--reopen-project','/songs/Old','--flag'],'/songs/New')).toEqual(['.','--flag','--reopen-project','/songs/New'])
  expect(relaunchArgs(['--reopen-project','/songs/Old'],'')).toEqual([])
})
