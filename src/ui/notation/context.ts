import type { InjectionKey, ShallowRef } from 'vue'
import type { NotationPage } from './svg-page'
export interface NotationView {
  readonly merged: ShallowRef<{ staffTrackIds: string[] } | null>
  readonly pages: ShallowRef<ReadonlyMap<number, NotationPage>>
  readonly busy: ShallowRef<boolean>
}
export const notationKey: InjectionKey<NotationView> = Symbol('notation')
