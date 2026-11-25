import type { InjectionKey } from 'vue'

export type TutorialTopic = 'first' | 'orchestra' | 'pads' | 'effects'
export const openTutorialsKey: InjectionKey<(topic?: TutorialTopic) => void> = Symbol('openTutorials')
