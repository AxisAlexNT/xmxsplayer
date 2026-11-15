import type { Project } from './model'
const colors = [
  '#7c8cff',
  '#b07cff',
  '#ff7ac8',
  '#ffd43b',
  '#3ddc97',
  '#2dd4bf',
  '#38bdf8',
  '#94a3b8',
]
export function registerColor(project: Project, index: number): string {
  const group = project.registers[index]?.group
  const first = group
    ? project.registers.findIndex((r) => r.group === group)
    : index
  return colors[Math.max(0, first) % colors.length]
}
