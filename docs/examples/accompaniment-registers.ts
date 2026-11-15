/* eslint-disable @typescript-eslint/no-unused-vars -- Entry points are invoked by Script bindings. */
const names = ['Brass', 'Strings', 'Choir']
function selectAccompaniment(index: number): void {
  xm.registers.set(index, true)
  for (let i = 0; i < 3; i++)
    xm.pad(i + 9).color = xm.registers.get(i) ? '#3ddc97' : '#254b3e'
  xm.display('Accompaniment', names[index])
}
function selectBrass(): void {
  selectAccompaniment(0)
}
function selectStrings(): void {
  selectAccompaniment(1)
}
function selectChoir(): void {
  selectAccompaniment(2)
}
