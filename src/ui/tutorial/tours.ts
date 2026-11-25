import type { en } from '../../shared/i18n-en'

export interface TourStep {
  id: string
  anchor: string
  titleKey: keyof typeof en
  bodyKey: keyof typeof en
  prepare?: 'Orchestra' | 'Controls' | 'Effects'
  waitFor?: 'click' | 'change'
  controlAnchor?: 'pad' | 'fader' | 'knob'
  controller?: 'pad' | 'fader' | 'knob'
}

export interface Tour { id: string; titleKey: keyof typeof en; steps: TourStep[] }

export const tours: Tour[] = [
  { id: 'orchestra', titleKey: 'tutorial.orchestra', steps: [
    { id: 'tutorial.orchestra1', anchor: 'preset', prepare: 'Orchestra', titleKey: 'tutorial.orchestra1', bodyKey: 'tutorial.orchestra1Body', waitFor: 'change' },
    { id: 'tutorial.orchestra2', anchor: 'orchestra', prepare: 'Orchestra', titleKey: 'tutorial.orchestra2', bodyKey: 'tutorial.orchestra2Body', waitFor: 'click' },
    { id: 'tutorial.orchestra3', anchor: 'section', prepare: 'Orchestra', titleKey: 'tutorial.orchestra3', bodyKey: 'tutorial.orchestra3Body', waitFor: 'click' },
    { id: 'tutorial.orchestra4', anchor: 'range', prepare: 'Orchestra', titleKey: 'tutorial.orchestra4', bodyKey: 'tutorial.orchestra4Body' },
    { id: 'tutorial.orchestra5', anchor: 'balance', prepare: 'Orchestra', titleKey: 'tutorial.orchestra5', bodyKey: 'tutorial.orchestra5Body' },
    { id: 'tutorial.orchestra6', anchor: 'layers', prepare: 'Orchestra', titleKey: 'tutorial.orchestra6', bodyKey: 'tutorial.orchestra6Body' },
    { id: 'tutorial.orchestra7', anchor: 'fx-open', titleKey: 'tutorial.orchestra7', bodyKey: 'tutorial.orchestra7Body', waitFor: 'click' },
    { id: 'tutorial.orchestra8', anchor: 'fx-add', prepare: 'Effects', titleKey: 'tutorial.orchestra8', bodyKey: 'tutorial.orchestra8Body', waitFor: 'change' },
    { id: 'tutorial.orchestra9', anchor: 'fx-preset', prepare: 'Effects', titleKey: 'tutorial.orchestra9', bodyKey: 'tutorial.orchestra9Body' },
  ] },
  { id: 'pads', titleKey: 'tutorial.pads', steps: [
    { id: 'tutorial.pads1', anchor: 'preset', prepare: 'Orchestra', titleKey: 'tutorial.pads1', bodyKey: 'tutorial.pads1Body', waitFor: 'change' },
    { id: 'tutorial.pads2', anchor: 'map', titleKey: 'tutorial.pads2', bodyKey: 'tutorial.pads2Body', waitFor: 'click' },
    { id: 'tutorial.pads3', anchor: 'orchestra', prepare: 'Orchestra', titleKey: 'tutorial.pads3', bodyKey: 'tutorial.pads3Body', waitFor: 'click' },
    { id: 'tutorial.pads4', anchor: 'control', controlAnchor: 'pad', prepare: 'Controls', titleKey: 'tutorial.pads4', bodyKey: 'tutorial.pads4Body', controller: 'pad' },
    { id: 'tutorial.pads5', anchor: 'map', titleKey: 'tutorial.pads5', bodyKey: 'tutorial.pads5Body', waitFor: 'click' },
    { id: 'tutorial.pads6', anchor: 'timing', prepare: 'Controls', titleKey: 'tutorial.pads6', bodyKey: 'tutorial.pads6Body', waitFor: 'change' },
    { id: 'tutorial.pads7', anchor: 'transport', titleKey: 'tutorial.pads7', bodyKey: 'tutorial.pads7Body', controller: 'pad' },
  ] },
  { id: 'effects', titleKey: 'tutorial.effects', steps: [
    { id: 'tutorial.effects1', anchor: 'fx-open', titleKey: 'tutorial.effects1', bodyKey: 'tutorial.effects1Body', waitFor: 'click' },
    { id: 'tutorial.effects2', anchor: 'fx-add', prepare: 'Effects', titleKey: 'tutorial.effects2', bodyKey: 'tutorial.effects2Body', waitFor: 'change' },
    { id: 'tutorial.effects3', anchor: 'fx-preset', prepare: 'Effects', titleKey: 'tutorial.effects3', bodyKey: 'tutorial.effects3Body', waitFor: 'change' },
    { id: 'tutorial.effects4', anchor: 'fx-add', prepare: 'Effects', titleKey: 'tutorial.effects4', bodyKey: 'tutorial.effects4Body', waitFor: 'change' },
    { id: 'tutorial.effects5', anchor: 'fx-power', prepare: 'Effects', titleKey: 'tutorial.effects5', bodyKey: 'tutorial.effects5Body' },
  ] },
  { id: 'drums', titleKey: 'tutorial.drums', steps: [
    { id: 'tutorial.drums1', anchor: 'control', controlAnchor: 'fader', prepare: 'Controls', titleKey: 'tutorial.drums1', bodyKey: 'tutorial.drums1Body', waitFor: 'click' },
    { id: 'tutorial.drums2', anchor: 'roll', prepare: 'Controls', titleKey: 'tutorial.drums2', bodyKey: 'tutorial.drums2Body', waitFor: 'click' },
    { id: 'tutorial.drums3', anchor: 'roll', prepare: 'Controls', titleKey: 'tutorial.drums3', bodyKey: 'tutorial.drums3Body' },
    { id: 'tutorial.drums4', anchor: 'hits', prepare: 'Controls', titleKey: 'tutorial.drums4', bodyKey: 'tutorial.drums4Body', controller: 'fader' },
    { id: 'tutorial.drums5', anchor: 'hits', prepare: 'Controls', titleKey: 'tutorial.drums5', bodyKey: 'tutorial.drums5Body', controller: 'fader' },
    { id: 'tutorial.drums6', anchor: 'hits', prepare: 'Controls', titleKey: 'tutorial.drums6', bodyKey: 'tutorial.drums6Body', controller: 'fader' },
  ] },
  { id: 'filter', titleKey: 'tutorial.filter', steps: [
    { id: 'tutorial.filter1', anchor: 'control', controlAnchor: 'knob', prepare: 'Controls', titleKey: 'tutorial.filter1', bodyKey: 'tutorial.filter1Body', waitFor: 'click' },
    { id: 'tutorial.filter2', anchor: 'filter-instrument', prepare: 'Controls', titleKey: 'tutorial.filter2', bodyKey: 'tutorial.filter2Body' },
    { id: 'tutorial.filter3', anchor: 'sweep', prepare: 'Controls', titleKey: 'tutorial.filter3', bodyKey: 'tutorial.filter3Body', waitFor: 'click' },
    { id: 'tutorial.filter4', anchor: 'keyboard', titleKey: 'tutorial.filter4', bodyKey: 'tutorial.filter4Body' },
    { id: 'tutorial.filter5', anchor: 'control', controlAnchor: 'knob', prepare: 'Controls', titleKey: 'tutorial.filter5', bodyKey: 'tutorial.filter5Body', controller: 'knob' },
    { id: 'tutorial.filter6', anchor: 'control', controlAnchor: 'knob', prepare: 'Controls', titleKey: 'tutorial.filter6', bodyKey: 'tutorial.filter6Body', controller: 'knob' },
  ] },
  { id: 'first', titleKey: 'tutorial.first', steps: [
    { id: 'tutorial.first1', anchor: 'name', titleKey: 'tutorial.first1', bodyKey: 'tutorial.first1Body', waitFor: 'change' },
    { id: 'tutorial.first2', anchor: 'timeline', titleKey: 'tutorial.first2', bodyKey: 'tutorial.first2Body' },
    { id: 'tutorial.first3', anchor: 'keyboard', titleKey: 'tutorial.first3', bodyKey: 'tutorial.first3Body' },
    { id: 'tutorial.first4', anchor: 'transport', titleKey: 'tutorial.first4', bodyKey: 'tutorial.first4Body' },
    { id: 'tutorial.first5', anchor: 'timeline', titleKey: 'tutorial.first5', bodyKey: 'tutorial.first5Body' },
    { id: 'tutorial.first6', anchor: 'name', titleKey: 'tutorial.first6', bodyKey: 'tutorial.first6Body' },
  ] },
]
