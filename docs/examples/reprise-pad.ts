xm.on('control', (e) => {
  if (e.id !== 'pad.2' || !e.pressed || e.edge !== 'press') return
  if (xm.transport.bar < 33)
    xm.track('drums').playNote(38, Math.max(1, Math.round(e.value * 127)), 0.25)
  else xm.track('horn').playNote(53, 100, 2)
})
xm.on('bar', ({ bar }) => {
  if (bar === 33) xm.scene.activate('reprise')
})
